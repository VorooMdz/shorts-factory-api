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

function cleanArcadeLabel(str) {
  return String(str || '')
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .trim();
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
// 3. MOTOR MULTI-AGENTE PIXEL-ART STUDIO v10.0
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload Multi-Agente v10.0 desde URL...');
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

  const escenas = (payload.escenas || []).map((esc, idx) => ({
    ...esc,
    texto_1: cleanArcadeLabel(esc.texto_1 || `ACTO 0${idx + 1}`).slice(0, 15),
    texto_2: cleanArcadeLabel(esc.texto_2 || 'HISTORIA REAL').slice(0, 15)
  }));

  const customSpritesDict = payload.custom_sprites || {};
  const subtitleChunks = buildSubtitleChunks(escenas, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio con bg_music2.mp3
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenas, duracionExactaVideo, hash); } catch (e) {}

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

  const safeEscenasJson = JSON.stringify(escenas).replace(/<\/script>/gi, '<\\/script>');
  const safeSpritesJson = JSON.stringify(customSpritesDict).replace(/<\/script>/gi, '<\\/script>');
  const safeChunksJson = JSON.stringify(subtitleChunks).replace(/<\/script>/gi, '<\\/script>');
  const safeSubrama = cleanArcadeLabel(payload.subrama || 'HISTORIA 8-BIT').slice(0, 28);

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
      .arcade-hud {
        position: absolute; top: 32px; left: 26px; right: 26px;
        display: flex; justify-content: center; align-items: center;
        background: rgba(8, 10, 22, 0.92);
        border: 4px solid #00f2fe;
        padding: 13px 18px;
        box-shadow: 0 8px 0 #000000;
        z-index: 20;
      }
      .hud-tag { color: #ffd000; font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase; text-align: center; }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000, #00f2fe);
        width: 0%; z-index: 30;
      }
      .label-box-top {
        position: absolute; top: 106px; left: 50%; transform: translateX(-50%);
        background: #080a14; border: 4px solid #000000;
        box-shadow: inset 0 0 0 2px #2b3248, 0 8px 0 rgba(0,0,0,0.75);
        padding: 13px 24px; color: #ffd166; font-size: 25px;
        text-transform: uppercase; white-space: nowrap; letter-spacing: 2px;
        text-shadow: 4px 4px 0 #000000; z-index: 18;
      }
      .label-box-bot {
        position: absolute; top: 884px; left: 50%; transform: translateX(-50%);
        background: #080a14; border: 4px solid #000000;
        box-shadow: inset 0 0 0 2px #2b3248, 0 8px 0 rgba(0,0,0,0.75);
        padding: 13px 24px; color: #00f5d4; font-size: 25px;
        text-transform: uppercase; white-space: nowrap; letter-spacing: 2px;
        text-shadow: 4px 4px 0 #000000; z-index: 18;
      }
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
      <div class="hud-tag">${safeSubrama}</div>
    </div>

    <div class="label-box-top" id="label-top">HISTORIA</div>
    <div class="label-box-bot" id="label-bot">CASO REAL</div>

    <canvas id="pixel-canvas" width="720" height="1280"></canvas>
    <div class="crt-scanlines"></div>

    <div class="subtitle-container">
      <div class="subtitle-box" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${safeEscenasJson};
      const customSprites = ${safeSpritesJson};
      const subtitleChunks = ${safeChunksJson};
      const totalFrames = ${totalFrames};

      const COLS = 120;
      const ROWS = 213;
      const CELL = 6;
      const GROUND_Y = 138;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#1a1c2c'));

      // ======================================================================
      // 1. PRIMITIVAS PIXEL-ART CON ANTI-DESBORDAMIENTO
      // ======================================================================
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

      function fillBorderedCircle(cx, cy, radius, fillColor, borderColor = '#0b0c10') {
        fillCircle(cx, cy, radius, borderColor);
        if (radius > 1) fillCircle(cx, cy, radius - 1, fillColor);
      }

      function drawRing(cx, cy, radius, thickness = 2, color = '#fde047') {
        const rOut = Math.round(radius);
        const rIn = Math.max(0, rOut - thickness);
        for (let r = -rOut; r <= rOut; r++) {
          for (let c = -rOut; c <= rOut; c++) {
            const d2 = c * c + r * r;
            if (d2 <= rOut * rOut && d2 >= rIn * rIn) setPx(cx + c, cy + r, color);
          }
        }
      }

      function drawPixelLine(x0, y0, x1, y1, thickness = 2, color = '#ffffff') {
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

      function fillPolygon(points, fillColor, borderColor = '#0b0c10') {
        if (!Array.isArray(points) || points.length < 3) return;
        let minY = ROWS, maxY = 0;
        points.forEach(p => {
          if (p[1] < minY) minY = Math.floor(p[1]);
          if (p[1] > maxY) maxY = Math.ceil(p[1]);
        });
        minY = Math.max(0, minY);
        maxY = Math.min(ROWS - 1, maxY);

        for (let y = minY; y <= maxY; y++) {
          const nodes = [];
          let j = points.length - 1;
          for (let i = 0; i < points.length; i++) {
            const yi = points[i][1], yj = points[j][1];
            const xi = points[i][0], xj = points[j][0];
            if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
              nodes.push(xi + (y - yi) / (yj - yi) * (xj - xi));
            }
            j = i;
          }
          nodes.sort((a, b) => a - b);
          for (let i = 0; i < nodes.length; i += 2) {
            if (nodes[i + 1] !== undefined) {
              for (let x = Math.round(nodes[i]); x <= Math.round(nodes[i + 1]); x++) {
                setPx(x, y, fillColor);
              }
            }
          }
        }
        if (borderColor) {
          for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            drawPixelLine(p1[0], p1[1], p2[0], p2[1], 1, borderColor);
          }
        }
      }

      function fillTriangle(x1, y1, x2, y2, x3, y3, fillColor, borderColor = '#0b0c10') {
        fillPolygon([[x1, y1], [x2, y2], [x3, y3]], fillColor, borderColor);
      }

      // ======================================================================
      // 2. RENDERIZADOR DE SPRITES CUSTOM 16x16 DISEÑADOS POR EL AGENTE 2
      // (CON CONTORNO NEGRO AUTOMÁTICO DE 1PX PARA ACABADO PROFESIONAL)
      // ======================================================================
      function drawCustomSprite(spriteName, centerX, centerY, scale = 1.25, flipX = false) {
        const key = String(spriteName || '').toLowerCase().trim();
        const def = customSprites[key] || Object.values(customSprites)[0];
        if (!def || !Array.isArray(def.rows) || def.rows.length === 0) {
          fillBorderedCircle(centerX, centerY, Math.round(6 * scale), '#ffd166', '#0b0c10');
          return;
        }
        const rows = def.rows;
        const pal = def.palette || { '1': '#ffd166', '2': '#ffffff', '3': '#ef4444', '4': '#38bdf8', '5': '#475569' };
        const h = rows.length;
        const w = String(rows[0]).length;
        const destH = Math.max(6, Math.round(h * scale));
        const destW = Math.max(6, Math.round(w * scale));
        const x0 = Math.round(centerX - destW / 2);
        const y0 = Math.round(centerY - destH / 2);

        // Matriz temporal escalada para añadir contorno negro automático de 1px
        const temp = Array.from({ length: destH + 2 }, () => Array(destW + 2).fill(null));
        for (let dy = 0; dy < destH; dy++) {
          const srcY = Math.min(h - 1, Math.floor((dy / destH) * h));
          const rStr = String(rows[srcY]);
          for (let dx = 0; dx < destW; dx++) {
            const rawX = Math.min(w - 1, Math.floor((dx / destW) * w));
            const srcX = flipX ? (w - 1 - rawX) : rawX;
            const ch = rStr[srcX];
            if (ch && ch !== '.' && ch !== '0' && ch !== ' ') {
              temp[dy + 1][dx + 1] = pal[ch] || '#ffd166';
            }
          }
        }

        // Pintar borde negro exterior de 1px y luego los píxeles de color
        for (let r = 1; r <= destH; r++) {
          for (let c = 1; c <= destW; c++) {
            if (!temp[r][c]) {
              if (temp[r - 1][c] || temp[r + 1][c] || temp[r][c - 1] || temp[r][c + 1]) {
                setPx(x0 + c - 1, y0 + r - 1, '#0b0c10');
              }
            }
          }
        }
        for (let r = 1; r <= destH; r++) {
          for (let c = 1; c <= destW; c++) {
            if (temp[r][c]) {
              setPx(x0 + c - 1, y0 + r - 1, temp[r][c]);
            }
          }
        }
      }

      // ======================================================================
      // 3. CONSTRUCTORES DE ARQUITECTURA, VEGETACIÓN Y VEHÍCULOS RICOS (16-BIT)
      // (ERRADICA LOS RECTÁNGULOS MARRONES SIN VENTANAS Y LAS CAJAS CON RUEDAS)
      // ======================================================================
      function drawDetailedBuilding(x, w, h, opts = {}, localFrame = 0) {
        const wallCol = opts.wallColor || '#475569';
        const roofCol = opts.roofColor || '#1e293b';
        const winCol = opts.windowColor || '#fde047';
        const topY = GROUND_Y - h;

        // Fachada con textura de ladrillo/piedra y borde
        fillBorderedRect(x, topY, w, h, wallCol, '#0b0c10');
        for (let ry = topY + 4; ry < GROUND_Y - 4; ry += 6) {
          fillRect(x + 2, ry, w - 4, 1, 'rgba(0,0,0,0.2)');
        }
        // Tejado triangular o cornisa señorial
        if (opts.peakedRoof) {
          fillTriangle(x - 2, topY, x + w + 2, topY, x + Math.floor(w / 2), topY - 14, roofCol, '#0b0c10');
        } else {
          fillBorderedRect(x - 2, topY - 4, w + 4, 5, roofCol, '#0b0c10');
        }
        // Cuadrícula de ventanas con marcos e iluminación interior
        for (let wy = topY + 6; wy < GROUND_Y - 16; wy += 11) {
          for (let wx = x + 4; wx < x + w - 7; wx += 9) {
            const isLit = ((wx + wy) % 3 !== 0);
            fillBorderedRect(wx, wy, 6, 7, isLit ? winCol : '#1e293b', '#0b0c10');
          }
        }
        // Puerta en planta baja anclada a GROUND_Y
        if (w >= 18) {
          const dx = x + Math.floor(w / 2) - 4;
          fillBorderedRect(dx, GROUND_Y - 12, 8, 12, '#2b1d14', '#0b0c10');
        }
      }

      function drawDetailedTree(x, scale = 1.0, localFrame = 0) {
        const trunkW = Math.max(3, Math.round(5 * scale));
        const trunkH = Math.round(18 * scale);
        const sway = Math.round(Math.sin(localFrame * 0.1 + x) * 1);
        // Tronco con raíces y corteza
        fillBorderedRect(x - Math.floor(trunkW / 2), GROUND_Y - trunkH, trunkW, trunkH, '#5c3a21', '#0b0c10');
        // Copa multicapa con sombreado 16-bit (oscuro -> medio -> brillo superior)
        const rMain = Math.round(11 * scale);
        fillBorderedCircle(x + sway, GROUND_Y - trunkH - Math.round(4 * scale), rMain, '#14532d', '#0b0c10');
        fillCircle(x - 3 + sway, GROUND_Y - trunkH - Math.round(7 * scale), Math.round(8 * scale), '#166534');
        fillCircle(x + 4 + sway, GROUND_Y - trunkH - Math.round(6 * scale), Math.round(7 * scale), '#15803d');
        fillCircle(x - 1 + sway, GROUND_Y - trunkH - Math.round(10 * scale), Math.round(6 * scale), '#22c55e');
      }

      function drawDetailedVehicle(x, type = 'truck', color = '#3f6212', facingLeft = false, localFrame = 0) {
        const dir = facingLeft ? -1 : 1;
        const bounce = localFrame % 4 < 2 ? -1 : 0;
        const vy = GROUND_Y + bounce;

        if (type === 'truck' || type === 'van') {
          // Caja trasera detallada con lonas/nervaduras
          const cargoX = facingLeft ? x - 4 : x - 28;
          fillBorderedRect(cargoX, vy - 24, 30, 18, color, '#0b0c10');
          fillRect(cargoX + 3, vy - 21, 24, 2, 'rgba(255,255,255,0.2)');
          fillRect(cargoX + 3, vy - 14, 24, 2, 'rgba(0,0,0,0.25)');
          // Cabina con parabrisas y faro delantero luminoso
          const cabX = facingLeft ? x - 16 : x + 2;
          fillBorderedRect(cabX, vy - 19, 14, 13, color, '#0b0c10');
          const winX = facingLeft ? cabX + 2 : cabX + 6;
          fillBorderedRect(winX, vy - 17, 6, 6, '#7dd3fc', '#0b0c10');
          const lightX = facingLeft ? cabX - 1 : cabX + 13;
          fillRect(lightX, vy - 11, 2, 3, '#fde047');
          // Haz de luz de los faros
          fillTriangle(lightX, vy - 10, lightX + dir * 18, vy - 16, lightX + dir * 18, vy - 2, 'rgba(253, 224, 71, 0.22)', null);
          // Ruedas con llanta girando sobre GROUND_Y
          const w1 = facingLeft ? x - 10 : x - 20;
          const w2 = facingLeft ? x + 16 : x + 8;
          [w1, w2].forEach(wx => {
            fillBorderedCircle(wx, GROUND_Y - 5, 5, '#1e293b', '#0b0c10');
            fillCircle(wx, GROUND_Y - 5, 2, '#94a3b8');
          });
          return;
        }
        // Coche deportivo / Policial / Sedán
        fillBorderedRect(x - 18, vy - 14, 36, 9, color, '#0b0c10');
        fillBorderedRect(x - 10, vy - 21, 20, 8, color, '#0b0c10');
        fillBorderedRect(x - 8, vy - 19, 7, 5, '#7dd3fc', '#0b0c10');
        fillBorderedRect(x + 1, vy - 19, 7, 5, '#7dd3fc', '#0b0c10');
        fillBorderedCircle(x - 11, GROUND_Y - 4, 4, '#1e293b', '#0b0c10');
        fillBorderedCircle(x + 11, GROUND_Y - 4, 4, '#1e293b', '#0b0c10');
      }

      // ======================================================================
      // 4. PERSONAJES EXPRESIVOS ARTICULADOS 16-BIT (CON ROSTRO, OJOS, BOCA Y BRAZOS)
      // + EFECTOS DE DISPARO/SPRAY ANCLADOS MATEMÁTICAMENTE A LA MANO
      // ======================================================================
      function drawActor(x, y, opts = {}, localFrame = 0) {
        const anchorY = (y === undefined || y === null || y > GROUND_Y) ? GROUND_Y : y;
        const suitCol = opts.suitColor || '#3b82f6';
        const skinCol = opts.skinColor || '#e6ad86';
        const hatCol = opts.hatColor !== undefined ? opts.hatColor : '#1e293b';
        const facingLeft = !!opts.facingLeft;
        const dir = facingLeft ? -1 : 1;
        const isMoving = !!opts.isMoving;
        const isTalking = !!opts.isTalking;
        const expr = opts.expression || 'determined';
        const step = isMoving ? (Math.floor(localFrame / 4) % 2) : 0;

        // Sombra firme en el suelo
        fillRect(x - 6, anchorY, 13, 2, 'rgba(0,0,0,0.45)');

        // Piernas articuladas con botas
        const legL = step === 0 ? -2 : 0;
        const legR = step === 1 ? -2 : 0;
        fillBorderedRect(x - 5, anchorY - 9 + legL, 5, 9, '#1e293b', '#0b0c10');
        fillBorderedRect(x + 1, anchorY - 9 + legR, 5, 9, '#1e293b', '#0b0c10');

        // Torso detallado con cinturón/corbata
        fillBorderedRect(x - 7, anchorY - 22, 15, 14, suitCol, '#0b0c10');
        fillRect(x - 1, anchorY - 20, 3, 8, opts.tieColor || '#ef4444');
        fillRect(x - 6, anchorY - 10, 13, 2, '#0b0c10');

        // Cabeza Expresiva 16-Bit (con ojos, pupilas, cejas y boca)
        const headY = anchorY - 35 + (isMoving ? (step ? -1 : 0) : 0);
        fillBorderedRect(x - 7, headY, 15, 14, skinCol, '#0b0c10');

        // Sombrero / Casco / Pelo
        if (hatCol) {
          fillBorderedRect(x - 9, headY - 2, 19, 3, hatCol, '#0b0c10');
          fillBorderedRect(x - 7, headY - 6, 15, 5, hatCol, '#0b0c10');
        } else {
          fillRect(x - 6, headY + 1, 13, 3, '#2b1d14');
        }

        // Ojos con pupilas orientadas hacia donde mira el actor
        const eye1X = facingLeft ? x - 5 : x - 2;
        const eye2X = facingLeft ? x + 1 : x + 3;
        fillRect(eye1X, headY + 5, 3, 3, '#ffffff');
        fillRect(eye2X, headY + 5, 3, 3, '#ffffff');
        setPx(facingLeft ? eye1X : eye1X + 2, headY + 6, '#0b0c10');
        setPx(facingLeft ? eye2X : eye2X + 2, headY + 6, '#0b0c10');

        // Cejas expresivas
        fillRect(eye1X, headY + 3, 3, 1, '#2b1d14');
        fillRect(eye2X, headY + 3, 3, 1, '#2b1d14');

        // Boca animada
        if (isTalking && (Math.floor(localFrame / 3) % 2 === 0)) {
          fillRect(x - 2, headY + 10, 5, 2, '#991b1b');
        } else {
          fillRect(x - 2, headY + 10, 4, 1, '#2b1d14');
        }

        // Brazo extendido y Mano sosteniendo un Sprite Custom si se indica 'holdSprite'
        const handX = x + dir * 10;
        const handY = anchorY - 16;
        fillBorderedRect(facingLeft ? x - 10 : x + 6, anchorY - 19, 5, 5, suitCol, '#0b0c10');
        fillRect(handX - 1, handY - 1, 3, 3, skinCol);

        if (opts.holdSprite) {
          drawCustomSprite(opts.holdSprite, handX + dir * 5, handY - 1, opts.spriteScale || 0.9, facingLeft);
        }

        return { handX: handX + dir * 6, handY: handY - 1, headX: x, headY };
      }

      // HAZ DE ACCIÓN CONECTADO MATEMÁTICAMENTE ENTRE MANO Y OBJETIVO (CERO LÍNEAS ROTAS)
      function drawActionBeam(fromX, fromY, toX, toY, type = 'bullets', localFrame = 0) {
        if (type === 'spray' || type === 'smoke') {
          for (let i = 0; i < 10; i++) {
            const t = ((i / 10) + (localFrame * 0.04)) % 1;
            const px = fromX + (toX - fromX) * t + Math.sin(localFrame * 0.3 + i) * (t * 5);
            const py = fromY + (toY - fromY) * t + Math.cos(localFrame * 0.2 + i) * (t * 4);
            fillBorderedCircle(px, py, 2 + Math.floor(t * 3), '#e2e8f0', '#94a3b8');
          }
          return;
        }
        if (type === 'laser' || type === 'flashlight') {
          drawPixelLine(fromX, fromY, toX, toY, 2, '#ef4444');
          fillCircle(toX, toY, 3 + (localFrame % 3), '#fde047');
          return;
        }
        // Ráfaga de disparos con fogonazo en el cañón y chispas en el punto exacto de impacto
        if (localFrame % 4 < 2) {
          fillCircle(fromX, fromY, 4, '#fde047');
          drawPixelLine(fromX, fromY, toX, toY, 1, '#fef08a');
          fillCircle(toX, toY, 4, '#f97316');
        }
      }

      // ======================================================================
      // 5. FONDOS ESCÉNICOS RICOS CONFIGURADOS POR EL AGENTE 3
      // ======================================================================
      function drawSky(skyTop = '#0f172a', skyMid = '#1e293b', skyBot = '#334155', groundCol = '#1e293b', horizonY = GROUND_Y) {
        const bands = [skyTop, skyMid, skyBot];
        const bandH = Math.max(1, Math.ceil(horizonY / bands.length));
        for (let r = 0; r < horizonY; r++) {
          const bIdx = Math.min(bands.length - 1, Math.floor(r / bandH));
          const nextIdx = Math.min(bands.length - 1, bIdx + 1);
          const ratio = (r % bandH) / bandH;
          for (let c = 0; c < COLS; c++) {
            let col = bands[bIdx];
            if (ratio > 0.72 && ((r + c) % 2 === 0)) col = bands[nextIdx];
            grid[r][c] = col;
          }
        }
        fillRect(0, horizonY, COLS, 2, '#0b0c10');
        for (let r = horizonY + 2; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            grid[r][c] = ((r + c) % 6 === 0) ? '#090d16' : groundCol;
          }
        }
      }

      function drawRoom(wallCol = '#3b2818', stripeCol = '#2b1d14', floorCol = '#78350f', groundY = GROUND_Y) {
        fillRect(0, 0, COLS, groundY, wallCol);
        for (let c = 0; c < COLS; c += 12) fillRect(c, 0, 2, groundY, stripeCol);
        fillBorderedRect(0, groundY - 3, COLS, 4, '#d97706', '#0b0c10');
        for (let r = groundY + 1; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            grid[r][c] = ((r + c) % 5 === 0) ? '#451a03' : floorCol;
          }
        }
      }

      function renderSceneBackground(bgConfig = {}, localFrame = 0) {
        const preset = bgConfig.preset || 'city_street';
        const skyCols = Array.isArray(bgConfig.sky_colors) && bgConfig.sky_colors.length >= 3
          ? bgConfig.sky_colors
          : ['#090d16', '#1e293b', '#334155'];
        const groundCol = bgConfig.ground_color || '#1e293b';

        if (preset === 'interior_office' || preset === 'interior_vault' || preset === 'interior_lab') {
          drawRoom(skyCols[0], skyCols[1], groundCol, GROUND_Y);
          if (preset === 'interior_vault') {
            fillBorderedCircle(60, 84, 32, '#475569', '#0b0c10');
            fillBorderedCircle(60, 84, 24, '#94a3b8', '#0b0c10');
            fillBorderedCircle(60, 84, 8, '#eab308', '#0b0c10');
          } else {
            // Ventanal o pizarra detallada en la pared
            fillBorderedRect(14, 46, 36, 28, '#38bdf8', '#0b0c10');
            fillRect(31, 46, 2, 28, '#0b0c10');
            fillRect(14, 59, 36, 2, '#0b0c10');
          }
          return;
        }

        drawSky(skyCols[0], skyCols[1], skyCols[2], groundCol, GROUND_Y);

        if (preset === 'forest_woods' || preset === 'nature_park') {
          drawDetailedTree(18, 1.1, localFrame);
          drawDetailedTree(52, 1.25, localFrame);
          drawDetailedTree(96, 1.05, localFrame);
        } else if (preset === 'city_street' || preset === 'military_base') {
          drawDetailedBuilding(8, 30, 74, { wallColor: '#475569', roofColor: '#1e293b', peakedRoof: true }, localFrame);
          drawDetailedBuilding(44, 34, 82, { wallColor: '#334155', roofColor: '#0f172a', peakedRoof: false }, localFrame);
          drawDetailedBuilding(84, 28, 68, { wallColor: '#64748b', roofColor: '#1e293b', peakedRoof: true }, localFrame);
        }
      }

      function drawStars(count = 20, localFrame = 0) {
        for (let i = 0; i < count; i++) {
          const sx = (i * 19 + 7) % COLS;
          const sy = 36 + (i * 11) % 65;
          if ((Math.floor(localFrame / 6) + i) % 3 !== 0) {
            setPx(sx, sy, i % 4 === 0 ? '#fde047' : '#ffffff');
          }
        }
      }

      function drawClouds(count = 3, speed = 0.4, localFrame = 0, yMin = 44) {
        for (let i = 0; i < count; i++) {
          const cx = ((i * 38 - Math.floor(localFrame * speed)) % (COLS + 24) + (COLS + 24)) % (COLS + 24) - 12;
          const cy = yMin + (i % 3) * 12;
          fillBorderedRect(cx, cy, 18, 5, '#ffffff', '#cbd5e1');
          fillRect(cx + 4, cy - 3, 10, 4, '#ffffff');
        }
      }

      function drawFire(x, y, w = 16, h = 14, localFrame = 0) {
        for (let c = 0; c < w; c += 2) {
          const fh = Math.max(4, Math.round(h * (0.5 + 0.5 * Math.abs(Math.sin(localFrame * 0.35 + c)))));
          fillRect(x + c, y - fh, 2, fh, '#dc2626');
          fillRect(x + c, y - Math.floor(fh * 0.65), 2, Math.floor(fh * 0.65), '#f97316');
          fillRect(x + c, y - Math.floor(fh * 0.35), 2, Math.floor(fh * 0.35), '#fde047');
        }
      }

      function drawBusto(cx, headY, opts = {}, localFrame = 0) {
        const s = opts.scale || 0.85;
        const suitCol = opts.suitColor || '#334155';
        const tieCol = opts.tieColor || '#e63946';
        const hatCol = opts.hatColor !== undefined ? opts.hatColor : '#eab308';
        const hairCol = opts.hairColor || '#2b1d14';
        const skinCol = opts.skinColor || '#e6ad86';
        const isTalking = opts.isTalking !== undefined ? opts.isTalking : true;

        const bobY = headY + Math.round(Math.sin(localFrame * 0.15) * 1);
        const bodyW = Math.round(58 * s), bodyH = Math.round(36 * s);
        fillBorderedRect(cx - Math.floor(bodyW / 2), bobY + Math.round(18 * s), bodyW, bodyH, suitCol, '#0b0c10');
        fillRect(cx - Math.round(6 * s), bobY + Math.round(19 * s), Math.round(12 * s), Math.round(14 * s), '#ffffff');
        fillRect(cx - Math.round(2 * s), bobY + Math.round(22 * s), Math.round(4 * s), Math.round(16 * s), tieCol);

        const headW = Math.round(32 * s), headH = Math.round(30 * s);
        const hx = cx - Math.floor(headW / 2), hy = bobY - Math.floor(headH / 2);
        fillBorderedRect(cx - Math.round(7 * s), hy + headH - 2, Math.round(14 * s), Math.round(8 * s), skinCol, '#0b0c10');
        fillBorderedRect(hx, hy, headW, headH, skinCol, '#0b0c10');
        fillRect(hx, hy, headW, Math.round(5 * s), hairCol);

        if (hatCol) {
          fillBorderedRect(cx - Math.round(24 * s), hy - Math.round(2 * s), Math.round(48 * s), Math.round(5 * s), hatCol, '#0b0c10');
          fillBorderedRect(cx - Math.round(16 * s), hy - Math.round(10 * s), Math.round(32 * s), Math.round(9 * s), hatCol, '#0b0c10');
        }

        const blink = (localFrame % 55 < 3);
        if (blink) {
          fillRect(cx - Math.round(9 * s), bobY - 2, Math.round(5 * s), 2, '#0b0c10');
          fillRect(cx + Math.round(4 * s), bobY - 2, Math.round(5 * s), 2, '#0b0c10');
        } else {
          fillRect(cx - Math.round(9 * s), bobY - Math.round(4 * s), Math.round(5 * s), Math.round(4 * s), '#ffffff');
          fillRect(cx - Math.round(7 * s), bobY - Math.round(4 * s), Math.round(3 * s), Math.round(4 * s), '#0b0c10');
          fillRect(cx + Math.round(4 * s), bobY - Math.round(4 * s), Math.round(5 * s), Math.round(4 * s), '#ffffff');
          fillRect(cx + Math.round(6 * s), bobY - Math.round(4 * s), Math.round(3 * s), Math.round(4 * s), '#0b0c10');
        }

        const mouthOpen = isTalking && (Math.floor(localFrame / 3) % 2 === 0);
        if (mouthOpen) {
          fillBorderedRect(cx - Math.round(5 * s), bobY + Math.round(6 * s), Math.round(10 * s), Math.round(5 * s), '#ffffff', '#0b0c10');
        } else {
          fillRect(cx - Math.round(5 * s), bobY + Math.round(7 * s), Math.round(10 * s), 2, '#0b0c10');
        }

        if (opts.holdSprite) {
          drawCustomSprite(opts.holdSprite, cx + 18, bobY + 26, 1.2, false);
        }
      }

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
        '!': ['010','010','010','000','010'], '?': ['111','001','011','000','010'],
        '+': ['000','010','111','010','000'], '-': ['000','000','111','000','000'],
        ':': ['000','010','000','010','000']
      };

      function drawTinyText(str, centerX, startY, color = '#ffffff', scale = 2) {
        const clean = String(str || '').toUpperCase().replace(/[^A-Z0-9$%!?+: -]/g, '').slice(0, 14);
        if (!clean) return;
        const charW = 3 * scale, gap = 1 * scale;
        const totalW = clean.length * (charW + gap) - gap;
        let cx = Math.max(2, Math.floor(centerX - totalW / 2));
        for (let i = 0; i < clean.length; i++) {
          const glyph = FONT_3X5[clean[i]];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') fillRect(cx + c * scale, startY + r * scale, scale, scale, color);
              }
            }
          }
          cx += charW + gap;
        }
      }

      const sandboxApi = {
        COLS, ROWS, GROUND_Y,
        setPx, px: setPx,
        fillRect, rect: fillRect,
        fillBorderedRect, borderedRect: fillBorderedRect, box: fillBorderedRect,
        fillCircle, circle: fillCircle,
        fillBorderedCircle, borderedCircle: fillBorderedCircle,
        drawRing, ring: drawRing,
        drawPixelLine, line: drawPixelLine,
        fillPolygon, polygon: fillPolygon,
        fillTriangle, triangle: fillTriangle,
        drawSky, sky: drawSky,
        drawRoom, room: drawRoom,
        renderSceneBackground,
        drawStars, stars: drawStars,
        drawClouds, clouds: drawClouds,
        drawFire, fire: drawFire,
        drawCustomSprite, customSprite: drawCustomSprite,
        drawDetailedBuilding, building: drawDetailedBuilding,
        drawDetailedTree, tree: drawDetailedTree,
        drawDetailedVehicle, vehicle: drawDetailedVehicle,
        drawActor, actor: drawActor,
        drawHuman: (x, y, col, hat, mov, lf, fl) => drawActor(x, y, { suitColor: col, hatColor: hat, isMoving: mov, facingLeft: fl }, lf),
        drawActionBeam, actionBeam: drawActionBeam,
        drawBusto, busto: drawBusto,
        drawTinyText, text: drawTinyText,
        sin: Math.sin, cos: Math.cos, abs: Math.abs, floor: Math.floor,
        round: Math.round, min: Math.min, max: Math.max, PI: Math.PI
      };

      const compiledRenderers = escenas.map((esc, idx) => {
        if (esc.js_code && typeof esc.js_code === 'string' && esc.js_code.trim().length > 10) {
          try {
            return new Function('api', 'progress', 'localFrame', \`with (api) { \${esc.js_code} }\`);
          } catch (e) {
            console.warn('⚠️ Error compilando escena ' + idx + ':', e.message);
            return null;
          }
        }
        return null;
      });

      function renderFallbackScene(esc, progress, localFrame) {
        renderSceneBackground(esc.bg_config || { preset: 'city_street' }, localFrame);
        drawBusto(60, 86, { suitColor: '#1e3a8a', tieColor: '#facc15', isTalking: true }, localFrame);
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
      const labelTop = document.getElementById('label-top');
      const labelBot = document.getElementById('label-bot');
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

        const esc = escenas[activeIdx] || {};
        const localT = Math.max(0, t - (esc.inicio || 0));
        const durEsc = Math.max(0.5, (esc.fin || 4) - (esc.inicio || 0));
        const progress = Math.max(0, Math.min(1, localT / durEsc));
        const localFrame = Math.floor(localT * 30);

        if (activeIdx !== lastSceneIdx) {
          lastSceneIdx = activeIdx;
          labelTop.textContent = esc.texto_1 || 'HISTORIA';
          labelBot.textContent = esc.texto_2 || 'CASO REAL';
        }

        // 1. Pintar el fondo rico diseñado por el Agente Arquitecto
        renderSceneBackground(esc.bg_config || {}, localFrame);

        // 2. Ejecutar la coreografía programada por el Agente Animador (con Sprites 16x16 del Agente Artista)
        const customFn = compiledRenderers[activeIdx];
        if (customFn) {
          try {
            customFn(sandboxApi, progress, localFrame);
          } catch (err) {
            renderFallbackScene(esc, progress, localFrame);
          }
        } else {
          renderFallbackScene(esc, progress, localFrame);
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

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Multi-Agente v10.0 (${duracionExactaVideo.toFixed(2)}s)...`);
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

  console.log('🔊 Ensamblando MP4 final v10.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Multi-Agente v10.0 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
