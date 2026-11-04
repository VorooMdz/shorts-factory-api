const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. DESCARGA DE PAYLOAD Y ALINEACIÓN FONÉTICA DE SUBTÍTULOS
// ============================================================================
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function normalizeForMatch(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function buildSubtitleChunks(escenas, alignmentData, realAudioDuration) {
  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'ERA', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE'
  ]);

  const sceneTokensList = escenas.map(esc => {
    const raw = (esc.subtitulo || '').trim();
    if (!raw) return [];
    const tokens = [];
    let inBold = false;
    raw.split(/\s+/).forEach(rw => {
      if (!rw) return;
      const starCount = (rw.match(/\*/g) || []).length;
      const startsBold = rw.startsWith('*');
      const endsBold = rw.endsWith('*') && starCount >= 2;
      const isHighlighted = inBold || starCount >= 2 || startsBold;
      const cleanWord = rw.replace(/[*#_~`]/g, '').trim();

      if (starCount % 2 !== 0) inBold = !inBold;
      else if (startsBold && !endsBold && starCount === 2) inBold = true;

      if (!cleanWord) return;
      if (/^[.,;!?¡¿…]+$/.test(cleanWord)) {
        if (tokens.length > 0) tokens[tokens.length - 1].text += cleanWord;
        return;
      }
      tokens.push({ text: cleanWord, highlight: isHighlighted });
    });
    return tokens;
  });

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
            elevenWords.push({ word: curWord, norm: normalizeForMatch(curWord), start: wStart, end: wEnd });
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
        elevenWords.push({ word: curWord, norm: normalizeForMatch(curWord), start: wStart, end: wEnd });
      } else if (elevenWords.length > 0) {
        elevenWords[elevenWords.length - 1].word += curWord;
        elevenWords[elevenWords.length - 1].end = wEnd;
      }
    }
  }

  function calcTokenWeight(tk) {
    const clean = tk.text.replace(/[.,;!?¡¿"«»()]/g, '');
    let w = Math.max(2, clean.length);
    if (/\d/.test(clean)) w += 6.5;
    if (/[€$%]/.test(tk.text)) w += 4.5;
    if (/[,;:]/.test(tk.text)) w += 2.8;
    if (/[.!?…]/.test(tk.text)) w += 4.2;
    return w;
  }

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
      for (let offset = 0; offset <= 5; offset++) {
        const candidateIdx = ewCursor + offset;
        if (candidateIdx >= elevenWords.length) break;
        const candNorm = elevenWords[candidateIdx].norm;
        if (candNorm && targetNorm && (candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm))) {
          bestMatchIdx = candidateIdx;
          break;
        }
      }
      if (bestMatchIdx !== -1) {
        let mStart = elevenWords[bestMatchIdx].start;
        let mEnd = elevenWords[bestMatchIdx].end;
        ewCursor = bestMatchIdx + 1;
        while (ewCursor < elevenWords.length && /^(euro|euros|dolar|dolares|por|ciento|millon|millones|mil|miles)$/.test(elevenWords[ewCursor].norm)) {
          const nextVisualNorm = (i + 1 < flatTokens.length) ? flatTokens[i + 1].norm : '';
          if (nextVisualNorm === elevenWords[ewCursor].norm) break;
          mEnd = elevenWords[ewCursor].end;
          ewCursor++;
        }
        flatTokens[i].matchedStart = mStart;
        flatTokens[i].matchedEnd = mEnd;
      } else if (ewCursor < elevenWords.length) {
        flatTokens[i].matchedStart = elevenWords[ewCursor].start;
        flatTokens[i].matchedEnd = elevenWords[ewCursor].end;
        ewCursor++;
      }
    }
  }

  const lastSpokenEnd = elevenWords.length > 0 ? elevenWords[elevenWords.length - 1].end : Math.max(1, realAudioDuration - 0.35);
  const sceneWeights = sceneTokensList.map(tokens => Math.max(3, tokens.reduce((acc, tk) => acc + calcTokenWeight(tk), 0)));
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
      sceneStart = (idx === 0) ? 0 : Math.max(0, firstMatched.matchedStart - 0.03);
      sceneEnd = (idx === escenas.length - 1) ? realAudioDuration : Math.min(realAudioDuration, lastMatched.matchedEnd + 0.06);
    }

    esc.inicio = sceneStart;
    esc.fin = sceneEnd;

    if (tokens.length === 0) return;

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
        if (bestIdx !== -1 && maxLen >= 4) g[bestIdx].tk.highlight = true;
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
        return { text: item.tk.text, highlight: item.tk.highlight, start: wStart, end: wEnd };
      });

      if (timedWords.length > 0 && g[0].matchedStart !== null) {
        gStart = timedWords[0].start;
        gEnd = timedWords[timedWords.length - 1].end + 0.05;
      }
      allChunks.push({ start: gStart, end: gEnd, words: timedWords });
      cursor = gEnd;
    });
  });

  for (let i = 0; i < escenas.length - 1; i++) escenas[i].fin = escenas[i + 1].inicio;
  if (escenas.length > 0) {
    escenas[0].inicio = 0;
    escenas[escenas.length - 1].fin = realAudioDuration;
  }
  for (let i = 0; i < allChunks.length - 1; i++) {
    if (allChunks[i].end > allChunks[i + 1].start) allChunks[i].end = allChunks[i + 1].start;
    else if (allChunks[i + 1].start - allChunks[i].end < 0.12) allChunks[i].end = allChunks[i + 1].start;
  }
  return allChunks;
}

// ============================================================================
// 2. SINTETIZADOR CHIPTUNE 8-BIT PROCEDURAL
// ============================================================================
function buildChiptuneSfxTrack(escenas, totalDuration, videoHash) {
  const allTypes = [
    'coin_8bit', 'laser_8bit', 'explosion_8bit', 'powerup_8bit', 'alarm_8bit',
    'glitch_8bit', 'jump_8bit', 'error_8bit', 'typing_8bit', 'level_clear_8bit'
  ];

  function get8BitRecipe(type, pitchMod) {
    const p = pitchMod.toFixed(3);
    const catalog = {
      coin_8bit: { expr: `0.18*(lt(t,0.08)*sgn(sin(2*PI*987.77*${p}*t))+gt(t,0.08)*exp(-6*(t-0.08))*sgn(sin(2*PI*1318.51*${p}*t)))`, dur: 0.42 },
      laser_8bit: { expr: `0.16*exp(-5*t)*sgn(sin(2*PI*(1200*${p}*exp(-6*t)+120)*t))`, dur: 0.32 },
      explosion_8bit: { expr: `0.25*exp(-4.5*t)*(sgn(sin(2*PI*75*exp(-2*t)*t))*sin(2*PI*19*t)+0.5*sgn(sin(2*PI*230*t)*sin(2*PI*53*t)))`, dur: 0.65 },
      powerup_8bit: { expr: `0.16*(lt(t,0.07)*sgn(sin(2*PI*330*${p}*t))+between(t,0.07,0.14)*sgn(sin(2*PI*392*${p}*t))+between(t,0.14,0.21)*sgn(sin(2*PI*659*${p}*t))+gt(t,0.21)*exp(-5*(t-0.21))*sgn(sin(2*PI*523*${p}*t)))`, dur: 0.45 },
      alarm_8bit: { expr: `0.16*exp(-1.5*t)*sgn(sin(2*PI*(680+220*sgn(sin(2*PI*8*t)))*t))`, dur: 0.55 },
      glitch_8bit: { expr: `0.16*exp(-6*t)*sgn(sin(2*PI*440*${p}*t)*sin(2*PI*67*t)+sin(2*PI*1120*t)*sin(2*PI*29*t))`, dur: 0.35 },
      jump_8bit: { expr: `0.17*exp(-4*t)*sgn(sin(2*PI*(180*${p}+520*t)*t))`, dur: 0.30 },
      error_8bit: { expr: `0.20*exp(-4*t)*(lt(t,0.14)*sgn(sin(2*PI*165*${p}*t))+gt(t,0.14)*sgn(sin(2*PI*130.8*${p}*t)))`, dur: 0.45 },
      typing_8bit: { expr: `0.15*(exp(-40*t)*sgn(sin(2*PI*1400*t))+gt(t,0.09)*exp(-40*(t-0.09))*sgn(sin(2*PI*1650*t))+gt(t,0.18)*exp(-40*(t-0.18))*sgn(sin(2*PI*1300*t)))`, dur: 0.30 },
      level_clear_8bit: { expr: `0.16*exp(-2.8*t)*(sgn(sin(2*PI*523.25*${p}*t))+0.7*sgn(sin(2*PI*659.25*${p}*t))+0.5*sgn(sin(2*PI*783.99*${p}*t)))`, dur: 0.65 }
    };
    return catalog[type] || catalog.coin_8bit;
  }

  const inputs = [];
  const filterParts = [];

  escenas.forEach((esc, idx) => {
    let rawType = String(esc.sfx || '').toLowerCase().trim();
    if (!allTypes.includes(rawType)) {
      rawType = allTypes[(videoHash + idx * 3) % allTypes.length];
    }
    const pitchMod = 0.90 + (((videoHash + idx * 13) % 21) / 100);
    const recipe = get8BitRecipe(rawType, pitchMod);
    const startSec = idx === 0 ? 0.04 : Math.max(0.05, Number(esc.inicio) || 0);
    const delayMs = Math.round(startSec * 1000);

    inputs.push(`-f lavfi -i "aevalsrc='${recipe.expr}':s=44100:d=${recipe.dur}"`);
    filterParts.push(`[${idx}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration.toFixed(3)}[s${idx}]`);
  });

  if (inputs.length === 0) return false;
  const mixLabels = escenas.map((_, idx) => `[s${idx}]`).join('');
  const filterComplex = `${filterParts.join(';')};${mixLabels}amix=inputs=${escenas.length}:duration=longest:dropout_transition=0:normalize=0[sfxout]`;

  try {
    execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`, { stdio: 'ignore' });
  } catch (err) {
    return false;
  }
  return fs.existsSync('hook_sfx.wav') && fs.statSync('hook_sfx.wav').size > 1000;
}

// ============================================================================
// 3. MOTOR DE DIRECCIÓN ARTÍSTICA CONTEXTUAL v8.0 (ESTILO ESTAFADOR EN TODAS)
// ============================================================================
function prepareStudioScenes(escenas, hash) {
  const allShots = [
    'protagonist_closeup',
    'two_characters_deal',
    'landmark_monument',
    'document_forgery_desk',
    'cash_heist_tally',
    'night_train_escape',
    'press_headline',
    'final_rpg_decision'
  ];

  const expressions = ['smirk_wink', 'greedy_dollar', 'scheming_evil', 'shock_sweat', 'ashamed_red', 'proud_confident'];
  const props = ['cash_bundle', 'secret_contract', 'iron_ingot', 'magnifying_glass', 'pocket_watch', 'microchip', 'key_master', 'trophy_cup'];
  const roles = ['con_artist', 'merchant_rich', 'scientist', 'engineer', 'military', 'hacker'];

  let prevShot = '';

  return (escenas || []).map((esc, idx) => {
    const text = `${esc.subtitulo || ''} ${esc.texto_1 || ''} ${esc.texto_2 || ''} ${esc.narrativa_visual || ''}`.toLowerCase();
    let shot = String(esc.shot_type || '').toLowerCase().trim();

    // Asignación semántica inteligente para que NINGUNA escena sea incoherente con lo que dice el locutor
    if (idx === escenas.length - 1) {
      shot = 'final_rpg_decision';
    } else if (/torre|eiffel|demoler|hierro|tonelada|monumento|edificio|estructura|7\.?000/.test(text)) {
      shot = 'landmark_monument';
    } else if (/prensa|periodico|diario|noticia|titular|publico|escandalo/.test(text)) {
      shot = 'press_headline';
    } else if (/falsific|credencial|documento|carta|contrato|ello|oficial|ley|codigo/.test(text)) {
      shot = 'document_forgery_desk';
    } else if (/suite|hotel|reuni|cito|ofreci|soborno|negoci|comerciante|magnate|convers/.test(text)) {
      shot = 'two_characters_deal';
    } else if (/entreg|dolar|euro|millon|botin|70\.?000|dinero|pago|fortuna|costo/.test(text)) {
      shot = 'cash_heist_tally';
    } else if (/tren|viena|fuga|escap|abord|viaj|avion|vuelo|coche|barco|regres/.test(text)) {
      shot = 'night_train_escape';
    } else if (/verguenza|confes|estafador|lustig| Fing|burocrata|oportunidad|ambicion/.test(text)) {
      shot = 'protagonist_closeup';
    } else if (!allShots.includes(shot)) {
      shot = allShots[(idx + hash) % (allShots.length - 1)];
    }

    // Evitar que dos escenas seguidas tengan el mismo plano
    if (shot === prevShot && idx < escenas.length - 1) {
      if (shot === 'protagonist_closeup') shot = 'two_characters_deal';
      else if (shot === 'two_characters_deal') shot = 'protagonist_closeup';
      else shot = 'protagonist_closeup';
    }
    prevShot = shot;

    // Inferir expresión facial coherente con la frase
    let expr = esc.expression || '';
    if (!expressions.includes(expr)) {
      if (/verguenza|jamás confesó|miedo|temor|ridiculo/.test(text)) expr = 'ashamed_red';
      else if (/dolar|millon|dinero|botin|ambicion|fortuna|70\.?000/.test(text)) expr = 'greedy_dollar';
      else if (/fallo|error|panico|catastrofe|descubri/.test(text)) expr = 'shock_sweat';
      else if (/secreto|soborno|enga|fingi|trampa|falsific/.test(text)) expr = 'scheming_evil';
      else expr = 'smirk_wink';
    }

    // Inferir objeto en mano coherente con la frase
    let prop = esc.hand_prop || '';
    if (!props.includes(prop)) {
      if (/hierro|tonelada|metal|acero|chatarra/.test(text)) prop = 'iron_ingot';
      else if (/credencial|contrato|documento|firma|ley/.test(text)) prop = 'secret_contract';
      else if (/investig|auditoria|secreto|pista/.test(text)) prop = 'magnifying_glass';
      else if (/tiempo|meses|segundo|hora|reloj/.test(text)) prop = 'pocket_watch';
      else if (/software|codigo|chip|sistema/.test(text)) prop = 'microchip';
      else prop = 'cash_bundle';
    }

    // Inferir rol visual del personaje
    let role = esc.character_role || '';
    if (!roles.includes(role)) {
      if (/verguenza|poisson|comerciante|magnate|inversor/.test(text) && shot === 'protagonist_closeup') role = 'merchant_rich';
      else if (/cientifico|nasa|medico/.test(text)) role = 'scientist';
      else if (/ingeniero|obrero|motor/.test(text)) role = 'engineer';
      else if (/militar|soldado|marine/.test(text)) role = 'military';
      else if (/hacker|programador/.test(text)) role = 'hacker';
      else role = 'con_artist';
    }

    const cleanT1 = String(esc.texto_1 || `ESCENA 0${idx + 1}`).toUpperCase().trim().slice(0, 14);
    const cleanT2 = String(esc.texto_2 || 'HISTORIA REAL').toUpperCase().trim().slice(0, 14);

    return {
      ...esc,
      shot_type: shot,
      expression: expr,
      hand_prop: prop,
      character_role: role,
      texto_1: cleanT1,
      texto_2: cleanT2,
      choice_a: (esc.choice_a || 'SI, CAERIA EN LA TRAMPA').toUpperCase().slice(0, 24),
      choice_b: (esc.choice_b || 'NO, SOSPECHARIA AL INSTANTE').toUpperCase().slice(0, 24)
    };
  });
}

// ============================================================================
// 4. EJECUCIÓN PRINCIPAL Y RENDERIZADOR v8.0
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload Pixel-Art Studio v8.0 desde URL...');
    await downloadFile(payloadUrl, 'payload.json');
  }

  let payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  if (Array.isArray(payload) && payload.length > 0) payload = payload[0];
  if (payload.json) payload = payload.json;

  const rawBase64 = (payload.audio_base64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error('❌ CRÍTICO: payload.audio_base64 llegó vacío desde n8n.');
  }
  fs.writeFileSync('audio_raw.mp3', Buffer.from(rawBase64, 'base64'));

  execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.45" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });

  let realAudioDuration = 42;
  try {
    const probeOutput = execSync('ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav', { encoding: 'utf8' });
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) realAudioDuration = parsed;
  } catch (err) {
    realAudioDuration = Number(payload.duracion_total) || 42;
  }

  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

  const seedStr = JSON.stringify(payload.escenas || '') + (payload.TituloYT || '') + String(Date.now());
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  const escenasStudio = prepareStudioScenes(payload.escenas || [], hash);
  const subtitleChunks = buildSubtitleChunks(escenasStudio, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio con bg_music2.mp3
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenasStudio, duracionExactaVideo, hash); } catch (e) {}

    let bgMusicPath = path.resolve(__dirname, '../bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve('bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve(__dirname, '../bg_music.mp3');

    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(`ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.78,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`, { stdio: 'inherit' });
      if (hasSfx) {
        execSync(`ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.18[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`, { stdio: 'inherit' });
      } else {
        execSync(`ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.18[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`, { stdio: 'inherit' });
      }
    } else {
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (e) {
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

  const safeEscenasJson = JSON.stringify(escenasStudio).replace(/<\/script>/gi, '<\\/script>');
  const safeChunksJson = JSON.stringify(subtitleChunks).replace(/<\/script>/gi, '<\\/script>');

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Montserrat:wght@900&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: #05050a;
        overflow: hidden; position: relative;
        font-family: 'Press Start 2P', monospace;
        -webkit-font-smoothing: none;
      }
      #pixel-canvas {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        image-rendering: pixelated;
        z-index: 2;
      }
      .crt-scanlines {
        position: absolute; inset: 0;
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.16) 50%);
        background-size: 100% 8px;
        z-index: 10; pointer-events: none;
      }
      /* TU HUD CLÁSICO INTACTO */
      .arcade-hud {
        position: absolute; top: 32px; left: 26px; right: 26px;
        display: flex; justify-content: space-between; align-items: center;
        background: rgba(8, 10, 22, 0.92);
        border: 4px solid #00f2fe;
        padding: 13px 18px;
        box-shadow: 0 8px 0 #000000;
        z-index: 20;
      }
      .hud-tag { color: #ffd000; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; }
      .hud-score { color: #ffffff; font-size: 12px; }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000, #00f2fe);
        width: 0%; z-index: 30;
      }

      /* RÓTULOS PIXEL-ART NÍTIDOS CON SOPORTE TOTAL PARA Ñ Y TILDES (CERO PALABRAS ROTAS) */
      .label-box-top {
        position: absolute; top: 108px; left: 50%; transform: translateX(-50%);
        background: #080a14; border: 4px solid #000000;
        box-shadow: inset 0 0 0 2px #2b3248, 0 8px 0 rgba(0,0,0,0.75);
        padding: 14px 26px; color: #ffd166; font-size: 28px;
        text-transform: uppercase; white-space: nowrap; letter-spacing: 2px;
        text-shadow: 4px 4px 0 #000000; z-index: 18;
      }
      .label-box-bot {
        position: absolute; top: 882px; left: 50%; transform: translateX(-50%);
        background: #080a14; border: 4px solid #000000;
        box-shadow: inset 0 0 0 2px #2b3248, 0 8px 0 rgba(0,0,0,0.75);
        padding: 14px 26px; color: #00f5d4; font-size: 28px;
        text-transform: uppercase; white-space: nowrap; letter-spacing: 2px;
        text-shadow: 4px 4px 0 #000000; z-index: 18;
      }

      /* CAJA DE PREGUNTA FINAL RPG CON TEXTO REAL 100% LEGIBLE */
      .rpg-choice-modal {
        position: absolute; top: 380px; left: 48px; right: 48px;
        background: #0f172a; border: 6px solid #eab308;
        outline: 6px solid #000000;
        box-shadow: 0 14px 0 rgba(0,0,0,0.85);
        padding: 28px 26px; z-index: 22; display: none;
      }
      .rpg-question-title {
        color: #ffffff; font-size: 18px; line-height: 1.5;
        margin-bottom: 24px; text-align: center;
        text-shadow: 3px 3px 0 #000000;
      }
      .rpg-option-row {
        font-size: 17px; padding: 12px 14px; margin-bottom: 10px;
        color: #64748b; text-shadow: 2px 2px 0 #000000;
        display: flex; align-items: center; gap: 14px;
      }
      .rpg-option-row.selected {
        color: #ffd166; background: rgba(255, 209, 102, 0.12);
        border: 3px solid #ffd166;
      }
      .rpg-cursor { color: #80ed99; font-size: 20px; }

      .subtitle-container {
        position: absolute; bottom: 78px; left: 26px; right: 26px;
        min-height: 155px; display: flex; justify-content: center; align-items: center;
        z-index: 25; pointer-events: none;
      }
      .subtitle-box {
        display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
        gap: 12px 18px; text-align: center; padding: 20px 26px;
        background: rgba(8, 10, 20, 0.94); border: 4px solid #ffffff; outline: 4px solid #000000;
        box-shadow: 0 12px 0 rgba(0,0,0,0.85);
      }
      .sub-word {
        display: inline-block; font-family: 'Montserrat', sans-serif; font-size: 38px; font-weight: 900;
        text-transform: uppercase; color: #ffffff; paint-order: stroke fill;
        -webkit-text-stroke: 7px #000000; text-shadow: 4px 4px 0 #000000;
      }
      .sub-word.kw { color: #ffd000; }
      .sub-word.active { transform: scale(1.12) translateY(-5px); color: #00f2fe; }
      .sub-word.kw.active { color: #ffd000; transform: scale(1.16) translateY(-6px); }
      .sub-word.future { opacity: 0.42; }
    </style>
  </head>
  <body>
    <div class="progress-bar" id="pbar"></div>
    <div class="arcade-hud">
      <div class="hud-tag">${(payload.subrama || '8BIT HEISTS').slice(0, 24)}</div>
      <div class="hud-score" id="hud-frame">ESC:01</div>
    </div>

    <!-- RÓTULOS CON TIPOGRAFÍA ARCADE REAL (CERO PALABRAS ROTAS, SOPORTA Ñ Y TILDES) -->
    <div class="label-box-top" id="label-top">1925</div>
    <div class="label-box-bot" id="label-bot">HISTORIA</div>

    <!-- MODAL RPG PARA LA PREGUNTA FINAL CON TEXTO LEGIBLE -->
    <div class="rpg-choice-modal" id="rpg-modal">
      <div class="rpg-question-title">¿QUÉ HABRÍAS HECHO TÚ EN SU LUGAR?</div>
      <div class="rpg-option-row selected" id="rpg-opt-a">
        <span class="rpg-cursor" id="cur-a">▶</span>
        <span id="txt-opt-a">ACEPTAR EL TRATO</span>
      </div>
      <div class="rpg-option-row" id="rpg-opt-b">
        <span class="rpg-cursor" id="cur-b" style="visibility:hidden">▶</span>
        <span id="txt-opt-b">SOSPECHAR Y DENUNCIAR</span>
      </div>
    </div>

    <canvas id="pixel-canvas" width="720" height="1280"></canvas>
    <div class="crt-scanlines"></div>

    <div class="subtitle-container">
      <div class="subtitle-box" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${safeEscenasJson};
      const subtitleChunks = ${safeChunksJson};
      const totalFrames = ${totalFrames};

      const COLS = 120;
      const ROWS = 213;
      const CELL = 6;
      const GROUND_Y = 142;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#1a1c2c'));

      function setPx(x, y, color) {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && color) {
          grid[cy][cx] = color;
        }
      }

      function fillRect(x, y, w, h, color) {
        const x0 = Math.round(x), y0 = Math.round(y);
        const rw = Math.round(w), rh = Math.round(h);
        for (let r = 0; r < rh; r++) {
          for (let c = 0; c < rw; c++) setPx(x0 + c, y0 + r, color);
        }
      }

      function fillBorderedRect(x, y, w, h, fillColor, borderColor = '#0b0c10') {
        fillRect(x, y, w, h, borderColor);
        if (w > 2 && h > 2) {
          fillRect(x + 1, y + 1, w - 2, h - 2, fillColor);
        }
      }

      function fillCircle(cx, cy, radius, color) {
        const rInt = Math.round(radius);
        for (let r = -rInt; r <= rInt; r++) {
          for (let c = -rInt; c <= rInt; c++) {
            if (c * c + r * r <= rInt * rInt) setPx(cx + c, cy + r, color);
          }
        }
      }

      function drawPixelLine(x0, y0, x1, y1, thickness, color) {
        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let cx = Math.round(x0), cy = Math.round(y0);
        const ex = Math.round(x1), ey = Math.round(y1);
        for (let i = 0; i < 300; i++) {
          fillRect(cx - Math.floor(thickness / 2), cy - Math.floor(thickness / 2), thickness, thickness, color);
          if (cx === ex && cy === ey) break;
          let e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }

      // ======================================================================
      // MOTOR DE OBJETOS DE MANO Y PROPS DETALLADOS (MISMO ESTILO DEL BILLETE)
      // ======================================================================
      function drawDetailedProp(propType, x, y) {
        if (propType === 'secret_contract') {
          fillBorderedRect(x - 14, y - 12, 28, 24, '#f8fafc', '#0b0c10');
          fillRect(x - 10, y - 8, 20, 2, '#1e293b');
          fillRect(x - 10, y - 4, 16, 2, '#64748b');
          fillRect(x - 10, y, 18, 2, '#64748b');
          fillCircle(x + 6, y + 5, 4, '#dc2626'); // Sello lacrado rojo
          return;
        }
        if (propType === 'iron_ingot') {
          // Viga / Lingote pesado de hierro remachado
          fillBorderedRect(x - 16, y - 8, 32, 16, '#64748b', '#0b0c10');
          fillRect(x - 14, y - 4, 28, 8, '#94a3b8');
          [-10, 0, 10].forEach(rx => fillRect(x + rx, y - 2, 2, 4, '#1e293b'));
          return;
        }
        if (propType === 'magnifying_glass') {
          fillCircle(x + 4, y - 4, 9, '#0b0c10');
          fillCircle(x + 4, y - 4, 7, '#38bdf8');
          fillRect(x + 1, y - 7, 3, 3, '#ffffff');
          drawPixelLine(x - 2, y + 2, x - 10, y + 10, 3, '#d97706');
          return;
        }
        if (propType === 'pocket_watch') {
          fillCircle(x, y, 10, '#eab308');
          fillCircle(x, y, 7, '#ffffff');
          fillRect(x, y - 5, 2, 5, '#0b0c10');
          fillRect(x, y, 4, 2, '#dc2626');
          return;
        }
        // Por defecto: Fajo de billetes verdes (el favorito del usuario)
        fillBorderedRect(x - 16, y - 8, 34, 16, '#80ed99', '#064e3b');
        fillBorderedRect(x - 13, y - 5, 28, 10, '#52b788', '#1b4332');
        fillRect(x - 2, y - 8, 5, 16, '#eab308'); // Cinta dorada del fajo
        fillCircle(x + 6, y, 3, '#1b4332');
      }

      // ======================================================================
      // CONSTRUCTOR UNIVERSAL DE PERSONAJES EXPRESIVOS DE MEDIO CUERPO
      // (LA MISMA CALIDAD Y CONSISTENCIA DEL ESTAFADOR PARA TODOS LOS PLANOS)
      // ======================================================================
      function drawExpressiveCharacter(cx, headY, role, expression, isTalking, localFrame, scale = 1.0, facingLeft = false) {
        let suitCol = '#334155', lapelCol = '#1e293b', tieCol = '#e63946', shirtCol = '#ffffff';
        let hatCol = '#eab308', hatBand = '#991b1b', hairCol = '#2b1d14';

        if (role === 'merchant_rich') { suitCol = '#1e3a8a'; lapelCol = '#172554'; tieCol = '#eab308'; hatCol = '#1e293b'; hatBand = '#eab308'; hairCol = '#475569'; }
        else if (role === 'scientist') { suitCol = '#f8fafc'; lapelCol = '#cbd5e1'; tieCol = '#0284c7'; hatCol = null; hairCol = '#64748b'; }
        else if (role === 'engineer') { suitCol = '#ea580c'; lapelCol = '#9a3412'; tieCol = '#facc15'; hatCol = '#facc15'; }
        else if (role === 'military') { suitCol = '#3f6212'; lapelCol = '#1a2e05'; tieCol = '#1a2e05'; hatCol = '#365314'; }
        else if (role === 'hacker') { suitCol = '#111827'; lapelCol = '#1f2937'; tieCol = '#10b981'; hatCol = null; }

        const s = scale;
        const bobY = headY + Math.round(Math.sin(localFrame * 0.15) * 1);

        // Torso y Traje con solapas y corbata
        const bodyW = Math.round(64 * s);
        const bodyH = Math.round(42 * s);
        fillBorderedRect(cx - Math.floor(bodyW / 2), bobY + Math.round(20 * s), bodyW, bodyH, suitCol, '#0b0c10');

        for (let r = 0; r < Math.round(18 * s); r++) {
          const vw = Math.max(2, Math.round(10 * s) - Math.floor(r * 0.5));
          fillRect(cx - vw, bobY + Math.round(21 * s) + r, vw * 2, 1, shirtCol);
        }
        fillRect(cx - Math.round(3 * s), bobY + Math.round(26 * s), Math.round(6 * s), Math.round(18 * s), tieCol);
        fillRect(cx - Math.round(20 * s), bobY + Math.round(36 * s), Math.round(7 * s), Math.round(3 * s), '#ffffff');
        fillCircle(cx - Math.round(13 * s), bobY + Math.round(31 * s), Math.max(1, Math.round(2 * s)), '#e63946');

        // Cuello y Cabeza con sombreado
        const headW = Math.round(34 * s);
        const headH = Math.round(32 * s);
        const hx = cx - Math.floor(headW / 2);
        const hy = bobY - Math.floor(headH / 2);

        fillBorderedRect(cx - Math.round(8 * s), hy + headH - 2, Math.round(16 * s), Math.round(9 * s), '#d49a73', '#0b0c10');
        fillBorderedRect(hx, hy, headW, headH, '#e6ad86', '#0b0c10');
        fillRect(hx + headW - Math.round(7 * s), hy + 1, Math.round(6 * s), headH - 2, '#d49a73');

        // Mejillas sonrojadas si está avergonzado (ashamed_red)
        if (expression === 'ashamed_red') {
          fillRect(hx + 3, bobY + 2, Math.round(6 * s), Math.round(4 * s), '#ef4444');
          fillRect(hx + headW - Math.round(9 * s), bobY + 2, Math.round(6 * s), Math.round(4 * s), '#ef4444');
        }

        // Orejas
        fillBorderedRect(hx - Math.round(3 * s), bobY - 3, Math.round(4 * s), Math.round(9 * s), '#d49a73', '#0b0c10');
        fillBorderedRect(hx + headW - 1, bobY - 3, Math.round(4 * s), Math.round(9 * s), '#d49a73', '#0b0c10');

        // Pelo y Sombrero
        fillRect(hx, hy, headW, Math.round(6 * s), hairCol);
        if (hatCol) {
          fillBorderedRect(cx - Math.round(26 * s), hy - Math.round(2 * s), Math.round(52 * s), Math.round(5 * s), hatCol, '#0b0c10');
          fillBorderedRect(cx - Math.round(18 * s), hy - Math.round(11 * s), Math.round(36 * s), Math.round(10 * s), hatCol, '#0b0c10');
          fillRect(cx - Math.round(17 * s), hy - Math.round(4 * s), Math.round(34 * s), Math.round(2 * s), hatBand);
        }

        // Cejas y Ojos Expresivos
        const isBlinking = (localFrame % 55 < 3);
        fillRect(cx - Math.round(11 * s), bobY - Math.round(7 * s), Math.round(7 * s), 2, '#2b1d14');
        fillRect(cx + Math.round(4 * s), bobY - Math.round(8 * s), Math.round(7 * s), 2, '#2b1d14');

        if (expression === 'greedy_dollar') {
          // Ojos de símbolo '$' dorado parpadeantes
          fillBorderedRect(cx - Math.round(11 * s), bobY - Math.round(4 * s), Math.round(7 * s), Math.round(6 * s), '#eab308', '#0b0c10');
          fillBorderedRect(cx + Math.round(4 * s), bobY - Math.round(4 * s), Math.round(7 * s), Math.round(6 * s), '#eab308', '#0b0c10');
        } else if (isBlinking) {
          fillRect(cx - Math.round(10 * s), bobY - 2, Math.round(6 * s), 2, '#2b1d14');
          fillRect(cx + Math.round(4 * s), bobY - 2, Math.round(6 * s), 2, '#2b1d14');
        } else {
          const pupilShift = facingLeft ? -1 : 1;
          fillRect(cx - Math.round(10 * s), bobY - Math.round(4 * s), Math.round(6 * s), Math.round(4 * s), '#ffffff');
          fillRect(cx - Math.round(8 * s) + pupilShift, bobY - Math.round(4 * s), Math.round(3 * s), Math.round(4 * s), '#2b1d14');

          if (expression === 'smirk_wink' && (localFrame % 90 > 45)) {
            fillRect(cx + Math.round(4 * s), bobY - 2, Math.round(6 * s), 2, '#2b1d14');
          } else {
            fillRect(cx + Math.round(4 * s), bobY - Math.round(4 * s), Math.round(6 * s), Math.round(4 * s), '#ffffff');
            fillRect(cx + Math.round(6 * s) + pupilShift, bobY - Math.round(4 * s), Math.round(3 * s), Math.round(4 * s), '#2b1d14');
          }
        }

        // Gota de sudor azul si está en shock o avergonzado
        if (expression === 'shock_sweat' || expression === 'ashamed_red') {
          const dropY = hy + 4 + (Math.floor(localFrame * 0.3) % 8);
          fillRect(hx + headW - 4, dropY, 3, 5, '#38bdf8');
        }

        // Nariz y Boca
        fillRect(cx - 2, bobY + 1, Math.round(4 * s), Math.round(4 * s), '#c6865e');
        const mouthOpen = isTalking && (Math.floor(localFrame / 3) % 2 === 0);
        if (mouthOpen) {
          fillBorderedRect(cx - Math.round(6 * s), bobY + Math.round(7 * s), Math.round(12 * s), Math.round(5 * s), '#ffffff', '#2b1d14');
          fillRect(cx - Math.round(4 * s), bobY + Math.round(9 * s), Math.round(8 * s), 2, '#991b1b');
        } else {
          fillRect(cx - Math.round(5 * s), bobY + Math.round(8 * s), Math.round(10 * s), 2, '#2b1d14');
        }
      }

      // ======================================================================
      // LAS 8 ESCENAS DE ESTUDIO (TODAS CON LA CONSISTENCIA DEL ESTAFADOR)
      // ======================================================================

      // 1. PRIMER PLANO DEL PROTAGONISTA CON OBJETO CONTEXTUAL EN MANO
      function renderProtagonistCloseup(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#4a3222');
        for (let c = 0; c < COLS; c += 12) fillRect(c, 0, 1, ROWS, '#362317');
        fillBorderedRect(10, 42, 30, 22, '#e2e8f0', '#2b1d14');
        for (let r = 47; r < 59; r += 3) fillRect(14, r, 22, 1, '#94a3b8');

        // Cuadro derecho en pared
        fillBorderedRect(82, 40, 28, 24, '#1e293b', '#eab308');
        fillRect(86, 45, 20, 14, '#38bdf8');

        drawExpressiveCharacter(58, 84, esc.character_role, esc.expression, true, localFrame, 1.0, false);

        // Mano detallada sosteniendo el objeto exacto de la escena
        const handY = 114 - Math.round(Math.sin(progress * Math.PI) * 5);
        drawDetailedProp(esc.hand_prop, 66, handY);
        fillBorderedRect(46, handY - 2, 18, 14, '#e6ad86', '#0b0c10');
        fillRect(50, handY - 2, 1, 9, '#0b0c10');
        fillRect(54, handY - 2, 1, 9, '#0b0c10');
        fillRect(58, handY - 2, 1, 9, '#0b0c10');
      }

      // 2. NEGOCIACIÓN / REUNIÓN EN SUITE PRIVADA ENTRE DOS PERSONAJES GRANDES
      function renderTwoCharactersDeal(esc, progress, localFrame) {
        // Suite de lujo en el Hotel Crillon (paredes burdeos, cortinas doradas y lámpara)
        fillRect(0, 0, COLS, ROWS, '#3b1d2e');
        for (let c = 0; c < COLS; c += 14) fillRect(c, 0, 2, ROWS, '#2a1220');
        // Ventanal central de la suite
        fillBorderedRect(38, 36, 44, 46, '#1e293b', '#eab308');
        fillRect(59, 36, 2, 46, '#eab308');
        fillRect(38, 58, 44, 2, '#eab308');

        // Personaje Izquierdo (Estafador/Líder) y Personaje Derecho (Magnate/Objetivo) con el mismo estilo
        const leftTalks = progress < 0.55;
        drawExpressiveCharacter(28, 86, 'con_artist', 'scheming_evil', leftTalks, localFrame, 0.78, false);
        drawExpressiveCharacter(92, 86, 'merchant_rich', 'greedy_dollar', !leftTalks, localFrame + 9, 0.78, true);

        // Mesa de caoba en primer plano donde se desliza el maletín/contrato de izquierda a derecha
        fillBorderedRect(8, 126, 104, 18, '#78350f', '#0b0c10');
        fillRect(10, 128, 100, 3, '#b45309');

        const propX = Math.round(38 + progress * 44);
        drawDetailedProp(esc.hand_prop, propX, 120);
      }

      // 3. LA TORRE EIFFEL / MONUMENTO DE HIERRO Y BÁSCULA DE 7.000 TONELADAS
      function renderLandmarkMonument(esc, progress, localFrame) {
        // Cielo de París al atardecer con dithering
        const bands = ['#1e1b4b', '#312e81', '#6d28d9', '#f97316'];
        for (let r = 0; r < GROUND_Y; r++) {
          const bIdx = Math.min(3, Math.floor(r / 35));
          fillRect(0, r, COLS, 1, bands[bIdx]);
        }
        fillRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#1e293b');

        // Silueta detallada de la Torre Eiffel / Monumento de Hierro en el centro-derecha (X=76)
        const tx = 76;
        // Base en arco de la Torre Eiffel
        fillBorderedRect(tx - 22, GROUND_Y - 18, 12, 18, '#b45309', '#0b0c10');
        fillBorderedRect(tx + 10, GROUND_Y - 18, 12, 18, '#b45309', '#0b0c10');
        fillBorderedRect(tx - 20, GROUND_Y - 22, 40, 5, '#d97706', '#0b0c10');
        // Segundo cuerpo
        fillBorderedRect(tx - 13, GROUND_Y - 48, 26, 26, '#b45309', '#0b0c10');
        fillBorderedRect(tx - 15, GROUND_Y - 52, 30, 4, '#d97706', '#0b0c10');
        // Aguja superior y antena
        fillBorderedRect(tx - 6, GROUND_Y - 86, 12, 34, '#b45309', '#0b0c10');
        fillRect(tx - 1, GROUND_Y - 98, 2, 12, '#fde047');
        // Entramado de vigas de hierro
        for (let y = GROUND_Y - 82; y < GROUND_Y - 22; y += 8) {
          fillRect(tx - 5, y, 10, 2, '#451a03');
        }

        // Nuestro protagonista en primer plano a la izquierda mostrando el lingote/acero
        drawExpressiveCharacter(30, 92, esc.character_role, 'proud_confident', true, localFrame, 0.78, false);
        drawDetailedProp('iron_ingot', 42, 118);
      }

      // 4. ENTREGA DEL BOTÍN ($70,000) CON FAJOS DE BILLETES APILÁNDOSE EN LA MESA
      function renderCashHeistTally(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#0f172a');
        // Bóveda dorada abierta al fondo
        fillCircle(60, 74, 34, '#334155');
        fillCircle(60, 74, 28, '#eab308');
        fillCircle(60, 74, 22, '#090d16');

        // Protagonista con ojos de '$' en el centro
        drawExpressiveCharacter(34, 88, esc.character_role, 'greedy_dollar', true, localFrame, 0.82, false);

        // Mesa en primer plano donde crecen 3 columnas de fajos de billetes verdes según progress
        fillBorderedRect(8, 128, 104, 16, '#451a03', '#0b0c10');
        const numStacks = Math.max(2, Math.floor(progress * 18));
        for (let i = 0; i < numStacks; i++) {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const sx = 62 + col * 16;
          const sy = 122 - row * 7;
          fillBorderedRect(sx, sy, 14, 6, '#80ed99', '#064e3b');
          fillRect(sx + 5, sy, 3, 6, '#eab308');
        }
      }

      // 5. ESCRITORIO DE FALSIFICACIÓN DE CREDENCIALES Y SELLO OFICIAL ROJO
      function renderDocumentForgeryDesk(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#362317');
        // Pergamino / Credencial oficial sobre el escritorio
        fillBorderedRect(18, 42, 84, 90, '#fef3c7', '#0b0c10');
        fillBorderedRect(22, 46, 76, 82, '#fffbeb', '#d97706');

        // Cabecera oficial dorada
        fillBorderedRect(42, 52, 36, 12, '#eab308', '#0b0c10');

        // Líneas de texto escribiéndose en tiempo real con una mano y pluma estilográfica
        const lines = Math.min(5, Math.floor(progress * 6) + 1);
        for (let i = 0; i < lines; i++) {
          const ly = 72 + i * 9;
          const lw = (i === lines - 1) ? Math.round((progress * 6 % 1) * 54) : 54;
          fillRect(32, ly, Math.max(8, lw), 3, '#1e293b');
        }

        // Mano del falsificador con pluma y Sello Oficial Rojo estampándose en progress > 0.45
        if (progress > 0.45) {
          fillCircle(74, 110, 11, '#dc2626');
          fillCircle(74, 110, 7, '#991b1b');
          fillRect(71, 107, 6, 6, '#fde047');
        }
      }

      // 6. HUIDA EN EL TREN NOCTURNO A VIENA (LOCOMOTORA EXPRESO CON VENTANAS ILUMINADAS)
      function renderNightTrainEscape(esc, progress, localFrame) {
        // Cielo nocturno estrellado con luna llena
        fillRect(0, 0, COLS, GROUND_Y, '#090d16');
        fillCircle(94, 48, 10, '#fef08a');
        fillCircle(90, 46, 8, '#090d16'); // Luna creciente
        for (let s = 0; s < 20; s++) {
          setPx((s * 19) % COLS, 36 + (s * 7) % 45, '#ffffff');
        }

        // Vías del tren con traviesas desplazándose a toda velocidad
        fillRect(0, GROUND_Y - 12, COLS, 24, '#1e293b');
        fillRect(0, GROUND_Y - 10, COLS, 3, '#94a3b8');
        const railShift = localFrame * 3;
        for (let c = 0; c < COLS; c += 8) {
          const rx = ((c - railShift) % COLS + COLS) % COLS;
          fillRect(rx, GROUND_Y - 7, 4, 4, '#78350f');
        }

        // Vagón Expreso Nocturno detallado cruzando la escena con humo blanco
        const trainX = 14 + Math.round(progress * 18);
        const trainY = GROUND_Y - 46;
        // Humo de la locomotora
        for (let p = 0; p < 5; p++) {
          const px = trainX + 70 - ((localFrame * 2 + p * 12) % 55);
          const py = trainY - 8 - p * 4;
          fillCircle(px, py, 4 + (p % 3), '#cbd5e1');
        }
        // Chasis del vagón y techo
        fillBorderedRect(trainX, trainY, 82, 34, '#1e3a8a', '#0b0c10');
        fillBorderedRect(trainX - 2, trainY - 4, 86, 6, '#eab308', '#0b0c10');
        fillRect(trainX + 2, trainY + 22, 78, 3, '#eab308');

        // 3 Grandes ventanillas iluminadas mostrando al estafador con su sombrero dentro
        [trainX + 8, trainX + 32, trainX + 56].forEach((wx, idx) => {
          fillBorderedRect(wx, trainY + 6, 18, 14, '#fef08a', '#0b0c10');
          if (idx === 1) {
            // Silueta de Lustig con su sombrero amarillo dentro del tren
            fillRect(wx + 4, trainY + 9, 10, 3, '#eab308');
            fillRect(wx + 6, trainY + 12, 6, 5, '#e6ad86');
            fillRect(wx + 5, trainY + 17, 8, 3, '#334155');
          }
        });

        // Ruedas del tren girando
        [trainX + 12, trainX + 30, trainX + 52, trainX + 70].forEach(whlX => {
          fillCircle(whlX, GROUND_Y - 12, 6, '#0b0c10');
          fillCircle(whlX, GROUND_Y - 12, 3, '#ef4444');
        });
      }

      // 7. PORTADA DE PRENSA / PERIÓDICO CON RETRATO Y LUPA
      function renderPressHeadline(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#1e293b');
        // Página de periódico
        fillBorderedRect(14, 38, 92, 96, '#e2e8f0', '#0b0c10');
        fillRect(18, 42, 84, 10, '#0f172a'); // Cabecera del diario

        // Foto del protagonista dentro del periódico
        fillBorderedRect(22, 58, 38, 42, '#94a3b8', '#0b0c10');
        drawExpressiveCharacter(41, 78, esc.character_role, 'smirk_wink', false, localFrame, 0.45, false);

        // Columnas de noticias al lado de la foto
        for (let r = 60; r < 124; r += 7) {
          fillRect(66, r, 32, 3, '#334155');
          if (r > 102) fillRect(22, r, 40, 3, '#334155');
        }

        // Lupa escaneando la noticia suavemente
        const lx = Math.round(45 + Math.sin(progress * Math.PI * 2) * 20);
        const ly = Math.round(85 + Math.cos(progress * Math.PI * 2) * 14);
        drawDetailedProp('magnifying_glass', lx, ly);
      }

      function flushGridToCanvas() {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = grid[r][c];
            ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
          }
        }
      }

      const subBox = document.getElementById('sub-box');
      const hudFrame = document.getElementById('hud-frame');
      const labelTop = document.getElementById('label-top');
      const labelBot = document.getElementById('label-bot');
      const rpgModal = document.getElementById('rpg-modal');
      const rpgOptA = document.getElementById('rpg-opt-a');
      const rpgOptB = document.getElementById('rpg-opt-b');
      const curA = document.getElementById('cur-a');
      const curB = document.getElementById('cur-b');
      const txtOptA = document.getElementById('txt-opt-a');
      const txtOptB = document.getElementById('txt-opt-b');

      let lastChunkIdx = -2;
      let lastSceneIdx = -2;

      window.setFrameData = function(frameIdx, t) {
        const linearRatio = (frameIdx + 1) / totalFrames;
        document.getElementById('pbar').style.width = Math.min(100, linearRatio * 100) + '%';

        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        hudFrame.textContent = 'ESC:' + String(activeIdx + 1).padStart(2, '0') + '/' + String(escenas.length).padStart(2, '0');

        const esc = escenas[activeIdx] || {};
        const localT = Math.max(0, t - (esc.inicio || 0));
        const durEsc = Math.max(0.5, (esc.fin || 4) - (esc.inicio || 0));
        const progress = Math.max(0, Math.min(1, localT / durEsc));
        const localFrame = Math.floor(localT * 30);

        const shot = esc.shot_type || 'protagonist_closeup';

        // Actualizar rótulos superiores/inferiores con soporte completo de Ñ y tildes
        if (activeIdx !== lastSceneIdx) {
          lastSceneIdx = activeIdx;
          labelTop.textContent = esc.texto_1 || 'HISTORIA';
          labelBot.textContent = esc.texto_2 || 'CASO REAL';
          txtOptA.textContent = esc.choice_a || 'SI, CAERIA EN LA TRAMPA';
          txtOptB.textContent = esc.choice_b || 'NO, DESCONFIARIA AL INSTANTE';
        }

        // Mostrar u ocultar el modal RPG interactivo con texto real en la escena final
        if (shot === 'final_rpg_decision') {
          rpgModal.style.display = 'block';
          const selectB = (Math.floor(localFrame / 18) % 2 === 1);
          rpgOptA.classList.toggle('selected', !selectB);
          rpgOptB.classList.toggle('selected', selectB);
          curA.style.visibility = selectB ? 'hidden' : 'visible';
          curB.style.visibility = selectB ? 'visible' : 'hidden';
          renderProtagonistCloseup(esc, progress, localFrame);
        } else {
          rpgModal.style.display = 'none';
          if (shot === 'two_characters_deal') renderTwoCharactersDeal(esc, progress, localFrame);
          else if (shot === 'landmark_monument') renderLandmarkMonument(esc, progress, localFrame);
          else if (shot === 'cash_heist_tally') renderCashHeistTally(esc, progress, localFrame);
          else if (shot === 'document_forgery_desk') renderDocumentForgeryDesk(esc, progress, localFrame);
          else if (shot === 'night_train_escape') renderNightTrainEscape(esc, progress, localFrame);
          else if (shot === 'press_headline') renderPressHeadline(esc, progress, localFrame);
          else renderProtagonistCloseup(esc, progress, localFrame);
        }

        flushGridToCanvas();

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

        if (cIdx !== lastChunkIdx) {
          lastChunkIdx = cIdx;
          subBox.innerHTML = chunk.words.map((w, wIdx) => {
            const kwClass = w.highlight ? 'kw' : '';
            return '<span class="sub-word ' + kwClass + '" id="sw-' + wIdx + '">' + w.text + '</span>';
          }).join('');
        }

        chunk.words.forEach((w, wIdx) => {
          const el = document.getElementById('sw-' + wIdx);
          if (!el) return;
          el.classList.toggle('active', t >= w.start && t <= w.end);
          el.classList.toggle('future', t < w.start);
        });
      };
    </script>
  </body>
  </html>`;

  fs.writeFileSync('index_8bit.html', htmlContent);

  if (fs.existsSync('frames')) fs.rmSync('frames', { recursive: true, force: true });
  fs.mkdirSync('frames');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', err => console.error('⚠️ Error en navegador:', err.message));
  await page.setViewport({ width: 720, height: 1280 });
  await page.goto('file://' + path.resolve('index_8bit.html'), { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Pixel-Art Studio v8.0 (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 94 });
  }

  await browser.close();
  if (browser.process()) {
    browser.process().kill('SIGKILL');
  }

  console.log('🔊 Ensamblando MP4 final Pixel-Art Studio v8.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Pixel-Art Studio v8.0 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
