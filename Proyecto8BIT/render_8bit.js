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
        let mStart = elevenWords[bestMatchIdx].start;
        let mEnd = elevenWords[bestMatchIdx].end;
        ewCursor = bestMatchIdx + 1;
        while (ewCursor < elevenWords.length && /^(euro|euros|dolar|dolares|por|ciento|millon|millones)$/.test(elevenWords[ewCursor].norm)) {
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
    : Math.max(1, realAudioDuration - 0.18);

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
      sceneEnd = (idx === escenas.length - 1) ? realAudioDuration : Math.min(realAudioDuration, lastMatched.matchedEnd + 0.05);
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
        gEnd = timedWords[timedWords.length - 1].end + 0.04;
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
        expr: `0.22*(lt(t,0.08)*sgn(sin(2*PI*987.77*${p}*t))+gt(t,0.08)*exp(-6*(t-0.08))*sgn(sin(2*PI*1318.51*${p}*t)))`,
        dur: 0.42
      },
      laser_8bit: {
        expr: `0.20*exp(-5*t)*sgn(sin(2*PI*(1200*${p}*exp(-6*t)+120)*t))`,
        dur: 0.32
      },
      explosion_8bit: {
        expr: `0.32*exp(-4.5*t)*(sgn(sin(2*PI*75*exp(-2*t)*t))*sin(2*PI*19*t)+0.5*sgn(sin(2*PI*230*t)*sin(2*PI*53*t)))`,
        dur: 0.65
      },
      powerup_8bit: {
        expr: `0.20*(lt(t,0.07)*sgn(sin(2*PI*330*${p}*t))+between(t,0.07,0.14)*sgn(sin(2*PI*392*${p}*t))+between(t,0.14,0.21)*sgn(sin(2*PI*659*${p}*t))+gt(t,0.21)*exp(-5*(t-0.21))*sgn(sin(2*PI*523*${p}*t)))`,
        dur: 0.45
      },
      alarm_8bit: {
        expr: `0.20*exp(-1.5*t)*sgn(sin(2*PI*(680+220*sgn(sin(2*PI*8*t)))*t))`,
        dur: 0.55
      },
      glitch_8bit: {
        expr: `0.20*exp(-6*t)*sgn(sin(2*PI*440*${p}*t)*sin(2*PI*67*t)+sin(2*PI*1120*t)*sin(2*PI*29*t))`,
        dur: 0.35
      },
      jump_8bit: {
        expr: `0.21*exp(-4*t)*sgn(sin(2*PI*(180*${p}+520*t)*t))`,
        dur: 0.30
      },
      error_8bit: {
        expr: `0.24*exp(-4*t)*(lt(t,0.14)*sgn(sin(2*PI*165*${p}*t))+gt(t,0.14)*sgn(sin(2*PI*130.8*${p}*t)))`,
        dur: 0.45
      },
      typing_8bit: {
        expr: `0.18*(exp(-40*t)*sgn(sin(2*PI*1400*t))+gt(t,0.09)*exp(-40*(t-0.09))*sgn(sin(2*PI*1650*t))+gt(t,0.18)*exp(-40*(t-0.18))*sgn(sin(2*PI*1300*t)))`,
        dur: 0.30
      },
      level_clear_8bit: {
        expr: `0.20*exp(-2.8*t)*(sgn(sin(2*PI*523.25*${p}*t))+0.7*sgn(sin(2*PI*659.25*${p}*t))+0.5*sgn(sin(2*PI*783.99*${p}*t)))`,
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
// 3. EJECUCIÓN PRINCIPAL Y RENDERIZADO DE LA MATRIZ 45x80 (720x1280)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload 8-BIT desde URL...');
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

  execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });

  let realAudioDuration = 26;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) realAudioDuration = parsed;
  } catch (err) {
    realAudioDuration = Number(payload.duracion_total) || 26;
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
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.85,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );
      if (hasSfx) {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.08[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      } else {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.08[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      }
    } else {
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (e) {
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

  // Paletas Retro 8-Bit (NES / Cyberpunk / GameBoy / Synthwave)
  const palettes = [
    { name: 'Cyber Arcade', bgTop: '#060713', bgBot: '#120924', primary: '#00f2fe', secondary: '#ff2a85', accent: '#ffd000', ground: '#1a103c', gridLine: 'rgba(0, 242, 254, 0.12)' },
    { name: 'Matrix Terminal', bgTop: '#030c06', bgBot: '#081c0f', primary: '#39ff14', secondary: '#00f2fe', accent: '#ffd000', ground: '#0d2e18', gridLine: 'rgba(57, 255, 20, 0.12)' },
    { name: 'Famicom Red', bgTop: '#14050a', bgBot: '#280914', primary: '#ffd000', secondary: '#ff2a5f', accent: '#00f2fe', ground: '#38101e', gridLine: 'rgba(255, 42, 95, 0.12)' },
    { name: 'Outrun 1986', bgTop: '#0b0418', bgBot: '#230b36', primary: '#ff6b00', secondary: '#c77dff', accent: '#39ff14', ground: '#2d124d', gridLine: 'rgba(199, 125, 255, 0.12)' }
  ];
  const pal = palettes[hash % palettes.length];

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
      /* Lienzo de Matriz 8-Bit (45x80 bloques -> 720x1280 px) */
      #pixel-canvas {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        image-rendering: pixelated;
        z-index: 2;
      }
      /* Efecto CRT Retro Sutil */
      .crt-scanlines {
        position: absolute; inset: 0;
        background: linear-gradient(
          rgba(18, 16, 16, 0) 50%, 
          rgba(0, 0, 0, 0.28) 50%
        );
        background-size: 100% 8px;
        z-index: 10; pointer-events: none;
      }
      /* HUD Arcade Superior */
      .arcade-hud {
        position: absolute; top: 36px; left: 28px; right: 28px;
        display: flex; justify-content: space-between; align-items: center;
        background: rgba(5, 5, 12, 0.86);
        border: 4px solid ${pal.primary};
        padding: 14px 18px;
        box-shadow: 0 8px 0 #000000;
        z-index: 20;
      }
      .hud-tag {
        color: ${pal.accent};
        font-size: 14px;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .hud-score {
        color: #ffffff;
        font-size: 13px;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: ${pal.secondary};
        width: 0%; z-index: 30;
      }
      /* Caja de Subtítulos Estilo RPG 8-Bit */
      .subtitle-container {
        position: absolute;
        bottom: 110px; left: 26px; right: 26px;
        min-height: 155px;
        display: flex; justify-content: center; align-items: center;
        z-index: 25; pointer-events: none;
      }
      .subtitle-box {
        display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
        gap: 12px 18px; text-align: center;
        padding: 22px 26px;
        background: rgba(6, 6, 14, 0.92);
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
        color: ${pal.accent};
      }
      .sub-word.active {
        transform: scale(1.12) translateY(-5px);
        color: ${pal.primary};
      }
      .sub-word.kw.active {
        color: ${pal.accent};
        transform: scale(1.16) translateY(-6px);
      }
      .sub-word.future {
        opacity: 0.40;
      }
    </style>
  </head>
  <body>
    <div class="progress-bar" id="pbar"></div>
    <div class="arcade-hud">
      <div class="hud-tag">${(payload.subrama || 'GLITCH 8-BIT').slice(0, 22)}</div>
      <div class="hud-score" id="hud-frame">FRM:000</div>
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
      const pal = ${JSON.stringify(pal)};

      // CONFIGURACIÓN DE LA CUADRÍCULA 45x80 (Cada celda = 16x16 píxeles -> 720x1280)
      const COLS = 45;
      const ROWS = 80;
      const CELL = 16;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');

      // Matriz en memoria de 45x80
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#000000'));

      function clearGrid(bgType, frameIdx) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            // Fondo gradiente por bandas 8-bit
            if (r < 18) grid[r][c] = pal.bgTop;
            else if (r < 48) grid[r][c] = (r % 2 === 0 && c % 2 === 0) ? pal.bgBot : pal.bgTop;
            else if (r < 56) grid[r][c] = pal.bgBot;
            else {
              // Suelo en perspectiva con desplazamiento (efecto movimiento retro)
              const scroll = Math.floor(frameIdx * 0.6);
              const isGridLine = ((r - 56) % 4 === 0) || ((c + scroll) % 6 === 0);
              grid[r][c] = isGridLine ? pal.secondary : pal.ground;
            }
          }
        }

        // Decoración atmosférica según bgType
        if (bgType === 'matrix_rain' || bgType === 'cyber_grid') {
          for (let c = 2; c < COLS - 2; c += 4) {
            const headRow = (frameIdx + c * 7) % 52;
            setCell(c, headRow, '#ffffff');
            setCell(c, headRow - 1, pal.primary);
            setCell(c, headRow - 2, pal.primary);
            setCell(c, headRow - 3, '#0a3a1a');
          }
        } else if (bgType === 'space_stars') {
          for (let i = 0; i < 28; i++) {
            const sc = (i * 17 + Math.floor(frameIdx * 0.2)) % COLS;
            const sr = (i * 11) % 50;
            if ((frameIdx + i) % 10 < 7) setCell(sc, sr, i % 3 === 0 ? pal.accent : '#ffffff');
          }
        } else if (bgType === 'server_room') {
          for (let c = 5; c < COLS - 5; c += 10) {
            drawRect(c, 16, 6, 38, '#141824');
            for (let r = 19; r < 50; r += 4) {
              const blink = ((frameIdx + r + c) % 12) < 6;
              setCell(c + 1, r, blink ? pal.primary : '#333344');
              setCell(c + 3, r, !blink ? pal.secondary : '#333344');
            }
          }
        } else if (bgType === 'bank_vault') {
          drawRect(6, 15, 33, 38, '#1c2026');
          drawCircle(22, 34, 10, '#3a4250');
          drawCircle(22, 34, 4, pal.accent);
        }
      }

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

      // MAPA DE CARACTERES PIXEL ART 3x5 PARA ROTULAR TEXTOS EN LA MATRIZ
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
        const totalW = clean.length * 4 - 1;
        let cx = Math.max(1, Math.floor(startX - totalW / 2));
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const glyph = FONT_3X5[ch];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') {
                  setCell(cx + c, startY + r + 1, '#000000'); // Sombra 8-bit
                  setCell(cx + c, startY + r, color);
                }
              }
            }
          }
          cx += 4;
        }
      }

      // GENERADOR PROCEDURAL DE SPRITES EN BLOQUES CON EXTREMIDADES MÓVILES
      function drawActor8Bit(tipo, baseX, baseY, action, frameIdx, primaryColor) {
        // Cálculo de desplazamiento y física por frame
        let x = baseX;
        let y = baseY;
        if (action === 'run_right') x = (baseX + Math.floor(frameIdx * 0.45)) % (COLS - 8);
        else if (action === 'run_left') x = (baseX - Math.floor(frameIdx * 0.45) + COLS * 10) % (COLS - 8);
        else if (action === 'jump') y = baseY - Math.abs(Math.round(Math.sin(frameIdx * 0.35) * 6));
        else if (action === 'fall') y = Math.min(50, baseY + Math.floor((frameIdx % 30) * 0.6));
        else if (action === 'float') y = baseY + Math.round(Math.sin(frameIdx * 0.25) * 2);

        // Ciclo de patas/extremidades (cambia de bloque cada 3 frames)
        const step = Math.floor(frameIdx / 3) % 2;
        const isGlitch = (action === 'glitch' || action === 'explode');

        const put = (dx, dy, col) => {
          let gx = x + dx;
          let gy = y + dy;
          if (isGlitch && (frameIdx % 4 < 2)) {
            gx += Math.round(Math.sin(frameIdx + dy) * 3);
            gy += Math.round(Math.cos(frameIdx + dx) * 2);
          }
          setCell(gx, gy, col);
        };

        if (tipo === 'rocket') {
          const ry = (action === 'launch' || action === 'jump') ? baseY - Math.floor((frameIdx % 35) * 0.7) : y;
          const rPut = (dx, dy, col) => setCell(x + dx, ry + dy, col);
          // Punta y fuselaje del cohete
          rPut(0, -6, '#ff2a5f');
          for (let c = -1; c <= 1; c++) rPut(c, -5, '#ff2a5f');
          for (let r = -4; r <= 3; r++) {
            for (let c = -2; c <= 2; c++) rPut(c, r, '#ffffff');
          }
          // Ventana
          rPut(0, -2, '#00f2fe'); rPut(0, -1, '#00f2fe');
          // Aletas laterales
          rPut(-3, 2, '#ff2a5f'); rPut(-3, 3, '#ff2a5f'); rPut(-4, 3, '#ff2a5f');
          rPut(3, 2, '#ff2a5f'); rPut(3, 3, '#ff2a5f'); rPut(4, 3, '#ff2a5f');
          // Fuego animado del propulsor (cambia celda a celda en cada frame)
          const flameLen = 3 + (frameIdx % 4);
          for (let f = 1; f <= flameLen; f++) {
            rPut(0, 3 + f, f % 2 === 0 ? '#ffd000' : '#ff6b00');
            if (f < flameLen) {
              rPut(-1, 3 + f, '#ff2a5f');
              rPut(1, 3 + f, '#ff2a5f');
            }
          }
          return;
        }

        if (tipo === 'dog' || tipo === 'wolf') {
          // Cuerpo horizontal de cuadrúpedo 8-bit
          for (let c = -3; c <= 2; c++) {
            for (let r = -1; r <= 1; r++) put(c, r, primaryColor || '#ff9f1c');
          }
          // Cabeza y orejas
          for (let c = 2; c <= 4; c++) {
            for (let r = -3; r <= -1; r++) put(c, r, primaryColor || '#ff9f1c');
          }
          put(2, -4, '#ffffff'); put(4, -2, '#000000'); put(5, -2, '#ff2a5f');
          // Cola animada
          put(-4, step === 0 ? -2 : -1, '#ffffff');
          put(-5, step === 0 ? -3 : -2, '#ffffff');
          // 4 Patas corriendo (cambian de bloque en cada paso)
          if (step === 0) {
            put(-3, 2, '#ffffff'); put(-4, 3, '#ffffff');
            put(-1, 2, primaryColor);
            put(1, 2, '#ffffff'); put(2, 3, '#ffffff');
            put(3, 2, primaryColor);
          } else {
            put(-3, 2, primaryColor);
            put(-1, 2, '#ffffff'); put(0, 3, '#ffffff');
            put(1, 2, primaryColor);
            put(3, 2, '#ffffff'); put(4, 3, '#ffffff');
          }
          return;
        }

        if (tipo === 'skull_bug' || tipo === 'virus') {
          for (let r = -4; r <= 1; r++) {
            for (let c = -4; c <= 4; c++) {
              if (Math.abs(c) === 4 && r === -4) continue;
              put(c, r, primaryColor || '#ff2a5f');
            }
          }
          // Ojos parpadeantes
          const eyeCol = (frameIdx % 6 < 3) ? '#ffd000' : '#000000';
          put(-2, -2, eyeCol); put(-1, -2, eyeCol);
          put(1, -2, eyeCol); put(2, -2, eyeCol);
          // Mandíbula / Patas de insecto código
          put(-3, 2, '#ffffff'); put(-1, 2, '#ffffff'); put(1, 2, '#ffffff'); put(3, 2, '#ffffff');
          const legOffset = step === 0 ? 1 : -1;
          put(-5, 0 + legOffset, pal.primary); put(5, 0 - legOffset, pal.primary);
          put(-5, 2 - legOffset, pal.primary); put(5, 2 + legOffset, pal.primary);
          return;
        }

        if (tipo === 'computer' || tipo === 'server') {
          for (let r = -5; r <= 2; r++) {
            for (let c = -5; c <= 5; c++) put(c, r, '#ffffff');
          }
          for (let r = -4; r <= 0; r++) {
            for (let c = -4; c <= 4; c++) put(c, r, '#081820');
          }
          // Líneas de código moviéndose dentro del monitor
          const lineRow = -4 + (frameIdx % 4);
          put(-3, lineRow, '#39ff14'); put(-2, lineRow, '#39ff14'); put(-1, lineRow, '#39ff14');
          put(1, lineRow, '#ffd000'); put(2, lineRow, '#ffd000');
          // Base del monitor
          put(-1, 3, '#888899'); put(0, 3, '#888899'); put(1, 3, '#888899');
          for (let c = -3; c <= 3; c++) put(c, 4, '#ffffff');
          return;
        }

        if (tipo === 'money_bag' || tipo === 'coin') {
          for (let r = -3; r <= 3; r++) {
            for (let c = -3; c <= 3; c++) {
              if (Math.abs(c) + Math.abs(r) <= 5) put(c, r, '#ffd000');
            }
          }
          put(0, -2, '#000000'); put(-1, -1, '#000000'); put(0, 0, '#000000'); put(1, 1, '#000000'); put(0, 2, '#000000');
          return;
        }

        // Por defecto: Humanoide 8-Bit (Hacker / Científico / Guardia / Banquero)
        const headColor = '#ffccaa';
        const suitColor = primaryColor || pal.primary;
        // Cabeza 3x3
        for (let r = -6; r <= -4; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, headColor);
        }
        // Gafas de hacker / Visor
        put(0, -5, '#000000'); put(1, -5, pal.accent);
        // Torso 3x4
        for (let r = -3; r <= 0; r++) {
          for (let c = -1; c <= 1; c++) put(c, r, suitColor);
        }
        // Brazos animados con el paso
        if (step === 0) {
          put(-2, -2, suitColor); put(-2, -1, headColor);
          put(2, -3, suitColor); put(2, -4, headColor);
        } else {
          put(-2, -3, suitColor); put(-2, -4, headColor);
          put(2, -2, suitColor); put(2, -1, headColor);
        }
        // Piernas alternando bloques para correr
        if (step === 0) {
          put(-1, 1, '#ffffff'); put(-2, 2, '#ffffff'); put(-2, 3, pal.secondary);
          put(1, 1, '#ffffff'); put(1, 2, pal.secondary);
        } else {
          put(-1, 1, '#ffffff'); put(-1, 2, pal.secondary);
          put(1, 1, '#ffffff'); put(2, 2, '#ffffff'); put(2, 3, pal.secondary);
        }
      }

      // Pintar toda la matriz 45x80 en el Canvas HTML5
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
        hudFrame.textContent = 'FRM:' + String(frameIdx).padStart(3, '0');

        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        const esc = escenas[activeIdx] || {};
        const localFrame = Math.max(0, Math.floor((t - (esc.inicio || 0)) * 30));

        // 1. Limpiar y construir fondo en la matriz 45x80
        clearGrid(esc.bg_type || 'cyber_grid', frameIdx);

        // 2. Dibujar actores móviles en la cuadrícula
        const actors = Array.isArray(esc.actors) && esc.actors.length > 0
          ? esc.actors
          : [
              { tipo: 'hacker', x: 14, y: 50, action: 'run_right', color: pal.primary },
              { tipo: 'computer', x: 32, y: 48, action: 'float', color: pal.secondary }
            ];

        actors.forEach((act, aIdx) => {
          const col = act.color || (aIdx % 2 === 0 ? pal.primary : pal.secondary);
          drawActor8Bit(
            act.tipo || 'hacker',
            Number(act.x) || 15 + aIdx * 14,
            Number(act.y) || 50,
            act.action || 'run_right',
            localFrame,
            col
          );
        });

        // 3. Efecto especial de explosión de píxeles o lluvia de monedas
        if (esc.efecto_matriz === 'explosion_pixel' || (localFrame > 18 && esc.sfx === 'explosion_8bit')) {
          for (let p = 0; p < 22; p++) {
            const angle = (p / 22) * Math.PI * 2;
            const dist = (localFrame % 18) * 1.1;
            const px = 22 + Math.cos(angle) * dist;
            const py = 36 + Math.sin(angle) * dist;
            setCell(px, py, p % 2 === 0 ? '#ffd000' : '#ff2a5f');
          }
        } else if (esc.efecto_matriz === 'coin_shower') {
          for (let m = 0; m < 12; m++) {
            const mx = (m * 7 + 3) % COLS;
            const my = (localFrame * 2 + m * 9) % 55;
            setCell(mx, my, '#ffd000');
            setCell(mx, my + 1, '#ff9f1c');
          }
        }

        // 4. Rotular texto_1 y texto_2 en bloques 8-bit dentro de la cuadrícula
        if (esc.texto_1) drawPixelString(esc.texto_1, 22, 10, pal.accent);
        if (esc.texto_2) drawPixelString(esc.texto_2, 22, 58, '#ffffff');

        // 5. Volcar matriz al lienzo
        flushGridToCanvas();

        // 6. Actualizar subtítulos sincronizados
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

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Matriz 8-Bit 45x80 (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 94 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final 8-Bit...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo 8-Bit generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
