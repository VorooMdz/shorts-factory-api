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
// 2. SINTETIZADOR CHIPTUNE 8-BIT PROCEDURAL
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
// 3. MOTOR CINEMÁTICO 8-BIT v3.0 (PARALLAX + DIORAMAS EN VIVO + CÁMARA MÓVIL)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload 8-BIT v3.0 desde URL...');
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

  let realAudioDuration = 38;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) realAudioDuration = parsed;
  } catch (err) {
    realAudioDuration = Number(payload.duracion_total) || 38;
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
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.80,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );
      if (hasSfx) {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.15[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      } else {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.15[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
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
      #viewport-wrapper {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        overflow: hidden;
        will-change: transform;
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
          rgba(0, 0, 0, 0.20) 50%
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
        bottom: 82px; left: 26px; right: 26px;
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
      .sub-word.kw { color: #ffd000; }
      .sub-word.active { transform: scale(1.12) translateY(-5px); color: #00f2fe; }
      .sub-word.kw.active { color: #ffd000; transform: scale(1.16) translateY(-6px); }
      .sub-word.future { opacity: 0.42; }
    </style>
  </head>
  <body>
    <div class="progress-bar" id="pbar"></div>
    <div class="arcade-hud">
      <div class="hud-tag">${(payload.subrama || 'GLITCH 8-BIT').slice(0, 24)}</div>
      <div class="hud-score" id="hud-frame">ESC:01</div>
    </div>

    <div id="viewport-wrapper">
      <canvas id="pixel-canvas" width="720" height="1280"></canvas>
    </div>
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
      const GROUND_Y = 53;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      const viewportWrapper = document.getElementById('viewport-wrapper');

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

      function drawLine(x0, y0, x1, y1, color) {
        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let cx = Math.round(x0), cy = Math.round(y0);
        const ex = Math.round(x1), ey = Math.round(y1);
        for (let i = 0; i < 100; i++) {
          setCell(cx, cy, color);
          if (cx === ex && cy === ey) break;
          let e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }

      // ======================================================================
      // ESCENARIOS CON PARALLAX EN TIEMPO REAL (EL FONDO SE DESPLAZA Y VIVE)
      // ======================================================================
      function drawParallaxEnvironment(bgType, localFrame, camScrollX) {
        const type = String(bgType || 'day_office').toLowerCase().trim();
        const farScroll = Math.floor(camScrollX * 0.25);
        const midScroll = Math.floor(camScrollX * 0.60);
        const floorScroll = Math.floor(camScrollX * 1.0);

        // 1. OFICINA CORPORATIVA CON PARALLAX EXTERIOR E INTERIOR
        if (type === 'day_office') {
          drawRect(0, 0, COLS, GROUND_Y, '#2b3a55');
          // Ventanales que se desplazan con midScroll
          for (let wIdx = -1; wIdx <= 3; wIdx++) {
            const wx = ((wIdx * 20 - midScroll) % 80 + 80) % 80 - 15;
            drawRect(wx, 14, 14, 23, '#5bc0be'); // Cielo diurno
            // Rascacielos lejanos con farScroll
            const bx = wx + 2 + ((farScroll % 6) - 3);
            drawRect(bx, 24, 4, 13, '#3a506b');
            drawRect(bx + 5, 20, 5, 17, '#1c2541');
            // Nubes vivas
            const cloudX = wx + ((Math.floor(localFrame * 0.25) + wIdx * 5) % 10);
            drawRect(cloudX, 16, 4, 2, '#ffffff');
            // Marcos
            drawRect(wx, 14, 14, 1, '#e0e6ed');
            drawRect(wx, 36, 14, 1, '#e0e6ed');
            drawRect(wx + 7, 14, 1, 23, '#e0e6ed');
          }
          // Cuadros y relojes en pared
          const clockX = ((18 - midScroll) % 45 + 45) % 45;
          drawCircle(clockX, 22, 3, '#ffffff'); setCell(clockX, 21, '#000000'); setCell(clockX + 1, 22, '#000000');
          // Suelo de parqué en movimiento con floorScroll
          drawRect(0, GROUND_Y - 2, COLS, 2, '#d9d9d9');
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((r + c + floorScroll) % 5 === 0) ? '#7f5539' : '#9c6644';
            }
          }
          return;
        }

        // 2. HOSPITAL / SALA DE RADIOTERAPIA (CON MONITORES DE ECG Y VENTANAS)
        if (type === 'hospital_lab') {
          drawRect(0, 0, COLS, GROUND_Y, '#d8f3dc');
          // Franja sanitaria azulada con scroll
          drawRect(0, 32, COLS, 3, '#74c69d');
          for (let i = -1; i <= 3; i++) {
            const px = ((i * 22 - midScroll) % 66 + 66) % 66 - 10;
            // Monitor de constantes vitales (ECG animado en la pared)
            drawRect(px, 16, 12, 10, '#1b4332');
            drawRect(px + 1, 17, 10, 8, '#081c15');
            for (let ecg = 0; ecg < 10; ecg++) {
              const pulseY = (ecg === (localFrame % 10)) ? 19 : ((ecg === (localFrame % 10) - 1) ? 23 : 21);
              setCell(px + 1 + ecg, pulseY, '#52b788');
            }
            // Cruz médica a la derecha del monitor
            drawRect(px + 15, 17, 3, 9, '#ef233c');
            drawRect(px + 12, 20, 9, 3, '#ef233c');
          }
          // Suelo clínico ajedrezado con perspectiva en movimiento
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((Math.floor((c + floorScroll) / 4) + Math.floor(r / 3)) % 2 === 0) ? '#f8f9fa' : '#adb5bd';
            }
          }
          return;
        }

        // 3. PLANTA NUCLEAR / FÁBRICA INDUSTRIAL (TUBERÍAS, FLUJO Y LUCES DE ALERTA)
        if (type === 'nuclear_plant' || type === 'factory_floor') {
          drawRect(0, 0, COLS, GROUND_Y, '#1e293b');
          // Tuberías horizontales con líquido radiactivo/energía fluyendo por dentro
          drawRect(0, 16, COLS, 4, '#334155');
          for (let c = 0; c < COLS; c++) {
            const flow = (c + localFrame) % 6 < 3;
            setCell(c, 17, flow ? '#38bdf8' : '#0284c7');
            setCell(c, 18, flow ? '#38bdf8' : '#0284c7');
          }
          // Columnas industriales y luces estroboscópicas de peligro con midScroll
          for (let i = -1; i <= 3; i++) {
            const cx = ((i * 18 - midScroll) % 72 + 72) % 72 - 8;
            drawRect(cx, 20, 4, GROUND_Y - 20, '#475569');
            // Sirena giratoria en lo alto de cada pilar
            const sirenOn = (Math.floor(localFrame / 4) + i) % 2 === 0;
            drawCircle(cx + 2, 22, 2, sirenOn ? '#ef4444' : '#7f1d1d');
          }
          // Suelo con franjas de seguridad amarillas y negras (Hazard stripes) en movimiento
          for (let c = 0; c < COLS; c++) {
            const hazard = ((c + floorScroll) % 6 < 3) ? '#eab308' : '#0f172a';
            drawRect(c, GROUND_Y, 1, 3, hazard);
          }
          drawRect(0, GROUND_Y + 3, COLS, ROWS - GROUND_Y - 3, '#0f172a');
          return;
        }

        // 4. SALA DE SERVIDORES / CENTRO DE DATOS CON TRÁFICO DE RED VISIBLE
        if (type === 'server_room') {
          drawRect(0, 0, COLS, GROUND_Y, '#090d16');
          // Cables de fibra óptica en el techo transmitiendo paquetes luminosos
          drawRect(0, 13, COLS, 2, '#1e293b');
          for (let p = 0; p < 5; p++) {
            const pktX = (p * 9 + localFrame * 2) % COLS;
            setCell(pktX, 13, '#00f5d4'); setCell(pktX - 1, 13, '#00bbf9');
          }
          // Racks de servidores desplazándose con midScroll
          for (let i = -1; i <= 4; i++) {
            const rx = ((i * 14 - midScroll) % 70 + 70) % 70 - 10;
            drawRect(rx, 16, 9, GROUND_Y - 16, '#1e293b');
            drawRect(rx + 1, 17, 7, GROUND_Y - 18, '#0f172a');
            for (let r = 19; r < GROUND_Y - 3; r += 3) {
              const active = ((localFrame + r * 3 + i) % 8) < 4;
              setCell(rx + 2, r, active ? '#10b981' : '#064e3b');
              setCell(rx + 4, r, !active ? '#38bdf8' : '#1e3a8a');
              setCell(rx + 6, r, (r % 6 === 0 && localFrame % 4 < 2) ? '#ef4444' : '#334155');
            }
          }
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((c + floorScroll) % 6 === 0 || r % 4 === 0) ? '#0284c7' : '#0f172a';
            }
          }
          return;
        }

        // 5. SUPERMERCADO EN MOVIMIENTO (PASILLOS CON PRODUCTOS)
        if (type === 'supermarket') {
          drawRect(0, 0, COLS, GROUND_Y, '#fefae0');
          for (let sy = 18; sy <= 42; sy += 10) {
            drawRect(0, sy, COLS, 2, '#adb5bd');
            for (let c = -4; c < COLS + 4; c += 4) {
              const px = ((c - midScroll) % COLS + COLS) % COLS;
              const col = ((c + sy) % 3 === 0) ? '#e63946' : (((c + sy) % 2 === 0) ? '#ffb703' : '#2a9d8f');
              drawRect(px, sy - 4, 2, 4, col);
              setCell(px, sy - 3, '#ffffff');
            }
          }
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = (Math.floor((c + floorScroll) / 4) + Math.floor(r / 3)) % 2 === 0 ? '#edede9' : '#d6ccc2';
            }
          }
          return;
        }

        // 6. PLATAFORMA DE LANZAMIENTO / AEROPUERTO DIURNO
        if (type === 'launch_pad' || type === 'airport_sky') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 22 ? '#0077b6' : (r < 38 ? '#00b4d8' : '#90e0ef'));
          }
          drawCircle(37 - (farScroll % 5), 16, 4, '#ffd166'); // Sol
          // Nubes dinámicas
          for (let i = 0; i < 4; i++) {
            const cx = ((i * 14 + Math.floor(localFrame * 0.5) - farScroll) % (COLS + 10) + (COLS + 10)) % (COLS + 10) - 5;
            drawRect(cx, 16 + i * 6, 7, 2, '#ffffff');
            drawRect(cx + 1, 15 + i * 6, 5, 1, '#ffffff');
          }
          // Montañas/edificios en el horizonte con farScroll
          for (let c = 0; c < COLS; c++) {
            const mh = 4 + Math.round(Math.sin((c + farScroll) * 0.25) * 3);
            drawRect(c, GROUND_Y - mh, 1, mh, '#457b9d');
          }
          drawRect(0, GROUND_Y, COLS, 3, '#52b788');
          drawRect(0, GROUND_Y + 3, COLS, ROWS - GROUND_Y - 3, '#343a40');
          for (let c = 0; c < COLS; c++) {
            if ((c + floorScroll * 2) % 8 < 4) drawRect(c, GROUND_Y + 6, 1, 2, '#ffd166');
          }
          return;
        }

        // 7. PARQUÉ DE BOLSA / TRADING FLOOR
        if (type === 'stock_exchange') {
          drawRect(0, 0, COLS, GROUND_Y, '#0f172a');
          // Ticker luminoso corriendo en la parte superior
          drawRect(0, 14, COLS, 5, '#020617');
          for (let c = 0; c < COLS; c += 5) {
            const tx = ((c - localFrame) % COLS + COLS) % COLS;
            drawRect(tx, 15, 3, 3, (c % 10 === 0) ? '#10b981' : '#ef4444');
          }
          // Gráficas gigantes de fondo
          for (let c = 0; c < COLS; c++) {
            const gh = 8 + Math.round(Math.sin((c + midScroll) * 0.3) * 6);
            drawRect(c, GROUND_Y - gh, 1, gh, 'rgba(16, 185, 129, 0.25)');
            setCell(c, GROUND_Y - gh, '#10b981');
          }
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((c + floorScroll + r) % 5 === 0) ? '#334155' : '#1e293b';
            }
          }
          return;
        }

        // 8. BÓVEDA BANCARIA / CASINO
        drawRect(0, 0, COLS, GROUND_Y, '#1d1e2c');
        for (let i = -1; i <= 3; i++) {
          const vx = ((i * 22 - midScroll) % 66 + 66) % 66 - 8;
          drawCircle(vx + 8, 32, 9, '#4a4e69');
          drawCircle(vx + 8, 32, 3, '#ffb703');
        }
        for (let r = GROUND_Y; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            grid[r][c] = ((c + floorScroll) % 4 === 0) ? '#3c096c' : '#240046';
          }
        }
      }

      // ======================================================================
      // DIBUJO DE HUMANOS Y OBJETOS CON POSTURAS REALES (SIN BAILAR EN EL SITIO)
      // ======================================================================
      function drawHuman(x, y, role, posture, localFrame, facingLeft) {
        let shirt = '#38bdf8', pants = '#1e3a8a', hat = null, skin = '#ffcdb2';
        if (role === 'engineer') { shirt = '#f97316'; hat = '#ffd166'; }
        else if (role === 'scientist' || role === 'doctor') { shirt = '#ffffff'; pants = '#475569'; }
        else if (role === 'businessman') { shirt = '#1e293b'; pants = '#0f172a'; }
        else if (role === 'hacker') { shirt = '#10b981'; pants = '#064e3b'; }
        else if (role === 'patient') { shirt = '#90e0ef'; pants = '#0077b6'; }

        const dir = facingLeft ? -1 : 1;
        const put = (dx, dy, col) => setCell(x + dx * dir, y + dy, col);

        // Si el paciente está tumbado en una camilla
        if (posture === 'lying_bed') {
          // Camilla médica con patas
          drawRect(x - 6, y + 2, 14, 2, '#e2e8f0');
          drawRect(x - 5, y + 4, 2, 4, '#94a3b8');
          drawRect(x + 5, y + 4, 2, 4, '#94a3b8');
          // Cuerpo tumbado
          drawRect(x - 5, y, 3, 2, skin); // Cabeza
          drawRect(x - 2, y, 6, 2, '#38bdf8'); // Bata paciente
          drawRect(x + 4, y, 3, 2, '#1e3a8a'); // Piernas
          return;
        }

        // Cabeza (quieta y firme)
        for (let r = -6; r <= -4; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, skin);
        }
        if (hat) {
          for (let c = -2; c <= 2; c++) put(c, -7, hat);
        }
        put(1, -5, '#000000'); // Ojo mirando en la dirección de la acción

        // Torso
        for (let r = -3; r <= 0; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, shirt);
        }
        if (role === 'businessman') { put(0, -2, '#ef233c'); put(0, -1, '#ef233c'); }

        // POSTURA 1: TECLEANDO EN UN ESCRITORIO CON ORDENADOR (PIERNAS QUIETAS, MANOS RÁPIDAS)
        if (posture === 'typing_desk') {
          // Piernas completamente quietas y firmes en el suelo
          put(-1, 1, pants); put(-1, 2, pants); put(-1, 3, '#ffffff');
          put(1, 1, pants); put(1, 2, pants); put(1, 3, '#ffffff');
          // Brazos extendidos hacia adelante tecleando rápido
          const handY = (localFrame % 4 < 2) ? -2 : -1;
          put(2, -2, shirt); put(3, handY, skin);
          // Escritorio físico y ordenador delante del personaje
          const deskX = x + 4 * dir;
          drawRect(deskX, y - 1, 7, 5, '#7f5539'); // Mesa de madera
          drawRect(deskX + 1, y - 6, 5, 5, '#e2e8f0'); // Monitor en la mesa
          drawRect(deskX + 2, y - 5, 3, 3, '#0f172a'); // Pantalla
          setCell(deskX + 2 + (localFrame % 3), y - 4, '#10b981'); // Código escribiéndose
          return;
        }

        // POSTURA 2: OBSERVANDO / INSPECCIONANDO (QUIETO Y ATENTO, SIN BAILAR)
        if (posture === 'inspect' || posture === 'idle') {
          put(-1, 1, pants); put(-1, 2, pants); put(-1, 3, '#ffffff');
          put(1, 1, pants); put(1, 2, pants); put(1, 3, '#ffffff');
          // Un brazo levantado señalando o sosteniendo un informe
          put(2, -2, shirt); put(3, -3, skin);
          put(-2, -1, shirt);
          return;
        }

        // POSTURA 3: PÁNICO / ALARMA (MANOS EN LA CABEZA O CORRIENDO)
        if (posture === 'panic') {
          put(-2, -4, shirt); put(-2, -5, skin);
          put(2, -4, shirt); put(2, -5, skin);
          const step = Math.floor(localFrame / 3) % 2;
          if (step === 0) {
            put(-1, 1, pants); put(-2, 2, pants); put(-2, 3, '#ffffff');
            put(1, 1, pants); put(1, 2, pants); put(1, 3, '#ffffff');
          } else {
            put(-1, 1, pants); put(-1, 2, pants); put(-1, 3, '#ffffff');
            put(1, 1, pants); put(2, 2, pants); put(2, 3, '#ffffff');
          }
          return;
        }

        // POSTURA 4: CAMINANDO DE VERDAD POR EL ESCENARIO (SOLO MUEVE PIERNAS AL AVANZAR)
        const step = Math.floor(localFrame / 4) % 2;
        if (step === 0) {
          put(-2, -2, shirt); put(2, -1, shirt);
          put(-1, 1, pants); put(-2, 2, pants); put(-2, 3, '#ffffff');
          put(1, 1, pants); put(1, 2, pants); put(1, 3, '#ffffff');
        } else {
          put(-2, -1, shirt); put(2, -2, shirt);
          put(-1, 1, pants); put(-1, 2, pants); put(-1, 3, '#ffffff');
          put(1, 1, pants); put(2, 2, pants); put(2, 3, '#ffffff');
        }
      }

      // ======================================================================
      // 8 DIORAMAS INTERACTIVOS COMPLEJOS (HISTORIA VISUAL CAUSA -> EFECTO)
      // ======================================================================
      function drawInteractiveDiorama(dioramaType, esc, localFrame) {
        const type = String(dioramaType || 'hacker_infiltration').toLowerCase().trim();
        const baseY = GROUND_Y - 4;

        // DIORAMA 1: CAÑÓN DE RADIACIÓN / LÁSER INDUSTRIAL DISPARANDO (THERAC-25 / LAB)
        if (type === 'radiation_beam') {
          // Operador a la izquierda tecleando en consola de control
          drawHuman(8, baseY, 'scientist', 'typing_desk', localFrame, false);
          // Máquina gigante de radioterapia en el techo/derecha (X=30, Y=24)
          drawRect(27, 20, 9, 8, '#e2e8f0');
          drawRect(29, 28, 5, 4, '#475569'); // Colimador / Cañón
          // Paciente en camilla debajo del cañón (X=31, Y=49)
          drawHuman(31, baseY, 'patient', 'lying_bed', localFrame, false);
          // Haz de radiación letal disparándose desde el cañón hacia la camilla
          if (localFrame > 8) {
            const beamWidth = (localFrame % 4 < 2) ? 3 : 1;
            drawRect(31 - Math.floor(beamWidth / 2), 32, beamWidth, 17, '#ef233c');
            setCell(31, 32 + (localFrame % 16), '#ffd166');
            // Chispazos de impacto sobre la camilla
            for (let s = 0; s < 6; s++) {
              const sx = 31 + Math.round(Math.cos(localFrame + s) * 5);
              const sy = 48 - Math.abs(Math.round(Math.sin(localFrame * 1.5 + s) * 4));
              setCell(sx, sy, s % 2 === 0 ? '#ffd166' : '#ef233c');
            }
          }
          return;
        }

        // DIORAMA 2: CENTRIFUGADORAS / MAQUINARIA EN SOBRECARGA (STUXNET / SABOTAJE)
        if (type === 'centrifuge_overload') {
          // Ingeniero observando o en pánico a la izquierda
          drawHuman(9, baseY, 'engineer', localFrame > 25 ? 'panic' : 'typing_desk', localFrame, false);
          // 2 Grandes cilindros de centrifugadoras industriales a la derecha (X=25 y X=35)
          [25, 35].forEach((cx, idx) => {
            const shake = (localFrame > 15) ? ((localFrame + idx) % 2 === 0 ? 1 : -1) : 0;
            drawRect(cx + shake - 3, 28, 7, 25, '#64748b');
            drawRect(cx + shake - 2, 30, 5, 21, '#334155');
            // Rotor interno girando a velocidad extrema
            const spinY = 32 + ((localFrame * 3 + idx * 7) % 16);
            const overheatColor = localFrame > 20 ? '#ef4444' : '#eab308';
            drawRect(cx + shake - 2, spinY, 5, 3, overheatColor);
            // Humo y fragmentos saltando cuando sobrecarga
            if (localFrame > 22) {
              for (let p = 0; p < 5; p++) {
                const px = cx + Math.round(Math.sin(localFrame * 0.8 + p) * 6);
                const py = 26 - ((localFrame + p * 4) % 12);
                setCell(px, py, p % 2 === 0 ? '#ef4444' : '#94a3b8');
              }
            }
          });
          return;
        }

        // DIORAMA 3: INFILTRACIÓN DE DATOS / VIRUS POR CABLE (HACKING / OVERFLOW)
        if (type === 'hacker_infiltration') {
          // Hacker a la izquierda en su escritorio
          drawHuman(9, baseY, 'hacker', 'typing_desk', localFrame, false);
          // Cable de red físico que cruza por el suelo/pared hasta el servidor central en X=34
          drawRect(16, baseY + 2, 18, 2, '#1e293b');
          // Paquetes de malware rojos/amarillos viajando físicamente de izquierda a derecha
          for (let pkt = 0; pkt < 3; pkt++) {
            const px = 16 + ((localFrame * 1.2 + pkt * 6) % 18);
            drawRect(px, baseY + 2, 2, 2, '#ef233c');
          }
          // Gran Servidor / Mainframe a la derecha recibiendo el impacto
          drawRect(32, 28, 9, 25, '#334155');
          drawRect(33, 30, 7, 21, '#0f172a');
          const infected = localFrame > 15;
          for (let r = 32; r < 49; r += 3) {
            drawRect(34, r, 5, 2, infected ? '#ef233c' : '#10b981');
          }
          return;
        }

        // DIORAMA 4: DESPEGUE Y EXPLOSIÓN DE COHETE EN VUELO (ARIANE 5 / ESPACIO)
        if (type === 'rocket_catastrophe') {
          // Ingeniero en torre de control abajo a la izquierda
          drawHuman(8, baseY, 'engineer', 'panic', localFrame, false);
          const explodeFrame = 32;
          if (localFrame < explodeFrame) {
            // El cohete sube y a partir del frame 18 se desvía lateralmente
            const ry = Math.max(18, 46 - Math.floor(localFrame * 0.9));
            const rx = 26 + (localFrame > 18 ? Math.floor((localFrame - 18) * 0.7) : 0);
            drawRect(rx - 2, ry - 5, 5, 9, '#ffffff');
            drawRect(rx - 1, ry - 7, 3, 2, '#ef233c');
            setCell(rx, ry - 2, '#00b4d8');
            // Estela densa de humo y fuego debajo del cohete
            for (let s = 1; s <= 10; s++) {
              const sy = ry + 3 + s;
              if (sy < GROUND_Y) {
                drawCircle(rx - (s > 4 ? 1 : 0), sy, s < 4 ? 2 : 3, s < 4 ? '#ffd166' : '#adb5bd');
              }
            }
          } else {
            // Explosión expansiva con fragmentos cayendo por gravedad
            const dt = localFrame - explodeFrame;
            for (let p = 0; p < 28; p++) {
              const ang = (p / 28) * Math.PI * 2;
              const speed = 0.6 + (p % 4) * 0.35;
              const px = 32 + Math.cos(ang) * dt * speed;
              const py = 22 + Math.sin(ang) * dt * speed + (dt * dt * 0.04); // Gravedad
              drawRect(px, py, 2, 2, p % 3 === 0 ? '#ffd166' : (p % 2 === 0 ? '#ef233c' : '#ffffff'));
            }
          }
          return;
        }

        // DIORAMA 5: COMPRA MASIVA Y ARBITRAJE EN SUPERMERCADO (PUDINES / PROMOS)
        if (type === 'supermarket_spree') {
          // Protagonista empujando el carrito de la compra avanzando de verdad por el pasillo
          const walkX = 8 + (Math.floor(localFrame * 0.45) % 22);
          drawHuman(walkX, baseY, 'businessman', 'walk', localFrame, false);
          // Carrito lleno pegado delante del personaje (en walkX + 6)
          const cartX = walkX + 6;
          drawRect(cartX, baseY - 2, 7, 4, '#e2e8f0');
          drawRect(cartX + 1, baseY - 5, 5, 3, '#ffb703'); // Montaña de pudines dorados
          setCell(cartX + 1, baseY + 3, '#000000'); setCell(cartX + 5, baseY + 3, '#000000');
          // Cajero / Escáner láser al final del pasillo (X=37) pitando monedas
          drawRect(35, baseY - 3, 6, 7, '#2a9d8f');
          if (localFrame % 6 < 3) {
            drawCircle(37, baseY - 8 - (localFrame % 8), 2, '#ffd166');
          }
          return;
        }

        // DIORAMA 6: TRANSFERENCIA MILLONARIA / LLUVIA DE ORO BANCARIA (HEIST / FORTUNA)
        if (type === 'heist_transfer') {
          // Banquero / Protagonista celebrando o corriendo con sacos
          const runX = 10 + (Math.floor(localFrame * 0.4) % 18);
          drawHuman(runX, baseY, 'businessman', 'walk', localFrame, false);
          // Bóveda abierta a la derecha lanzando monedas en arco parabólico hacia el personaje
          for (let m = 0; m < 8; m++) {
            const prog = ((localFrame * 0.05 + m * 0.12) % 1);
            const mx = 36 - prog * (36 - runX);
            const my = (baseY - 4) - Math.sin(prog * Math.PI) * 16;
            drawRect(mx, my, 2, 2, '#ffd166');
          }
          return;
        }

        // DIORAMA 7: CRASH FINANCIERO EN TIEMPO REAL (BOLSA / FLASH CRASH)
        if (type === 'stock_crash_live') {
          // Inversor llevándose las manos a la cabeza a la izquierda
          drawHuman(9, baseY, 'businessman', 'panic', localFrame, false);
          // Pizarra gigante de cotización donde la línea se desploma en tiempo real
          drawRect(16, 20, 24, 24, '#020617');
          drawRect(16, 20, 24, 1, '#475569');
          const maxPoints = Math.min(20, Math.floor(localFrame * 0.6) + 4);
          let prevX = 18, prevY = 26;
          for (let i = 1; i <= maxPoints; i++) {
            const cx = 18 + i;
            const cy = i < 8 ? (26 - (i % 3)) : Math.min(42, 24 + (i - 7) * 1.5);
            const col = i < 8 ? '#10b981' : '#ef4444';
            drawLine(prevX, prevY, cx, cy, col);
            prevX = cx; prevY = cy;
          }
          return;
        }

        // DIORAMA 8: VUELO COMERCIAL CRUZANDO EL CIELO (MILLAS / AVIACIÓN)
        const planeX = 6 + (Math.floor(localFrame * 0.55) % 30);
        const planeY = 28 + Math.round(Math.sin(localFrame * 0.2) * 2);
        drawRect(planeX - 6, planeY, 13, 3, '#ffffff');
        drawRect(planeX - 6, planeY - 3, 3, 3, '#ef233c');
        drawRect(planeX - 1, planeY - 4, 3, 10, '#cbd5e1');
        // Pasajero / Ingeniero abajo en la terminal con su maleta y billete dorado
        drawHuman(18, baseY, 'engineer', 'walk', localFrame, false);
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
        const localT = Math.max(0, t - (esc.inicio || 0));
        const durEsc = Math.max(0.5, (esc.fin || 4) - (esc.inicio || 0));
        const localFrame = Math.floor(localT * 30);

        // 1. CÁMARA CINEMÁTICA Y PARALLAX SCROLL
        const camMode = String(esc.camera_mode || 'pan_right').toLowerCase();
        let camScrollX = localFrame * 0.35;
        if (camMode === 'pan_left') camScrollX = -localFrame * 0.35;

        // Zoom dinámico o temblor de terremoto en el viewport
        let scale = 1.0 + (localT / durEsc) * 0.06;
        let tx = 0, ty = 0;
        if (camMode === 'zoom_dramatic') {
          scale = 1.0 + Math.min(0.18, (localT / durEsc) * 0.18);
        } else if (camMode === 'earthquake' || esc.diorama === 'rocket_catastrophe' || esc.diorama === 'centrifuge_overload') {
          if (localFrame > 16) {
            tx = Math.sin(localFrame * 2.3) * 8;
            ty = Math.cos(localFrame * 3.1) * 6;
          }
        }
        viewportWrapper.style.transform = \`translate(\${tx.toFixed(1)}px, \${ty.toFixed(1)}px) scale(\${scale.toFixed(3)})\`;

        // 2. PINTAR ESCENARIO MULTICAPA CON PARALLAX
        drawParallaxEnvironment(esc.bg_type || 'day_office', localFrame, camScrollX);

        // 3. EJECUTAR EL DIORAMA INTERACTIVO DE LA ESCENA
        drawInteractiveDiorama(esc.diorama || 'hacker_infiltration', esc, localFrame);

        // 4. RÓTULOS PIXEL ART CON CAJA DE CONTRASTE
        if (esc.texto_1) drawPixelString(esc.texto_1, 22, 8, '#ffd166');
        if (esc.texto_2) drawPixelString(esc.texto_2, 22, 56, '#00f5d4');

        // 5. VOLCAR MATRIZ AL LIENZO
        flushGridToCanvas();

        // 6. SUBTÍTULOS SINCRONIZADOS
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

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Cinemático 8-Bit v3.0 (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 94 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final 8-Bit v3.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo 8-Bit v3.0 generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
