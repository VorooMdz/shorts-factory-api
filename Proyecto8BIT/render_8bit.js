const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. UTILIDADES DE RED, CORRECCIÓN DE "Ñ" Y SUBTÍTULOS + MICRO-PLANOS FONÉTICOS
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

function fixSpanishN(str) {
  if (!str) return '';
  return String(str)
    .replace(/engann/gi, (m) => m[0] === 'E' ? 'Engañ' : 'engañ')
    .replace(/espannol/gi, (m) => m[0] === 'E' ? 'Español' : 'español')
    .replace(/\bespanol(es|a|as)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bengano(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\benganar(on)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bhazana(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bpequeno(s|a|as)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bmontana(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bcompania(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bdano(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bsenal(es)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bdiseno(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bsueno(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'))
    .replace(/\bano(s)?\b/gi, (m) => m.replace(/n/i, (n) => n === 'N' ? 'Ñ' : 'ñ'));
}

function cleanArcadeText(str) {
  return fixSpanishN(str)
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .trim();
}

function normalizeForMatch(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function buildSubtitleChunksAndBeatTimings(escenas, alignmentData, realAudioDuration) {
  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'ERA', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE'
  ]);

  const sceneTokensList = escenas.map(esc => {
    const raw = fixSpanishN((esc.subtitulo || '').trim());
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
  const sceneWordSlices = [];

  escenas.forEach((esc, idx) => {
    const tokens = sceneTokensList[idx];
    const sWeight = sceneWeights[idx];
    const phoneticStart = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;
    cumulativeWeight += sWeight;
    const phoneticEnd = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;

    const sceneFlatSlice = flatTokens.slice(flatIdx, flatIdx + tokens.length);
    flatIdx += tokens.length;
    sceneWordSlices.push(sceneFlatSlice);

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
        item.finalStart = wStart;
        item.finalEnd = wEnd;
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

  // CALCULAR LOS TIEMPOS EXACTOS DE CADA SUB-ESCENA (MICRO-PLANO) SEGÚN SU FRAGMENTO DE VOZ
  escenas.forEach((esc, idx) => {
    const sStart = esc.inicio;
    const sEnd = esc.fin;
    const sDur = Math.max(0.3, sEnd - sStart);
    const beats = Array.isArray(esc.sub_escenas) && esc.sub_escenas.length > 0 ? esc.sub_escenas : [esc];
    const wordSlice = sceneWordSlices[idx] || [];

    const weights = beats.map(b => {
      const frag = String(b.fragmento_voz || b.texto_1 || '').trim();
      return Math.max(4, frag.length);
    });
    const totalW = weights.reduce((a, b) => a + b, 0);

    let accumW = 0;
    let wordSearchCursor = 0;

    beats.forEach((b, bIdx) => {
      const propStart = sStart + (accumW / totalW) * sDur;
      accumW += weights[bIdx];
      const propEnd = (bIdx === beats.length - 1) ? sEnd : (sStart + (accumW / totalW) * sDur);

      let bStart = (bIdx === 0) ? sStart : propStart;
      if (bIdx > 0 && b.fragmento_voz && wordSlice.length > 0) {
        const firstFragWords = String(b.fragmento_voz).trim().split(/\s+/).slice(0, 2).map(normalizeForMatch).filter(Boolean);
        if (firstFragWords.length > 0) {
          for (let wi = wordSearchCursor + 1; wi < wordSlice.length; wi++) {
            const wNorm = wordSlice[wi].norm;
            if (wNorm && (wNorm === firstFragWords[0] || wNorm.startsWith(firstFragWords[0]))) {
              if (wordSlice[wi].finalStart !== undefined) {
                const candidateT = wordSlice[wi].finalStart;
                if (candidateT > sStart + 0.35 && candidateT < sEnd - 0.35) {
                  bStart = candidateT;
                  wordSearchCursor = wi;
                  break;
                }
              }
            }
          }
        }
      }
      b.inicio_beat = bStart;
      b.fin_beat = propEnd;
    });

    for (let bi = 0; bi < beats.length - 1; bi++) {
      if (beats[bi + 1].inicio_beat <= beats[bi].inicio_beat + 0.35) {
        beats[bi + 1].inicio_beat = sStart + ((bi + 1) / beats.length) * sDur;
      }
      beats[bi].fin_beat = beats[bi + 1].inicio_beat;
    }
    if (beats.length > 0) {
      beats[0].inicio_beat = sStart;
      beats[beats.length - 1].fin_beat = sEnd;
    }
  });

  for (let i = 0; i < allChunks.length - 1; i++) {
    if (allChunks[i].end > allChunks[i + 1].start) allChunks[i].end = allChunks[i + 1].start;
    else if (allChunks[i + 1].start - allChunks[i].end < 0.12) allChunks[i].end = allChunks[i + 1].start;
  }
  return allChunks;
}

// ============================================================================
// 2. SINTETIZADOR CHIPTUNE SINCRONIZADO AL MILISEGUNDO CON CADA MICRO-PLANO
// ============================================================================
function buildChiptuneSfxTrack(escenas, totalDuration, videoHash) {
  const allTypes = [
    'coin_8bit', 'laser_8bit', 'explosion_8bit', 'powerup_8bit', 'alarm_8bit',
    'glitch_8bit', 'jump_8bit', 'error_8bit', 'typing_8bit', 'level_clear_8bit'
  ];

  function get8BitRecipe(type, pitchMod) {
    const p = pitchMod.toFixed(3);
    const catalog = {
      coin_8bit: { expr: `0.16*(lt(t,0.08)*sgn(sin(2*PI*987.77*${p}*t))+gt(t,0.08)*exp(-6*(t-0.08))*sgn(sin(2*PI*1318.51*${p}*t)))`, dur: 0.36 },
      laser_8bit: { expr: `0.14*exp(-5*t)*sgn(sin(2*PI*(1200*${p}*exp(-6*t)+120)*t))`, dur: 0.28 },
      explosion_8bit: { expr: `0.22*exp(-4.5*t)*(sgn(sin(2*PI*75*exp(-2*t)*t))*sin(2*PI*19*t)+0.5*sgn(sin(2*PI*230*t)*sin(2*PI*53*t)))`, dur: 0.55 },
      powerup_8bit: { expr: `0.14*(lt(t,0.07)*sgn(sin(2*PI*330*${p}*t))+between(t,0.07,0.14)*sgn(sin(2*PI*392*${p}*t))+between(t,0.14,0.21)*sgn(sin(2*PI*659*${p}*t))+gt(t,0.21)*exp(-5*(t-0.21))*sgn(sin(2*PI*523*${p}*t)))`, dur: 0.40 },
      alarm_8bit: { expr: `0.14*exp(-1.5*t)*sgn(sin(2*PI*(680+220*sgn(sin(2*PI*8*t)))*t))`, dur: 0.45 },
      glitch_8bit: { expr: `0.14*exp(-6*t)*sgn(sin(2*PI*440*${p}*t)*sin(2*PI*67*t)+sin(2*PI*1120*t)*sin(2*PI*29*t))`, dur: 0.30 },
      jump_8bit: { expr: `0.15*exp(-4*t)*sgn(sin(2*PI*(180*${p}+520*t)*t))`, dur: 0.26 },
      error_8bit: { expr: `0.18*exp(-4*t)*(lt(t,0.14)*sgn(sin(2*PI*165*${p}*t))+gt(t,0.14)*sgn(sin(2*PI*130.8*${p}*t)))`, dur: 0.38 },
      typing_8bit: { expr: `0.13*(exp(-40*t)*sgn(sin(2*PI*1400*t))+gt(t,0.09)*exp(-40*(t-0.09))*sgn(sin(2*PI*1650*t))+gt(t,0.18)*exp(-40*(t-0.18))*sgn(sin(2*PI*1300*t)))`, dur: 0.26 },
      level_clear_8bit: { expr: `0.14*exp(-2.8*t)*(sgn(sin(2*PI*523.25*${p}*t))+0.7*sgn(sin(2*PI*659.25*${p}*t))+0.5*sgn(sin(2*PI*783.99*${p}*t)))`, dur: 0.50 }
    };
    return catalog[type] || catalog.coin_8bit;
  }

  const inputs = [];
  const filterParts = [];
  let sfxIndex = 0;

  escenas.forEach((esc, idx) => {
    const beats = Array.isArray(esc.sub_escenas) && esc.sub_escenas.length > 0 ? esc.sub_escenas : [esc];

    beats.forEach((beat, bIdx) => {
      let rawType = String(beat.sfx || esc.sfx || '').toLowerCase().trim();
      if (!allTypes.includes(rawType)) {
        rawType = allTypes[(videoHash + sfxIndex * 3) % allTypes.length];
      }
      const pitchMod = 0.90 + (((videoHash + sfxIndex * 13) % 21) / 100);
      const recipe = get8BitRecipe(rawType, pitchMod);
      const beatStartSec = (idx === 0 && bIdx === 0) ? 0.04 : Math.max(0.05, Number(beat.inicio_beat ?? esc.inicio) || 0);
      const delayMs = Math.round(beatStartSec * 1000);

      inputs.push(`-f lavfi -i "aevalsrc='${recipe.expr}':s=44100:d=${recipe.dur}"`);
      filterParts.push(`[${sfxIndex}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration.toFixed(3)}[s${sfxIndex}]`);
      sfxIndex++;
    });
  });

  if (inputs.length === 0) return false;
  const mixLabels = Array.from({ length: sfxIndex }, (_, i) => `[s${i}]`).join('');
  const filterComplex = `${filterParts.join(';')};${mixLabels}amix=inputs=${sfxIndex}:duration=longest:dropout_transition=0:normalize=0[sfxout]`;

  try {
    execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`, { stdio: 'ignore' });
  } catch (err) {
    return false;
  }
  return fs.existsSync('hook_sfx.wav') && fs.statSync('hook_sfx.wav').size > 1000;
}

// ============================================================================
// 3. MOTOR PIXEL-ART v20.1 (BARRA NO LINEAL + MAPEO CONTEXTUAL 5 PISTAS SUNO)
// ============================================================================
const MUSIC_STYLE_TO_INDEX = {
  HEIST: 1,
  DISASTER: 2,
  MYSTERY: 3,
  UNDERGROUND: 4,
  CLIMAX: 5
};

async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload v20.1 desde URL...');
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

  const escenas = (payload.escenas || []).map((esc, idx) => {
    const rawBeats = Array.isArray(esc.sub_escenas) && esc.sub_escenas.length > 0
      ? esc.sub_escenas
      : [{ texto_1: esc.texto_1, bg_code: esc.bg_code, fg_code: esc.fg_code, sfx: esc.sfx }];

    const cleanBeats = rawBeats.map((b) => ({
      ...b,
      texto_1: cleanArcadeText(b.texto_1 || esc.texto_1 || payload.tema_titulo || `ACTO 0${idx + 1}`)
    }));

    return {
      ...esc,
      subtitulo: fixSpanishN(esc.subtitulo || ''),
      texto_1: cleanBeats[0].texto_1,
      sub_escenas: cleanBeats
    };
  });

  const customSpritesDict = payload.custom_sprites || {};
  const customRigsDict = payload.custom_rigs || {};
  const subtitleChunks = buildSubtitleChunksAndBeatTimings(escenas, payload.alignment, duracionExactaVideo);

  // ==========================================================================
  // SELECCIÓN INTELIGENTE DE LAS 5 PISTAS DE MÚSICA (bg_music_1.mp3 .. bg_music_5.mp3)
  // ==========================================================================
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenas, duracionExactaVideo, hash); } catch (e) {}

    const styleKey = String(payload.music_style || '').toUpperCase().trim();
    const mappedFromStyle = MUSIC_STYLE_TO_INDEX[styleKey];
    const trackIdx = Math.max(
      1,
      Math.min(5, mappedFromStyle || Number(payload.music_track_index) || ((hash % 5) + 1))
    );

    const candidateFiles = [
      path.resolve(`bg_music_${trackIdx}.mp3`),
      path.resolve(__dirname, `bg_music_${trackIdx}.mp3`),
      path.resolve(__dirname, `../bg_music_${trackIdx}.mp3`),
      path.resolve(__dirname, '../bg_music2.mp3'),
      path.resolve('bg_music2.mp3'),
      path.resolve(__dirname, '../bg_music.mp3'),
      path.resolve('bg_music.mp3')
    ];

    const bgMusicPath = candidateFiles.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);

    if (bgMusicPath) {
      console.log(`🎵 Usando pista musical (#${trackIdx} - ${styleKey || 'AUTO'}): ${path.basename(bgMusicPath)}`);
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
  const safeRigsJson = JSON.stringify(customRigsDict).replace(/<\/script>/gi, '<\\/script>');
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
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.12) 50%);
        background-size: 100% 8px;
        z-index: 10; pointer-events: none;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000, #00f2fe);
        width: 0%; z-index: 30;
      }
      .label-box-top {
        position: absolute; top: 42px; left: 50%; transform: translateX(-50%);
        background: rgba(8, 10, 22, 0.94);
        border: 4px solid #00f2fe;
        outline: 4px solid #000000;
        box-shadow: 0 10px 0 rgba(0,0,0,0.8);
        padding: 14px 26px; color: #ffd166; font-size: 22px;
        text-transform: uppercase; white-space: nowrap; letter-spacing: 1.5px;
        text-shadow: 3px 3px 0 #000000; z-index: 20;
        max-width: 668px; overflow: hidden; text-align: center;
      }
      .retro-enie {
        position: relative;
        display: inline-block;
      }
      .retro-enie::after {
        content: '';
        position: absolute;
        top: -0.26em;
        left: 8%;
        width: 76%;
        height: 0.13em;
        background: currentColor;
        box-shadow: 3px 3px 0 #000000;
      }
      .subtitle-container {
        position: absolute; bottom: 72px; left: 26px; right: 26px;
        min-height: 150px; display: flex; justify-content: center; align-items: center;
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
    <div class="label-box-top" id="label-top">HISTORIA</div>

    <canvas id="pixel-canvas" width="720" height="1280"></canvas>
    <div class="crt-scanlines"></div>

    <div class="subtitle-container">
      <div class="subtitle-box" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${safeEscenasJson};
      const customSprites = ${safeSpritesJson};
      const customRigsRaw = ${safeRigsJson};
      const subtitleChunks = ${safeChunksJson};
      const totalFrames = ${totalFrames};

      const COLS = 120;
      const ROWS = 213;
      const CELL = 6;
      const GROUND_Y = 152;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#1e293b'));
      let dataTextOverlayQueue = [];

      let transformStack = [{ tx: 0, ty: 0, scale: 1, rad: 0, flipX: false }];

      function mapPoint(lx, ly) {
        let x = lx, y = ly;
        for (let i = transformStack.length - 1; i >= 1; i--) {
          const t = transformStack[i];
          const fx = t.flipX ? -x : x;
          const sx = fx * t.scale;
          const sy = y * t.scale;
          const cosA = Math.cos(t.rad), sinA = Math.sin(t.rad);
          const rx = sx * cosA - sy * sinA;
          const ry = sx * sinA + sy * cosA;
          x = rx + t.tx;
          y = ry + t.ty;
        }
        return [Math.round(x), Math.round(y)];
      }

      function withGroup(cx, cy, scale = 1.0, angleDeg = 0, flipX = false, drawCallback) {
        if (typeof scale === 'function') {
          drawCallback = scale;
          scale = 1.0; angleDeg = 0; flipX = false;
        } else if (typeof angleDeg === 'function') {
          drawCallback = angleDeg;
          angleDeg = 0; flipX = false;
        } else if (typeof flipX === 'function') {
          drawCallback = flipX;
          flipX = false;
        }
        transformStack.push({
          tx: Number(cx) || 0,
          ty: Number(cy) || 0,
          scale: Math.max(0.15, Math.min(4.0, Number(scale) || 1.0)),
          rad: ((Number(angleDeg) || 0) * Math.PI) / 180,
          flipX: !!flipX
        });
        try {
          if (typeof drawCallback === 'function') drawCallback();
        } finally {
          transformStack.pop();
        }
      }

      function toRetroHtml(str) {
        const clean = String(str || '').toUpperCase()
          .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E')
          .replace(/[ÍÌÏÎ]/g, 'I').replace(/[ÓÒÖÔ]/g, 'O')
          .replace(/[ÚÙÜÛ]/g, 'U').trim();
        return clean.replace(/Ñ/g, '<span class="retro-enie">N</span>');
      }

      function updateTopBanner(textStr) {
        const el = document.getElementById('label-top');
        const clean = String(textStr || 'HISTORIA').trim();
        let size = 22;
        if (clean.length > 26) size = 14;
        else if (clean.length > 22) size = 16;
        else if (clean.length > 18) size = 18;
        else if (clean.length > 14) size = 20;
        el.style.fontSize = size + 'px';
        el.innerHTML = toRetroHtml(clean);
      }

      // ======================================================================
      // 1. PRIMITIVAS CON SOPORTE DE TRANSFORMACIÓN LOCAL Y VOLUMETRÍA 16-BIT
      // ======================================================================
      function setPxRaw(gx, gy, color) {
        const cx = Math.round(gx);
        const cy = Math.round(gy);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && color) {
          grid[cy][cx] = color;
        }
      }

      function setPx(x, y, color) {
        if (!color) return;
        if (transformStack.length === 1) {
          setPxRaw(x, y, color);
        } else {
          const [gx, gy] = mapPoint(x, y);
          setPxRaw(gx, gy, color);
        }
      }

      function fillPolygonRaw(pts, fillColor, borderColor = '#0b0c10') {
        if (!Array.isArray(pts) || pts.length < 3) return;
        let minY = ROWS, maxY = 0;
        pts.forEach(p => {
          if (p[1] < minY) minY = Math.floor(p[1]);
          if (p[1] > maxY) maxY = Math.ceil(p[1]);
        });
        minY = Math.max(0, minY);
        maxY = Math.min(ROWS - 1, maxY);

        for (let y = minY; y <= maxY; y++) {
          const nodes = [];
          let j = pts.length - 1;
          for (let i = 0; i < pts.length; i++) {
            const yi = pts[i][1], yj = pts[j][1];
            const xi = pts[i][0], xj = pts[j][0];
            if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
              nodes.push(xi + (y - yi) / (yj - yi) * (xj - xi));
            }
            j = i;
          }
          nodes.sort((a, b) => a - b);
          for (let i = 0; i < nodes.length; i += 2) {
            if (nodes[i + 1] !== undefined) {
              for (let x = Math.round(nodes[i]); x <= Math.round(nodes[i + 1]); x++) {
                setPxRaw(x, y, fillColor);
              }
            }
          }
        }
        if (borderColor) {
          for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            drawLineRaw(p1[0], p1[1], p2[0], p2[1], 1, borderColor);
          }
        }
      }

      function drawLineRaw(x0, y0, x1, y1, thickness = 1, color = '#ffffff') {
        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let cx = Math.round(x0), cy = Math.round(y0);
        const ex = Math.round(x1), ey = Math.round(y1);
        const t = Math.max(1, Math.round(thickness));
        for (let i = 0; i < 300; i++) {
          for (let r = 0; r < t; r++) {
            for (let c = 0; c < t; c++) {
              setPxRaw(cx - Math.floor(t / 2) + c, cy - Math.floor(t / 2) + r, color);
            }
          }
          if (cx === ex && cy === ey) break;
          let e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }

      function fillRect(x, y, w, h, color) {
        if (transformStack.length === 1) {
          const x0 = Math.round(x), y0 = Math.round(y);
          const rw = Math.min(120, Math.round(w)), rh = Math.min(140, Math.round(h));
          for (let r = 0; r < rh; r++) {
            for (let c = 0; c < rw; c++) setPxRaw(x0 + c, y0 + r, color);
          }
        } else {
          const p1 = mapPoint(x, y);
          const p2 = mapPoint(x + w, y);
          const p3 = mapPoint(x + w, y + h);
          const p4 = mapPoint(x, y + h);
          fillPolygonRaw([p1, p2, p3, p4], color, null);
        }
      }

      function fillBorderedRect(x, y, w, h, fillColor, borderColor = '#0b0c10') {
        if (transformStack.length === 1) {
          const rw = Math.min(118, Math.round(w)), rh = Math.min(130, Math.round(h));
          fillRect(x, y, rw, rh, borderColor);
          if (rw > 2 && rh > 2) {
            fillRect(x + 1, y + 1, rw - 2, rh - 2, fillColor);
          }
        } else {
          const p1 = mapPoint(x, y);
          const p2 = mapPoint(x + w, y);
          const p3 = mapPoint(x + w, y + h);
          const p4 = mapPoint(x, y + h);
          fillPolygonRaw([p1, p2, p3, p4], fillColor, borderColor);
        }
      }

      function drawVolumetricBox(x, y, w, h, baseColor = '#3b82f6', highlightColor = '#60a5fa', shadowColor = '#1d4ed8', borderColor = '#0b0c10') {
        fillBorderedRect(x, y, w, h, baseColor, borderColor);
        if (w > 4 && h > 4) {
          fillRect(x + 1, y + 1, w - 2, 2, highlightColor);
          fillRect(x + 1, y + 1, 2, h - 2, highlightColor);
          fillRect(x + 1, y + h - 3, w - 2, 2, shadowColor);
          fillRect(x + w - 3, y + 1, 2, h - 2, shadowColor);
        }
      }

      function fillCircle(cx, cy, radius, color) {
        const [gx, gy] = mapPoint(cx, cy);
        const effScale = transformStack.reduce((acc, t) => acc * t.scale, 1);
        const rInt = Math.min(54, Math.max(1, Math.round(radius * effScale)));
        for (let r = -rInt; r <= rInt; r++) {
          for (let c = -rInt; c <= rInt; c++) {
            if (c * c + r * r <= rInt * rInt) setPxRaw(gx + c, gy + r, color);
          }
        }
      }

      function fillBorderedCircle(cx, cy, radius, fillColor, borderColor = '#0b0c10') {
        const [gx, gy] = mapPoint(cx, cy);
        const effScale = transformStack.reduce((acc, t) => acc * t.scale, 1);
        const rInt = Math.min(54, Math.max(1, Math.round(radius * effScale)));
        for (let r = -rInt; r <= rInt; r++) {
          for (let c = -rInt; c <= rInt; c++) {
            if (c * c + r * r <= rInt * rInt) setPxRaw(gx + c, gy + r, borderColor);
          }
        }
        if (rInt > 1) {
          const rIn = rInt - 1;
          for (let r = -rIn; r <= rIn; r++) {
            for (let c = -rIn; c <= rIn; c++) {
              if (c * c + r * r <= rIn * rIn) setPxRaw(gx + c, gy + r, fillColor);
            }
          }
        }
      }

      function drawRing(cx, cy, radius, thickness = 2, color = '#fde047') {
        const [gx, gy] = mapPoint(cx, cy);
        const effScale = transformStack.reduce((acc, t) => acc * t.scale, 1);
        const rOut = Math.min(56, Math.round(radius * effScale));
        const rIn = Math.max(0, rOut - Math.max(1, Math.round(thickness * effScale)));
        for (let r = -rOut; r <= rOut; r++) {
          for (let c = -rOut; c <= rOut; c++) {
            const d2 = c * c + r * r;
            if (d2 <= rOut * rOut && d2 >= rIn * rIn) setPxRaw(gx + c, gy + r, color);
          }
        }
      }

      function drawPixelLine(x0, y0, x1, y1, thickness = 2, color = '#ffffff') {
        const [gx0, gy0] = mapPoint(x0, y0);
        const [gx1, gy1] = mapPoint(x1, y1);
        drawLineRaw(gx0, gy0, gx1, gy1, thickness, color);
      }

      function fillPolygon(points, fillColor, borderColor = '#0b0c10') {
        if (!Array.isArray(points) || points.length < 3) return;
        const mapped = points.map(p => mapPoint(p[0], p[1]));
        fillPolygonRaw(mapped, fillColor, borderColor);
      }

      function fillTriangle(x1, y1, x2, y2, x3, y3, fillColor, borderColor = '#0b0c10') {
        fillPolygon([[x1, y1], [x2, y2], [x3, y3]], fillColor, borderColor);
      }

      // ======================================================================
      // 2. FÍSICAS DIRECCIONALES Y EMISORES VECTORIALES
      // ======================================================================
      function drawExhaust(nozzleX, nozzleY, angleDeg = 180, length = 16, width = 8, localFrame = 0) {
        const rad = (angleDeg * Math.PI) / 180;
        const perpRad = rad + Math.PI / 2;
        const pulse = 0.8 + 0.35 * Math.abs(Math.sin(localFrame * 0.6));
        const lenOuter = length * pulse;
        const lenMid = lenOuter * 0.68;
        const lenCore = lenOuter * 0.38;

        const makeCone = (L, W) => [
          [nozzleX + Math.cos(perpRad) * (W / 2), nozzleY + Math.sin(perpRad) * (W / 2)],
          [nozzleX - Math.cos(perpRad) * (W / 2), nozzleY - Math.sin(perpRad) * (W / 2)],
          [nozzleX + Math.cos(rad) * L, nozzleY + Math.sin(rad) * L]
        ];

        fillPolygon(makeCone(lenOuter, width), '#dc2626', null);
        fillPolygon(makeCone(lenMid, width * 0.72), '#f97316', null);
        fillPolygon(makeCone(lenCore, width * 0.45), '#fef08a', null);

        for (let i = 1; i <= 4; i++) {
          const dist = lenOuter + ((localFrame * 2 + i * 5) % 14);
          const spread = Math.sin(localFrame * 0.4 + i * 2) * (width * 0.45);
          const px = nozzleX + Math.cos(rad) * dist + Math.cos(perpRad) * spread;
          const py = nozzleY + Math.sin(rad) * dist + Math.sin(perpRad) * spread;
          fillCircle(px, py, 1.5, i % 2 === 0 ? '#fde047' : '#94a3b8');
        }
      }

      function drawFire(x, y, w = 16, h = 14, localFrame = 0, angleDeg = -90) {
        if (angleDeg !== -90) {
          drawExhaust(x + w / 2, y, angleDeg, h, w, localFrame);
          return;
        }
        for (let c = 0; c < w; c += 2) {
          const fh = Math.max(4, Math.round(h * (0.5 + 0.5 * Math.abs(Math.sin(localFrame * 0.35 + c)))));
          fillRect(x + c, y - fh, 2, fh, '#dc2626');
          fillRect(x + c, y - Math.floor(fh * 0.65), 2, Math.floor(fh * 0.65), '#f97316');
          fillRect(x + c, y - Math.floor(fh * 0.35), 2, Math.floor(fh * 0.35), '#fde047');
        }
      }

      // ======================================================================
      // 3. MICRO-TIPOGRAFÍA DE DATOS EN LIENZO (PARA MONITORES, NOTAS Y PIZARRAS)
      // ======================================================================
      function drawDataText(textStr, x, y, color = '#fde047', size = 1, bgColor = 'rgba(8,10,20,0.88)') {
        const clean = cleanArcadeText(String(textStr ?? '')).slice(0, 22);
        if (!clean) return;
        const [gx, gy] = mapPoint(x, y);
        dataTextOverlayQueue.push({
          text: clean,
          x: Math.max(10, Math.min(110, gx)) * CELL,
          y: Math.max(28, Math.min(156, gy)) * CELL,
          color: color || '#fde047',
          fontSize: size >= 2 ? 17 : (size <= 0.8 ? 11 : 14),
          bgColor
        });
      }

      // ======================================================================
      // 4. ESCENARIOS BASE Y UTILIDADES MATEMÁTICAS DE ANIMACIÓN
      // ======================================================================
      function drawSky(skyTop = '#1d4ed8', skyMid = '#3b82f6', skyBot = '#93c5fd', groundCol = '#334155', horizonY = GROUND_Y) {
        const hY = Math.max(40, Math.min(175, Math.round(horizonY)));
        const bands = [skyTop, skyMid, skyBot];
        const bandH = Math.max(1, Math.ceil(hY / bands.length));
        for (let r = 0; r < hY; r++) {
          const bIdx = Math.min(bands.length - 1, Math.floor(r / bandH));
          const nextIdx = Math.min(bands.length - 1, bIdx + 1);
          const ratio = (r % bandH) / bandH;
          for (let c = 0; c < COLS; c++) {
            let col = bands[bIdx];
            if (ratio > 0.72 && ((r + c) % 2 === 0)) col = bands[nextIdx];
            grid[r][c] = col;
          }
        }
        fillRect(0, hY, COLS, 2, '#0b0c10');
        fillRect(0, hY + 2, COLS, 3, '#64748b');
        fillRect(0, hY + 5, COLS, ROWS - hY - 5, groundCol);
      }

      function drawRoom(wallCol = '#334155', panelCol = '#1e293b', floorCol = '#78350f', groundY = GROUND_Y) {
        const gY = Math.max(60, Math.min(175, Math.round(groundY)));
        fillRect(0, 0, COLS, gY, wallCol);
        for (let c = 6; c < COLS - 6; c += 24) {
          fillBorderedRect(c, 32, 18, gY - 52, panelCol, 'rgba(0,0,0,0.35)');
        }
        fillBorderedRect(0, gY - 16, COLS, 16, '#451a03', '#0b0c10');
        fillBorderedRect(0, gY - 18, COLS, 3, '#d97706', '#0b0c10');
        fillRect(0, gY, COLS, ROWS - gY, floorCol);
      }

      function drawOcean(waterY = 118, waterCol = '#0284c7', foamCol = '#bae6fd', localFrame = 0) {
        for (let c = 0; c < COLS; c++) {
          const waveH = Math.round(Math.sin(c * 0.2 + localFrame * 0.25) * 2);
          const wy = waterY + waveH;
          fillRect(c, wy, 1, ROWS - wy, waterCol);
          setPxRaw(c, wy, foamCol);
        }
      }

      function drawExplosion(cx, cy, maxRadius = 28, progress = 0.5, localFrame = 0) {
        const p = Math.max(0.15, Math.min(1, progress * 1.35));
        const rOuter = Math.round(maxRadius * p);
        const rMid = Math.round(rOuter * 0.72);
        const rCore = Math.round(rOuter * 0.42);

        drawRing(cx, cy, Math.min(46, rOuter + 5), 2, '#fde047');
        fillBorderedCircle(cx, cy, rOuter, '#dc2626', '#0b0c10');
        fillCircle(cx, cy, rMid, '#f97316');
        fillCircle(cx, cy, rCore, (localFrame % 4 < 2) ? '#ffffff' : '#fef08a');
      }

      function drawStars(count = 20, localFrame = 0) {
        for (let i = 0; i < count; i++) {
          const sx = (i * 19 + 7) % COLS;
          const sy = 30 + (i * 11) % 75;
          if ((Math.floor(localFrame / 6) + i) % 3 !== 0) {
            setPxRaw(sx, sy, i % 4 === 0 ? '#fde047' : '#ffffff');
          }
        }
      }

      function drawClouds(count = 3, speed = 0.4, localFrame = 0, yMin = 42) {
        for (let i = 0; i < count; i++) {
          const cx = ((i * 38 - Math.floor(localFrame * speed)) % (COLS + 24) + (COLS + 24)) % (COLS + 24) - 12;
          const cy = yMin + (i % 3) * 12;
          fillBorderedRect(cx, cy, 18, 5, '#ffffff', '#cbd5e1');
          fillRect(cx + 4, cy - 3, 10, 4, '#ffffff');
        }
      }

      function drawCustomSprite(spriteName, centerX, centerY, scale = 1.25, flipX = false, localFrame = 0) {
        const key = String(spriteName || '').toLowerCase().trim();
        const def = customSprites[key] || Object.values(customSprites)[0];
        if (!def) return;
        const useFrame2 = (Math.floor(localFrame / 5) % 2 === 1) && Array.isArray(def.rows_2) && def.rows_2.length > 0;
        const rows = useFrame2 ? def.rows_2 : (def.rows_1 || def.rows || []);
        if (!Array.isArray(rows) || rows.length === 0) return;

        const pal = def.palette || { '1': '#ffd166', '2': '#ffffff', '3': '#ef4444', '4': '#38bdf8', '5': '#475569' };
        const h = rows.length;
        const w = String(rows[0]).length;
        const destH = Math.max(6, Math.round(h * scale));
        const destW = Math.max(6, Math.round(w * scale));
        const [gx, gy] = mapPoint(centerX, centerY);
        const x0 = Math.round(gx - destW / 2);
        const y0 = Math.round(gy - destH / 2);

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

        for (let r = 1; r <= destH; r++) {
          for (let c = 1; c <= destW; c++) {
            if (!temp[r][c]) {
              if (temp[r - 1][c] || temp[r + 1][c] || temp[r][c - 1] || temp[r][c + 1]) {
                setPxRaw(x0 + c - 1, y0 + r - 1, '#0b0c10');
              }
            }
          }
        }
        for (let r = 1; r <= destH; r++) {
          for (let c = 1; c <= destW; c++) {
            if (temp[r][c]) {
              setPxRaw(x0 + c - 1, y0 + r - 1, temp[r][c]);
            }
          }
        }
      }

      // COMPILADOR DE RIGS PROCEDURALES
      const compiledRigs = {};
      for (const [rigName, rigCode] of Object.entries(customRigsRaw || {})) {
        if (typeof rigCode === 'string' && rigCode.trim().length > 5) {
          try {
            compiledRigs[rigName.toLowerCase().trim()] = new Function(
              'api', 'state', 'progress', 'localFrame',
              \`with (api) { \${rigCode} }\`
            );
          } catch (e) {
            console.warn('⚠️ Error compilando rig ' + rigName + ':', e.message);
          }
        }
      }

      function drawRig(rigName, cx, cy, scale = 1.0, angleDeg = 0, flipX = false, state = 'idle', progress = 0.5, localFrame = 0) {
        const key = String(rigName || '').toLowerCase().trim();
        const fn = compiledRigs[key] || Object.values(compiledRigs)[0];
        if (!fn) {
          drawCustomSprite(key, cx, cy, scale, flipX, localFrame);
          return;
        }
        withGroup(cx, cy, scale, angleDeg, flipX, () => {
          try {
            fn(sandboxApi, state, progress, localFrame);
          } catch (e) {}
        });
      }

      const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
      const easeOut = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
      const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const sandboxApi = {
        COLS, ROWS, GROUND_Y,
        withGroup, group: withGroup,
        setPx, px: setPx,
        fillRect, rect: fillRect,
        fillBorderedRect, borderedRect: fillBorderedRect, box: fillBorderedRect,
        drawVolumetricBox, volumetricBox: drawVolumetricBox, bevelBox: drawVolumetricBox,
        fillCircle, circle: fillCircle,
        fillBorderedCircle, borderedCircle: fillBorderedCircle,
        drawRing, ring: drawRing,
        drawPixelLine, line: drawPixelLine,
        fillPolygon, polygon: fillPolygon,
        fillTriangle, triangle: fillTriangle,
        drawExhaust, exhaust: drawExhaust, jetFlame: drawExhaust,
        drawFire, fire: drawFire,
        drawDataText, dataText: drawDataText, text: drawDataText, label: drawDataText,
        drawText: drawDataText, fillText: drawDataText, drawScreenText: drawDataText, drawTinyText: drawDataText, print: drawDataText,
        drawSky, sky: drawSky,
        drawRoom, room: drawRoom,
        drawOcean, ocean: drawOcean,
        drawExplosion, explosion: drawExplosion,
        drawStars, stars: drawStars,
        drawClouds, clouds: drawClouds,
        drawCustomSprite, customSprite: drawCustomSprite,
        drawRig, rig: drawRig,
        lerp, easeOut, easeInOut,
        sin: Math.sin, cos: Math.cos, abs: Math.abs, floor: Math.floor,
        round: Math.round, min: Math.min, max: Math.max, PI: Math.PI
      };

      const compiledSceneBeats = escenas.map((esc) => {
        const beats = Array.isArray(esc.sub_escenas) && esc.sub_escenas.length > 0 ? esc.sub_escenas : [esc];
        return beats.map((b) => {
          let bgFn = null, fgFn = null;
          if (b.bg_code && typeof b.bg_code === 'string' && b.bg_code.trim().length > 5) {
            try { bgFn = new Function('api', 'progress', 'localFrame', \`with (api) { \${b.bg_code} }\`); } catch (e) {}
          }
          const code = b.fg_code || b.js_code || '';
          if (code && typeof code === 'string' && code.trim().length > 5) {
            try { fgFn = new Function('api', 'progress', 'localFrame', \`with (api) { \${code} }\`); } catch (e) {}
          }
          return {
            bgFn,
            fgFn,
            texto_1: b.texto_1 || esc.texto_1,
            inicio_beat: b.inicio_beat ?? esc.inicio,
            fin_beat: b.fin_beat ?? esc.fin
          };
        });
      });

      function flushGridToCanvas() {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            ctx.fillStyle = grid[r][c];
            ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
          }
        }
        if (dataTextOverlayQueue.length > 0) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          dataTextOverlayQueue.forEach(item => {
            const rawStr = item.text;
            const displayStr = rawStr.replace(/Ñ/g, 'N');
            let fSize = item.fontSize;
            ctx.font = \`\${fSize}px "Press Start 2P", monospace\`;
            while (ctx.measureText(displayStr).width > 580 && fSize > 9) {
              fSize -= 1;
              ctx.font = \`\${fSize}px "Press Start 2P", monospace\`;
            }
            const totalW = ctx.measureText(displayStr).width;
            const padX = 8, padY = 6;
            const bw = totalW + padX * 2;
            const bh = fSize + padY * 2;
            const safeX = Math.max(bw / 2 + 10, Math.min(720 - bw / 2 - 10, item.x));
            const safeY = Math.max(130, Math.min(920, item.y));

            if (item.bgColor) {
              ctx.fillStyle = item.bgColor;
              ctx.fillRect(safeX - bw / 2, safeY - bh / 2, bw, bh);
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 3;
              ctx.strokeRect(safeX - bw / 2, safeY - bh / 2, bw, bh);
            }
            ctx.fillStyle = '#000000';
            ctx.fillText(displayStr, safeX + 2, safeY + 2);
            ctx.fillStyle = item.color;
            ctx.fillText(displayStr, safeX, safeY);

            for (let i = 0; i < rawStr.length; i++) {
              if (rawStr[i] === 'Ñ') {
                const prefixW = ctx.measureText(displayStr.slice(0, i)).width;
                const charW = ctx.measureText('N').width;
                const tildeX = (safeX - totalW / 2) + prefixW + charW * 0.1;
                const tildeY = safeY - fSize * 0.68;
                ctx.fillStyle = '#000000';
                ctx.fillRect(tildeX + 2, tildeY + 2, charW * 0.78, Math.max(2, fSize * 0.16));
                ctx.fillStyle = item.color;
                ctx.fillRect(tildeX, tildeY, charW * 0.78, Math.max(2, fSize * 0.16));
              }
            }
          });
          ctx.restore();
        }
      }

      const subBox = document.getElementById('sub-box');
      let lastChunkIdx = -2;
      let lastBeatKey = '';

      window.setFrameData = function(frameIdx, t) {
        const linearRatio = (frameIdx + 1) / totalFrames;
        // CURVA DE RETENCIÓN NO LINEAL: Avanza rápido al principio y desacelera hacia el final
        const curvedRatio = 1 - Math.pow(1 - linearRatio, 2.35);
        document.getElementById('pbar').style.width = Math.min(100, curvedRatio * 100) + '%';

        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        const esc = escenas[activeIdx] || {};
        const beats = compiledSceneBeats[activeIdx] || [];
        const numBeats = Math.max(1, beats.length);

        let beatIdx = beats.findIndex((b, bi) => {
          if (bi === numBeats - 1) return t >= b.inicio_beat;
          return t >= b.inicio_beat && t < b.fin_beat;
        });
        if (beatIdx === -1) beatIdx = 0;

        const activeBeat = beats[beatIdx] || {};
        const bStart = Number(activeBeat.inicio_beat ?? esc.inicio) || 0;
        const bEnd = Number(activeBeat.fin_beat ?? esc.fin) || (bStart + 2);
        const beatDur = Math.max(0.25, bEnd - bStart);
        const beatLocalT = Math.max(0, t - bStart);
        const beatProgress = Math.max(0, Math.min(1, beatLocalT / beatDur));
        const beatLocalFrame = Math.floor(beatLocalT * 30);

        const beatKey = activeIdx + '_' + beatIdx;

        if (beatKey !== lastBeatKey) {
          lastBeatKey = beatKey;
          updateTopBanner(activeBeat.texto_1 || esc.texto_1 || 'HISTORIA');
        }

        transformStack = [{ tx: 0, ty: 0, scale: 1, rad: 0, flipX: false }];
        dataTextOverlayQueue = [];
        drawSky('#0f172a', '#1e293b', '#334155', '#1e293b', GROUND_Y);

        if (activeBeat.bgFn) {
          try { activeBeat.bgFn(sandboxApi, beatProgress, beatLocalFrame); } catch (e) {}
        }

        transformStack = [{ tx: 0, ty: 0, scale: 1, rad: 0, flipX: false }];
        if (activeBeat.fgFn) {
          try { activeBeat.fgFn(sandboxApi, beatProgress, beatLocalFrame); } catch (e) {}
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

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Ultra-Ágil v20.1 (${duracionExactaVideo.toFixed(2)}s)...`);
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

  console.log('🔊 Ensamblando MP4 final v20.1...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Pixel-Art Studio v20.1 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
