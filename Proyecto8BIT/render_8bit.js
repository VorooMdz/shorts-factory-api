const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. UTILIDADES DE RED Y AUTO-BUSCADOR DE SPRITES (ICONIFY COLOR + VECTOR)
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

// Diccionario rápido de traducción Español -> Inglés por si la IA envía algún término en español
const ES_TO_EN_MAP = {
  'perro': 'dog', 'pelota': 'tennis', 'avion': 'airplane', 'cohete': 'rocket',
  'virus': 'biohazard', 'calavera': 'skull', 'esqueleto': 'skull', 'mago': 'mage',
  'espada': 'crossed-swords', 'escudo': 'shield', 'chip': 'microchip', 'reloj': 'stopwatch',
  'ordenador': 'laptop', 'servidor': 'server', 'dinero': 'money-bag', 'moneda': 'coin',
  'banco': 'bank', 'fuego': 'fire', 'explosion': 'collision', 'alerta': 'warning',
  'medico': 'health-worker', 'hospital': 'hospital', 'coche': 'automobile', 'camion': 'delivery-truck',
  'tren': 'high-speed-train', 'barco': 'ship', 'mundo': 'globe-showing-americas', 'ciencia': 'microscope',
  'dragon': 'dragon', 'gato': 'cat', 'leon': 'lion', 'comida': 'hamburger', 'pizza': 'pizza',
  'corazon': 'red-heart', 'cerebro': 'brain', 'robot': 'robot', 'telefono': 'mobile-phone',
  'satelite': 'satellite', 'bomba': 'bomb', 'llave': 'key', 'candado': 'locked', 'trofeo': 'trophy'
};

async function resolveSvgForPixelArt(rawQuery) {
  let q = String(rawQuery || 'sparkles').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_:\s]/g, '').trim();

  if (ES_TO_EN_MAP[q]) q = ES_TO_EN_MAP[q];
  const cleanName = q.includes(':') ? q.split(':')[1] : q.replace(/\s+/g, '-');

  // 1. Intentar primero packs a todo color (Twemoji / Noto) ideales para rasterizar a Pixel Art
  const directPrefixes = ['twemoji', 'noto', 'fluent-emoji-flat', 'lucide', 'tabler'];
  for (const pref of directPrefixes) {
    const svg = await fetchText(`https://api.iconify.design/${pref}/${cleanName}.svg`);
    if (svg && svg.includes('<svg')) {
      return { svg, isColorPack: ['twemoji', 'noto', 'fluent-emoji-flat'].includes(pref) };
    }
  }

  // 2. Búsqueda semántica en Iconify priorizando packs coloridos y de videojuegos
  const searchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(cleanName)}&prefixes=twemoji,noto,fluent-emoji-flat,game-icons,lucide,tabler&limit=6`;
  const searchRes = await fetchText(searchUrl);
  if (searchRes) {
    try {
      const parsed = JSON.parse(searchRes);
      if (Array.isArray(parsed.icons) && parsed.icons.length > 0) {
        // Priorizar twemoji o noto si están en los resultados
        const colorMatch = parsed.icons.find(ic => ic.startsWith('twemoji:') || ic.startsWith('noto:') || ic.startsWith('fluent-emoji-flat:'));
        const chosen = colorMatch || parsed.icons[0];
        const [bPref, bName] = chosen.split(':');
        const svg = await fetchText(`https://api.iconify.design/${bPref}/${bName}.svg`);
        if (svg && svg.includes('<svg')) {
          return { svg, isColorPack: ['twemoji', 'noto', 'fluent-emoji-flat'].includes(bPref) };
        }
      }
    } catch (e) {}
  }

  // 3. Fallback garantizado
  const fallbackSvg = await fetchText('https://api.iconify.design/twemoji/sparkles.svg');
  return { svg: fallbackSvg || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#ffd166"/></svg>', isColorPack: true };
}

async function preloadAllSceneSprites(escenas) {
  const spriteCache = {};
  const keysToFetch = new Set(['dog', 'tennis', 'airplane', 'microchip', 'skull', 'biohazard', 'robot', 'money-bag', 'fire', 'warning', 'sparkles']);

  for (const s of (escenas || [])) {
    if (s.actor_1?.icon) keysToFetch.add(String(s.actor_1.icon).toLowerCase().trim());
    if (s.actor_2?.icon) keysToFetch.add(String(s.actor_2.icon).toLowerCase().trim());
    if (s.projectile_icon) keysToFetch.add(String(s.projectile_icon).toLowerCase().trim());
  }

  for (const key of keysToFetch) {
    if (key && !spriteCache[key]) {
      spriteCache[key] = await resolveSvgForPixelArt(key);
    }
  }
  return spriteCache;
}

// ============================================================================
// 2. ALINEACIÓN FONÉTICA DE SUBTÍTULOS
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
// 3. SINTETIZADOR CHIPTUNE 8-BIT PROCEDURAL (CORREGIDO Y AMPLIADO)
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
// 4. AUTO-SANITIZADOR SEMÁNTICO DE ESCENAS (GARANTIZA CERO ESCENAS VACÍAS)
// ============================================================================
function enrichScenesWithSemantics(escenas) {
  const worldThemes = ['sky_clouds', 'city_street', 'tech_lab', 'nature_park', 'office_interior', 'medieval_fantasy', 'hospital_clinic', 'financial_floor', 'industrial_plant', 'deep_space'];
  const choreographies = ['chase_and_catch', 'sky_flight_crisis', 'crowd_contagion', 'counter_overflow_boom', 'projectile_impact', 'dialogue_interaction', 'workstation_action', 'hero_showcase'];
  const timeModes = ['day', 'sunset', 'night', 'cyber'];

  return (escenas || []).map((esc, idx) => {
    const text = `${esc.subtitulo || ''} ${esc.texto_1 || ''} ${esc.texto_2 || ''} ${esc.narrativa_visual || ''}`.toLowerCase();

    // Inferencia inteligente si la IA usó otro esquema o dejó algún campo vacío
    let world = esc.world_theme || esc.bg_type || '';
    let choreo = esc.choreography || esc.diorama || '';
    let icon1 = esc.actor_1?.icon || (Array.isArray(esc.actors) && esc.actors[0]?.tipo) || '';
    let icon2 = esc.actor_2?.icon || (Array.isArray(esc.actors) && esc.actors[1]?.tipo) || '';
    let proj = esc.projectile_icon || '';

    if (!world || !worldThemes.includes(world)) {
      if (/avion|boeing|vuelo|aire|piloto|aeropuerto|cielo/.test(text)) world = 'sky_clouds';
      else if (/perro|parque|pelota|bosque|montana|animal|arbol|campo/.test(text)) world = 'nature_park';
      else if (/warcraft|jefe|hechizo|castillo|espada|juego|fantasia|heroe/.test(text)) world = 'medieval_fantasy';
      else if (/calle|ciudad|capital|edificio|trafico|gente|habitante/.test(text)) world = 'city_street';
      else if (/hospital|medico|paciente|clinica|pandemia|virus|enfermedad|ciencia|cientifico/.test(text)) world = 'hospital_clinic';
      else if (/bolsa|dinero|millon|precio|banco|accion|mercado/.test(text)) world = 'financial_floor';
      else if (/generador|motor|energia|planta|nuclear|fabrica|maquina/.test(text)) world = 'industrial_plant';
      else if (/espacio|cohete|satelite|planeta|orbita/.test(text)) world = 'deep_space';
      else if (/software|codigo|bit|contador|servidor|computadora|sistema|reboot|reset/.test(text)) world = 'tech_lab';
      else world = worldThemes[idx % worldThemes.length];
    }

    if (!choreo || !choreographies.includes(choreo)) {
      if (/avion|boeing|vuelo|cohete|apagar|aire/.test(text)) choreo = 'sky_flight_crisis';
      else if (/contagi|pandemia|esparci|propag|infect|esqueleto|habitante|masivo/.test(text)) choreo = 'crowd_contagion';
      else if (/contador|bit|248|dos mil millones|overflow|desbordamiento|negativo|numero/.test(text)) choreo = 'counter_overflow_boom';
      else if (/perro|pelota|perseguir|correr|huir|escapar|cazar|huyeron/.test(text)) choreo = 'chase_and_catch';
      else if (/lanzaba|ataque|dispar|hechizo|maldicion|cortando|rayo/.test(text)) choreo = 'projectile_impact';
      else if (/estudio|cientifico|programador|reiniciar|servidor|consola/.test(text)) choreo = 'workstation_action';
      else if (/hablar|comerciante|orden|ley|acuerdo/.test(text)) choreo = 'dialogue_interaction';
      else choreo = choreographies[idx % choreographies.length];
    }

    if (!icon1) {
      if (/avion|boeing|vuelo/.test(text)) icon1 = 'airplane';
      else if (/perro|mascota/.test(text)) icon1 = 'dog';
      else if (/hakkar|jefe|monstruo|dragon/.test(text)) icon1 = 'dragon';
      else if (/jugador|guerrero|personaje|heroe/.test(text)) icon1 = 'mage';
      else if (/cientifico|medico|estudio/.test(text)) icon1 = 'microscope';
      else if (/servidor|blizzard|computadora/.test(text)) icon1 = 'laptop';
      else if (/generador|energia|luz/.test(text)) icon1 = 'zap';
      else icon1 = 'robot';
    }

    if (!icon2) {
      if (/pelota|bola/.test(text)) icon2 = 'tennis';
      else if (/chip|software|bit|codigo/.test(text)) icon2 = 'microchip';
      else if (/esqueleto|muerte|caos/.test(text)) icon2 = 'skull';
      else if (/virus|pandemia|contagio|maldicion/.test(text)) icon2 = 'biohazard';
      else if (/reloj|tiempo|dia|segundo|meses/.test(text)) icon2 = 'stopwatch';
      else if (/alerta|peligro|panico|fallo|error/.test(text)) icon2 = 'warning';
      else icon2 = 'sparkles';
    }

    if (!proj) {
      if (/virus|contagio|maldicion|hechizo/.test(text)) proj = 'biohazard';
      else if (/energia|luz|electrica|rayo/.test(text)) proj = 'zap';
      else if (/fuego|explosion|ataque/.test(text)) proj = 'fire';
      else proj = 'sparkles';
    }

    return {
      ...esc,
      world_theme: world,
      time_of_day: esc.time_of_day || timeModes[idx % timeModes.length],
      weather: esc.weather || (idx % 3 === 0 ? 'sparks' : 'clear'),
      choreography: choreo,
      camera_mode: esc.camera_mode || (idx % 2 === 0 ? 'pan_right' : 'zoom_in'),
      actor_1: {
        icon: String(icon1).toLowerCase().trim(),
        color: esc.actor_1?.color || '#00f5d4',
        label: esc.actor_1?.label || ''
      },
      actor_2: {
        icon: String(icon2).toLowerCase().trim(),
        color: esc.actor_2?.color || '#ffd166',
        label: esc.actor_2?.label || ''
      },
      projectile_icon: String(proj).toLowerCase().trim(),
      counter_value: esc.counter_value || (/\d+/.exec(text)?.[0] || '2147483647')
    };
  });
}

// ============================================================================
// 5. FUNCIÓN PRINCIPAL Y MOTOR DE RENDERIZADO 8-BIT v5.0 (60x106 BLOQUES)
// ============================================================================
async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload Universal 8-BIT v5.0 desde URL...');
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

  // Enriquecer y blindar todas las escenas para que ninguna quede vacía jamás
  const escenasEnriquecidas = enrichScenesWithSemantics(payload.escenas || []);
  // Evitar repetir el mismo mundo o coreografía en dos escenas consecutivas
  const allWorlds = ['sky_clouds', 'city_street', 'tech_lab', 'nature_park', 'office_interior', 'medieval_fantasy', 'hospital_clinic', 'financial_floor', 'industrial_plant', 'deep_space'];
  const allChoreos = ['chase_and_catch', 'sky_flight_crisis', 'crowd_contagion', 'counter_overflow_boom', 'projectile_impact', 'dialogue_interaction', 'workstation_action', 'hero_showcase'];
  for (let i = 1; i < escenasEnriquecidas.length; i++) {
    if (escenasEnriquecidas[i].world_theme === escenasEnriquecidas[i - 1].world_theme) {
      escenasEnriquecidas[i].world_theme = allWorlds[(idx = i * 3 + hash) % allWorlds.length];
    }
    if (escenasEnriquecidas[i].choreography === escenasEnriquecidas[i - 1].choreography) {
      escenasEnriquecidas[i].choreography = allChoreos[(i * 5 + hash) % allChoreos.length];
    }
  }

  console.log('🎨 Descargando y rasterizando Sprites universales desde Iconify...');
  const spriteCache = await preloadAllSceneSprites(escenasEnriquecidas);
  const subtitleChunks = buildSubtitleChunks(escenasEnriquecidas, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio con bg_music2.mp3 + SFX Chiptune
  try {
    let hasSfx = false;
    try { hasSfx = buildChiptuneSfxTrack(escenasEnriquecidas, duracionExactaVideo, hash); } catch (e) {}

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
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.18) 50%);
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
      <div class="hud-tag">${(payload.subrama || 'PIXEL DOCS 8-BIT').slice(0, 24)}</div>
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
      const escenas = ${JSON.stringify(escenasEnriquecidas)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const rawSpriteCache = ${JSON.stringify(spriteCache)};
      const totalFrames = ${totalFrames};

      // CUADRÍCULA DE ALTA DEFINICIÓN RETRO: 60x106 bloques (Cada bloque = 12x12 px -> 720x1272)
      const COLS = 60;
      const ROWS = 106;
      const CELL = 12;
      const GROUND_Y = 70;

      const canvas = document.getElementById('pixel-canvas');
      const ctx = canvas.getContext('2d');
      const viewportWrapper = document.getElementById('viewport-wrapper');

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
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) setCell(x + c, y + r, color);
        }
      }

      function drawCircle(cx, cy, radius, color) {
        for (let r = -radius; r <= radius; r++) {
          for (let c = -radius; c <= radius; c++) {
            if (c * c + r * r <= radius * radius) setCell(cx + c, cy + r, color);
          }
        }
      }

      function drawLine(x0, y0, x1, y1, color) {
        let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let cx = Math.round(x0), cy = Math.round(y0);
        const ex = Math.round(x1), ey = Math.round(y1);
        for (let i = 0; i < 120; i++) {
          setCell(cx, cy, color);
          if (cx === ex && cy === ey) break;
          let e2 = 2 * err;
          if (e2 >= dy) { err += dy; cx += sx; }
          if (e2 <= dx) { err += dx; cy += sy; }
        }
      }

      // ======================================================================
      // AUTO-PIXELADOR: CONVIERTE CUALQUIER SVG DE ICONIFY EN UNA MATRIZ 20x20
      // CON BORDE NEGRO RETRO (#05050A) Y CUANTIZACIÓN DE COLOR 8-BIT
      // ======================================================================
      async function rasterizeAllSprites() {
        const SIZE = 20;
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
              if (!/stroke=/i.test(svgText)) {
                svgText = svgText.replace(/<svg/i, '<svg fill="#00f5d4" stroke="#ffffff"');
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
            offCtx.drawImage(img, 1, 1, SIZE - 2, SIZE - 2);
            URL.revokeObjectURL(url);

            const imgData = offCtx.getImageData(0, 0, SIZE, SIZE).data;
            const mat = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
            let activePixels = 0;

            for (let r = 0; r < SIZE; r++) {
              for (let c = 0; c < SIZE; c++) {
                const idx = (r * SIZE + c) * 4;
                const a = imgData[idx + 3];
                if (a > 75) {
                  // Cuantizar canal RGB a saltos de 32 para estética 8-bit pura
                  const qr = Math.min(255, Math.round(imgData[idx] / 32) * 32);
                  const qg = Math.min(255, Math.round(imgData[idx + 1] / 32) * 32);
                  const qb = Math.min(255, Math.round(imgData[idx + 2] / 32) * 32);
                  const hex = '#' + [qr, qg, qb].map(v => v.toString(16).padStart(2, '0')).join('');
                  mat[r][c] = (hex === '#000000') ? '#1e293b' : hex;
                  activePixels++;
                }
              }
            }

            // Añadir silueta/borde negro 8-bit alrededor de los píxeles activos
            if (activePixels > 12) {
              const outlined = mat.map(row => [...row]);
              for (let r = 1; r < SIZE - 1; r++) {
                for (let c = 1; c < SIZE - 1; c++) {
                  if (!mat[r][c]) {
                    if (mat[r - 1][c] || mat[r + 1][c] || mat[r][c - 1] || mat[r][c + 1]) {
                      outlined[r][c] = '#05050a';
                    }
                  }
                }
              }
              rasterizedSprites[key] = outlined;
            }
          } catch (e) {}
        }
      }

      // DIBUJAR SPRITE RASTERIZADO CON DEFORMACIÓN PROCEDURAL DE PATAS, REBOTE Y ESCALA
      function drawSpriteMatrix(iconKey, centerX, centerY, animMode, localFrame, flipX, scale = 1) {
        const key = String(iconKey || 'sparkles').toLowerCase().trim();
        const mat = rasterizedSprites[key] || rasterizedSprites['sparkles'];
        if (!mat) return;

        const SIZE = mat.length;
        const step = Math.floor(localFrame / 4) % 2;

        // Deformación Squash & Stretch para rebotes (ej. pelotas, mascotas)
        let stretchX = 1.0, stretchY = 1.0;
        if (animMode === 'bounce_physics') {
          const phase = (localFrame % 18) / 18;
          if (phase < 0.15) { stretchX = 1.22; stretchY = 0.78; } // Aplastamiento contra el suelo
          else if (phase < 0.5) { stretchX = 0.90; stretchY = 1.12; } // Estiramiento al subir
        }

        for (let r = 0; r < SIZE; r++) {
          for (let c = 0; c < SIZE; c++) {
            const col = mat[r][c];
            if (!col) continue;

            let relX = (c - SIZE / 2) * stretchX * scale;
            let relY = (r - SIZE / 2) * stretchY * scale;
            if (flipX) relX = -relX;

            // Animación articular de patas/base (las últimas 5 filas del sprite alternan su zancada)
            if (animMode === 'walk_cycle' && r >= SIZE - 5) {
              const isLeftHalf = c < SIZE / 2;
              if ((isLeftHalf && step === 0) || (!isLeftHalf && step === 1)) {
                relX += flipX ? -2 : 2;
                relY -= 1;
              } else {
                relX += flipX ? 1 : -1;
              }
            }

            setCell(centerX + relX, centerY + relY, col);
          }
        }
      }

      // HUMANOIDE / CRIATURA 8-BIT ARTICULADO DE APOYO PARA MULTITUDES Y ESCENAS
      function drawArticulatedCharacter(x, y, shirtColor, state, localFrame, facingLeft) {
        const dir = facingLeft ? -1 : 1;
        const step = Math.floor(localFrame / 4) % 2;
        const put = (dx, dy, col) => setCell(x + dx * dir, y + dy, col);

        if (state === 'skeleton') {
          // Esqueleto 8-bit blanco para escenas de contagio/muerte (ej. WoW)
          drawRect(x - 2, y - 9, 5, 4, '#f8f9fa');
          setCell(x - 1, y - 8, '#05050a'); setCell(x + 1, y - 8, '#05050a');
          drawRect(x - 1, y - 4, 3, 4, '#e2e8f0');
          setCell(x - 2, y - 3, '#f8f9fa'); setCell(x + 2, y - 3, '#f8f9fa');
          setCell(x - 1, y, '#f8f9fa'); setCell(x + 1, y, '#f8f9fa');
          return;
        }

        // Sombra en el suelo
        drawRect(x - 2, y + 4, 5, 1, 'rgba(0,0,0,0.45)');
        // Cabeza con pelo y ojos
        drawRect(x - 2, y - 9, 5, 2, '#4a2c11');
        drawRect(x - 2, y - 7, 5, 3, '#ffcdb2');
        put(2, -6, '#05050a');
        // Torso
        drawRect(x - 2, y - 4, 5, 5, shirtColor || '#38bdf8');
        // Brazos y piernas con ciclo de caminata real
        if (step === 0) {
          put(-3, -3, shirtColor); put(-3, -2, '#ffcdb2');
          put(3, -4, shirtColor); put(3, -5, '#ffcdb2');
          put(-2, 1, '#1e3a8a'); put(-3, 2, '#1e3a8a'); put(-3, 3, '#ffffff');
          put(1, 1, '#1e3a8a'); put(2, 2, '#1e3a8a'); put(2, 3, '#ffffff');
        } else {
          put(-3, -4, shirtColor); put(-3, -5, '#ffcdb2');
          put(3, -3, shirtColor); put(3, -2, '#ffcdb2');
          put(-1, 1, '#1e3a8a'); put(-1, 2, '#1e3a8a'); put(-1, 3, '#ffffff');
          put(2, 1, '#1e3a8a'); put(3, 2, '#1e3a8a'); put(3, 3, '#ffffff');
        }
      }

      // ======================================================================
      // 10 MUNDOS PARALLAX MULTICAPA A TODO COLOR (NUNCA MÁS FONDO VACÍO)
      // ======================================================================
      function drawWorldEnvironment(esc, localFrame) {
        const theme = esc.world_theme || 'city_street';
        const farScroll = Math.floor(localFrame * 0.25);
        const midScroll = Math.floor(localFrame * 0.65);
        const floorScroll = Math.floor(localFrame * 1.1);

        // 1. PARQUE NATURAL / BOSQUE SOLEADO (Perros, naturaleza, deportes, vida)
        if (theme === 'nature_park') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 25 ? '#38bdf8' : (r < 48 ? '#7dd3fc' : '#bae6fd'));
          }
          drawCircle(48, 18, 6, '#fde047'); // Sol brillante
          // Nubes esponjosas
          for (let i = 0; i < 4; i++) {
            const cx = ((i * 18 - farScroll) % 72 + 72) % 72 - 8;
            drawRect(cx, 16 + (i % 2) * 7, 10, 3, '#ffffff');
            drawRect(cx + 2, 14 + (i % 2) * 7, 6, 2, '#ffffff');
          }
          // Colinas verdes lejanas
          for (let c = 0; c < COLS; c++) {
            const hh = 8 + Math.round(Math.sin((c + farScroll) * 0.12) * 4);
            drawRect(c, GROUND_Y - hh, 1, hh, '#4ade80');
          }
          // Árboles detallados en plano medio con Parallax
          for (let i = -1; i <= 4; i++) {
            const tx = ((i * 16 - midScroll) % 80 + 80) % 80 - 10;
            drawRect(tx + 3, GROUND_Y - 14, 3, 14, '#78350f'); // Tronco
            drawCircle(tx + 4, GROUND_Y - 17, 6, '#15803d');
            drawCircle(tx + 3, GROUND_Y - 19, 4, '#22c55e');
          }
          // Césped vivo con flores y tierra
          drawRect(0, GROUND_Y, COLS, 4, '#16a34a');
          drawRect(0, GROUND_Y + 4, COLS, ROWS - GROUND_Y - 4, '#15803d');
          for (let c = 0; c < COLS; c += 3) {
            const gx = ((c - floorScroll) % COLS + COLS) % COLS;
            setCell(gx, GROUND_Y + 1, '#86efac');
            if (c % 9 === 0) setCell(gx, GROUND_Y - 1, '#f43f5e'); // Flores rojas
          }
          return;
        }

        // 2. CIELO Y NUBES EN ALTURA (Boeing 787, aviación, clima, aves)
        if (theme === 'sky_clouds') {
          for (let r = 0; r < ROWS; r++) {
            const col = r < 30 ? '#0284c7' : (r < 62 ? '#38bdf8' : (r < 78 ? '#bae6fd' : '#0369a1'));
            drawRect(0, r, COLS, 1, col);
          }
          // Capa de nubes lejanas y cercanas desplazándose rápido (sensación de velocidad aérea)
          for (let i = 0; i < 6; i++) {
            const cx = ((i * 15 - floorScroll * 2) % 90 + 90) % 90 - 15;
            const cy = 20 + (i * 9) % 45;
            drawRect(cx, cy, 14, 4, '#ffffff');
            drawRect(cx + 3, cy - 2, 8, 2, '#f8fafc');
          }
          // Cordillera y océano allá abajo en la distancia
          for (let c = 0; c < COLS; c++) {
            const mh = 6 + Math.round(Math.cos((c + farScroll) * 0.18) * 4);
            drawRect(c, GROUND_Y - mh, 1, mh, '#334155');
          }
          return;
        }

        // 3. MUNDO FANTASÍA / MEDIEVAL / VIDEOJUEGO RPG (World of Warcraft, historia, batallas)
        if (theme === 'medieval_fantasy') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 26 ? '#1e1b4b' : (r < 50 ? '#312e81' : '#4c1d95'));
          }
          drawCircle(46, 18, 6, '#fef08a'); // Luna llena mágica
          // Silueta de castillo con almenas y antorchas encendidas
          for (let i = -1; i <= 3; i++) {
            const bx = ((i * 22 - midScroll) % 88 + 88) % 88 - 14;
            drawRect(bx, 26, 16, GROUND_Y - 26, '#1e293b');
            // Almenas de la torre
            for (let a = 0; a < 16; a += 4) drawRect(bx + a, 23, 2, 3, '#1e293b');
            // Ventana gótica iluminada
            drawRect(bx + 6, 34, 4, 8, '#fbbf24');
            // Antorcha llameante
            const flameCol = (localFrame + i) % 2 === 0 ? '#f97316' : '#fde047';
            drawRect(bx + 2, 48, 2, 3, flameCol);
          }
          // Suelo empedrado medieval
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((Math.floor((c + floorScroll) / 4) + Math.floor(r / 3)) % 2 === 0) ? '#475569' : '#334155';
            }
          }
          return;
        }

        // 4. CIUDAD VIVA / GRAN CAPITAL (Sociedad, tráfico, economía, historias urbanas)
        if (theme === 'city_street') {
          for (let r = 0; r < GROUND_Y; r++) {
            drawRect(0, r, COLS, 1, r < 30 ? '#1d3557' : '#457b9d');
          }
          for (let i = -1; i <= 4; i++) {
            const bx = ((i * 18 - midScroll) % 90 + 90) % 90 - 15;
            const bh = 28 + (i % 3) * 8;
            drawRect(bx, GROUND_Y - bh, 14, bh, i % 2 === 0 ? '#1e293b' : '#334155');
            for (let wy = GROUND_Y - bh + 4; wy < GROUND_Y - 6; wy += 5) {
              for (let wx = bx + 2; wx < bx + 12; wx += 4) {
                drawRect(wx, wy, 2, 3, ((wx + wy) % 3 === 0) ? '#fde047' : '#38bdf8');
              }
            }
          }
          // Asfalto con líneas viales en movimiento
          drawRect(0, GROUND_Y, COLS, 3, '#94a3b8');
          drawRect(0, GROUND_Y + 3, COLS, ROWS - GROUND_Y - 3, '#1e293b');
          for (let c = 0; c < COLS; c++) {
            if ((c + floorScroll * 2) % 10 < 5) drawRect(c, GROUND_Y + 8, 1, 2, '#facc15');
          }
          return;
        }

        // 5. HOSPITAL / CENTRO CIENTÍFICO DE INVESTIGACIÓN
        if (theme === 'hospital_clinic') {
          drawRect(0, 0, COLS, GROUND_Y, '#e0f2fe');
          drawRect(0, 42, COLS, 3, '#38bdf8');
          for (let i = -1; i <= 3; i++) {
            const px = ((i * 24 - midScroll) % 72 + 72) % 72 - 12;
            drawRect(px, 20, 14, 12, '#0f172a');
            for (let e = 0; e < 12; e++) {
              const py = (e === (localFrame % 12)) ? 23 : 26;
              setCell(px + 1 + e, py, '#4ade80');
            }
            drawRect(px + 17, 21, 3, 9, '#ef4444');
            drawRect(px + 14, 24, 9, 3, '#ef4444');
          }
          for (let r = GROUND_Y; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              grid[r][c] = ((Math.floor((c + floorScroll) / 4) + Math.floor(r / 3)) % 2 === 0) ? '#f1f5f9' : '#cbd5e1';
            }
          }
          return;
        }

        // 6. LABORATORIO TECNOLÓGICO / SERVIDORES / FINANZAS / PLANTA INDUSTRIAL
        drawRect(0, 0, COLS, GROUND_Y, '#0f172a');
        // Líneas de datos en el techo
        drawRect(0, 16, COLS, 2, '#1e293b');
        for (let p = 0; p < 6; p++) {
          const px = (p * 10 + localFrame * 2) % COLS;
          drawRect(px, 16, 2, 2, '#00f5d4');
        }
        // Racks y pantallas holográficas en movimiento con midScroll
        for (let i = -1; i <= 4; i++) {
          const rx = ((i * 16 - midScroll) % 80 + 80) % 80 - 12;
          drawRect(rx, 22, 11, GROUND_Y - 22, '#1e293b');
          drawRect(rx + 1, 24, 9, GROUND_Y - 26, '#090d16');
          for (let ry = 27; ry < GROUND_Y - 5; ry += 4) {
            const on = ((localFrame + ry + i) % 8) < 4;
            drawRect(rx + 2, ry, 3, 2, on ? '#10b981' : '#064e3b');
            drawRect(rx + 6, ry, 2, 2, !on ? '#38bdf8' : '#ef4444');
          }
        }
        for (let r = GROUND_Y; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            grid[r][c] = ((c + floorScroll) % 6 === 0 || r % 4 === 0) ? '#0284c7' : '#090d16';
          }
        }
      }

      // ======================================================================
      // 8 COREOGRAFÍAS DINÁMICAS UNIVERSALES (ANIMAN CUALQUIER COMBINACIÓN DE OBJETOS)
      // ======================================================================
      function renderSceneChoreography(esc, localFrame) {
        const choreo = esc.choreography || 'chase_and_catch';
        const icon1 = esc.actor_1?.icon || 'dog';
        const icon2 = esc.actor_2?.icon || 'tennis';
        const projIcon = esc.projectile_icon || 'sparkles';

        // 1. PERSECUCIÓN Y REBOTE CON FÍSICA REAL (Ej: Perro jugando con pelota, persecución, huida)
        if (choreo === 'chase_and_catch') {
          const cycle = localFrame % 75;
          const runnerX = 12 + Math.floor((cycle / 75) * 32);
          const ballX = Math.min(52, runnerX + 14 - Math.floor((cycle / 75) * 8));
          const bounceY = GROUND_Y - 9 - Math.abs(Math.round(Math.sin(localFrame * 0.32) * 14));

          // Dibujar Actor 1 corriendo con patas animadas detrás de Actor 2
          drawSpriteMatrix(icon1, runnerX, GROUND_Y - 10, 'walk_cycle', localFrame, false, 1.15);
          // Dibujar Actor 2 botando con física de aplastamiento y estiramiento
          drawSpriteMatrix(icon2, ballX, bounceY, 'bounce_physics', localFrame, false, 0.95);

          // Partículas de polvo al correr y estrellitas cuando la alcanza
          setCell(runnerX - 8, GROUND_Y - 2, '#ffffff');
          setCell(runnerX - 10, GROUND_Y - 3, '#cbd5e1');
          if (Math.abs(runnerX - ballX) < 9) {
            for (let s = 0; s < 6; s++) {
              const ang = (s / 6) * Math.PI * 2 + localFrame * 0.2;
              setCell(ballX + Math.cos(ang) * 8, bounceY + Math.sin(ang) * 8, '#fde047');
            }
          }
          return;
        }

        // 2. VUELO Y CRISIS AÉREA (Ej: Boeing 787 apagándose en vuelo, cohete, ave)
        if (choreo === 'sky_flight_crisis') {
          const isCrisis = localFrame > 28;
          const planeX = 22 + Math.round(Math.sin(localFrame * 0.1) * 6);
          const planeY = isCrisis
            ? Math.min(GROUND_Y - 8, 36 + Math.floor((localFrame - 28) * 0.65))
            : (36 + Math.round(Math.sin(localFrame * 0.22) * 3));

          // Estela de viento y humo detrás del avión/objeto volador
          for (let tr = 1; tr <= 12; tr++) {
            const trailCol = isCrisis ? (tr % 2 === 0 ? '#ef4444' : '#475569') : '#ffffff';
            drawCircle(planeX - tr * 2, planeY + (isCrisis ? -tr : 2), isCrisis ? 2 : 1, trailCol);
          }

          drawSpriteMatrix(icon1, planeX, planeY, 'fly_bank', localFrame, false, 1.35);

          // El culpable/evento secundario (ej: chip, rayo, alerta) parpadeando arriba a la derecha
          const badgeY = 28 + Math.round(Math.cos(localFrame * 0.3) * 2);
          drawSpriteMatrix(icon2, 46, badgeY, 'pulse_float', localFrame, false, 1.0);
          if (isCrisis) {
            drawLine(42, badgeY, planeX + 4, planeY - 2, '#ef4444');
          }
          return;
        }

        // 3. CONTAGIO MASIVO / TRANSFORMACIÓN DE MULTITUD (Ej: Pandemia WoW, tendencias sociales)
        if (choreo === 'crowd_contagion') {
          // Jefe / Fuente en la parte superior izquierda lanzando el hechizo/esporas
          drawSpriteMatrix(icon1, 14, 34, 'pulse_float', localFrame, false, 1.25);

          // 4 Habitantes en la calle que van siendo alcanzados por las esporas y transformándose
          const positions = [24, 34, 44, 52];
          positions.forEach((px, idx) => {
            const infectFrame = 12 + idx * 14;
            const isInfected = localFrame >= infectFrame;

            // Proyectil/espora viajando en arco hacia cada habitante
            if (localFrame < infectFrame && localFrame > infectFrame - 14) {
              const p = (localFrame - (infectFrame - 14)) / 14;
              const sx = 14 + p * (px - 14);
              const sy = 34 + p * (GROUND_Y - 8 - 34) - Math.sin(p * Math.PI) * 12;
              drawCircle(sx, sy, 2, '#4ade80');
              setCell(sx, sy, '#ef4444');
            }

            if (isInfected) {
              // Se transforma en Actor 2 (ej: calavera/esqueleto/infectado)
              drawSpriteMatrix(icon2, px, GROUND_Y - 9, 'bounce_physics', localFrame + idx * 5, false, 0.95);
              setCell(px, GROUND_Y - 18 - (localFrame % 6), '#4ade80');
            } else {
              drawArticulatedCharacter(px, GROUND_Y - 4, idx % 2 === 0 ? '#38bdf8' : '#f97316', 'walk', localFrame + idx * 7, true);
            }
          });
          return;
        }

        // 4. CONTADOR DIGITAL EN VIVO + DESBORDAMIENTO (Ej: 32 bits, Día 248, Y2K, precios)
        if (choreo === 'counter_overflow_boom') {
          const isOverflow = localFrame > 32;
          // Gran pantalla LED retro en el centro superior (Y=24..38)
          drawRect(8, 23, 44, 15, '#05050a');
          drawRect(9, 24, 42, 13, isOverflow ? '#450a0a' : '#064e3b');
          const displayNum = isOverflow ? 'OVERFLOW' : String( Math.min(2147483647, 1999999000 + localFrame * 4812345) ).slice(0, 9);
          drawPixelString(displayNum, 30, 28, isOverflow ? '#ef4444' : '#4ade80');

          // Actores debajo recibiendo la descarga cuando el contador desborda
          drawSpriteMatrix(icon1, 18, GROUND_Y - 10, 'walk_cycle', localFrame, false, 1.15);
          drawSpriteMatrix(icon2, 42, GROUND_Y - 10, 'bounce_physics', localFrame, true, 1.15);

          if (isOverflow) {
            drawLine(30, 38, 18, GROUND_Y - 12, '#ef4444');
            drawLine(30, 38, 42, GROUND_Y - 12, '#fde047');
          }
          return;
        }

        // 5. IMPACTO DE PROYECTILES / BATALLA / CAUSA-EFECTO DIRECTO
        if (choreo === 'projectile_impact') {
          drawSpriteMatrix(icon1, 14, GROUND_Y - 10, 'walk_cycle', localFrame, false, 1.2);
          const hit = (localFrame % 20) > 12;
          drawSpriteMatrix(icon2, 46 + (hit ? 2 : 0), GROUND_Y - 10, 'bounce_physics', localFrame, true, 1.2);

          // Proyectiles viajando de Actor 1 a Actor 2
          const prog = (localFrame % 20) / 20;
          const px = 20 + prog * 24;
          const py = (GROUND_Y - 12) - Math.sin(prog * Math.PI) * 8;
          drawSpriteMatrix(projIcon, px, py, 'pulse_float', localFrame, false, 0.65);
          return;
        }

        // 6. DIÁLOGO / INTERACCIÓN SOCIAL / NEGOCIACIÓN
        if (choreo === 'dialogue_interaction') {
          drawArticulatedCharacter(14, GROUND_Y - 4, '#38bdf8', 'walk', localFrame, false);
          drawArticulatedCharacter(46, GROUND_Y - 4, '#f43f5e', 'walk', localFrame + 10, true);

          // Bocadillo de diálogo pixel-art encima mostrando los iconos del tema
          drawRect(18, 24, 24, 18, '#ffffff');
          drawRect(19, 25, 22, 16, '#0f172a');
          const activeIcon = (Math.floor(localFrame / 25) % 2 === 0) ? icon1 : icon2;
          drawSpriteMatrix(activeIcon, 30, 33, 'bounce_physics', localFrame, false, 0.85);
          return;
        }

        // 7. ESTACIÓN DE TRABAJO / CIENCIA / INVESTIGACIÓN EN VIVO
        if (choreo === 'workstation_action') {
          drawArticulatedCharacter(14, GROUND_Y - 4, '#ffffff', 'walk', localFrame, false);
          // Monitor holográfico gigante a la derecha proyectando los dos objetos animados
          drawRect(24, 24, 28, 26, '#00f5d4');
          drawRect(25, 25, 26, 24, '#090d16');
          drawSpriteMatrix(icon1, 33, 37, 'bounce_physics', localFrame, false, 0.9);
          drawSpriteMatrix(icon2, 44, 37, 'walk_cycle', localFrame, true, 0.9);
          return;
        }

        // 8. HERO SHOWCASE (Presentación dinámica con ambos actores en acción)
        const x1 = 18 + Math.round(Math.sin(localFrame * 0.15) * 4);
        const x2 = 42 - Math.round(Math.sin(localFrame * 0.15) * 4);
        drawSpriteMatrix(icon1, x1, GROUND_Y - 11, 'walk_cycle', localFrame, false, 1.25);
        drawSpriteMatrix(icon2, x2, GROUND_Y - 11, 'bounce_physics', localFrame, true, 1.25);
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

      function drawPixelString(str, startX, startY, color) {
        const clean = String(str || '').toUpperCase().replace(/[^A-Z0-9$%!? ]/g, '').slice(0, 11);
        if (!clean) return;
        const totalW = clean.length * 4 - 1;
        let cx = Math.max(2, Math.floor(startX - totalW / 2));
        drawRect(cx - 2, startY - 1, totalW + 4, 7, '#05050a');
        for (let i = 0; i < clean.length; i++) {
          const ch = clean[i];
          const glyph = FONT_3X5[ch];
          if (glyph) {
            for (let r = 0; r < 5; r++) {
              for (let c = 0; c < 3; c++) {
                if (glyph[r][c] === '1') setCell(cx + c, startY + r, color);
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
        const localFrame = Math.floor(localT * 30);

        // Movimiento suave de cámara
        const scale = 1.0 + (localT / durEsc) * 0.05;
        let tx = 0, ty = 0;
        if (esc.camera_mode === 'dramatic_shake' && localFrame > 15) {
          tx = Math.sin(localFrame * 2.2) * 6;
          ty = Math.cos(localFrame * 2.9) * 5;
        }
        viewportWrapper.style.transform = \`translate(\${tx.toFixed(1)}px, \${ty.toFixed(1)}px) scale(\${scale.toFixed(3)})\`;

        // 1. Pintar el Mundo Parallax Multicapa
        drawWorldEnvironment(esc, localFrame);

        // 2. Pintar la Coreografía Interactiva con los Sprites Auto-Pixelados
        renderSceneChoreography(esc, localFrame);

        // 3. Rótulos superiores e inferiores
        if (esc.texto_1) drawPixelString(esc.texto_1, 30, 11, '#ffd166');
        if (esc.texto_2) drawPixelString(esc.texto_2, 30, 74, '#00f5d4');

        // 4. Volcar la matriz 60x106 al lienzo
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

  console.log(`🎬 Grabando ${totalFrames} fotogramas en Motor Universal Auto-Pixelador v5.0 (${duracionExactaVideo.toFixed(2)}s)...`);
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

  console.log('🔊 Ensamblando MP4 final Universal 8-Bit v5.0...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo Universal 8-Bit v5.0 generado con éxito!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en render_8bit.js:', err);
  process.exit(1);
});
