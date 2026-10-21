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

// 2. Motor de alineación fonética de subtítulos (Sincronización por peso de sílabas y pausas)
function buildSubtitleChunks(escenas) {
  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'TAMBIEN', 'TAMBIÉN', 'ERA',
    'O', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE', 'MI', 'MIS', 'TUS', 'NOS', 'NI'
  ]);

  // Extraer tokens de cada escena conservando marcas de **énfasis**
  const sceneTokensList = escenas.map(esc => {
    const raw = (esc.subtitulo || '').trim();
    if (!raw) return [];

    const tokens = [];
    const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|(\S+)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      if (match[1] || match[2]) {
        const phrase = (match[1] || match[2]).trim();
        phrase.split(/\s+/).forEach(w => {
          if (w) tokens.push({ text: w, highlight: true });
        });
      } else if (match[3]) {
        tokens.push({ text: match[3], highlight: false });
      }
    }
    return tokens;
  });

  // Función que calcula lo que tarda la voz humana/ElevenLabs en pronunciar cada palabra + su pausa
  function calcTokenWeight(tk) {
    const clean = tk.text.replace(/[.,;!?¡¿"«»()]/g, '');
    let w = Math.max(2, clean.length); // Palabras largas duran más
    if (/[,;]/.test(tk.text)) w += 3.2; // Pausa breve en coma
    if (/[.!?]/.test(tk.text)) w += 5.0; // Pausa larga en punto o interrogación
    return w;
  }

  // Calculamos el inicio y fin real de cada escena basándonos en el peso fonético real del guion completo
  // (Esto corrige cualquier desfase si la IA estimó mal los segundos de alguna frase larga o corta)
  const totalDuration = escenas.length > 0 ? escenas[escenas.length - 1].fin : 35;
  const sceneWeights = sceneTokensList.map(tokens => {
    const sum = tokens.reduce((acc, tk) => acc + calcTokenWeight(tk), 0);
    return Math.max(4, sum);
  });
  const totalScriptWeight = sceneWeights.reduce((a, b) => a + b, 0);

  let cumulativeWeight = 0;
  const allChunks = [];

  escenas.forEach((esc, idx) => {
    const tokens = sceneTokensList[idx];
    const sWeight = sceneWeights[idx];

    // Mezclamos un 75% de peso fonético exacto + 25% de la marca de la IA para mantener anclaje perfecto
    const phoneticStart = (cumulativeWeight / totalScriptWeight) * totalDuration;
    cumulativeWeight += sWeight;
    const phoneticEnd = (cumulativeWeight / totalScriptWeight) * totalDuration;

    const sceneStart = (idx === 0) ? 0 : (phoneticStart * 0.75 + esc.inicio * 0.25);
    const sceneEnd = (idx === escenas.length - 1) ? totalDuration : (phoneticEnd * 0.75 + esc.fin * 0.25);

    // Sincronizamos también los tiempos de la propia escena visual con este cálculo fonético
    esc.inicio = sceneStart;
    esc.fin = sceneEnd;

    if (tokens.length === 0) return;

    // Agrupar en bloques dinámicos de 2 a 4 palabras (cortando siempre si hay signo de puntuación)
    const groups = [];
    let currentGroup = [];
    let currentChars = 0;

    tokens.forEach((tk) => {
      currentGroup.push(tk);
      currentChars += tk.text.length;
      const hasPunct = /[.,;!?]/.test(tk.text);

      if (currentGroup.length >= 4 || currentChars >= 20 || (hasPunct && currentGroup.length >= 2)) {
        groups.push(currentGroup);
        currentGroup = [];
        currentChars = 0;
      }
    });
    if (currentGroup.length > 0) {
      if (groups.length > 0 && currentGroup.length === 1 && groups[groups.length - 1].length < 4) {
        groups[groups.length - 1].push(currentGroup[0]);
      } else {
        groups.push(currentGroup);
      }
    }

    // Garantizar que cada bloque visual tenga al menos 1 palabra clave resaltada en color
    groups.forEach(g => {
      if (!g.some(t => t.highlight)) {
        let bestIdx = -1;
        let maxLen = 0;
        g.forEach((t, i) => {
          const clean = t.text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g, '').toUpperCase();
          if (!stopWords.has(clean) && clean.length > maxLen) {
            maxLen = clean.length;
            bestIdx = i;
          }
        });
        if (bestIdx !== -1 && maxLen >= 4) {
          g[bestIdx].highlight = true;
        }
      }
    });

    // Repartir el tiempo exacto de la escena entre sus palabras según su peso fonético
    const dur = Math.max(0.2, sceneEnd - sceneStart);
    let cursor = sceneStart;

    groups.forEach((g, gIdx) => {
      const gWeight = g.reduce((acc, tk) => acc + calcTokenWeight(tk), 0);
      const gDur = (gWeight / sWeight) * dur;
      const gStart = cursor;
      const gEnd = (gIdx === groups.length - 1) ? sceneEnd : (cursor + gDur);

      let wCursor = gStart;
      const timedWords = g.map((tk, wIdx) => {
        const wWeight = calcTokenWeight(tk);
        const wDur = (wWeight / gWeight) * (gEnd - gStart);
        const wStart = wCursor;
        const wEnd = (wIdx === g.length - 1) ? gEnd : (wCursor + wDur);
        wCursor = wEnd;
        return {
          text: tk.text,
          highlight: tk.highlight,
          start: wStart,
          end: wEnd
        };
      });

      allChunks.push({
        start: gStart,
        end: gEnd,
        words: timedWords
      });

      cursor = gEnd;
    });
  });

  return allChunks;
}

async function main() {
  console.log('🚀 Iniciando motor de renderizado con Subtítulos Dinámicos y Color Variable...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));

  // 1. Guardar MP3 original y convertir a WAV limpio con 0.25s de respiro final
  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio_raw.mp3', Buffer.from(audioBase64, 'base64'));

  execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.25" -c:a pcm_s16le audio.wav', { stdio: 'ignore' });

  // ============================================================================
  // 2. OBTENCIÓN DE LA DURACIÓN REAL EXACTA (nk=1 sobre WAV)
  // ============================================================================
  let realAudioDuration = 35;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 audio.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) {
      realAudioDuration = parsed;
      console.log(`🎙️ Duración real exacta medida en WAV: ${realAudioDuration.toFixed(3)}s`);
    } else {
      throw new Error(`Salida de ffprobe no numérica: ${probeOutput}`);
    }
  } catch (err) {
    console.error('⚠️ Fallo al medir con ffprobe, usando fallback:', err.message);
    realAudioDuration = Number(payload.duracion_total) || 35;
  }

  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

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

  // Elegimos un color distinto en cada vídeo combinando el título y un factor aleatorio
  const seedStr = (payload.tema_titulo || '') + (payload.categoria || '') + String(Date.now());
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) % 100000;
  }
  const chosenAccent = accentPalettes[hash % accentPalettes.length];
  console.log(`🎨 Color de resaltado de subtítulos para este vídeo: ${chosenAccent.name} (${chosenAccent.hex})`);

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

    const planosRotativos = ['medio', 'general', 'primer_plano', 'medio'];
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

  // Construimos los bloques de subtítulos sincronizados fonéticamente
  const subtitleChunks = buildSubtitleChunks(escenasProcesadas);

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
        position: absolute; top: 35%; left: 50%; width: 480px; height: 480px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, rgba(255, 42, 95, 0.15) 0%, var(--accent-glow) 35%, transparent 70%);
        opacity: 0.45;
        pointer-events: none; z-index: 1;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, var(--accent-color)); width: 0%; z-index: 30;
        box-shadow: 0 0 20px var(--accent-glow);
      }
      .top-tag {
        position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.08); color: #e0e0f0;
        font-size: 21px; font-weight: 900; padding: 11px 28px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid rgba(255,255,255,0.18); white-space: nowrap;
        box-shadow: 0 10px 30px rgba(0,0,0,0.6); z-index: 20;
      }

      /* Elevamos ligeramente la zona del dibujo para dejar espacio limpio a los subtítulos abajo */
      .scene {
        position: absolute; inset: 0;
        padding-bottom: 210px;
        display: flex; justify-content: center; align-items: center;
        opacity: 0; z-index: 10;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform;
      }
      svg { width: 520px; height: 620px; overflow: visible; filter: drop-shadow(0 15px 30px rgba(0,0,0,0.85)); }
      .plano-primer_plano svg { width: 630px; height: 750px; }
      .plano-medio svg { width: 570px; height: 680px; }
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

      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.35)); }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }

      /* ======================================================================
         ESTILOS DE SUBTÍTULOS DINÁMICOS (ESTILO VIRAL HORMOZI / SHORTS)
         ====================================================================== */
      .subtitle-container {
        position: absolute;
        bottom: 115px;
        left: 36px;
        right: 36px;
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
        gap: 10px 14px;
        text-align: center;
        padding: 16px 26px;
        background: rgba(8, 8, 16, 0.72);
        border: 1.5px solid rgba(255, 255, 255, 0.12);
        border-radius: 26px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.85);
        will-change: transform, opacity;
      }
      .sub-word {
        display: inline-block;
        font-size: 40px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        line-height: 1.15;
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
        transform: scale(1.13) translateY(-3px);
      }
      .sub-word.kw.active {
        transform: scale(1.18) translateY(-4px);
      }
      .sub-word.future {
        opacity: 0.48;
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

      // Auto-ajuste anti-solapamiento de textos dentro de los SVGs
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

      document.querySelectorAll('.scene svg').
