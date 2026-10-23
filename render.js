const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// 1. Limpiador de textos internos de los SVGs (diagramas y props)
function sanitizeSvgTexts(esc, matchesDestacados) {
  let raw1 = (esc.texto_1 || '').trim();
  let raw2 = (esc.texto_2 || '').trim();
  let raw3 = (esc.texto_3 || '').trim();

  if (/ vs\.? /i.test(raw1) && (!raw2 || /^vs\.?$/i.test(raw2))) {
    const parts = raw1.split(/ vs\.? /i);
    raw1 = parts[0].trim();
    raw2 = (parts[1] || '').trim();
  }

  if (/^(vs\.?|contra|versus)$/i.test(raw2)) {
    raw2 = matchesDestacados[1] || '';
  }

  const cleanRedundant = (str) => str
    .replace(/\(\s*(señuelo|ganador|trampa|premio)\s*\)/gi, '')
    .replace(/\b(vs\.?|versus)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  raw1 = cleanRedundant(raw1) || matchesDestacados[0] || 'OPCIÓN A';
  raw2 = cleanRedundant(raw2) || matchesDestacados[1] || 'OPCIÓN B';
  raw3 = cleanRedundant(raw3) || matchesDestacados[2] || 'OPCIÓN C';

  return [raw1.toUpperCase(), raw2.toUpperCase(), raw3.toUpperCase()];
}

// Normalizador para emparejar palabras del guion con las palabras de ElevenLabs sin desfase
function normalizeForMatch(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// 2. Motor de alineación de subtítulos de alta precisión (Sin desfase final ni signos sueltos)
function buildSubtitleChunks(escenas, alignmentData, realAudioDuration) {
  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'TAMBIEN', 'TAMBIÉN', 'ERA',
    'O', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE', 'MI', 'MIS', 'TUS', 'NOS', 'NI'
  ]);

  // Extraer tokens por espacio real (evita que "petición**." cree un token "." suelto que desfase el índice)
  const sceneTokensList = escenas.map(esc => {
    const raw = (esc.subtitulo || '').trim();
    if (!raw) return [];

    const tokens = [];
    let inBold = false;
    const rawWords = raw.split(/\s+/);

    rawWords.forEach(rw => {
      if (!rw) return;
      const starCount = (rw.match(/\*/g) || []).length;
      const startsBold = rw.startsWith('*');
      const endsBold = rw.endsWith('*') && starCount >= 2;

      const isHighlighted = inBold || starCount >= 2 || startsBold;
      const cleanWord = rw.replace(/[*#_~`]/g, '').trim();

      if (starCount % 2 !== 0) {
        inBold = !inBold;
      } else if (startsBold && !endsBold && starCount === 2) {
        inBold = true;
      }

      if (!cleanWord) return;

      // Si por error tipográfico viene un signo de puntuación suelto (ej. "." o "..."), lo unimos a la palabra anterior
      if (/^[.,;!?¡¿…]+$/.test(cleanWord)) {
        if (tokens.length > 0) {
          tokens[tokens.length - 1].text += cleanWord;
        }
        return;
      }

      tokens.push({ text: cleanWord, highlight: isHighlighted });
    });

    return tokens;
  });

  // Extraer palabras reales desde character_start_times_seconds de ElevenLabs
  let elevenWords = [];
  if (alignmentData && Array.isArray(alignmentData.characters) && Array.isArray(alignmentData.character_start_times_seconds)) {
    const chars = alignmentData.characters;
    const starts = alignmentData.character_start_times_seconds;
    const ends = alignmentData.character_end_times_seconds || starts;
    let curWord = '';
    let wStart = null;
    let wEnd = null;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/\s/.test(ch)) {
        if (curWord.length > 0) {
          if (!/^[.,;!?¡¿…]+$/.test(curWord)) {
            elevenWords.push({
              word: curWord,
              norm: normalizeForMatch(curWord),
              start: wStart,
              end: wEnd
            });
          } else if (elevenWords.length > 0) {
            elevenWords[elevenWords.length - 1].word += curWord;
            elevenWords[elevenWords.length - 1].end = wEnd;
          }
          curWord = '';
          wStart = null;
        }
      } else {
        if (wStart === null) wStart = starts[i];
        wEnd = ends[i];
        curWord += ch;
      }
    }
    if (curWord.length > 0) {
      if (!/^[.,;!?¡¿…]+$/.test(curWord)) {
        elevenWords.push({
          word: curWord,
          norm: normalizeForMatch(curWord),
          start: wStart,
          end: wEnd
        });
      } else if (elevenWords.length > 0) {
        elevenWords[elevenWords.length - 1].word += curWord;
        elevenWords[elevenWords.length - 1].end = wEnd;
      }
    }
  }

  function calcTokenWeight(tk) {
    const clean = tk.text.replace(/[.,;!?¡¿"«»()]/g, '');
    let w = Math.max(2, clean.length);
    // Si contiene dígitos (ej. 76%, 1913), al pronunciarse en español ocupa muchas más sílabas
    if (/\d/.test(clean)) w += 6.5;
    if (/[,;:]/.test(tk.text)) w += 2.8;
    if (/[.!?…]/.test(tk.text)) w += 4.2;
    return w;
  }

  // Emparejamiento global inteligente palabra a palabra (Con ventana de re-enganche anti-deriva)
  const flatTokens = [];
  sceneTokensList.forEach((tokens, sIdx) => {
    tokens.forEach((tk, tIdx) => {
      flatTokens.push({ sIdx, tIdx, tk, norm: normalizeForMatch(tk.text), matchedStart: null, matchedEnd: null });
    });
  });

  if (elevenWords.length > 0 && flatTokens.length > 0) {
    let ewCursor = 0;
    for (let i = 0; i < flatTokens.length; i++) {
      const targetNorm = flatTokens[i].norm;
      let bestMatchIdx = -1;

      // Buscar coincidencia exacta o parcial en una ventana cercana [-1, +4] para absorber desajustes
      for (let offset = 0; offset <= 4; offset++) {
        const candidateIdx = ewCursor + offset;
        if (candidateIdx >= elevenWords.length) break;
        const candNorm = elevenWords[candidateIdx].norm;
        if (candNorm && targetNorm && (candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm))) {
          bestMatchIdx = candidateIdx;
          break;
        }
      }

      if (bestMatchIdx !== -1) {
        flatTokens[i].matchedStart = elevenWords[bestMatchIdx].start;
        flatTokens[i].matchedEnd = elevenWords[bestMatchIdx].end;
        ewCursor = bestMatchIdx + 1;
      } else if (ewCursor < elevenWords.length) {
        // Si es un número o símbolo que no coincide literalmente, usamos la posición proporcional segura
        flatTokens[i].matchedStart = elevenWords[ewCursor].start;
        flatTokens[i].matchedEnd = elevenWords[ewCursor].end;
        ewCursor++;
      }
    }
  }

  // Usamos el fin real de la voz hablada (sin el padding de silencio final) para el fallback fonético
  const lastSpokenEnd = elevenWords.length > 0
    ? elevenWords[elevenWords.length - 1].end
    : Math.max(1, realAudioDuration - 0.18);

  const sceneWeights = sceneTokensList.map(tokens => {
    const sum = tokens.reduce((acc, tk) => acc + calcTokenWeight(tk), 0);
    return Math.max(3, sum);
  });
  const totalScriptWeight = sceneWeights.reduce((a, b) => a + b, 0);

  let cumulativeWeight = 0;
  let flatIdx = 0;
  const allChunks = [];

  escenas.forEach((esc, idx) => {
    const tokens = sceneTokensList[idx];
    const sWeight = sceneWeights[idx];

    const phoneticStart = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;
    cumulativeWeight += sWeight;
    const phoneticEnd = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;

    const sceneFlatSlice = flatTokens.slice(flatIdx, flatIdx + tokens.length);
    flatIdx += tokens.length;

    let sceneStart = (idx === 0) ? 0 : phoneticStart;
    let sceneEnd = (idx === escenas.length - 1) ? realAudioDuration : phoneticEnd;

    const firstMatched = sceneFlatSlice.find(f => f.matchedStart !== null);
    const lastMatched = [...sceneFlatSlice].reverse().find(f => f.matchedEnd !== null);

    if (firstMatched && lastMatched) {
      sceneStart = (idx === 0) ? 0 : Math.max(0, firstMatched.matchedStart - 0.04);
      sceneEnd = (idx === escenas.length - 1)
        ? realAudioDuration
        : Math.min(realAudioDuration, lastMatched.matchedEnd + 0.06);
    }

    esc.inicio = sceneStart;
    esc.fin = sceneEnd;

    if (tokens.length === 0) return;

    // Agrupar en bloques ágiles de 2 a 3 palabras (máx 18 caracteres)
    const groups = [];
    let currentGroup = [];
    let currentChars = 0;

    sceneFlatSlice.forEach((item) => {
      currentGroup.push(item);
      currentChars += item.tk.text.length;
      const hasPunct = /[.,;!?]/.test(item.tk.text);

      if (currentGroup.length >= 3 || currentChars >= 18 || (hasPunct && currentGroup.length >= 2)) {
        groups.push(currentGroup);
        currentGroup = [];
        currentChars = 0;
      }
    });
    if (currentGroup.length > 0) {
      if (groups.length > 0 && currentGroup.length === 1 && groups[groups.length - 1].length < 3) {
        groups[groups.length - 1].push(currentGroup[0]);
      } else {
        groups.push(currentGroup);
      }
    }

    // Garantizar al menos 1 palabra resaltada por bloque
    groups.forEach(g => {
      if (!g.some(item => item.tk.highlight)) {
        let bestIdx = -1;
        let maxLen = 0;
        g.forEach((item, i) => {
          const clean = item.tk.text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g, '').toUpperCase();
          if (!stopWords.has(clean) && clean.length > maxLen) {
            maxLen = clean.length;
            bestIdx = i;
          }
        });
        if (bestIdx !== -1 && maxLen >= 4) {
          g[bestIdx].tk.highlight = true;
        }
      }
    });

    const dur = Math.max(0.2, sceneEnd - sceneStart);
    let cursor = sceneStart;

    groups.forEach((g, gIdx) => {
      const gWeight = g.reduce((acc, item) => acc + calcTokenWeight(item.tk), 0);
      const gDur = (gWeight / sWeight) * dur;
      let gStart = cursor;
      let gEnd = (gIdx === groups.length - 1) ? sceneEnd : (cursor + gDur);

      let wCursor = gStart;
      const timedWords = g.map((item, wIdx) => {
        let wStart, wEnd;
        if (item.matchedStart !== null && item.matchedEnd !== null) {
          wStart = item.matchedStart;
          wEnd = item.matchedEnd;
        } else {
          const wWeight = calcTokenWeight(item.tk);
          const wDur = (wWeight / gWeight) * (gEnd - gStart);
          wStart = wCursor;
          wEnd = (wIdx === g.length - 1) ? gEnd : (wCursor + wDur);
          wCursor = wEnd;
        }
        return {
          text: item.tk.text,
          highlight: item.tk.highlight,
          start: wStart,
          end: wEnd
        };
      });

      if (timedWords.length > 0 && g[0].matchedStart !== null) {
        gStart = timedWords[0].start;
        gEnd = timedWords[timedWords.length - 1].end + 0.04;
      }

      allChunks.push({
        start: gStart,
        end: gEnd,
        words: timedWords
      });

      cursor = gEnd;
    });
  });

  // Ajustar continuidad entre bloques para que no parpadeen ni se pisen
  for (let i = 0; i < allChunks.length - 1; i++) {
    if (allChunks[i].end > allChunks[i + 1].start) {
      allChunks[i].end = allChunks[i + 1].start;
    } else if (allChunks[i + 1].start - allChunks[i].end < 0.12) {
      allChunks[i].end = allChunks[i + 1].start;
    }
  }

  return allChunks;
}

async function main() {
  console.log('🚀 Iniciando motor de renderizado Viral (SVGs Intactos + Sincronización Exacta + Música 8%)...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  let payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  if (Array.isArray(payload) && payload.length > 0) payload = payload[0];
  if (payload.json) payload = payload.json;

  // 1. Extraer y verificar audio Base64 de ElevenLabs
  const rawBase64 = (payload.audio_base64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error('❌ CRÍTICO: payload.audio_base64 llegó vacío desde n8n. Revisa la salida de ElevenLabs.');
  }
  fs.writeFileSync('audio_raw.mp3', Buffer.from(rawBase64, 'base64'));
  console.log(`📦 Audio MP3 decodificado correctamente (${fs.statSync('audio_raw.mp3').size} bytes).`);

  const hasExactTimestamps = !!(payload.alignment && payload.alignment.characters);

  if (hasExactTimestamps) {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  } else {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "silenceremove=stop_periods=-1:stop_duration=0.22:stop_threshold=-38dB,atempo=1.04,apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  }

  // ============================================================================
  // 2. OBTENCIÓN DE LA DURACIÓN REAL EXACTA (nk=1 sobre WAV limpio)
  // ============================================================================
  let realAudioDuration = 26;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) {
      realAudioDuration = parsed;
      console.log(`🎙️ Duración real exacta medida en WAV: ${realAudioDuration.toFixed(3)}s`);
    }
  } catch (err) {
    console.error('⚠️ Fallo al medir con ffprobe, usando fallback:', err.message);
    realAudioDuration = Number(payload.duracion_total) || 26;
  }

  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

  // ============================================================================
  // 2.5 MEZCLA DE MÚSICA DE FONDO EN 2 PASOS SEGUROS (Volumen afinado al 8%)
  // ============================================================================
  try {
    const bgMusicPath = path.resolve('bg_music.mp3');
    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      console.log(`🎵 bg_music.mp3 detectado (${fs.statSync(bgMusicPath).size} bytes). Preparando pista musical al 8%...`);
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);

      // Paso A: Convertir bg_music.mp3 a WAV estéreo 44.1kHz con volumen suave al 8% (0.08)
      execSync(
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.08,afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );

      // Paso B: Mezclar los dos WAVs gemelos manteniendo la voz al 105% de presencia
      try {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.05[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      } catch (amixErr) {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=2.1[v];[1:a]volume=2.0[m];[v][m]amix=inputs=2:duration=first:dropout_transition=2" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      }

      if (!fs.existsSync('audio.wav') || fs.statSync('audio.wav').size < 1000) {
        throw new Error('El archivo audio.wav mezclado quedó vacío.');
      }
      console.log('✅ ¡Mezcla de voz + música completada con éxito!');
    } else {
      console.log('⚠️ No se encontró bg_music.mp3 válido. Usando voz limpia.');
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (audioErr) {
    console.warn('⚠️ Error al mezclar bg_music.mp3, garantizando audio con voz limpia:', audioErr.message);
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

  // ============================================================================
  // 3. SELECCIÓN DE COLOR DE ÉNFASIS ÚNICO PARA CADA VÍDEO
  // ============================================================================
  const accentPalettes = [
    { name: 'Cian Eléctrico', hex: '#00f2fe', glow: 'rgba(0, 242, 254, 0.75)' },
    { name: 'Verde Neón', hex: '#39ff14', glow: 'rgba(57, 255, 20, 0.70)' },
    { name: 'Amarillo Dorado', hex: '#ffd000', glow: 'rgba(255, 208, 0, 0.75)' },
    { name: 'Magenta Vibrante', hex: '#ff2a85', glow: 'rgba(255, 42, 133, 0.75)' },
    { name: 'Naranja Fuego', hex: '#ff6b00', glow: 'rgba(255, 107, 0, 0.75)' },
    { name: 'Violeta Eléctrico', hex: '#c77dff', glow: 'rgba(199, 125, 255, 0.75)' }
  ];

  const seedStr = (payload.tema_titulo || '') + (payload.categoria || '') + String(Date.now());
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) % 100000;
  }
  const chosenAccent = accentPalettes[hash % accentPalettes.length];
  console.log(`🎨 Color de resaltado de subtítulos: ${chosenAccent.name} (${chosenAccent.hex})`);

  // ============================================================================
  // 4. ESCALADO PROPORCIONAL DE ESCENAS Y GENERACIÓN DE SUBTÍTULOS
  // ============================================================================
  const escenasOriginales = payload.escenas || [];
  const ultimaEscenaFinOriginal = escenasOriginales.length > 0
    ? Number(escenasOriginales[escenasOriginales.length - 1].fin)
    : duracionExactaVideo;

  const timeScale = duracionExactaVideo / Math.max(0.1, ultimaEscenaFinOriginal);

  const escenasProcesadas = escenasOriginales.map((esc, idx) => {
    const inicioEscena = (idx === 0) ? 0 : Number(esc.inicio) * timeScale;
    const finEscena = (idx === escenasOriginales.length - 1)
      ? duracionExactaVideo
      : Number(esc.fin) * timeScale;

    let svgInterno = '';

    if (esc.diagrama && catalogo[esc.diagrama]) {
      svgInterno = `<g class="layer-main">${catalogo[esc.diagrama]}</g>`;
    } else {
      const cuerpoKey = (esc.cuerpo && catalogo[esc.cuerpo]) ? esc.cuerpo : 'cuerpo_base_quieto';
      const caraKey = (esc.cara && catalogo[esc.cara]) ? esc.cara : 'cara_duda';
      const propKey = (esc.prop && catalogo[esc.prop]) ? esc.prop : null;

      if (catalogo[cuerpoKey]) svgInterno += `<g class="layer-body">${catalogo[cuerpoKey]}</g>`;
      if (catalogo[caraKey]) svgInterno += `<g class="layer-face">${catalogo[caraKey]}</g>`;
      if (propKey && catalogo[propKey]) svgInterno += `<g class="layer-prop">${catalogo[propKey]}</g>`;
    }

    const subTexto = esc.subtitulo || '';
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim());
    const [t1, t2, t3] = sanitizeSvgTexts(esc, matchesDestacados);

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3)
      .replace(/\{TEXTO_1\}/g, t1)
      .replace(/\{TEXTO_2\}/g, t2)
      .replace(/\{TEXTO_3\}/g, t3);

    const planosRotativos = ['primer_plano', 'medio', 'general', 'primer_plano'];
    const planoElegido = esc.plano || planosRotativos[idx % planosRotativos.length];

    return {
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      svgInterno,
      esDiagrama: !!esc.diagrama,
      plano: planoElegido
    };
  });

  const subtitleChunks = buildSubtitleChunks(escenasProcesadas, payload.alignment, duracionExactaVideo);

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');
      :root {
        --accent-color: ${chosenAccent.hex};
        --accent-glow: ${chosenAccent.glow};
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: radial-gradient(circle at 50% 38%, #1d1d35 0%, #06060a 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      .grid-bg {
        position: absolute; inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
        background-size: 50px 50px;
      }
      .glow-spot {
        position: absolute; top: 35%; left: 50%; width: 500px; height: 500px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, rgba(255, 42, 95, 0.16) 0%, var(--accent-glow) 38%, transparent 70%);
        opacity: 0.50;
        pointer-events: none; z-index: 1;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 10px;
        background: linear-gradient(90deg, #ff2a5f, var(--accent-color)); width: 0%; z-index: 30;
        box-shadow: 0 0 18px var(--accent-glow);
      }
      .top-tag {
        position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.08); color: #e0e0f0;
        font-size: 20px; font-weight: 900; padding: 10px 26px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid rgba(255,255,255,0.18); white-space: nowrap;
        box-shadow: 0 10px 30px rgba(0,0,0,0.6); z-index: 20;
      }

      .scene {
        position: absolute; inset: 0;
        padding-bottom: 220px;
        display: flex; justify-content: center; align-items: center;
        opacity: 0; z-index: 10;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform;
      }
      svg { width: 530px; height: 630px; overflow: visible; filter: drop-shadow(0 15px 30px rgba(0,0,0,0.85)); }
      .plano-primer_plano svg { width: 640px; height: 760px; }
      .plano-medio svg { width: 580px; height: 690px; }
      .plano-general svg { width: 520px; height: 620px; }

      svg text {
        font-family: 'Montserrat', sans-serif;
        font-weight: 900;
        paint-order: stroke fill;
        stroke: #0a0a12;
        stroke-width: 2.5px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* CLASES CRÍTICAS PARA QUE LOS SVGS NUNCA SALGAN NEGROS */
      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.35)); }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }

      /* ======================================================================
         SUBTÍTULOS CORREGIDOS ANTI-SOLAPAMIENTO (ESPACIADO AMPLIO Y LIMPIO)
         ====================================================================== */
      .subtitle-container {
        position: absolute;
        bottom: 120px;
        left: 32px;
        right: 32px;
        min-height: 150px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 25;
        pointer-events: none;
      }
      .subtitle-box {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 14px 24px;
        text-align: center;
        padding: 18px 28px;
        background: rgba(8, 8, 16, 0.78);
        border: 1.5px solid rgba(255, 255, 255, 0.14);
        border-radius: 26px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.88);
        will-change: transform, opacity;
      }
      .sub-word {
        display: inline-block;
        margin: 0 3px;
        font-size: 39px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        line-height: 1.18;
        color: #ffffff;
        paint-order: stroke fill;
        -webkit-text-stroke: 7px #05050a;
        text-shadow: 0 6px 16px rgba(0, 0, 0, 0.95);
        will-change: transform, opacity;
      }
      .sub-word.kw {
        color: var(--accent-color);
        filter: drop-shadow(0 0 14px var(--accent-glow));
      }
      .sub-word.active {
        transform: scale(1.09) translateY(-3px);
      }
      .sub-word.kw.active {
        transform: scale(1.13) translateY(-4px);
      }
      .sub-word.future {
        opacity: 0.45;
      }
    </style>
  </head>
  <body>
    <div class="grid-bg"></div>
    <div class="glow-spot" id="glow"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag">${payload.categoria || 'PSICOLOGÍA'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg viewBox="0 0 200 240">${e.svgInterno}</svg>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="subtitle-container">
      <div class="subtitle-box" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const totalFrames = ${totalFrames};

      document.fonts.ready.then(() => {
        document.querySelectorAll('.scene svg').forEach(svg => {
          const texts = Array.from(svg.querySelectorAll('text'));
          
          texts.forEach(txt => {
            const content = (txt.textContent || '').trim();
            if (content.length <= 2) return;

            const x = parseFloat(txt.getAttribute('x') || '100');
            const y = parseFloat(txt.getAttribute('y') || '120');

            const sameRowTexts = texts.filter(other => {
              if (other === txt) return false;
              const oy = parseFloat(other.getAttribute('y') || '0');
              return Math.abs(oy - y) < 14;
            });

            let maxAllowedWidth = 170;
            if (sameRowTexts.length >= 2) {
              maxAllowedWidth = 52;
            } else if (sameRowTexts.length === 1) {
              const ox = parseFloat(sameRowTexts[0].getAttribute('x') || '100');
              const dist = Math.abs(x - ox);
              maxAllowedWidth = Math.max(54, dist - 28);
            } else if (x < 65 || x > 135) {
              maxAllowedWidth = 60;
            }

            let currentSize = parseFloat(txt.getAttribute('font-size') || '12');
            while (txt.getComputedTextLength() > maxAllowedWidth && currentSize > 6.5) {
              currentSize -= 0.5;
              txt.setAttribute('font-size', String(currentSize));
            }

            if (txt.getComputedTextLength() > maxAllowedWidth) {
              txt.setAttribute('textLength', String(maxAllowedWidth));
              txt.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
          });
        });
      });

      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('.draw, line, polyline, path, rect, polygon, circle, ellipse');
        let idx = 0;
        shapes.forEach(shape => {
          const fillAttr = shape.getAttribute('fill');
          const hasSolidFill = fillAttr && fillAttr !== 'none' && !fillAttr.startsWith('rgba');
          if (hasSolidFill && !shape.classList.contains('draw')) return;

          shape.setAttribute('pathLength', '100');
          shape.dataset.drawIdx = idx++;
          shape.style.strokeDasharray = '100';
          shape.style.strokeDashoffset = '100';
        });
      });

      function easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      }

      const subBox = document.getElementById('sub-box');
      let lastChunkIdx = -2;

      window.setFrameData = function(frameIdx, t) {
        // Barra de progreso psicológica no lineal
        const linearRatio = (frameIdx + 1) / totalFrames;
        const psychPct = Math.pow(linearRatio, 0.62) * 100;
        document.getElementById('pbar').style.width = Math.min(100, psychPct) + '%';
        
        const glowScale = 1 + Math.sin(t * 4.2) * 0.18;
        document.getElementById('glow').style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        // 1. RENDERIZADO DE ESCENA VISUAL
        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = escenas.length - 1;

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          if (idx === activeIdx) {
            const localT = Math.max(0, t - e.inicio);
            const durEscena = Math.max(0.1, e.fin - e.inicio);
            sc.style.opacity = '1';

            const entryProgress = Math.min(1, localT / 0.26);
            let scale = 0.42 + 0.58 * easeOutBack(entryProgress);

            scale *= (1 + (localT / durEscena) * 0.08);

            if (localT > durEscena * 0.48) {
              const midProgress = Math.min(1, (localT - durEscena * 0.48) / 0.22);
              scale *= (1 + 0.08 * easeOutBack(midProgress));
            }

            const floatY = Math.sin(localT * 5.2) * 11;
            const tiltDeg = Math.sin(localT * 2.8) * (e.esDiagrama ? 1.4 : 2.5);
            inner.style.transform = \`translateY(\${floatY}px) scale(\${scale}) rotate(\${tiltDeg}deg)\`;

            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              const delay = Math.min(0.18, dIdx * 0.025);
              const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.35));
              shape.style.strokeDashoffset = String(100 * (1 - drawP));
            });

            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const faceY = Math.sin(localT * 7.5) * 3.5;
              const faceRot = Math.sin(localT * 5.0) * 4.0;
              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translateY(\${faceY}px) rotate(\${faceRot}deg)\`;
            }

            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propY = Math.sin(localT * 6.5 + 1) * 9;
              const propScale = 1 + Math.sin(localT * 9.5) * 0.09;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translateY(\${propY}px) scale(\${propScale})\`;
            }

            sc.querySelectorAll('.float').forEach(el => {
              const fOffset = Math.sin(localT * 6.5) * 7.5;
              el.style.transform = \`translateY(\${fOffset}px)\`;
            });

            sc.querySelectorAll('.pulse').forEach(el => {
              const pScale = 1 + Math.sin(localT * 11) * 0.13;
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = \`scale(\${pScale})\`;
            });

          } else {
            sc.style.opacity = '0';
          }
        });

        // 2. RENDERIZADO DE SUBTÍTULOS
        let cIdx = subtitleChunks.findIndex((c, idx) => {
          if (idx === subtitleChunks.length - 1) return t >= c.start;
          return t >= c.start && t < c.end;
        });

        if (cIdx === -1) {
          subBox.style.opacity = '0';
          return;
        }

        const chunk = subtitleChunks[cIdx];
        subBox.style.opacity = '1';

        const chunkLocalT = Math.max(0, t - chunk.start);
        const popP = Math.min(1, chunkLocalT / 0.12);
        const boxScale = 0.90 + 0.10 * easeOutBack(popP);
        subBox.style.transform = \`scale(\${boxScale})\`;

        if (cIdx !== lastChunkIdx) {
          lastChunkIdx = cIdx;
          subBox.innerHTML = chunk.words.map((w, wIdx) => {
            const kwClass = w.highlight ? 'kw' : '';
            return \`<span class="sub-word \${kwClass}" id="sw-\${wIdx}">\${w.text}</span>\`;
          }).join('');
        }

        chunk.words.forEach((w, wIdx) => {
          const el = document.getElementById('sw-' + wIdx);
          if (!el) return;
          const isCurrent = (t >= w.start && t <= w.end);
          const isFuture = (t < w.start);

          el.classList.toggle('active', isCurrent);
          el.classList.toggle('future', isFuture);
        });
      };
    </script>
  </body>
  </html>`;

  fs.writeFileSync('index.html', htmlContent);

  if (fs.existsSync('frames')) {
    fs.rmSync('frames', { recursive: true, force: true });
  }
  fs.mkdirSync('frames');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');

  console.log(`🎬 Grabando exactamente ${totalFrames} fotogramas (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final con mapeo explícito de vídeo y audio...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo output.mp4 generado con SVGs intactos, subtítulos clavados y música de fondo!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
