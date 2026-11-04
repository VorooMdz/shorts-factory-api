const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. DESCARGA Y RESOLUCIÓN DE SPRITES SÓLIDOS A COLOR (ICONIFY)
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

function fetchText(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(null));
  });
}

const ES_TO_EN_MAP = {
  'perro': 'dog', 'pelota': 'tennis', 'avion': 'airplane', 'cohete': 'rocket',
  'virus': 'biohazard', 'calavera': 'skull', 'esqueleto': 'skull', 'mago': 'mage',
  'espada': 'crossed-swords', 'escudo': 'shield', 'chip': 'microchip', 'reloj': 'stopwatch',
  'ordenador': 'laptop', 'servidor': 'desktop-computer', 'dinero': 'money-bag', 'moneda': 'coin',
  'banco': 'bank', 'fuego': 'fire', 'explosion': 'collision', 'alerta': 'warning',
  'medico': 'health-worker', 'hospital': 'hospital', 'coche': 'automobile', 'camion': 'delivery-truck',
  'tren': 'high-speed-train', 'barco': 'ship', 'mundo': 'globe-showing-americas', 'ciencia': 'microscope',
  'dragon': 'dragon', 'gato': 'cat', 'leon': 'lion', 'comida': 'hamburger', 'pizza': 'pizza',
  'corazon': 'red-heart', 'cerebro': 'brain', 'robot': 'robot', 'telefono': 'telephone',
  'satelite': 'satellite', 'bomba': 'bomb', 'llave': 'key', 'candado': 'locked', 'trofeo': 'trophy',
  'silbato': 'postal-horn', 'cereal': 'bowl-with-spoon', 'caja': 'package', 'casa-blanca': 'classical-building',
  'antena': 'satellite-antenna', 'altavoz': 'loudspeaker', 'musica': 'musical-note', 'hacker': 'detective'
};

const FALLBACK_COLOR_ICONS = [
  'telephone', 'package', 'loudspeaker', 'satellite-antenna', 'laptop',
  'globe-showing-americas', 'classical-building', 'detective', 'trophy',
  'rocket', 'microscope', 'money-bag', 'stopwatch', 'shield', 'key',
  'locked', 'bomb', 'fire', 'high-voltage', 'gear', 'magnet', 'compass',
  'crystal-ball', 'joystick', 'video-game', 'battery', 'light-bulb', 'crown'
];

async function resolveSvgForPixelArt(rawQuery) {
  let q = String(rawQuery || 'sparkles').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_:\s-]/g, '').trim();

  if (ES_TO_EN_MAP[q]) q = ES_TO_EN_MAP[q];
  const cleanName = q.includes(':') ? q.split(':')[1] : q.replace(/\s+/g, '-');

  const colorPrefixes = ['fluent-emoji-flat', 'twemoji', 'noto', 'flat-color-icons'];
  for (const pref of colorPrefixes) {
    const svg = await fetchText(`https://api.iconify.design/${pref}/${cleanName}.svg`);
    if (svg && svg.includes('<svg')) {
      return { svg, isColorPack: true };
    }
  }

  const colorSearchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(cleanName)}&prefixes=fluent-emoji-flat,twemoji,noto,flat-color-icons&limit=5`;
  const colorRes = await fetchText(colorSearchUrl);
  if (colorRes) {
    try {
      const parsed = JSON.parse(colorRes);
      if (Array.isArray(parsed.icons) && parsed.icons.length > 0) {
        const [bPref, bName] = parsed.icons[0].split(':');
        const svg = await fetchText(`https://api.iconify.design/${bPref}/${bName}.svg`);
        if (svg && svg.includes('<svg')) {
          return { svg, isColorPack: true };
        }
      }
    } catch (e) {}
  }

  const gameSearchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(cleanName)}&prefixes=game-icons&limit=3`;
  const gameRes = await fetchText(gameSearchUrl);
  if (gameRes) {
    try {
      const parsed = JSON.parse(gameRes);
      if (Array.isArray(parsed.icons) && parsed.icons.length > 0) {
        const [bPref, bName] = parsed.icons[0].split(':');
        const svg = await fetchText(`https://api.iconify.design/${bPref}/${bName}.svg`);
        if (svg && svg.includes('<svg')) {
          return { svg, isColorPack: false };
        }
      }
    } catch (e) {}
  }

  const fallbackSvg = await fetchText('https://api.iconify.design/twemoji/sparkles.svg');
  return { svg: fallbackSvg || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#ffd166"/></svg>', isColorPack: true };
}

// ============================================================================
// 2. ENRIQUECEDOR CINEMATOGRÁFICO Y DEDUPLICADOR ESTRICTO DE SPRITES
// ============================================================================
function prepareCinematicScenes(escenas, hash) {
  const allShotTypes = [
    'closeup_character',
    'side_scroll_journey',
    'document_blueprint',
    'map_trajectory',
    'crowd_accumulation',
    'scale_comparison',
    'pyramid_network',
    'dramatic_fire_scene',
    'final_choice_card'
  ];

  const charRoles = ['suit_boss', 'scientist', 'engineer', 'military', 'hacker', 'explorer'];
  const palettes = ['sunset', 'day', 'night', 'sepia', 'cyber', 'storm'];

  const usedIcons = new Set();
  let fallbackCursor = 0;

  function getUniqueIcon(requestedIcon) {
    let key = String(requestedIcon || '').toLowerCase().trim();
    if (ES_TO_EN_MAP[key]) key = ES_TO_EN_MAP[key];
    if (!key || usedIcons.has(key)) {
      while (fallbackCursor < FALLBACK_COLOR_ICONS.length * 2) {
        const cand = FALLBACK_COLOR_ICONS[(fallbackCursor + hash) % FALLBACK_COLOR_ICONS.length];
        fallbackCursor++;
        if (!usedIcons.has(cand)) {
          key = cand;
          break;
        }
      }
    }
    usedIcons.add(key);
    return key;
  }

  let prevShot = '';

  return (escenas || []).map((esc, idx) => {
    const text = `${esc.subtitulo || ''} ${esc.texto_1 || ''} ${esc.texto_2 || ''} ${esc.narrativa_visual || ''}`.toLowerCase();
    let shot = String(esc.shot_type || esc.stage_layout || '').toLowerCase().trim();

    if (idx === escenas.length - 1) {
      shot = 'final_choice_card';
    } else if (!allShotTypes.includes(shot) || shot === prevShot) {
      if (idx === 0) shot = 'closeup_character';
      else if (/mapa|ruta|orbita|pais|italia|marte|continente|distancia|viaje/.test(text)) shot = 'map_trajectory';
      else if (/millon|dolar|euro|altura|veces|escala|peso|kilo|compar|248|300|1500/.test(text)) shot = 'scale_comparison';
      else if (/multitud|fila|cola|cientos|miles|personas|soldados|jugadores|habitantes/.test(text)) shot = 'crowd_accumulation';
      else if (/codigo|documento|cupon|informe|contrato|ley|auditoria|secreto|error/.test(text)) shot = 'document_blueprint';
      else if (/red|sistema|piramide|banco|servidores|colaps|cascada|nodos/.test(text)) shot = 'pyramid_network';
      else if (/fuego|explosion|desintegr|quem|incendio|destru|catastrofe|pánico|panico/.test(text)) shot = 'dramatic_fire_scene';
      else if (/camin|corri|despeg|vuelo|avion|cohete|sonda|perro|cueva/.test(text)) shot = 'side_scroll_journey';
      else shot = allShotTypes[(idx * 2 + hash) % (allShotTypes.length - 1)];

      if (shot === prevShot) {
        shot = allShotTypes.find(s => s !== prevShot && s !== 'final_choice_card') || 'closeup_character';
      }
    }
    prevShot = shot;

    let role = esc.character_role || '';
    if (!charRoles.includes(role)) {
      if (/militar|marine|soldado|guerra|general|policia/.test(text)) role = 'military';
      else if (/cientifico|nasa|medico|laboratorio|estudio|física/.test(text)) role = 'scientist';
      else if (/ingeniero|constructor|motor|maquina|obrero/.test(text)) role = 'engineer';
      else if (/hacker|programador|software|codigo|juego/.test(text)) role = 'hacker';
      else if (/explorador|selva|isla|cueva|montaña/.test(text)) role = 'explorer';
      else role = 'suit_boss';
    }

    const rawIcon1 = esc.actor_1?.icon || 'rocket';
    const rawIcon2 = esc.actor_2?.icon || 'globe-showing-americas';
    const uniqueIcon1 = getUniqueIcon(rawIcon1);
    const uniqueIcon2 = getUniqueIcon(rawIcon2);

    const numMatch = (esc.subtitulo || '').match(/\d+(?:[.,]\d+)?/);
    const bigNumber = esc.big_metric || (numMatch ? numMatch[0] : '');

    return {
      ...esc,
      shot_type: shot,
      character_role: role,
      palette_mode: esc.palette_mode || palettes[(idx + hash) % palettes.length],
      actor_1: { icon: uniqueIcon1 },
      actor_2: { icon: uniqueIcon2 },
      big_metric: String(bigNumber).toUpperCase().slice(0, 10),
      texto_1: (esc.texto_1 || esc.big_metric || `ACTO 0${idx + 1}`).toUpperCase().slice(0, 11),
      texto_2: (esc.texto_2 || 'HISTORIA').toUpperCase().slice(0, 11)
    };
  });
}

async function preloadAllSceneSprites(escenas) {
  const spriteCache = {};
  const keysToFetch = new Set(['sparkles']);

  for (const s of (escenas || [])) {
    if (s.actor_1?.icon) keysToFetch.add(s.actor_1.icon);
    if (s.actor_2?.icon) keysToFetch.add(s.actor_2.icon);
  }

  for (const key of keysToFetch) {
    if (key && !spriteCache[key]) {
      spriteCache[key] = await resolveSvgForPixelArt(key);
    }
  }
  return spriteCache;
}

// ============================================================================
// 3. ALINEACIÓN FONÉTICA DE SUBTÍTULOS
// ============================================================================
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
// 4. SINTETIZADOR CHIPTUNE 8-BIT PROCEDURAL
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
// 5. MOTOR PRINCIPAL v7.2 (HUD CLÁSICO + ANIMACIONES CINEMÁTICAS 8-BIT)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload Pixel-Art Studio v7.2 desde URL...');
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

  const escenasCinematic = prepareCinematicScenes(payload.escenas || [], hash);
  console.log('🎨 Descargando Sprites sólidos de apoyo...');
  const spriteCache = await preloadAllSceneSprites(escenasCinematic);
  const subtitleChunks = buildSubtitleChunks(escenasCinematic, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio con bg_music2.mp3
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenasCinematic, duracionExactaVideo, hash); } catch (e) {}

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

  // Serialización segura para evitar que caracteres especiales rompan el bloque <script>
  const safeEscenasJson = JSON.stringify(escenasCinematic).replace(/<\/script>/gi, '<\\/script>');
  const safeChunksJson = JSON.stringify(subtitleChunks).replace(/<\/script>/gi, '<\\/script>');
  const safeSpritesJson = JSON.stringify(spriteCache).replace(/<\/script>/gi, '<\\/script>');

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
      <div class="hud-tag">${(payload.subrama || 'HISTORIA 8-BIT').slice(0, 24)}</div>
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
      const escenas = ${safeEscenasJson};
      const subtitleChunks = ${safeChunksJson};
      const rawSpriteCache = ${safeSpritesJson};
      const totalFrames = ${totalFrames};

      const COLS = 120;
      const ROWS = 213;
      const CELL = 6;
      const GROUND_Y = 140;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#1a1c2c'));
      const rasterizedSprites = {};

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

      async function rasterizeAllSprites() {
        const SIZE = 30;
        const offCanvas = document.createElement('canvas');
        offCanvas.width = SIZE;
        offCanvas.height = SIZE;
        const offCtx = offCanvas.getContext('2d');

        for (const [key, item] of Object.entries(rawSpriteCache)) {
          try {
            let svgText = item.svg || '';
            if (!item.isColorPack) {
              svgText = svgText
                .replace(/stroke="currentColor"/gi, 'stroke="#00f5d4"')
                .replace(/fill="currentColor"/gi, 'fill="#ffd166"');
              if (!/fill=/i.test(svgText)) {
                svgText = svgText.replace(/<svg/i, '<svg fill="#ffd166" stroke="#00f5d4"');
              }
            }
            const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            await new Promise((res) => {
              img.onload = res;
              img.onerror = res;
              img.src = url;
            });
            offCtx.clearRect(0, 0, SIZE, SIZE);
            offCtx.drawImage(img, 2, 2, SIZE - 4, SIZE - 4);
            URL.revokeObjectURL(url);

            const imgData = offCtx.getImageData(0, 0, SIZE, SIZE).data;
            const mat = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

            for (let r = 0; r < SIZE; r++) {
              for (let c = 0; c < SIZE; c++) {
                const idx = (r * SIZE + c) * 4;
                const a = imgData[idx + 3];
                if (a > 70) {
                  const qr = Math.min(255, Math.round(imgData[idx] / 24) * 24);
                  const qg = Math.min(255, Math.round(imgData[idx + 1] / 24) * 24);
                  const qb = Math.min(255, Math.round(imgData[idx + 2] / 24) * 24);
                  const hex = '#' + [qr, qg, qb].map(v => v.toString(16).padStart(2, '0')).join('');
                  mat[r][c] = (hex === '#000000') ? '#1e293b' : hex;
                }
              }
            }

            const closed = mat.map(row => [...row]);
            for (let r = 1; r < SIZE - 1; r++) {
              for (let c = 1; c < SIZE - 1; c++) {
                if (!mat[r][c]) {
                  const neighbors = [mat[r - 1][c], mat[r + 1][c], mat[r][c - 1], mat[r][c + 1]].filter(Boolean);
                  if (neighbors.length >= 3) closed[r][c] = neighbors[0];
                }
              }
            }

            const outlined = closed.map(row => [...row]);
            for (let r = 1; r < SIZE - 1; r++) {
              for (let c = 1; c < SIZE - 1; c++) {
                if (!closed[r][c]) {
                  if (closed[r - 1][c] || closed[r + 1][c] || closed[r][c - 1] || closed[r][c + 1]) {
                    outlined[r][c] = '#05050a';
                  }
                }
              }
            }
            rasterizedSprites[key] = outlined;
          } catch (e) {}
        }
      }

      function drawSolidSprite(iconKey, centerX, centerY, scale = 1.0, flipX = false) {
        const key = String(iconKey || 'sparkles').toLowerCase().trim();
        const mat = rasterizedSprites[key] || rasterizedSprites['sparkles'];
        if (!mat) return;

        const srcSize = mat.length;
        const destSize = Math.max(8, Math.round(srcSize * scale));
        const halfDest = Math.floor(destSize / 2);

        for (let dy = 0; dy < destSize; dy++) {
          const srcY = Math.min(srcSize - 1, Math.floor((dy / destSize) * srcSize));
          for (let dx = 0; dx < destSize; dx++) {
            const rawSrcX = Math.min(srcSize - 1, Math.floor((dx / destSize) * srcSize));
            const srcX = flipX ? (srcSize - 1 - rawSrcX) : rawSrcX;
            const col = mat[srcY][srcX];
            if (col) {
              setPx(centerX - halfDest + dx, centerY - halfDest + dy, col);
            }
          }
        }
      }

      const PALETTES = {
        sunset: { sky1: '#2d1b4e', sky2: '#682c57', sky3: '#b84a54', sky4: '#f38157', ground1: '#3b2137', ground2: '#231321' },
        day:    { sky1: '#2b6cb0', sky2: '#4299e1', sky3: '#63b3ed', sky4: '#bee3f8', ground1: '#48bb78', ground2: '#2f855a' },
        night:  { sky1: '#090d16', sky2: '#111a2e', sky3: '#1a2642', sky4: '#24345a', ground1: '#2d3748', ground2: '#1a202c' },
        sepia:  { sky1: '#5c4033', sky2: '#8b5a2b', sky3: '#cd853f', sky4: '#f4a460', ground1: '#4a3525', ground2: '#332419' },
        cyber:  { sky1: '#0f1026', sky2: '#1b1e44', sky3: '#292d66', sky4: '#3b418c', ground1: '#1e293b', ground2: '#0f172a' },
        storm:  { sky1: '#111827', sky2: '#1f2937', sky3: '#374151', sky4: '#4b5563', ground1: '#1f2937', ground2: '#111827' }
      };

      function drawDitheredSky(palKey, maxRow = GROUND_Y) {
        const p = PALETTES[palKey] || PALETTES.sunset;
        const bands = [p.sky1, p.sky2, p.sky3, p.sky4];
        const bandH = Math.ceil(maxRow / bands.length);

        for (let r = 0; r < maxRow; r++) {
          const bIdx = Math.min(bands.length - 1, Math.floor(r / bandH));
          const nextIdx = Math.min(bands.length - 1, bIdx + 1);
          const localR = r % bandH;
          const ratio = localR / bandH;

          for (let c = 0; c < COLS; c++) {
            let col = bands[bIdx];
            if (ratio > 0.72 && ((r + c) % 2 === 0)) {
              col = bands[nextIdx];
            } else if (ratio > 0.86 && ((r % 2 === 0) || (c % 2 === 0))) {
              col = bands[nextIdx];
            }
            grid[r][c] = col;
          }
        }
        fillRect(0, maxRow, COLS, 3, '#0b0c10');
        for (let r = maxRow + 3; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            grid[r][c] = ((r + c) % 7 === 0) ? p.ground1 : p.ground2;
          }
        }
      }

      function drawCloseUpPortrait(esc, progress, localFrame, isTalking) {
        const role = esc.character_role || 'suit_boss';
        fillRect(0, 0, COLS, ROWS, '#4a3222');
        for (let c = 0; c < COLS; c += 12) fillRect(c, 0, 1, ROWS, '#362317');
        fillBorderedRect(10, 42, 30, 22, '#e2e8f0', '#2b1d14');
        for (let r = 47; r < 59; r += 3) fillRect(14, r, 22, 1, '#94a3b8');

        fillBorderedRect(82, 40, 28, 28, '#1e293b', '#eab308');
        drawSolidSprite(esc.actor_1?.icon, 96, 54, 0.75, false);

        const cx = 56;
        const headY = 82 + Math.round(Math.sin(localFrame * 0.15) * 1);

        let suitCol = '#334155', lapelCol = '#1e293b', tieCol = '#e63946', shirtCol = '#ffffff';
        let hatCol = '#eab308', hatBand = '#991b1b', hairCol = '#2b1d14';

        if (role === 'scientist') { suitCol = '#f8fafc'; lapelCol = '#cbd5e1'; tieCol = '#0284c7'; hatCol = null; hairCol = '#64748b'; }
        else if (role === 'engineer') { suitCol = '#ea580c'; lapelCol = '#9a3412'; tieCol = '#facc15'; hatCol = '#facc15'; }
        else if (role === 'military') { suitCol = '#3f6212'; lapelCol = '#1a2e05'; tieCol = '#1a2e05'; hatCol = '#365314'; }
        else if (role === 'hacker') { suitCol = '#111827'; lapelCol = '#1f2937'; tieCol = '#10b981'; hatCol = null; }

        fillBorderedRect(cx - 34, headY + 22, 68, 42, suitCol, '#0b0c10');
        for (let r = 0; r < 20; r++) {
          const vw = Math.max(2, 11 - Math.floor(r * 0.5));
          fillRect(cx - vw, headY + 23 + r, vw * 2, 1, shirtCol);
        }
        fillRect(cx - 3, headY + 28, 6, 20, tieCol);
        drawPixelLine(cx - 14, headY + 23, cx - 2, headY + 42, 2, lapelCol);
        drawPixelLine(cx + 14, headY + 23, cx + 2, headY + 42, 2, lapelCol);
        fillRect(cx - 22, headY + 40, 8, 3, '#ffffff');
        fillCircle(cx - 14, headY + 34, 2, '#e63946');

        fillBorderedRect(cx - 9, headY + 14, 18, 10, '#d49a73', '#0b0c10');
        fillBorderedRect(cx - 18, headY - 18, 36, 34, '#e6ad86', '#0b0c10');
        fillRect(cx + 10, headY - 16, 7, 32, '#d49a73');
        fillBorderedRect(cx - 21, headY - 4, 4, 10, '#d49a73', '#0b0c10');
        fillBorderedRect(cx + 17, headY - 4, 4, 10, '#d49a73', '#0b0c10');

        fillRect(cx - 18, headY - 18, 36, 7, hairCol);
        if (hatCol) {
          fillBorderedRect(cx - 28, headY - 20, 56, 5, hatCol, '#0b0c10');
          fillBorderedRect(cx - 19, headY - 29, 38, 10, hatCol, '#0b0c10');
          fillRect(cx - 18, headY - 22, 36, 2, hatBand);
        }

        const isWinking = (progress > 0.60 && progress < 0.85);
        const isBlinking = (localFrame % 55 < 3);
        fillRect(cx - 12, headY - 8, 8, 2, '#2b1d14');
        fillRect(cx + 4, headY - 9, 8, 2, '#2b1d14');

        if (isBlinking) {
          fillRect(cx - 11, headY - 3, 7, 2, '#2b1d14');
          fillRect(cx + 4, headY - 3, 7, 2, '#2b1d14');
        } else {
          fillRect(cx - 11, headY - 4, 7, 4, '#ffffff');
          fillRect(cx - 9, headY - 4, 4, 4, '#2b1d14');
          setPx(cx - 8, headY - 3, '#ffffff');
          if (isWinking) {
            fillRect(cx + 4, headY - 3, 7, 2, '#2b1d14');
          } else {
            fillRect(cx + 4, headY - 4, 7, 4, '#ffffff');
            fillRect(cx + 6, headY - 4, 4, 4, '#2b1d14');
            setPx(cx + 7, headY - 3, '#ffffff');
          }
        }

        fillRect(cx - 2, headY + 1, 4, 5, '#c6865e');
        const mouthOpen = isTalking && (Math.floor(localFrame / 3) % 2 === 0);
        if (mouthOpen) {
          fillBorderedRect(cx - 7, headY + 7, 14, 6, '#ffffff', '#2b1d14');
          fillRect(cx - 5, headY + 10, 10, 2, '#991b1b');
        } else {
          fillRect(cx - 6, headY + 8, 12, 2, '#2b1d14');
          fillRect(cx + 5, headY + 7, 2, 2, '#2b1d14');
        }

        const handY = headY + 30 - Math.round(Math.sin(progress * Math.PI) * 5);
        fillBorderedRect(cx - 6, handY - 8, 34, 16, '#80ed99', '#064e3b');
        fillBorderedRect(cx - 3, handY - 5, 28, 10, '#52b788', '#1b4332');
        fillCircle(cx + 11, handY, 3, '#1b4332');
        fillBorderedRect(cx - 12, handY - 2, 18, 14, '#e6ad86', '#0b0c10');
        fillRect(cx - 8, handY - 2, 1, 9, '#0b0c10');
        fillRect(cx - 4, handY - 2, 1, 9, '#0b0c10');
        fillRect(cx, handY - 2, 1, 9, '#0b0c10');
      }

      function drawMiniPerson(x, y, suitCol, hatCol, isWalking, localFrame, facingLeft = false, speechSymbol = null) {
        const step = isWalking ? (Math.floor(localFrame / 4) % 2) : 0;
        fillRect(x - 3, y + 1, 7, 1, 'rgba(0,0,0,0.4)');
        fillBorderedRect(x - 3, y - 5 + (step ? -1 : 0), 3, 6, '#1e293b', '#0b0c10');
        fillBorderedRect(x, y - 5 + (step ? 0 : -1), 3, 6, '#1e293b', '#0b0c10');
        fillBorderedRect(x - 4, y - 14, 9, 10, suitCol, '#0b0c10');
        fillBorderedRect(x - 3, y - 21, 7, 8, '#e6ad86', '#0b0c10');
        const eyeX = facingLeft ? (x - 2) : (x + 2);
        setPx(eyeX, y - 18, '#0b0c10');
        if (hatCol) {
          fillRect(x - 4, y - 22, 9, 2, hatCol);
          fillRect(x - 3, y - 24, 7, 2, hatCol);
        } else {
          fillRect(x - 3, y - 22, 7, 2, '#2b1d14');
        }
        if (speechSymbol) {
          fillBorderedRect(x - 5, y - 35, 11, 10, '#ffffff', '#0b0c10');
          fillRect(x - 1, y - 25, 3, 2, '#ffffff');
          fillRect(x, y - 33, 2, 4, '#e63946');
          setPx(x, y - 28, '#e63946');
        }
      }

      function renderCrowdAccumulation(esc, progress, localFrame) {
        drawDitheredSky(esc.palette_mode, GROUND_Y);
        fillBorderedRect(62, 48, 52, GROUND_Y - 48, '#9b2226', '#0b0c10');
        for (let wy = 56; wy < GROUND_Y - 24; wy += 14) {
          for (let wx = 68; wx < 106; wx += 12) {
            fillBorderedRect(wx, wy, 7, 9, '#334155', '#0b0c10');
          }
        }
        fillBorderedRect(78, GROUND_Y - 24, 18, 24, '#0b0c10', '#d97706');

        drawMiniPerson(20, GROUND_Y, '#3f6212', '#365314', false, localFrame, false);

        const totalPeople = Math.max(3, Math.floor(progress * 28));
        const colors = ['#38bdf8', '#f97316', '#eab308', '#a855f7', '#10b981', '#64748b'];
        for (let i = 0; i < totalPeople; i++) {
          const row = Math.floor(i / 7);
          const col = i % 7;
          const px = 34 + col * 9 + (row % 2) * 3;
          const py = GROUND_Y - row * 6;
          drawMiniPerson(px, py, colors[i % colors.length], i % 2 === 0 ? '#1e293b' : null, false, localFrame, true);
        }
      }

      function renderScaleComparison(esc, progress, localFrame) {
        drawDitheredSky('night', GROUND_Y);
        for (let r = 0; r < 65; r++) {
          const mw = Math.floor(r * 0.85);
          const col = r < 22 ? '#ffffff' : '#475569';
          fillRect(92 - mw, GROUND_Y - 65 + r, mw * 2, 1, col);
        }
        [125, 95, 65].forEach(ly => fillRect(6, ly, 14, 2, '#ffffff'));

        drawMiniPerson(32, GROUND_Y, '#78350f', '#eab308', false, localFrame, false);
        drawSolidSprite(esc.actor_1?.icon, 20, 56, 0.85, false);

        const maxTowerH = 85;
        const curH = Math.max(8, Math.round(progress * maxTowerH));
        for (let y = GROUND_Y - curH; y < GROUND_Y; y += 4) {
          fillBorderedRect(48, y, 14, 4, (y % 8 === 0) ? '#80ed99' : '#e2e8f0', '#0b0c10');
        }
      }

      function renderMapTrajectory(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#1d4ed8');
        for (let r = 0; r < ROWS; r += 6) {
          for (let c = 0; c < COLS; c += 6) {
            setPx(c + (r % 12 === 0 ? 3 : 0), r, '#1e40af');
          }
        }
        fillCircle(16, 108, 24, '#15803d');
        fillCircle(22, 92, 16, '#16a34a');
        fillCircle(104, 84, 24, '#b45309');
        fillCircle(94, 100, 16, '#d97706');

        const totalDots = 16;
        const activeDots = Math.max(2, Math.floor(progress * totalDots));
        for (let i = 0; i < activeDots; i++) {
          const t = i / (totalDots - 1);
          const dx = 24 + t * 72;
          const dy = 102 - Math.sin(t * Math.PI) * 38;
          fillBorderedRect(dx - 2, dy - 2, 4, 4, i % 2 === 0 ? '#ef4444' : '#ffffff', '#0b0c10');
        }

        drawSolidSprite(esc.actor_1?.icon, 22, 105, 0.85, false);
        drawSolidSprite(esc.actor_2?.icon, 96, 82, 0.85, false);
      }

      function renderDocumentBlueprint(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#2b1d14');
        fillBorderedRect(12, 44, 96, 92, '#f5ebe0', '#0b0c10');
        fillBorderedRect(16, 48, 88, 84, '#edede9', '#7f5539');

        drawSolidSprite(esc.actor_1?.icon, 60, 90, 0.95, false);

        const linesToShow = Math.floor(progress * 6) + 2;
        for (let i = 0; i < linesToShow; i++) {
          const ly = 56 + i * 11;
          const lw = (i % 2 === 0) ? 64 : 48;
          fillRect(60 - Math.floor(lw / 2), ly, lw, 3, '#334155');
        }

        if (progress > 0.40) {
          const pulse = (Math.floor(localFrame / 4) % 2 === 0) ? 1 : 0;
          fillBorderedRect(54 - pulse, 72 - pulse, 12 + pulse * 2, 24 + pulse * 2, '#ef4444', '#0b0c10');
          fillBorderedRect(54 - pulse, 100 - pulse, 12 + pulse * 2, 9 + pulse * 2, '#ef4444', '#0b0c10');
        }
      }

      function renderPyramidNetwork(esc, progress, localFrame) {
        fillRect(0, 0, COLS, ROWS, '#141622');
        const rows = [1, 2, 3, 4];
        const isCollapsing = progress > 0.72;
        const dropOffset = isCollapsing ? Math.round(Math.pow((progress - 0.72) * 3.5, 2) * 28) : 0;

        rows.forEach((count, rIdx) => {
          const boxW = 16, boxH = 16, gap = 6;
          const totalW = count * boxW + (count - 1) * gap;
          const startX = Math.floor((COLS - totalW) / 2);
          const baseY = 46 + rIdx * 21 + (isCollapsing ? dropOffset * (rIdx + 1) * 0.25 : 0);

          for (let cIdx = 0; cIdx < count; cIdx++) {
            const bx = startX + cIdx * (boxW + gap);
            const boxCol = isCollapsing ? '#991b1b' : (rIdx === 3 ? '#065f46' : '#3b2818');
            const borderCol = isCollapsing ? '#ef4444' : '#eab308';
            fillBorderedRect(bx, baseY, boxW, boxH, boxCol, borderCol);
            fillRect(bx + 5, baseY + 3, 6, 5, '#e6ad86');
            fillRect(bx + 4, baseY + 8, 8, 6, '#1e293b');
          }
        });
      }

      function renderSideScrollJourney(esc, progress, localFrame) {
        drawDitheredSky(esc.palette_mode, GROUND_Y);

        for (let r = 0; r < 52; r++) {
          const w = 10 + Math.floor(r * 0.9);
          fillRect(75 - w, GROUND_Y - 52 + r, w * 2, 1, '#3b2137');
        }
        for (let i = 0; i < 6; i++) {
          const py = GROUND_Y - 56 - ((localFrame + i * 11) % 24);
          const px = 75 + Math.round(Math.sin(localFrame * 0.1 + i) * 6);
          fillRect(px, py, 2, 2, '#f97316');
        }

        const walkX = Math.round(18 + progress * 48);
        drawMiniPerson(walkX - 14, GROUND_Y, '#dc2626', null, true, localFrame, false);
        drawMiniPerson(walkX, GROUND_Y, '#f8fafc', null, true, localFrame + 3, false, progress > 0.35 ? '!' : null);
        drawMiniPerson(walkX + 14, GROUND_Y, '#16a34a', '#eab308', true, localFrame + 6, false);

        const botY = GROUND_Y - 36 + Math.round(Math.sin(localFrame * 0.2) * 3);
        drawSolidSprite(esc.actor_1?.icon, walkX + 26, botY, 0.85, false);
      }

      function renderDramaticFireScene(esc, progress, localFrame) {
        drawDitheredSky('storm', GROUND_Y);

        [14, 68].forEach((hx) => {
          fillBorderedRect(hx, GROUND_Y - 32, 36, 32, '#78350f', '#0b0c10');
          for (let r = 0; r < 14; r++) {
            fillRect(hx - 2 + r, GROUND_Y - 32 - r, 40 - r * 2, 1, '#451a03');
          }
          for (let f = 0; f < 18; f++) {
            const fx = hx + 4 + (f * 2) % 28;
            const fh = 6 + ((localFrame + f * 5) % 12);
            fillRect(fx, GROUND_Y - 32 - fh, 3, fh, '#dc2626');
            fillRect(fx, GROUND_Y - 32 - Math.floor(fh * 0.65), 3, Math.floor(fh * 0.65), '#f97316');
            fillRect(fx, GROUND_Y - 32 - Math.floor(fh * 0.35), 2, Math.floor(fh * 0.35), '#fde047');
          }
        });

        for (let r = 0; r < 24; r++) {
          const rx = ((r * 19 - localFrame * 2) % COLS + COLS) % COLS;
          const ry = (r * 13 + localFrame * 3) % GROUND_Y;
          fillRect(rx, ry, 1, 3, '#fde047');
        }

        drawMiniPerson(52, GROUND_Y, '#31102f', '#eab308', false, localFrame, false);
        drawSolidSprite(esc.actor_2?.icon, 60, 62, 0.90, false);
      }

      function renderFinalChoiceCard(esc, progress, localFrame) {
        renderCrowdAccumulation(esc, 0.85, localFrame);

        fillBorderedRect(14, 58, 92, 48, '#141829', '#eab308');
        fillBorderedRect(17, 61, 86, 42, '#0f172a', '#0b0c10');

        const selectSecond = (Math.floor(localFrame / 18) % 2 === 1);
        const cursorY = selectSecond ? 86 : 72;
        fillRect(24, cursorY, 2, 6, '#80ed99');
        fillRect(26, cursorY + 1, 2, 4, '#80ed99');
        fillRect(28, cursorY + 2, 2, 2, '#80ed99');

        fillRect(34, 73, 52, 4, selectSecond ? '#64748b' : '#ffd166');
        fillRect(34, 87, 42, 4, selectSecond ? '#ffd166' : '#64748b');
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
        '+': ['000','010','111','010','000'], '-': ['000','000','111','000','000']
      };

      function drawPixelString(str, centerX, startY, color) {
        const clean = String(str || '').toUpperCase().replace(/[^A-Z0-9$%!?+ -]/g, '').slice(0, 12);
        if (!clean) return;
        const scale = 2;
        const charW = 3 * scale;
        const charH = 5 * scale;
        const gap = 1 * scale;
        const totalW = clean.length * (charW + gap) - gap;
        let cx = Math.max(3, Math.floor(centerX - totalW / 2));

        fillBorderedRect(cx - 4, startY - 3, totalW + 8, charH + 6, '#080a14', '#000000');
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const glyph = FONT_3X5[ch];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') {
                  fillRect(cx + c * scale, startY + r * scale, scale, scale, color);
                }
              }
            }
          }
          cx += charW + gap;
        }
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
      let lastChunkIdx = -2;

      window.initSpritesReady = rasterizeAllSprites();

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

        const shot = esc.shot_type || 'closeup_character';
        if (shot === 'closeup_character') {
          drawCloseUpPortrait(esc, progress, localFrame, true);
        } else if (shot === 'crowd_accumulation') {
          renderCrowdAccumulation(esc, progress, localFrame);
        } else if (shot === 'scale_comparison') {
          renderScaleComparison(esc, progress, localFrame);
        } else if (shot === 'map_trajectory') {
          renderMapTrajectory(esc, progress, localFrame);
        } else if (shot === 'document_blueprint') {
          renderDocumentBlueprint(esc, progress, localFrame);
        } else if (shot === 'pyramid_network') {
          renderPyramidNetwork(esc, progress, localFrame);
        } else if (shot === 'dramatic_fire_scene') {
          renderDramaticFireScene(esc, progress, localFrame);
        } else if (shot === 'final_choice_card') {
          renderFinalChoiceCard(esc, progress, localFrame);
        } else {
          renderSideScrollJourney(esc, progress, localFrame);
        }

        let topText = esc.texto_1 || '';
        if ((shot === 'crowd_accumulation' || shot === 'scale_comparison') && esc.big_metric) {
          const digitsOnly = String(esc.big_metric).replace(/[^0-9]/g, '');
          const baseNum = parseInt(digitsOnly, 10);
          if (!isNaN(baseNum) && baseNum > 10) {
            const curVal = Math.max(1, Math.round(baseNum * Math.min(1, progress * 1.15)));
            topText = String(curVal) + '+';
          }
        }

        if (topText) drawPixelString(topText, 60, 19, '#ffd166');
        if (esc.texto_2) drawPixelString(esc.texto_2, 60, 148, '#00f5d4');

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
  await page.evaluate(async () => { await window.initSpritesReady; });

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Pixel-Art Studio v7.2 (${duracionExactaVideo.toFixed(2)}s)...`);
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

  console.log('🔊 Ensamblando MP4 final Pixel-Art Studio v7.2...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Pixel-Art Studio v7.2 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
