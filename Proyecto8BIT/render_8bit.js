const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. DESCARGA DE PAYLOAD Y ALINEACIÓN FONÉTICA DE SUBTÍTULOS (SIN CORTES)
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
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
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

  const lastSpokenEnd = elevenWords.length > 0
    ? elevenWords[elevenWords.length - 1].end
    : Math.max(1, realAudioDuration - 0.35);

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

  for (let i = 0; i < escenas.length - 1; i++) {
    escenas[i].fin = escenas[i + 1].inicio;
  }
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
// 2. SINTETIZADOR CHIPTUNE 8-BIT PROCEDURAL (ONDAS CUADRADAS Y ARPEGIOS NES)
// ============================================================================
function buildChiptuneSfxTrack(escenas, totalDuration, videoHash) {
  function get8BitRecipe(type, pitchMod) {
    const p = pitchMod.toFixed(3);
    const catalog = {
      coin_8bit: {
        expr: `0.20*(lt(t,0.08)*sgn(sin(2*PI*987.77*${p}*t))+gt(t,0.08)*exp(-6*(t-0.08))*sgn(sin(2*PI*1318.51*${p}*t)))`,
        dur: 0.42
      },
      laser_8bit: {
        expr: `0.18*exp(-5*t)*sgn(sin(2*PI*(1200*${p}*exp(-6*t)+120)*t))`,
        dur: 0.32
      },
      explosion_8bit: {
        expr: `0.28*exp(-4.5*t)*(sgn(sin(2*PI*75*exp(-2*t)*t))*sin(2*PI*19*t)+0.5*sgn(sin(2*PI*230*t)*sin(2*PI*53*t)))`,
        dur: 0.65
      },
      powerup_8bit: {
        expr: `0.18*(lt(t,0.07)*sgn(sin(2*PI*330*${p}*t))+between(t,0.07,0.14)*sgn(sin(2*PI*392*${p}*t))+between(t,0.14,0.21)*sgn(sin(2*PI*659*${p}*t))+gt(t,0.21)*exp(-5*(t-0.21))*sgn(sin(2*PI*523*${p}*t)))`,
        dur: 0.45
      },
      alarm_8bit: {
        expr: `0.18*exp(-1.5*t)*sgn(sin(2*PI*(680+220*sgn(sin(2*PI*8*t)))*t))`,
        dur: 0.55
      },
      glitch_8bit: {
        expr: `0.18*exp(-6*t)*sgn(sin(2*PI*440*${p}*t)*sin(2*PI*67*t)+sin(2*PI*1120*t)*sin(2*PI*29*t))`,
        dur: 0.35
      },
      jump_8bit: {
        expr: `0.19*exp(-4*t)*sgn(sin(2*PI*(180*${p}+520*t)*t))`,
        dur: 0.30
      },
      error_8bit: {
        expr: `0.22*exp(-4*t)*(lt(t,0.14)*sgn(sin(2*PI*165*${p}*t))+gt(t,0.14)*sgn(sin(2*PI*130.8*${p}*t)))`,
        dur: 0.45
      },
      typing_8bit: {
        expr: `0.16*(exp(-40*t)*sgn(sin(2*PI*1400*t))+gt(t,0.09)*exp(-40*(t-0.09))*sgn(sin(2*PI*1650*t))+gt(t,0.18)*exp(-40*(t-0.18))*sgn(sin(2*PI*1300*t)))`,
        dur: 0.30
      },
      level_clear_8bit: {
        expr: `0.18*exp(-2.8*t)*(sgn(sin(2*PI*523.25*${p}*t))+0.7*sgn(sin(2*PI*659.25*${p}*t))+0.5*sgn(sin(2*PI*783.99*${p}*t)))`,
        dur: 0.65
      }
    };
    return catalog[type] || catalog.coin_8bit;
  }

  const allTypes = [
    'coin_8bit', 'laser_8bit', 'explosion_8bit', 'powerup_8bit', 'alarm_8bit',
    'glitch_8bit', 'jump_8bit', 'error_8bit', 'typing_8bit', 'level_clear_8bit'
  ];

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
    execSync(
      `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`,
      { stdio: 'ignore' }
    );
  } catch (err) {
    return false;
  }
  return fs.existsSync('hook_sfx.wav') && fs.statSync('hook_sfx.wav').size > 1000;
}

// ============================================================================
// 3. EJECUCIÓN PRINCIPAL Y MOTOR GRÁFICO ESCÉNICO 8-BIT (45x80)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload 8-BIT v2.0 desde URL...');
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

  // Colchón de +0.45s al final para evitar que se corte la última sílaba del locutor
  execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.45" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });

  let realAudioDuration = 35;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) realAudioDuration = parsed;
  } catch (err) {
    realAudioDuration = Number(payload.duracion_total) || 35;
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

  const escenasOriginales = payload.escenas || [];
  const subtitleChunks = buildSubtitleChunks(escenasOriginales, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio con bg_music2.mp3
  try {
    let hasSfx = false;
    try {
      hasSfx = buildChiptuneSfxTrack(escenasOriginales, duracionExactaVideo, hash);
    } catch (e) {}

    let bgMusicPath = path.resolve(__dirname, '../bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve('bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve(__dirname, '../bg_music.mp3');

    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.82,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );
      if (hasSfx) {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.12[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      } else {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.12[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      }
    } else {
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (e) {
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

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
      }
      #pixel-canvas {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        image-rendering: pixelated;
        z-index: 2;
      }
      .crt-scanlines {
        position: absolute; inset: 0;
        background: linear-gradient(
          rgba(18, 16, 16, 0) 50%, 
          rgba(0, 0, 0, 0.22) 50%
        );
        background-size: 100% 8px;
        z-index: 10; pointer-events: none;
      }
      .arcade-hud {
        position: absolute; top: 32px; left: 26px; right: 26px;
        display: flex; justify-content: space-between; align-items: center;
        background: rgba(8, 10, 22, 0.90);
        border: 4px solid #00f2fe;
        padding: 13px 18px;
        box-shadow: 0 8px 0 #000000;
        z-index: 20;
      }
      .hud-tag {
        color: #ffd000;
        font-size: 13px;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .hud-score {
        color: #ffffff;
        font-size: 12px;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000, #00f2fe);
        width: 0%; z-index: 30;
      }
      .subtitle-container {
        position: absolute;
        bottom: 85px; left: 26px; right: 26px;
        min-height: 155px;
        display: flex; justify-content: center; align-items: center;
        z-index: 25; pointer-events: none;
      }
      .subtitle-box {
        display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
        gap: 12px 18px; text-align: center;
        padding: 20px 26px;
        background: rgba(8, 10, 20, 0.94);
        border: 4px solid #ffffff;
        outline: 4px solid #000000;
        box-shadow: 0 12px 0 rgba(0,0,0,0.85);
      }
      .sub-word {
        display: inline-block;
        font-family: 'Montserrat', sans-serif;
        font-size: 38px;
        font-weight: 900;
        text-transform: uppercase;
        color: #ffffff;
        paint-order: stroke fill;
        -webkit-text-stroke: 7px #000000;
        text-shadow: 4px 4px 0 #000000;
      }
      .sub-word.kw {
        color: #ffd000;
      }
      .sub-word.active {
        transform: scale(1.12) translateY(-5px);
        color: #00f2fe;
      }
      .sub-word.kw.active {
        color: #ffd000;
        transform: scale(1.16) translateY(-6px);
      }
      .sub-word.future {
        opacity: 0.42;
      }
    </style>
  </head>
  <body>
    <div class="progress-bar" id="pbar"></div>
    <div class="arcade-hud">
      <div class="hud-tag" id="hud-scene-title">${(payload.subrama || 'GLITCH 8-BIT').slice(0, 24)}</div>
      <div class="hud-score" id="hud-frame">ESC:01</div>
    </div>

    <canvas id="pixel-canvas" width="720" height="1280"></canvas>
    <div class="crt-scanlines"></div>

    <div class="subtitle-container">
      <div class="subtitle-box" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasOriginales)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const totalFrames = ${totalFrames};

      const COLS = 45;
      const ROWS = 80;
      const CELL = 16;
      const GROUND_Y = 54; // Nivel firme del suelo donde pisan los personajes

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#101420'));

      function setCell(x, y, color) {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && color) {
          grid[cy][cx] = color;
        }
      }

      function drawRect(x, y, w, h, color) {
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            setCell(x + c, y + r, color);
          }
        }
      }

      function drawCircle(cx, cy, radius, color) {
        for (let r = -radius; r <= radius; r++) {
          for (let c = -radius; c <= radius; c++) {
            if (c * c + r * r <= radius * radius) {
              setCell(cx + c, cy + r, color);
            }
          }
        }
      }

      // ======================================================================
      // 10 ESCENARIOS CONTEXTUALES RICOS Y COLORIDOS (NO MÁS FONDO NEGRO VACÍO)
      // ======================================================================
      function drawEnvironment(bgType, frameIdx) {
        const type = String(bgType || 'day_office').toLowerCase().trim();

        // 1. OFICINA CORPORATIVA CON VENTANALES DE DÍA Y EDIFICIOS
        if (type === 'day_office') {
          drawRect(0, 0, COLS, GROUND_Y, '#2b3a55'); // Pared azulada de oficina
          // Dos grandes ventanales con cielo azul diurno, nubes y edificios al fondo
          [5, 25].forEach(wx => {
            drawRect(wx, 14, 15, 24, '#5bc0be'); // Cielo diurno
            drawRect(wx + 2, 26, 4, 12, '#3a506b'); // Rascacielos lejano 1
            drawRect(wx + 8, 22, 5, 16, '#1c2541'); // Rascacielos lejano 2
            // Nube moviéndose
            const cloudX = wx + 2 + (Math.floor(frameIdx * 0.15) % 9);
            drawRect(cloudX, 17, 4, 2, '#ffffff');
            // Marco de ventana
            drawRect(wx, 14, 15, 1, '#e0e6ed');
            drawRect(wx, 37, 15, 1, '#e0e6ed');
            drawRect(wx + 7, 14, 1, 24, '#e0e6ed');
          });
          // Zócalo y suelo de madera cálida con baldosas
          drawRect(0, GROUND_Y - 2, COLS, 2, '#d9d9d9');
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((r + c) % 4 === 0) ? '#7f5539' : '#9c6644';
            }
          }
          return;
        }

        // 2. SUPERMERCADO / TIENDA CON ESTANTERÍAS DE COLORES
        if (type === 'supermarket') {
          drawRect(0, 0, COLS, GROUND_Y, '#f4f1de'); // Pared crema muy luminosa
          // Estanterías del supermercado llenas de productos
          for (let sy = 16; sy <= 42; sy += 9) {
            drawRect(4, sy, 37, 2, '#8d99ae'); // Balda metálica
            for (let sx = 6; sx < 38; sx += 4) {
              const prodCol = (sx + sy) % 3 === 0 ? '#e63946' : ((sx + sy) % 2 === 0 ? '#ffb703' : '#2a9d8f');
              drawRect(sx, sy - 4, 2, 4, prodCol);
              setCell(sx, sy - 3, '#ffffff'); // Etiqueta del producto
            }
          }
          // Suelo ajedrezado de tienda
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const isLight = (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 0;
              grid[r][c] = isLight ? '#e5e5e5' : '#b8c0ff';
            }
          }
          return;
        }

        // 3. PLATAFORMA DE LANZAMIENTO ESPACIAL DIURNA (ARIANE / NASA)
        if (type === 'launch_pad') {
          // Cielo azul degradado luminoso
          for (let r = 0; r < GROUND_Y; r++) {
            const skyCol = r < 22 ? '#1d3557' : (r < 38 ? '#457b9d' : '#a8dadc');
            drawRect(0, r, COLS, 1, skyCol);
          }
          // Nubes blancas suaves
          const c1 = (Math.floor(frameIdx * 0.2) + 5) % (COLS - 8);
          const c2 = (Math.floor(frameIdx * 0.15) + 25) % (COLS - 8);
          drawRect(c1, 16, 7, 2, '#ffffff'); drawRect(c1 + 1, 15, 5, 1, '#ffffff');
          drawRect(c2, 24, 8, 2, '#ffffff'); drawRect(c2 + 2, 23, 4, 1, '#ffffff');
          // Torre de lanzamiento roja a la izquierda
          for (let r = 18; r < GROUND_Y; r++) {
            setCell(7, r, '#e63946');
            setCell(11, r, '#e63946');
            if (r % 3 === 0) drawRect(7, r, 5, 1, '#f1faee');
          }
          // Suelo de hormigón y hierba verde
          drawRect(0, GROUND_Y, COLS, 3, '#52b788');
          drawRect(0, GROUND_Y + 3, COLS, ROWS - GROUND_Y - 3, '#495057');
          return;
        }

        // 4. AEROPUERTO Y CIELO DE VUELO (MILLAS / AVIONES)
        if (type === 'airport_sky') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 28 ? '#0077b6' : '#90e0ef');
          }
          // Sol radiante arriba a la derecha
          drawCircle(36, 15, 4, '#ffd166');
          // Nubes en movimiento
          for (let i = 0; i < 3; i++) {
            const cx = (i * 15 + Math.floor(frameIdx * 0.4)) % (COLS - 6);
            drawRect(cx, 18 + i * 7, 6, 2, '#ffffff');
          }
          // Torre de control al fondo
          drawRect(6, 36, 4, 18, '#adb5bd');
          drawRect(4, 32, 8, 4, '#1d3557');
          drawRect(5, 33, 6, 2, '#00f5d4');
          // Pista de asfalto con líneas blancas
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#343a40');
          const stripeShift = Math.floor(frameIdx * 0.8);
          for (let c = 0; c < COLS; c++) {
            if ((c + stripeShift) % 8 < 4) drawRect(c, GROUND_Y + 4, 1, 2, '#ffd166');
          }
          return;
        }

        // 5. PARQUÉ DE BOLSA / WALL STREET (TRADING / FINANZAS)
        if (type === 'stock_exchange') {
          drawRect(0, 0, COLS, GROUND_Y, '#101828');
          // Paneles electrónicos de cotizaciones al fondo
          for (let py = 15; py <= 35; py += 10) {
            drawRect(3, py, 39, 7, '#050811');
            for (let px = 5; px < 40; px += 3) {
              const isUp = ((px + py + Math.floor(frameIdx / 4)) % 3) !== 0;
              const barH = 2 + ((px * py) % 4);
              drawRect(px, py + 6 - barH, 2, barH, isUp ? '#10b981' : '#ef4444');
            }
          }
          // Suelo de mármol brillante
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((r + c) % 5 === 0) ? '#334155' : '#1e293b';
            }
          }
          return;
        }

        // 6. BÓVEDA BANCARIA ACORAZADA
        if (type === 'bank_vault') {
          drawRect(0, 0, COLS, GROUND_Y, '#2b2d42');
          drawRect(5, 13, 35, 39, '#4a4e69');
          drawCircle(22, 32, 12, '#8d99ae');
          drawCircle(22, 32, 9, '#2b2d42');
          drawCircle(22, 32, 4, '#ffb703');
          // Rayos de la timba de la puerta acorazada girando
          const angle = frameIdx * 0.08;
          for (let d = 4; d <= 9; d++) {
            setCell(22 + Math.cos(angle) * d, 32 + Math.sin(angle) * d, '#ffb703');
            setCell(22 - Math.cos(angle) * d, 32 - Math.sin(angle) * d, '#ffb703');
          }
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#1a1b26');
          return;
        }

        // 7. SALA DE SERVIDORES / CENTRO DE DATOS
        if (type === 'server_room') {
          drawRect(0, 0, COLS, GROUND_Y, '#0f172a');
          for (let c = 4; c < COLS - 4; c += 10) {
            drawRect(c, 14, 7, 40, '#1e293b');
            drawRect(c + 1, 15, 5, 38, '#090d16');
            for (let r = 17; r < 50; r += 3) {
              const on = ((frameIdx + r * 3 + c) % 10) < 6;
              setCell(c + 2, r, on ? '#38bdf8' : '#334155');
              setCell(c + 4, r, !on ? '#10b981' : '#ef4444');
            }
          }
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = (c % 5 === 0 || r % 4 === 0) ? '#38bdf8' : '#0f172a';
            }
          }
          return;
        }

        // 8. LABORATORIO CLÍNICO / HOSPITAL
        if (type === 'hospital_lab') {
          drawRect(0, 0, COLS, GROUND_Y, '#e0fbfc');
          // Azulejos blancos y celestes de laboratorio
          for (let r = 12; r < GROUND_Y; r += 4) {
            drawRect(0, r, COLS, 1, '#98c1d9');
          }
          // Cruz médica roja en la pared central
          drawRect(20, 18, 5, 13, '#ef233c');
          drawRect(16, 22, 13, 5, '#ef233c');
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#3d5a80');
          return;
        }

        // 9. CASINO / CONCURSO DE TV ILUMINADO
        if (type === 'casino_floor') {
          drawRect(0, 0, COLS, GROUND_Y, '#240046');
          // Panel de bombillas luminosas estilo concurso TV
          for (let r = 14; r < 48; r += 5) {
            for (let c = 4; c < COLS - 4; c += 5) {
              const lit = ((r + c + Math.floor(frameIdx / 3)) % 3) === 0;
              drawRect(c, r, 3, 3, lit ? '#ffbe0b' : '#5a189a');
            }
          }
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#3c096c');
          return;
        }

        // 10. ESPACIO PROFUNDO CON PLANETA Y ESTRELLAS (DEEP SPACE)
        drawRect(0, 0, COLS, ROWS, '#0b0c10');
        // Planeta Tierra / Satélite en el horizonte
        drawCircle(22, 68, 22, '#1f4e78');
        drawCircle(18, 64, 8, '#2e8b57');
        for (let i = 0; i < 32; i++) {
          const sc = (i * 19 + Math.floor(frameIdx * 0.2)) % COLS;
          const sr = (i * 13) % 48;
          if ((frameIdx + i) % 8 < 6) setCell(sc, sr, i % 3 === 0 ? '#ffd166' : '#ffffff');
        }
      }

      // ======================================================================
      // DICCIONARIO DE 20 SPRITES 8-BIT RECONOCIBLES + MATRIZ CUSTOM
      // ======================================================================
      function drawActor8Bit(act, frameIdx) {
        const tipo = String(act.tipo || 'engineer').toLowerCase().trim();
        const action = String(act.action || 'idle').toLowerCase().trim();

        // Determinar si es un objeto aéreo o terrestre para anclarlo bien y que no flote
        const isAirborne = ['rocket', 'plane', 'satellite', 'chart_up', 'chart_down', 'alert_sign', 'virus_bug', 'barcode'].includes(tipo);
        let baseX = Number(act.x) || 22;
        let baseY = isAirborne ? (Number(act.y) || 30) : (GROUND_Y - 5);

        let x = baseX;
        let y = baseY;

        if (action === 'walk_right' || action === 'run_right') {
          x = 6 + ((baseX + Math.floor(frameIdx * 0.38)) % (COLS - 12));
        } else if (action === 'walk_left' || action === 'run_left') {
          x = 6 + ((baseX - Math.floor(frameIdx * 0.38) + COLS * 10) % (COLS - 12));
        } else if (action === 'jump') {
          y = baseY - Math.abs(Math.round(Math.sin(frameIdx * 0.32) * 5));
        } else if (action === 'launch') {
          y = Math.max(12, baseY - Math.floor((frameIdx % 45) * 0.65));
        } else if (action === 'fall') {
          y = Math.min(GROUND_Y - 3, 16 + Math.floor((frameIdx % 40) * 0.8));
        } else if (action === 'float' || isAirborne) {
          y = baseY + Math.round(Math.sin(frameIdx * 0.22) * 2);
        }

        // Sacudida limpia sin desintegrar el dibujo (para que siempre se entienda qué es)
        if (action === 'shake' || action === 'glitch') {
          x += (frameIdx % 2 === 0) ? 1 : -1;
        }

        const step = Math.floor(frameIdx / 4) % 2;
        const put = (dx, dy, col) => setCell(x + dx, y + dy, col);

        // Si el Director envió una matriz custom_grid (array de strings)
        if (Array.isArray(act.custom_grid) && act.custom_grid.length >= 4) {
          const paletteMap = {
            '1': act.color || '#ffd166',
            '2': '#ffffff',
            '3': '#ef233c',
            '4': '#00f5d4',
            '5': '#000000'
          };
          const h = act.custom_grid.length;
          const w = act.custom_grid[0].length;
          for (let r = 0; r < h; r++) {
            const rowStr = String(act.custom_grid[r]);
            for (let c = 0; c < rowStr.length; c++) {
              const ch = rowStr[c];
              if (paletteMap[ch]) {
                put(c - Math.floor(w / 2), r - Math.floor(h / 2), paletteMap[ch]);
              }
            }
          }
          return;
        }

        // 1. TAZA DE PUDIN / PRODUCTO DE SUPERMERCADO
        if (tipo === 'pudding_cup') {
          // Copa marrón/caramelo con tapa dorada
          for (let c = -4; c <= 4; c++) put(c, -3, '#ffd166'); // Tapa dorada
          for (let r = -2; r <= 2; r++) {
            const w = r < 1 ? 3 : 2;
            for (let c = -w; c <= w; c++) put(c, r, '#d4a373');
          }
          for (let c = -2; c <= 2; c++) put(c, -1, '#ffffff'); // Franja de crema
          return;
        }

        // 2. CÓDIGO DE BARRAS CON LÁSER ROJO ESCANEANDO
        if (tipo === 'barcode') {
          drawRect(x - 6, y - 4, 13, 9, '#ffffff');
          const bars = [-5, -3, -2, 0, 2, 3, 5];
          bars.forEach(bc => {
            for (let r = -3; r <= 3; r++) put(bc, r, '#000000');
          });
          // Línea láser roja subiendo y bajando
          const laserY = -3 + (frameIdx % 7);
          for (let c = -7; c <= 7; c++) put(c, laserY, '#ef233c');
          return;
        }

        // 3. CARRITO DE LA COMPRA LLENO
        if (tipo === 'shopping_cart') {
          // Mango y cesta metálica
          put(-5, -3, '#ef233c'); put(-4, -2, '#adb5bd');
          for (let c = -3; c <= 4; c++) {
            put(c, -2, '#ffffff'); put(c, 2, '#ffffff');
            if (c % 2 === 0) { put(c, -1, '#adb5bd'); put(c, 0, '#adb5bd'); put(c, 1, '#adb5bd'); }
          }
          // Productos dentro del carrito
          drawRect(x - 2, y - 4, 3, 2, '#ffb703');
          drawRect(x + 1, y - 5, 3, 3, '#ef233c');
          // Ruedas girando
          put(-2, 4, '#000000'); put(3, 4, '#000000');
          return;
        }

        // 4. AVIÓN COMERCIAL (MILLAS / VUELOS)
        if (tipo === 'plane') {
          const flyX = 8 + ((baseX + Math.floor(frameIdx * 0.5)) % (COLS - 16));
          const pPut = (dx, dy, col) => setCell(flyX + dx, y + dy, col);
          // Fuselaje blanco
          for (let c = -6; c <= 6; c++) { pPut(c, 0, '#ffffff'); pPut(c, 1, '#e5e5e5'); }
          pPut(7, 1, '#ffffff'); pPut(-6, -1, '#ef233c'); pPut(-6, -2, '#ef233c'); // Cola roja
          // Ventanillas azules
          for (let c = -3; c <= 4; c += 2) pPut(c, 0, '#0077b6');
          // Alas
          for (let r = -3; r <= 4; r++) pPut(0, r, '#adb5bd');
          return;
        }

        // 5. COHETE ESPACIAL (ARIANE 5 / NASA)
        if (tipo === 'rocket') {
          put(0, -7, '#ef233c');
          for (let c = -1; c <= 1; c++) put(c, -6, '#ef233c');
          for (let r = -5; r <= 3; r++) {
            for (let c = -2; c <= 2; c++) put(c, r, '#ffffff');
          }
          put(0, -2, '#00b4d8'); put(0, -1, '#00b4d8'); // Escotilla
          put(-3, 2, '#ef233c'); put(-3, 3, '#ef233c'); put(-4, 3, '#ef233c');
          put(3, 2, '#ef233c'); put(3, 3, '#ef233c'); put(4, 3, '#ef233c');
          // Propulsor animado
          const fl = 2 + (frameIdx % 4);
          for (let f = 1; f <= fl; f++) {
            put(0, 3 + f, f % 2 === 0 ? '#ffd166' : '#f77f00');
            put(-1, 3 + f, '#ef233c'); put(1, 3 + f, '#ef233c');
          }
          return;
        }

        // 6. SATÉLITE ESPACIAL CON PANELES SOLARES
        if (tipo === 'satellite') {
          drawRect(x - 2, y - 2, 5, 5, '#ffd166'); // Cuerpo dorado
          drawRect(x - 8, y - 1, 5, 3, '#0077b6'); // Panel izquierdo
          drawRect(x + 4, y - 1, 5, 3, '#0077b6'); // Panel derecho
          put(0, -3, '#ffffff'); put(0, -4, '#ef233c'); // Antena
          return;
        }

        // 7. GRÁFICA SUBIENDO (CHART UP) O BAJANDO (CHART DOWN)
        if (tipo === 'chart_up' || tipo === 'chart_down') {
          drawRect(x - 6, y - 5, 13, 10, '#0f172a');
          const isUp = tipo === 'chart_up';
          const lineCol = isUp ? '#10b981' : '#ef4444';
          for (let i = -4; i <= 4; i++) {
            const cy = isUp ? -i : i;
            put(i, cy, lineCol);
            put(i, cy + 1, lineCol);
          }
          return;
        }

        // 8. ORDENADOR / MONITOR CON PANTALLA DE CÓDIGO
        if (tipo === 'computer') {
          drawRect(x - 5, y - 5, 11, 8, '#e2e8f0');
          drawRect(x - 4, y - 4, 9, 6, '#0f172a');
          const blinkCol = (action === 'glitch' || action === 'explode') ? '#ef4444' : '#10b981';
          drawRect(x - 3, y - 3, 5, 1, blinkCol);
          drawRect(x - 3, y - 1, 7, 1, '#ffd166');
          drawRect(x - 1, y + 3, 3, 2, '#94a3b8');
          drawRect(x - 3, y + 4, 7, 1, '#e2e8f0');
          return;
        }

        // 9. SACO DE DINERO / LINGOTES DE ORO
        if (tipo === 'money_bag' || tipo === 'gold_bars') {
          for (let r = -3; r <= 3; r++) {
            for (let c = -3; c <= 3; c++) {
              if (Math.abs(c) + Math.abs(r) <= 5) put(c, r, '#ffd166');
            }
          }
          put(0, -2, '#000000'); put(-1, -1, '#000000'); put(0, 0, '#000000'); put(1, 1, '#000000'); put(0, 2, '#000000');
          return;
        }

        // 10. TROFEO DORADO (VICTORIA / RÉCORD / ESTATUS VIP)
        if (tipo === 'trophy') {
          for (let r = -4; r <= 0; r++) {
            for (let c = -3; c <= 3; c++) put(c, r, '#ffd166');
          }
          put(-4, -3, '#ffd166'); put(4, -3, '#ffd166');
          put(0, 1, '#f77f00'); put(0, 2, '#f77f00');
          for (let c = -2; c <= 2; c++) put(c, 3, '#ffffff');
          return;
        }

        // 11. VIRUS / BUG INFORMÁTICO O SEÑAL DE ALERTA
        if (tipo === 'virus_bug' || tipo === 'alert_sign') {
          for (let r = -3; r <= 2; r++) {
            for (let c = -3; c <= 3; c++) put(c, r, '#ef233c');
          }
          const eye = (frameIdx % 6 < 3) ? '#ffd166' : '#ffffff';
          put(-2, -1, eye); put(2, -1, eye);
          const legShift = step === 0 ? 1 : -1;
          put(-4, 0 + legShift, '#ffd166'); put(4, 0 - legShift, '#ffd166');
          put(-4, 2 - legShift, '#ffd166'); put(4, 2 + legShift, '#ffd166');
          return;
        }

        // 12. CAMIÓN DE REPARTO / COCHE
        if (tipo === 'truck' || tipo === 'car') {
          drawRect(x - 6, y - 3, 8, 5, '#ffffff'); // Remolque
          drawRect(x + 2, y - 1, 4, 3, '#ef233c'); // Cabina
          put(4, 0, '#90e0ef'); // Parabrisas
          put(-4, 3, '#000000'); put(0, 3, '#000000'); put(3, 3, '#000000'); // Ruedas
          return;
        }

        // 13. HUMANOIDES CONTEXTUALES (ENGINEER, BUSINESSMAN, HACKER, SCIENTIST, GUARD)
        let shirtColor = '#38bdf8';
        let pantsColor = '#1e3a8a';
        let hatColor = null;

        if (tipo === 'engineer') { shirtColor = '#f97316'; hatColor = '#ffd166'; } // Casco amarillo e indumentaria naranja
        else if (tipo === 'businessman') { shirtColor = '#1e293b'; pantsColor = '#0f172a'; } // Traje ejecutivo oscuro con corbata roja
        else if (tipo === 'scientist') { shirtColor = '#ffffff'; pantsColor = '#475569'; } // Bata blanca de laboratorio
        else if (tipo === 'guard') { shirtColor = '#1d3557'; hatColor = '#1d3557'; }
        else if (tipo === 'hacker') { shirtColor = '#10b981'; pantsColor = '#064e3b'; }

        // Cabeza
        for (let r = -5; r <= -3; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, '#ffcdb2');
        }
        if (hatColor) {
          for (let c = -2; c <= 2; c++) put(c, -6, hatColor);
        }
        put(1, -4, '#000000'); // Ojo mirando al frente

        // Torso
        for (let r = -2; r <= 1; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, shirtColor);
        }
        if (tipo === 'businessman') { put(0, -1, '#ef233c'); put(0, 0, '#ef233c'); } // Corbata roja

        // Brazos animados
        if (step === 0) {
          put(-2, -1, shirtColor); put(-2, 0, '#ffcdb2');
          put(2, -2, shirtColor); put(2, -3, '#ffcdb2');
        } else {
          put(-2, -2, shirtColor); put(-2, -3, '#ffcdb2');
          put(2, -1, shirtColor); put(2, 0, '#ffcdb2');
        }

        // Piernas caminando sobre el suelo firme (GROUND_Y)
        if (step === 0) {
          put(-1, 2, pantsColor); put(-2, 3, pantsColor); put(-2, 4, '#ffffff');
          put(1, 2, pantsColor); put(1, 3, pantsColor); put(1, 4, '#ffffff');
        } else {
          put(-1, 2, pantsColor); put(-1, 3, pantsColor); put(-1, 4, '#ffffff');
          put(1, 2, pantsColor); put(2, 3, pantsColor); put(2, 4, '#ffffff');
        }
      }

      // FUENTE 3x5 PARA RÓTULOS PIXEL ART EN PANTALLA
      const FONT_3X5 = {
        'A': ['010','101','111','101','101'], 'B': ['110','101','110','101','110'],
        'C': ['111','100','100','100','111'], 'D': ['110','101','101','101','110'],
        'E': ['111','100','110','100','111'], 'F': ['111','100','110','100','100'],
        'G': ['111','100','101','101','111'], 'H': ['101','101','111','101','101'],
        'I': ['111','010','010','010','111'], 'J': ['001','001','001','101','111'],
        'K': ['101','101','110','101','101'], 'L': ['100','100','100','100','111'],
        'M': ['101','111','101','101','101'], 'N': ['111','101','101','101','101'],
        'O': ['111','101','101','101','111'], 'P': ['111','101','111','100','100'],
        'Q': ['111','101','101','111','001'], 'R': ['111','101','110','101','101'],
        'S': ['111','100','111','001','111'], 'T': ['111','010','010','010','010'],
        'U': ['101','101','101','101','111'], 'V': ['101','101','101','101','010'],
        'W': ['101','101','101','111','101'], 'X': ['101','101','010','101','101'],
        'Y': ['101','101','010','010','010'], 'Z': ['111','001','010','100','111'],
        '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
        '2': ['111','001','111','100','111'], '3': ['111','001','111','001','111'],
        '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
        '6': ['111','100','111','101','111'], '7': ['111','001','001','001','001'],
        '8': ['111','101','111','101','111'], '9': ['111','101','111','001','111'],
        '$': ['010','111','010','111','010'], '%': ['101','001','010','100','101'],
        '!': ['010','010','010','000','010'], '?': ['111','001','011','000','010']
      };

      function drawPixelString(str, startX, startY, color) {
        const clean = String(str || '').toUpperCase().replace(/[^A-Z0-9$%!? ]/g, '').slice(0, 9);
        if (!clean) return;
        const totalW = clean.length * 4 - 1;
        let cx = Math.max(2, Math.floor(startX - totalW / 2));
        // Caja oscura translúcida detrás del texto para legibilidad 100% sobre fondos claros
        drawRect(cx - 2, startY - 1, totalW + 4, 7, '#080a14');
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const glyph = FONT_3X5[ch];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') {
                  setCell(cx + c, startY + r, color);
                }
              }
            }
          }
          cx += 4;
        }
      }

      function flushGridToCanvas() {
        ctx.clearRect(0, 0, 720, 1280);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = grid[r][c];
            ctx.fillRect(c * CELL, r * CELL, CELL - 1, CELL - 1);
          }
        }
      }

      const subBox = document.getElementById('sub-box');
      const hudFrame = document.getElementById('hud-frame');
      let lastChunkIdx = -2;

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
        const localFrame = Math.max(0, Math.floor((t - (esc.inicio || 0)) * 30));

        // 1. Pintar el escenario contextual rico y colorido
        drawEnvironment(esc.bg_type || 'day_office', frameIdx);

        // 2. Pintar los objetos y actores coherentes con el guion
        const actors = Array.isArray(esc.actors) && esc.actors.length > 0
          ? esc.actors
          : [{ tipo: 'engineer', x: 16, y: 49, action: 'walk_right' }];

        actors.forEach((act, aIdx) => {
          drawActor8Bit(
            { ...act, x: Number(act.x) || (14 + aIdx * 16) },
            localFrame
          );
        });

        // 3. Efectos ambientales de partículas (explosión o lluvia de oro)
        if (esc.efecto_matriz === 'explosion_pixel') {
          for (let p = 0; p < 24; p++) {
            const angle = (p / 24) * Math.PI * 2;
            const dist = 2 + (localFrame % 16) * 0.9;
            setCell(22 + Math.cos(angle) * dist, 30 + Math.sin(angle) * dist, p % 2 === 0 ? '#ffd166' : '#ef233c');
          }
        } else if (esc.efecto_matriz === 'coin_shower') {
          for (let m = 0; m < 14; m++) {
            const mx = (m * 7 + 4) % COLS;
            const my = 12 + ((localFrame * 2 + m * 9) % 40);
            setCell(mx, my, '#ffd166');
            setCell(mx, my + 1, '#f77f00');
          }
        }

        // 4. Rótulos superiores e inferiores con caja de contraste
        if (esc.texto_1) drawPixelString(esc.texto_1, 22, 8, '#ffd166');
        if (esc.texto_2) drawPixelString(esc.texto_2, 22, 57, '#00f5d4');

        // 5. Renderizar la cuadrícula en el Canvas
        flushGridToCanvas();

        // 6. Subtítulos sincronizados
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
  await page.goto('file://' + path.resolve('index_8bit.html'), { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Matriz Contextual 8-Bit (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 94 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final 8-Bit v2.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo 8-Bit v2.0 generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
