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

// Pool de iconos de respaldo variados (100% ilustrados a color) para impedir repeticiones
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
    .replace(/[^a-z0-9-_:\s]/g, '').trim();

  if (ES_TO_EN_MAP[q]) q = ES_TO_EN_MAP[q];
  const cleanName = q.includes(':') ? q.split(':')[1] : q.replace(/\s+/g, '-');

  // Prioridad absoluta a colecciones ilustradas SÓLIDAS y rellenas a color (nunca iconos huecos de líneas finas)
  const colorPrefixes = ['fluent-emoji-flat', 'twemoji', 'noto', 'flat-color-icons'];
  for (const pref of colorPrefixes) {
    const svg = await fetchText(`https://api.iconify.design/${pref}/${cleanName}.svg`);
    if (svg && svg.includes('<svg')) {
      return { svg, isColorPack: true };
    }
  }

  // Búsqueda semántica restringida primero a packs rellenos a todo color
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

  // Si no existe en emojis, buscar en game-icons (que son siluetas sólidas rellenas, no líneas huecas)
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
// 2. DEDUPLICADOR ESTRICTO DE SPRITES Y MUNDOS POR ESCENA
// ============================================================================
function enforceUniqueScenesAndSprites(escenas, hash) {
  const allWorlds = [
    'city_night', 'suburban_room', 'telecom_central', 'retro_office',
    'server_datacenter', 'world_map_room', 'science_lab', 'nature_park',
    'sky_airspace', 'bank_vault', 'industrial_plant', 'grand_hall'
  ];
  const allLayouts = [
    'versus_confrontation', 'unbox_discovery', 'signal_transmission',
    'system_override_console', 'world_map_routing', 'dialogue_stage',
    'chain_reaction', 'vehicle_journey', 'chase_pursuit', 'grand_monument'
  ];

  const usedIcons = new Set();
  let fallbackCursor = 0;

  function getUniqueIcon(requestedIcon) {
    let key = String(requestedIcon || '').toLowerCase().trim();
    if (ES_TO_EN_MAP[key]) key = ES_TO_EN_MAP[key];
    if (!key || usedIcons.has(key)) {
      while (fallbackCursor < FALLBACK_COLOR_ICONS.length) {
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

  let prevWorld = '';
  let prevLayout = '';

  return (escenas || []).map((esc, idx) => {
    const text = `${esc.subtitulo || ''} ${esc.texto_1 || ''} ${esc.texto_2 || ''} ${esc.narrativa_visual || ''}`.toLowerCase();

    // 1. Asignar layout narrativo coherente con el texto y sin repetir el anterior
    let layout = esc.stage_layout || esc.choreography || '';
    if (!allLayouts.includes(layout) || layout === prevLayout) {
      if (idx === (escenas.length - 1)) layout = 'grand_monument';
      else if (/dentro|caja|descubri|encontr|oculto|escondid/.test(text)) layout = 'unbox_discovery';
      else if (/frecuencia|hercio|hz|sonido|soplar|tono|senal|onda|llamada/.test(text)) layout = 'signal_transmission';
      else if (/continente|mundo|ruta|desviar|pais|global|mapa|casa blanca/.test(text)) layout = 'world_map_routing';
      else if (/sistema|reinici|abierta|control|codigo|contador|red|troncal/.test(text)) layout = 'system_override_console';
      else if (/derrotad|mayor|gigante|contra|poderos|juguete/.test(text)) layout = 'versus_confrontation';
      else if (/avion|vuelo|coche|tren|viaj|despeg/.test(text)) layout = 'vehicle_journey';
      else if (/perro|pelota|perseguir|correr|huir|escap/.test(text)) layout = 'chase_pursuit';
      else if (/contagi|miles|millones|masivo|propag/.test(text)) layout = 'chain_reaction';
      else layout = allLayouts[(idx * 3 + hash) % allLayouts.length];

      if (layout === prevLayout) {
        layout = allLayouts.find(l => l !== prevLayout) || 'system_override_console';
      }
    }
    prevLayout = layout;

    // 2. Asignar mundo coherente sin repetir el anterior
    let world = esc.world_theme || '';
    if (!allWorlds.includes(world) || world === prevWorld) {
      if (layout === 'world_map_routing') world = 'world_map_room';
      else if (/cereal|cocina|casa|juguete|niño/.test(text)) world = 'suburban_room';
      else if (/frecuencia|2600|troncal|telefon|at&t|central/.test(text)) world = 'telecom_central';
      else if (/servidor|sistema|red|codigo|hacker|phreak/.test(text)) world = 'server_datacenter';
      else if (/parque|perro|pelota|arbol|bosque|montaña/.test(text)) world = 'nature_park';
      else if (/avion|cielo|vuelo|nube/.test(text)) world = 'sky_airspace';
      else if (/banco|millon|dinero|bolsa|gratis/.test(text)) world = 'bank_vault';
      else if (/ciencia|medico|hospital|estudio/.test(text)) world = 'science_lab';
      else world = allWorlds[(idx + hash) % allWorlds.length];

      if (world === prevWorld) {
        world = allWorlds.find(w => w !== prevWorld) || allWorlds[(idx + 2) % allWorlds.length];
      }
    }
    prevWorld = world;

    // 3. Garantizar que actor_1 y actor_2 sean únicos en todo el vídeo
    const rawIcon1 = esc.actor_1?.icon || 'telephone';
    const rawIcon2 = esc.actor_2?.icon || 'package';

    const uniqueIcon1 = getUniqueIcon(rawIcon1);
    const uniqueIcon2 = getUniqueIcon(rawIcon2);

    // El fondo SOLO se mueve si es un viaje en vehículo o una persecución corriendo
    const shouldScrollBg = (layout === 'vehicle_journey' || layout === 'chase_pursuit');

    return {
      ...esc,
      world_theme: world,
      stage_layout: layout,
      bg_scroll: shouldScrollBg,
      actor_1: { icon: uniqueIcon1 },
      actor_2: { icon: uniqueIcon2 }
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
      coin_8bit: { expr: `0.20*(lt(t,0.08)*sgn(sin(2*PI*987.77*${p}*t))+gt(t,0.08)*exp(-6*(t-0.08))*sgn(sin(2*PI*1318.51*${p}*t)))`, dur: 0.42 },
      laser_8bit: { expr: `0.18*exp(-5*t)*sgn(sin(2*PI*(1200*${p}*exp(-6*t)+120)*t))`, dur: 0.32 },
      explosion_8bit: { expr: `0.28*exp(-4.5*t)*(sgn(sin(2*PI*75*exp(-2*t)*t))*sin(2*PI*19*t)+0.5*sgn(sin(2*PI*230*t)*sin(2*PI*53*t)))`, dur: 0.65 },
      powerup_8bit: { expr: `0.18*(lt(t,0.07)*sgn(sin(2*PI*330*${p}*t))+between(t,0.07,0.14)*sgn(sin(2*PI*392*${p}*t))+between(t,0.14,0.21)*sgn(sin(2*PI*659*${p}*t))+gt(t,0.21)*exp(-5*(t-0.21))*sgn(sin(2*PI*523*${p}*t)))`, dur: 0.45 },
      alarm_8bit: { expr: `0.18*exp(-1.5*t)*sgn(sin(2*PI*(680+220*sgn(sin(2*PI*8*t)))*t))`, dur: 0.55 },
      glitch_8bit: { expr: `0.18*exp(-6*t)*sgn(sin(2*PI*440*${p}*t)*sin(2*PI*67*t)+sin(2*PI*1120*t)*sin(2*PI*29*t))`, dur: 0.35 },
      jump_8bit: { expr: `0.19*exp(-4*t)*sgn(sin(2*PI*(180*${p}+520*t)*t))`, dur: 0.30 },
      error_8bit: { expr: `0.22*exp(-4*t)*(lt(t,0.14)*sgn(sin(2*PI*165*${p}*t))+gt(t,0.14)*sgn(sin(2*PI*130.8*${p}*t)))`, dur: 0.45 },
      typing_8bit: { expr: `0.16*(exp(-40*t)*sgn(sin(2*PI*1400*t))+gt(t,0.09)*exp(-40*(t-0.09))*sgn(sin(2*PI*1650*t))+gt(t,0.18)*exp(-40*(t-0.18))*sgn(sin(2*PI*1300*t)))`, dur: 0.30 },
      level_clear_8bit: { expr: `0.18*exp(-2.8*t)*(sgn(sin(2*PI*523.25*${p}*t))+0.7*sgn(sin(2*PI*659.25*${p}*t))+0.5*sgn(sin(2*PI*783.99*${p}*t)))`, dur: 0.65 }
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
// 5. MOTOR PRINCIPAL v6.0 (REJILLA HD 90x160 + SPRITES SÓLIDOS SIN HUECOS)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload Universal 8-BIT v6.0 desde URL...');
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

  // Deduplicar sprites y mundos para garantizar variedad total
  const escenasUnicas = enforceUniqueScenesAndSprites(payload.escenas || [], hash);
  console.log('🎨 Descargando Sprites ilustrados a color (cero repeticiones)...');
  const spriteCache = await preloadAllSceneSprites(escenasUnicas);
  const subtitleChunks = buildSubtitleChunks(escenasUnicas, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenasUnicas, duracionExactaVideo, hash); } catch (e) {}

    let bgMusicPath = path.resolve(__dirname, '../bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve('bg_music2.mp3');
    if (!fs.existsSync(bgMusicPath)) bgMusicPath = path.resolve(__dirname, '../bg_music.mp3');

    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(`ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.80,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`, { stdio: 'inherit' });
      if (hasSfx) {
        execSync(`ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.15[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`, { stdio: 'inherit' });
      } else {
        execSync(`ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.15[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`, { stdio: 'inherit' });
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
      const escenas = ${JSON.stringify(escenasUnicas)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const rawSpriteCache = ${JSON.stringify(spriteCache)};
      const totalFrames = ${totalFrames};

      // REJILLA HD 90x160 (Cada celda = 8x8 px -> 720x1280 exactos, nitidez 16-Bit/8-Bit)
      const COLS = 90;
      const ROWS = 160;
      const CELL = 8;
      const GROUND_Y = 104;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      let grid = Array.from({ length: ROWS }, () => Array(COLS).fill('#101420'));
      const rasterizedSprites = {};

      function setCell(x, y, color) {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && color) {
          grid[cy][cx] = color;
        }
      }

      function drawRect(x, y, w, h, color) {
        const x0 = Math.round(x), y0 = Math.round(y);
        const rw = Math.round(w), rh = Math.round(h);
        for (let r = 0; r < rh; r++) {
          for (let c = 0; c < rw; c++) setCell(x0 + c, y0 + r, color);
        }
      }

      function drawCircle(cx, cy, radius, color) {
        const rInt = Math.round(radius);
        for (let r = -rInt; r <= rInt; r++) {
          for (let c = -rInt; c <= rInt; c++) {
            if (c * c + r * r <= rInt * rInt) setCell(cx + c, cy + r, color);
          }
        }
      }

      function drawRing(cx, cy, radius, thickness, color) {
        const rOut = Math.round(radius);
        const rIn = Math.max(0, rOut - thickness);
        for (let r = -rOut; r <= rOut; r++) {
          for (let c = -rOut; c <= rOut; c++) {
            const d2 = c * c + r * r;
            if (d2 <= rOut * rOut && d2 >= rIn * rIn) setCell(cx + c, cy + r, color);
          }
        }
      }

      function drawLine(x0, y0, x1, y1, thickness, color) {
        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let cx = Math.round(x0), cy = Math.round(y0);
        const ex = Math.round(x1), ey = Math.round(y1);
        for (let i = 0; i < 200; i++) {
          drawRect(cx - Math.floor(thickness / 2), cy - Math.floor(thickness / 2), thickness, thickness, color);
          if (cx === ex && cy === ey) break;
          let e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }

      // ======================================================================
      // RASTERIZADOR DE ALTA DEFINICIÓN (30x30 CELDAS) + RELLENO SÓLIDO
      // ======================================================================
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

            // Cerrar cualquier hueco interior de 1 píxel (Morphological Closing) y añadir borde negro sólido
            const closed = mat.map(row => [...row]);
            for (let r = 1; r < SIZE - 1; r++) {
              for (let c = 1; c < SIZE - 1; c++) {
                if (!mat[r][c]) {
                  const neighbors = [mat[r - 1][c], mat[r + 1][c], mat[r][c - 1], mat[r][c + 1]].filter(Boolean);
                  if (neighbors.length >= 3) {
                    closed[r][c] = neighbors[0];
                  }
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

      // MAPEO INVERSO: PINTA EL SPRITE A CUALQUIER ESCALA CON CERO PÍXELES ROTOS O FALTANTES
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
              setCell(centerX - halfDest + dx, centerY - halfDest + dy, col);
            }
          }
        }
      }

      // PERSONAJE HUMANO ARTICULADO 16-BIT
      function drawPerson(x, y, suitColor, hairColor, isWalking, localFrame, facingLeft) {
        const dir = facingLeft ? -1 : 1;
        const step = isWalking ? (Math.floor(localFrame / 5) % 2) : 0;
        const put = (dx, dy, w, h, col) => {
          const rx = facingLeft ? (x - dx - w + 1) : (x + dx);
          drawRect(rx, y + dy, w, h, col);
        };

        // Sombra en el suelo
        drawRect(x - 4, y + 6, 9, 2, 'rgba(0,0,0,0.45)');
        // Pelo y Cabeza
        put(-3, -14, 7, 3, hairColor || '#4a2c11');
        put(-3, -11, 7, 5, '#ffcdb2');
        put(2, -9, 2, 2, '#05050a'); // Ojo
        // Torso
        put(-3, -6, 7, 7, suitColor || '#38bdf8');
        // Brazos y Piernas (Solo caminan si isWalking === true)
        if (!isWalking) {
          put(-5, -5, 2, 5, suitColor); put(-5, 0, 2, 2, '#ffcdb2');
          put(4, -5, 2, 5, suitColor); put(4, 0, 2, 2, '#ffcdb2');
          put(-3, 1, 3, 5, '#1e293b'); put(-3, 6, 3, 2, '#ffffff');
          put(1, 1, 3, 5, '#1e293b'); put(1, 6, 3, 2, '#ffffff');
        } else if (step === 0) {
          put(-5, -4, 2, 5, suitColor); put(4, -6, 2, 5, suitColor);
          put(-4, 1, 3, 5, '#1e293b'); put(-5, 6, 3, 2, '#ffffff');
          put(2, 1, 3, 5, '#1e293b'); put(3, 6, 3, 2, '#ffffff');
        } else {
          put(-4, -6, 2, 5, suitColor); put(4, -4, 2, 5, suitColor);
          put(-1, 1, 3, 5, '#1e293b'); put(-1, 6, 3, 2, '#ffffff');
          put(1, 1, 3, 5, '#1e293b'); put(1, 6, 3, 2, '#ffffff');
        }
      }

      // ======================================================================
      // 12 MUNDOS DETALLADOS (ESTÁTICOS POR DEFECTO; SOLO SE MUEVEN EN VIAJES)
      // ======================================================================
      function drawWorld(esc, localFrame) {
        const theme = esc.world_theme || 'city_night';
        const scrollX = esc.bg_scroll ? Math.floor(localFrame * 0.9) : 0;

        // 1. HABITACIÓN / COCINA AÑOS 70 (Ideal para cereales, inventos caseros, vida cotidiana)
        if (theme === 'suburban_room') {
          drawRect(0, 0, COLS, GROUND_Y, '#fef3c7'); // Pared crema cálida
          // Papel pintado con franjas suaves verticales estáticas
          for (let c = 6; c < COLS; c += 12) drawRect(c, 0, 2, GROUND_Y, '#fde68a');
          // Ventana soleada con cortinas
          drawRect(32, 24, 26, 28, '#38bdf8');
          drawRect(34 + (Math.floor(localFrame * 0.1) % 10), 30, 8, 3, '#ffffff'); // Nube lenta en ventana
          drawRect(32, 24, 26, 2, '#78350f'); drawRect(32, 50, 26, 2, '#78350f');
          drawRect(44, 24, 2, 28, '#78350f');
          // Mesa / Encimera en la parte baja
          drawRect(0, GROUND_Y - 4, COLS, 4, '#b45309');
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((Math.floor(c / 6) + Math.floor(r / 4)) % 2 === 0) ? '#d97706' : '#92400e';
            }
          }
          return;
        }

        // 2. CENTRAL TELEFÓNICA / CONMUTADORES INDUSTRIALES (AT&T, 2600 Hz, redes)
        if (theme === 'telecom_central') {
          drawRect(0, 0, COLS, GROUND_Y, '#1e293b');
          // Paneles estáticos de conmutación telefónica con cables y luces parpadeantes
          for (let bx = 8; bx < COLS - 8; bx += 20) {
            drawRect(bx, 22, 16, GROUND_Y - 22, '#334155');
            drawRect(bx + 2, 24, 12, GROUND_Y - 26, '#0f172a');
            for (let ry = 28; ry < GROUND_Y - 6; ry += 5) {
              for (let rx = bx + 4; rx < bx + 12; rx += 4) {
                const lit = ((rx + ry + Math.floor(localFrame / 6)) % 3) === 0;
                drawRect(rx, ry, 2, 2, lit ? '#fde047' : '#0284c7');
              }
            }
          }
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#0f172a');
          drawRect(0, GROUND_Y, COLS, 2, '#64748b');
          return;
        }

        // 3. SALA DEL MAPA MUNDIAL / CENTRO DE OPERACIONES GLOBAL
        if (theme === 'world_map_room') {
          drawRect(0, 0, COLS, GROUND_Y, '#091526');
          // Cuadrícula cartográfica estática
          for (let r = 18; r < GROUND_Y; r += 10) drawRect(0, r, COLS, 1, '#112a46');
          for (let c = 10; c < COLS; c += 12) drawRect(c, 18, 1, GROUND_Y - 18, '#112a46');
          // Siluetas de continentes en verde esmeralda oscuro
          drawRect(12, 34, 18, 14, '#14532d'); drawRect(16, 48, 10, 16, '#14532d'); // América
          drawRect(42, 30, 22, 16, '#14532d'); drawRect(46, 46, 12, 16, '#14532d'); // Eurasia/África
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#050b14');
          drawRect(0, GROUND_Y, COLS, 2, '#00f5d4');
          return;
        }

        // 4. OFICINA RETRO / DESPACHO CON VENTANALES ESTÁTICOS
        if (theme === 'retro_office') {
          drawRect(0, 0, COLS, GROUND_Y, '#334155');
          [10, 50].forEach(wx => {
            drawRect(wx, 22, 28, 36, '#38bdf8');
            drawRect(wx + 4, 36, 8, 22, '#1e293b');
            drawRect(wx + 15, 30, 10, 28, '#0f172a');
            drawRect(wx, 22, 28, 2, '#e2e8f0'); drawRect(wx, 56, 28, 2, '#e2e8f0');
          });
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#78350f');
          drawRect(0, GROUND_Y, COLS, 2, '#d97706');
          return;
        }

        // 5. CENTRO DE DATOS / SERVIDORES (ESTÁTICO, SOLO PARPADEAN LOS LEDS)
        if (theme === 'server_datacenter') {
          drawRect(0, 0, COLS, GROUND_Y, '#090d16');
          for (let rx = 8; rx < COLS - 8; rx += 19) {
            drawRect(rx, 24, 14, GROUND_Y - 24, '#1e293b');
            drawRect(rx + 2, 26, 10, GROUND_Y - 28, '#05070c');
            for (let ry = 30; ry < GROUND_Y - 6; ry += 6) {
              const on = ((Math.floor(localFrame / 5) + ry + rx) % 4) < 2;
              drawRect(rx + 4, ry, 3, 2, on ? '#10b981' : '#064e3b');
              drawRect(rx + 8, ry, 2, 2, !on ? '#38bdf8' : '#ef4444');
            }
          }
          drawRect(0, GROUND_Y, COLS, ROWS - GROUND_Y, '#0f172a');
          drawRect(0, GROUND_Y, COLS, 2, '#00f5d4');
          return;
        }

        // 6. PARQUE NATURAL (Se desplaza SOLO si bg_scroll === true)
        if (theme === 'nature_park') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 35 ? '#38bdf8' : (r < 70 ? '#7dd3fc' : '#bae6fd'));
          }
          drawCircle(72, 26, 8, '#fde047');
          for (let i = -1; i <= 4; i++) {
            const tx = ((i * 24 - scrollX) % 110 + 110) % 110 - 15;
            drawRect(tx + 4, GROUND_Y - 20, 4, 20, '#78350f');
            drawCircle(tx + 6, GROUND_Y - 24, 9, '#15803d');
            drawCircle(tx + 5, GROUND_Y - 27, 6, '#22c55e');
          }
          drawRect(0, GROUND_Y, COLS, 5, '#22c55e');
          drawRect(0, GROUND_Y + 5, COLS, ROWS - GROUND_Y - 5, '#15803d');
          return;
        }

        // 7. ESPACIO AÉREO / CIELO (Se desplazan las nubes suavemente)
        if (theme === 'sky_airspace') {
          for (let r = 0; r < ROWS; r++) {
            drawRect(0, r, COLS, 1, r < 45 ? '#0284c7' : (r < 95 ? '#38bdf8' : '#0369a1'));
          }
          const cloudShift = Math.floor(localFrame * 0.8);
          for (let i = 0; i < 5; i++) {
            const cx = ((i * 22 - cloudShift) % 110 + 110) % 110 - 15;
            const cy = 28 + (i * 13) % 55;
            drawRect(cx, cy, 18, 5, '#ffffff');
            drawRect(cx + 4, cy - 3, 10, 3, '#f8fafc');
          }
          return;
        }

        // 8. BÓVEDA BANCARIA / LABORATORIO / CIUDAD NOCTURNA (Estáticos salvo viaje)
        for (let r = 0; r < GROUND_Y; r++) {
          drawRect(0, r, COLS, 1, r < 40 ? '#0f172a' : '#1e293b');
        }
        // Estrellas parpadeando arriba
        for (let s = 0; s < 16; s++) {
          if ((Math.floor(localFrame / 8) + s) % 3 !== 0) {
            drawRect((s * 17) % COLS, 18 + (s * 7) % 20, 1, 1, '#ffffff');
          }
        }
        // Edificios estáticos (o con scrollX si es vehicle_journey)
        for (let i = 0; i < 5; i++) {
          const bx = ((i * 20 - scrollX) % 100 + 100) % 100 - 10;
          const bh = 38 + (i % 3) * 12;
          drawRect(bx, GROUND_Y - bh, 16, bh, i % 2 === 0 ? '#1e293b' : '#334155');
          for (let wy = GROUND_Y - bh + 5; wy < GROUND_Y - 6; wy += 7) {
            for (let wx = bx + 3; wx < bx + 13; wx += 5) {
              drawRect(wx, wy, 3, 4, ((wx + wy) % 2 === 0) ? '#fde047' : '#38bdf8');
            }
          }
        }
        drawRect(0, GROUND_Y, COLS, 3, '#94a3b8');
        drawRect(0, GROUND_Y + 3, COLS, ROWS - GROUND_Y - 3, '#0f172a');
      }

      // ======================================================================
      // 10 COMPOSICIONES PROGRESIVAS (AVANZAN DE 0.0 A 1.0 SIN BUCLES REPETITIVOS)
      // ======================================================================
      function renderProgressiveStage(esc, progress, localFrame) {
        const layout = esc.stage_layout || 'signal_transmission';
        const icon1 = esc.actor_1?.icon || 'telephone';
        const icon2 = esc.actor_2?.icon || 'postal-horn';

        // 1. DESCUBRIMIENTO DENTRO DE CAJA / CONTENEDOR (progress 0.0 -> 1.0)
        // Ej: El silbato saliendo de dentro de la caja de cereales Cap'n Crunch
        if (layout === 'unbox_discovery') {
          // La caja/contenedor está en la parte inferior central y se abre en progress = 0.25
          const boxY = GROUND_Y - 16;
          drawSolidSprite(icon1, 45, boxY, 1.15, false);

          // A partir de progress = 0.20, el objeto descubierto (icon2) emerge suavemente hacia arriba
          if (progress > 0.15) {
            const emergeP = Math.min(1, (progress - 0.15) / 0.55);
            const easeOut = 1 - Math.pow(1 - emergeP, 3);
            const itemY = boxY - Math.round(easeOut * 34);
            const itemScale = 0.5 + easeOut * 0.75;

            // Halo de descubrimiento dorado detrás del objeto emergente
            if (emergeP > 0.5) {
              drawRing(45, itemY, Math.round(16 + Math.sin(localFrame * 0.2) * 2), 2, '#fde047');
            }
            drawSolidSprite(icon2, 45, itemY, itemScale, false);
          }
          return;
        }

        // 2. TRANSMISIÓN DE SEÑAL / ONDA ACÚSTICA DE A -> B (progress 0.0 -> 1.0)
        // Ej: Al soplar el silbato (izquierda), una onda de 2600 Hz viaja e impacta en el teléfono/troncal (derecha)
        if (layout === 'signal_transmission') {
          drawSolidSprite(icon1, 20, GROUND_Y - 24, 1.05, false);
          drawSolidSprite(icon2, 70, GROUND_Y - 24, 1.05, false);

          // Onda sinusoidal acústica y anillos viajando de X=32 a X=58 según progress
          const waveReachX = Math.round(32 + progress * 28);
          for (let x = 32; x <= waveReachX; x++) {
            const wy = (GROUND_Y - 24) + Math.round(Math.sin((x - localFrame * 0.6) * 0.45) * 8);
            drawRect(x, wy, 2, 3, '#00f5d4');
          }
          const pulseX = 32 + Math.round(progress * 26);
          drawRing(pulseX, GROUND_Y - 24, 6, 2, '#fde047');

          // Cuando la señal alcanza el receptor (progress > 0.75), el receptor brilla con un aura verde/amarilla
          if (progress > 0.75) {
            drawRing(70, GROUND_Y - 24, 18, 2, '#4ade80');
          }
          return;
        }

        // 3. ENRUTAMIENTO EN MAPA GLOBAL (progress 0.0 -> 1.0)
        // Ej: Desviar llamadas a través de continentes enteros hasta llegar a la Casa Blanca
        if (layout === 'world_map_routing') {
          const nodes = [
            { x: 18, y: 74 },
            { x: 38, y: 46 },
            { x: 56, y: 70 },
            { x: 72, y: 44 }
          ];

          // Dibujar los nodos intermedios y trazar la línea progresivamente de nodo en nodo
          const totalSegments = nodes.length - 1;
          const currentFloat = progress * totalSegments;

          for (let i = 0; i < totalSegments; i++) {
            const segP = Math.max(0, Math.min(1, currentFloat - i));
            if (segP > 0) {
              const nx = nodes[i].x + (nodes[i + 1].x - nodes[i].x) * segP;
              const ny = nodes[i].y + (nodes[i + 1].y - nodes[i].y) * segP;
              drawLine(nodes[i].x, nodes[i].y, nx, ny, 2, '#ef4444');
            }
            drawCircle(nodes[i].x, nodes[i].y, 3, '#fde047');
          }

          // Icono de origen abajo a la izquierda e Icono de destino (ej. Casa Blanca) arriba a la derecha
          drawSolidSprite(icon1, 18, 74, 0.85, false);
          drawSolidSprite(icon2, 72, 44, 1.05, false);
          if (progress > 0.85) {
            drawRing(72, 44, 18, 2, '#fde047');
          }
          return;
        }

        // 4. CONSOLA DE CONTROL Y OVERRIDE DE SISTEMA (progress 0.0 -> 1.0)
        // Ej: El sistema creía que la llamada había terminado, pero la conexión permanecía abierta
        if (layout === 'system_override_console') {
          // Gran monitor de control en la parte superior central
          drawRect(14, 28, 62, 36, '#e2e8f0');
          drawRect(16, 30, 58, 32, '#05070c');

          // Barra de estado progresiva dentro del monitor que pasa de CERRADO a ABIERTO/OVERRIDE
          const barW = Math.round(50 * progress);
          const isOverride = progress > 0.55;
          drawRect(20, 42, 50, 8, '#1e293b');
          drawRect(20, 42, barW, 8, isOverride ? '#10b981' : '#f97316');

          // Protagonista operando abajo a la izquierda y los dos iconos a los lados
          drawPerson(18, GROUND_Y - 8, '#38bdf8', '#4a2c11', false, localFrame, false);
          drawSolidSprite(icon1, 44, GROUND_Y - 18, 0.95, false);
          drawSolidSprite(icon2, 70, GROUND_Y - 18, 0.95, false);
          return;
        }

        // 5. CONFRONTACIÓN DAVID VS GOLIAT (progress 0.0 -> 1.0)
        // Ej: La mayor empresa telefónica del mundo derrotada por un simple juguete
        if (layout === 'versus_confrontation') {
          const slideIn = Math.min(1, progress / 0.35);
          const x1 = Math.round(-10 + slideIn * 34);
          const x2 = Math.round(100 - slideIn * 34);

          drawSolidSprite(icon1, x1, GROUND_Y - 22, 1.20, false);
          drawSolidSprite(icon2, x2, GROUND_Y - 20, 1.00, false);

          // Rayo de choque en el centro cuando colisionan las fuerzas
          if (progress > 0.40) {
            drawLine(45, 36, 42, 62, 2, '#fde047');
            drawLine(42, 62, 48, 68, 2, '#fde047');
            drawLine(48, 68, 44, 96, 2, '#fde047');
          }
          return;
        }

        // 6. TRAYECTO EN VEHÍCULO / VUELO (Aquí el fondo SÍ se desplaza)
        if (layout === 'vehicle_journey') {
          const vx = Math.round(20 + progress * 35);
          const vy = (esc.world_theme === 'sky_airspace') ? 56 : (GROUND_Y - 18);
          drawSolidSprite(icon1, vx, vy, 1.25, false);
          drawSolidSprite(icon2, 72, 38, 0.90, false);
          return;
        }

        // 7. PERSECUCIÓN EN MOVIMIENTO (Aquí el fondo SÍ se desplaza)
        if (layout === 'chase_pursuit') {
          const chaserX = Math.round(16 + progress * 34);
          const targetX = Math.min(76, chaserX + 24 - Math.round(progress * 10));
          const bounceY = GROUND_Y - 16 - Math.abs(Math.round(Math.sin(progress * Math.PI * 4) * 14));

          drawSolidSprite(icon1, chaserX, GROUND_Y - 18, 1.10, false);
          drawSolidSprite(icon2, targetX, bounceY, 0.95, false);
          return;
        }

        // 8. REACCIÓN EN CADENA SECUENCIAL (progress 0.0 -> 1.0)
        if (layout === 'chain_reaction') {
          const thresholds = [0.15, 0.40, 0.65, 0.85];
          thresholds.forEach((th, idx) => {
            const px = 16 + idx * 19;
            const activated = progress >= th;
            drawSolidSprite(activated ? icon2 : icon1, px, GROUND_Y - 18, 0.85, false);
            if (activated) {
              drawRing(px, GROUND_Y - 18, 12, 1, '#fde047');
            }
          });
          return;
        }

        // 9. ESCENARIO DE DIÁLOGO / FUNDADORES (progress 0.0 -> 1.0)
        if (layout === 'dialogue_stage') {
          drawPerson(22, GROUND_Y - 8, '#38bdf8', '#4a2c11', false, localFrame, false);
          drawPerson(68, GROUND_Y - 8, '#f43f5e', '#1e293b', false, localFrame, true);

          // Pantalla central mostrando el primer objeto en la 1ª mitad de la frase y el 2º en la 2ª mitad
          drawRect(28, 30, 34, 34, '#ffffff');
          drawRect(30, 32, 30, 30, '#0f172a');
          const shownIcon = (progress < 0.5) ? icon1 : icon2;
          drawSolidSprite(shownIcon, 45, 47, 0.95, false);
          return;
        }

        // 10. MONUMENTO FINAL / LEGADO HISTÓRICO (progress 0.0 -> 1.0)
        // Pedestal central con ambos iconos de legado y partículas ascendentes
        drawRect(28, GROUND_Y - 12, 34, 12, '#475569');
        drawRect(24, GROUND_Y - 4, 42, 4, '#94a3b8');
        drawSolidSprite(icon1, 33, GROUND_Y - 30, 1.05, false);
        drawSolidSprite(icon2, 57, GROUND_Y - 30, 1.05, false);
        for (let p = 0; p < 8; p++) {
          const px = 20 + (p * 7);
          const py = Math.round(GROUND_Y - 16 - ((progress * 50 + p * 9) % 50));
          drawRect(px, py, 2, 2, '#fde047');
        }
      }

      // FUENTE PIXEL ART 3x5 PARA RÓTULOS EN PANTALLA
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

      function drawPixelString(str, centerX, startY, color) {
        const clean = String(str || '').toUpperCase().replace(/[^A-Z0-9$%!? ]/g, '').slice(0, 11);
        if (!clean) return;
        const scale = 2; // Escala doble para la rejilla 90x160
        const charW = 3 * scale;
        const charH = 5 * scale;
        const gap = 1 * scale;
        const totalW = clean.length * (charW + gap) - gap;
        let cx = Math.max(3, Math.floor(centerX - totalW / 2));

        drawRect(cx - 3, startY - 2, totalW + 6, charH + 4, '#05050a');
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const glyph = FONT_3X5[ch];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') {
                  drawRect(cx + c * scale, startY + r * scale, scale, scale, color);
                }
              }
            }
          }
          cx += charW + gap;
        }
      }

      function flushGridToCanvas() {
        ctx.fillStyle = '#05050a';
        ctx.fillRect(0, 0, 720, 1280);
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

        // 1. Pintar el Mundo (Estático por defecto; solo se desplaza si es viaje/persecución)
        drawWorld(esc, localFrame);

        // 2. Pintar la Composición Progresiva de la Escena (0.0 -> 1.0 sin bucles repetitivos)
        renderProgressiveStage(esc, progress, localFrame);

        // 3. Rótulos superiores e inferiores nítidos
        if (esc.texto_1) drawPixelString(esc.texto_1, 45, 14, '#ffd166');
        if (esc.texto_2) drawPixelString(esc.texto_2, 45, 110, '#00f5d4');

        // 4. Volcar la matriz 90x160 al lienzo
        flushGridToCanvas();

        // 5. Subtítulos sincronizados
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
  await page.setViewport({ width: 720, height: 1280 });
  await page.goto('file://' + path.resolve('index_8bit.html'), { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');
  await page.evaluate(async () => { await window.initSpritesReady; });

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Pixel-Art Pro v6.0 (${duracionExactaVideo.toFixed(2)}s)...`);
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

  console.log('🔊 Ensamblando MP4 final Pixel-Art Pro v6.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -crf 24 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Universal 8-Bit v6.0 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
