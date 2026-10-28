const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 1. DICCIONARIO DE ICONOS VECTORIALES DE EMERGENCIA (100% Tolerante a Fallos)
// Si Gemini pide un icono que no existe en Iconify o hay microcorte de red,
// se usa instantáneamente un vector neón de respaldo acorde a la palabra.
// ============================================================================
const FALLBACK_LUCIDE_PATHS = {
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>'
};

function getFallbackIconInner(iconName) {
  const clean = String(iconName || '').toLowerCase();
  for (const [key, svgPaths] of Object.entries(FALLBACK_LUCIDE_PATHS)) {
    if (clean.includes(key)) return svgPaths;
  }
  const keys = Object.keys(FALLBACK_LUCIDE_PATHS);
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) % keys.length;
  return FALLBACK_LUCIDE_PATHS[keys[h]];
}

// Descargador asíncrono de SVGs de Iconify API con timeout corto y fallback garantizado
function fetchIconifySvg(iconSpec) {
  return new Promise((resolve) => {
    const raw = String(iconSpec || 'lucide:brain').trim().toLowerCase();
    const parts = raw.includes(':') ? raw.split(':') : ['lucide', raw];
    const prefix = parts[0].replace(/[^a-z0-9-]/g, '') || 'lucide';
    const name = parts[1].replace(/[^a-z0-9-]/g, '') || 'brain';
    const url = `https://api.iconify.design/${prefix}/${name}.svg`;

    const req = https.get(url, { timeout: 2800 }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ viewBox: '0 0 24 24', inner: getFallbackIconInner(name) });
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (!data.includes('<svg') || data.length < 30) {
          resolve({ viewBox: '0 0 24 24', inner: getFallbackIconInner(name) });
          return;
        }
        const vbMatch = data.match(/viewBox=["']([^"']+)["']/i);
        const viewBox = vbMatch ? vbMatch[1] : '0 0 24 24';
        const inner = data
          .replace(/<svg[^>]*>/i, '')
          .replace(/<\/svg>/i, '')
          .replace(/stroke=["'][^"']*["']/gi, '')
          .replace(/fill=["']currentColor["']/gi, 'fill="none"')
          .trim();
        resolve({ viewBox, inner: inner || getFallbackIconInner(name) });
      });
    });

    req.on('error', () => resolve({ viewBox: '0 0 24 24', inner: getFallbackIconInner(name) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ viewBox: '0 0 24 24', inner: getFallbackIconInner(name) });
    });
  });
}

// ============================================================================
// 2. EXTRACTOR DE TEXTOS CLAVE PARA HUD DE ESCENAS
// ============================================================================
function sanitizeSvgTexts(esc, matchesDestacados) {
  let raw1 = (esc.texto_1 || '').trim();
  let raw2 = (esc.texto_2 || '').trim();
  let raw3 = (esc.texto_3 || '').trim();

  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'ERA', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE'
  ]);

  const subWords = (esc.subtitulo || '')
    .replace(/[*#_~`.,;!?¡¿"«»()]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= 3 && !stopWords.has(w));

  const fallback1 = matchesDestacados[0] || subWords[0] || 'MENTE';
  const fallback2 = matchesDestacados[1] || subWords[1] || subWords[subWords.length - 1] || 'REALIDAD';
  const fallback3 = matchesDestacados[2] || subWords[2] || 'EFECTO';

  raw1 = raw1 || fallback1;
  raw2 = raw2 || fallback2;
  raw3 = raw3 || fallback3;

  if (raw2.toUpperCase() === raw1.toUpperCase() && subWords.length > 1) {
    raw2 = subWords.find(w => w !== raw1.toUpperCase()) || fallback2;
  }

  return [
    raw1.toUpperCase().slice(0, 16),
    raw2.toUpperCase().slice(0, 16),
    raw3.toUpperCase().slice(0, 16)
  ];
}

// ============================================================================
// 3. CONSTRUCTORES VISUALES DE LOS 3 MODOS (svg_custom, icon_composition, data_viz)
// ============================================================================

function buildHudHeaderFooter(t1, t2) {
  return `
    <g class="hud-labels">
      <rect x="70" y="18" width="260" height="34" rx="17" fill="rgba(8,8,18,0.78)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
      <text x="200" y="41" text-anchor="middle" fill="#ffffff" font-size="16" font-weight="900" letter-spacing="1.5">${t1}</text>
      <rect x="70" y="352" width="260" height="34" rx="17" fill="rgba(8,8,18,0.78)" stroke="var(--accent-color)" stroke-width="1.5"/>
      <text x="200" y="375" text-anchor="middle" fill="#ffd000" font-size="16" font-weight="900" letter-spacing="1.5">${t2}</text>
    </g>
  `;
}

// MODO A: SVG Custom escrito por Gemini con sanitización y fallback de Grafo Neuronal
function buildModeSvgCustom(esc, t1, t2, seed) {
  let rawSvg = String(esc.svg_code || '').trim();
  rawSvg = rawSvg
    .replace(/<svg[^>]*>/gi, '')
    .replace(/<\/svg>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();

  const hasValidShapes = /<(path|circle|rect|line|polyline|polygon|ellipse)\b/i.test(rawSvg);

  if (!hasValidShapes) {
    // Fallback procedural elegante: Constelación Sináptica Neón
    const p1 = 95 + (seed % 40);
    const p2 = 265 - (seed % 35);
    rawSvg = `
      <g class="float">
        <circle class="stroke-neon draw" cx="200" cy="195" r="78" stroke-dasharray="8 6"/>
        <polygon class="stroke-alt draw" points="200,105 282,240 118,240"/>
        <line class="stroke-white draw" x1="${p1}" y1="135" x2="${p2}" y2="255"/>
        <line class="stroke-yellow draw" x1="${p2}" y1="135" x2="${p1}" y2="255"/>
        <circle class="stroke-white pulse" cx="200" cy="105" r="14" fill="#090a14"/>
        <circle class="stroke-neon pulse" cx="282" cy="240" r="14" fill="#090a14"/>
        <circle class="stroke-alt pulse" cx="118" cy="240" r="14" fill="#090a14"/>
        <circle class="stroke-yellow pulse" cx="200" cy="195" r="22" fill="#090a14"/>
      </g>
    `;
  } else {
    // Asegurar que las figuras tengan clases de color neón visibles
    rawSvg = rawSvg.replace(/<(path|circle|rect|line|polyline|polygon|ellipse)(?![^>]*class=)/gi, '<$1 class="stroke-neon draw"');
  }

  return `
    ${buildHudHeaderFooter(t1, t2)}
    <g class="custom-svg-stage">${rawSvg}</g>
  `;
}

// MODO B: Composición de Iconos de Iconify con 5 físicas interactivas
function buildModeIconComposition(esc, resolvedIcons, t1, t2) {
  const icons = resolvedIcons.length > 0 ? resolvedIcons : [{ viewBox: '0 0 24 24', inner: FALLBACK_LUCIDE_PATHS.brain }];
  const physics = String(esc.fisica_iconos || 'orbitar').toLowerCase().trim();
  const colorClasses = ['stroke-neon', 'stroke-alt', 'stroke-yellow'];

  const iconGroups = icons.slice(0, 3).map((ic, idx) => {
    const cls = colorClasses[idx % colorClasses.length];
    return `
      <g class="icon-actor icon-actor-${idx}" data-idx="${idx}" data-total="${Math.min(3, icons.length)}" data-physics="${physics}">
        <circle cx="200" cy="195" r="56" fill="rgba(8, 10, 20, 0.72)" class="${cls} draw" stroke-width="2.5"/>
        <svg x="152" y="147" width="96" height="96" viewBox="${ic.viewBox}" class="${cls} icon-svg-inner">
          ${ic.inner}
        </svg>
      </g>
    `;
  }).join('');

  return `
    ${buildHudHeaderFooter(t1, t2)}
    <g class="icon-arena" data-physics="${physics}">
      <circle cx="200" cy="195" r="112" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.8" stroke-dasharray="6 8"/>
      <line x1="75" y1="195" x2="325" y2="195" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      ${iconGroups}
    </g>
  `;
}

// MODO C: Visualización de Datos Animada (Donut, Barras, Curva o Línea de Tiempo)
function buildModeDataViz(esc, t1, t2) {
  const dv = esc.data_viz || {};
  const tipo = String(dv.tipo || 'donut').toLowerCase().trim();

  // Intentar extraer números del subtítulo si Gemini no los puso en data_viz
  const numsInSub = [...String(esc.subtitulo || '').matchAll(/\d+(?:[.,]\d+)?/g)].map(m => parseFloat(m[0].replace(',', '.')));
  const val1 = (dv.valor !== undefined && dv.valor !== null && !isNaN(Number(dv.valor)))
    ? Number(dv.valor)
    : (numsInSub[0] !== undefined ? numsInSub[0] : 85);
  const val2 = (dv.valor_2 !== undefined && dv.valor_2 !== null && !isNaN(Number(dv.valor_2)))
    ? Number(dv.valor_2)
    : (numsInSub[1] !== undefined ? numsInSub[1] : Math.max(10, 100 - val1));

  const sufijo = (dv.sufijo !== undefined && dv.sufijo !== null) ? String(dv.sufijo).slice(0, 4) : (/%/.test(esc.subtitulo || '') ? '%' : '');
  const label1 = String(dv.etiqueta_1 || t1).toUpperCase().slice(0, 16);
  const label2 = String(dv.etiqueta_2 || t2).toUpperCase().slice(0, 16);

  if (tipo === 'bars') {
    const maxVal = Math.max(val1, val2, 1);
    const h1 = Math.max(28, Math.round((val1 / maxVal) * 165));
    const h2 = Math.max(28, Math.round((val2 / maxVal) * 165));
    return `
      ${buildHudHeaderFooter(label1, label2)}
      <g class="dataviz-bars" data-type="bars">
        <line x1="65" y1="305" x2="335" y2="305" class="stroke-white" stroke-width="4"/>
        <rect class="bar-rect-1 stroke-neon" data-target-h="${h1}" x="102" y="${305 - h1}" width="68" height="${h1}" rx="10" fill="rgba(0, 242, 254, 0.22)"/>
        <rect class="bar-rect-2 stroke-alt" data-target-h="${h2}" x="230" y="${305 - h2}" width="68" height="${h2}" rx="10" fill="rgba(255, 42, 133, 0.22)"/>
        <text class="counter-num" data-target="${val1}" data-suffix="${sufijo}" x="136" y="${292 - h1}" text-anchor="middle" fill="#ffffff" font-size="26" font-weight="900">0${sufijo}</text>
        <text class="counter-num" data-target="${val2}" data-suffix="${sufijo}" x="264" y="${292 - h2}" text-anchor="middle" fill="#ffd000" font-size="26" font-weight="900">0${sufijo}</text>
        <text x="136" y="332" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="800">${label1.slice(0, 12)}</text>
        <text x="264" y="332" text-anchor="middle" fill="#ffd000" font-size="13" font-weight="800">${label2.slice(0, 12)}</text>
      </g>
    `;
  }

  if (tipo === 'curve') {
    return `
      ${buildHudHeaderFooter(label1, label2)}
      <g class="dataviz-curve" data-type="curve">
        <line x1="60" y1="295" x2="340" y2="295" class="stroke-white" stroke-width="3.5"/>
        <line x1="60" y1="95" x2="60" y2="295" class="stroke-white" stroke-width="3.5"/>
        <path class="stroke-neon draw" d="M 65 280 C 135 275, 165 110, 235 115 C 285 118, 310 225, 335 245" fill="none" stroke-width="6"/>
        <circle class="pulse stroke-yellow" cx="225" cy="115" r="11" fill="#ffd000"/>
        <text class="counter-num" data-target="${val1}" data-suffix="${sufijo}" x="225" y="92" text-anchor="middle" fill="#ffd000" font-size="32" font-weight="900">0${sufijo}</text>
      </g>
    `;
  }

  if (tipo === 'timeline') {
    return `
      ${buildHudHeaderFooter(label1, label2)}
      <g class="dataviz-timeline" data-type="timeline">
        <line x1="60" y1="195" x2="340" y2="195" class="stroke-white draw" stroke-width="5"/>
        <circle class="stroke-neon pulse" cx="115" cy="195" r="22" fill="#090b14"/>
        <circle class="stroke-alt pulse" cx="285" cy="195" r="22" fill="#090b14"/>
        <text class="counter-num" data-target="${val1}" data-suffix="" x="115" y="148" text-anchor="middle" fill="#ffffff" font-size="26" font-weight="900">${val1}</text>
        <text class="counter-num" data-target="${val2}" data-suffix="${sufijo}" x="285" y="148" text-anchor="middle" fill="#ffd000" font-size="26" font-weight="900">${val2}${sufijo}</text>
        <text x="115" y="245" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="800">${label1.slice(0, 12)}</text>
        <text x="285" y="245" text-anchor="middle" fill="#ffd000" font-size="13" font-weight="800">${label2.slice(0, 12)}</text>
      </g>
    `;
  }

  // Por defecto: Donut Neón con anillo progresivo y contador central gigante
  const pct = Math.max(5, Math.min(100, val1 > 100 ? 85 : val1));
  return `
    ${buildHudHeaderFooter(label1, label2)}
    <g class="dataviz-donut" data-type="donut">
      <circle cx="200" cy="195" r="86" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="18"/>
      <circle class="donut-ring stroke-neon" data-target-pct="${pct}" cx="200" cy="195" r="86" fill="none" stroke-width="18" transform="rotate(-90 200 195)" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
      <text class="counter-num" data-target="${val1}" data-suffix="${sufijo || '%'}" x="200" y="208" text-anchor="middle" fill="#ffffff" font-size="42" font-weight="900">0${sufijo || '%'}</text>
    </g>
  `;
}

// ============================================================================
// 4. ALINEACIÓN FONÉTICA Y POR TIMESTAMPS DE ELEVENLABS
// ============================================================================
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
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'TAMBIEN', 'TAMBIÉN', 'ERA',
    'O', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE', 'MI', 'MIS', 'TUS', 'NOS', 'NI'
  ]);

  const sceneTokensList = escenas.map(esc => {
    const raw = (esc.subtitulo || '').trim();
    if (!raw) return [];

    const tokens = [];
    let inBold = false;
    const rawWords = raw.split(/\s+/);

    rawWords.forEach(rw => {
      if (!rw) return;
      const starCount = (rw.match(/\*/g) || []).length;
      const startsBold = rw.startsWith('*');
      const endsBold = rw.endsWith('*') && starCount >= 2;

      const isHighlighted = inBold || starCount >= 2 || startsBold;
      const cleanWord = rw.replace(/[*#_~`]/g, '').trim();

      if (starCount % 2 !== 0) {
        inBold = !inBold;
      } else if (startsBold && !endsBold && starCount === 2) {
        inBold = true;
      }

      if (!cleanWord) return;

      if (/^[.,;!?¡¿…]+$/.test(cleanWord)) {
        if (tokens.length > 0) {
          tokens[tokens.length - 1].text += cleanWord;
        }
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
            elevenWords.push({
              word: curWord,
              norm: normalizeForMatch(curWord),
              start: wStart,
              end: wEnd
            });
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
        elevenWords.push({
          word: curWord,
          norm: normalizeForMatch(curWord),
          start: wStart,
          end: wEnd
        });
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
      const rawText = flatTokens[i].tk.text;
      const targetNorm = flatTokens[i].norm;
      const hasCurrencyOrPct = /[€$%]/.test(rawText);
      let bestMatchIdx = -1;

      for (let offset = 0; offset <= 4; offset++) {
        const candidateIdx = ewCursor + offset;
        if (candidateIdx >= elevenWords.length) break;
        const candNorm = elevenWords[candidateIdx].norm;
        if (candNorm && targetNorm && (candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm))) {
          bestMatchIdx = candidateIdx;
          break;
        }
        if (hasCurrencyOrPct && targetNorm === '1' && candNorm === 'un') {
          bestMatchIdx = candidateIdx;
          break;
        }
      }

      if (bestMatchIdx !== -1) {
        let mStart = elevenWords[bestMatchIdx].start;
        let mEnd = elevenWords[bestMatchIdx].end;
        ewCursor = bestMatchIdx + 1;

        while (ewCursor < elevenWords.length && /^(euro|euros|dolar|dolares|por|ciento)$/.test(elevenWords[ewCursor].norm)) {
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

  const sceneWeights = sceneTokensList.map(tokens => {
    const sum = tokens.reduce((acc, tk) => acc + calcTokenWeight(tk), 0);
    return Math.max(3, sum);
  });
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
      sceneEnd = (idx === escenas.length - 1)
        ? realAudioDuration
        : Math.min(realAudioDuration, lastMatched.matchedEnd + 0.05);
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
        if (bestIdx !== -1 && maxLen >= 4) {
          g[bestIdx].tk.highlight = true;
        }
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
        return {
          text: item.tk.text,
          highlight: item.tk.highlight,
          start: wStart,
          end: wEnd
        };
      });

      if (timedWords.length > 0 && g[0].matchedStart !== null) {
        gStart = timedWords[0].start;
        gEnd = timedWords[timedWords.length - 1].end + 0.04;
      }

      allChunks.push({
        start: gStart,
        end: gEnd,
        words: timedWords
      });

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
    if (allChunks[i].end > allChunks[i + 1].start) {
      allChunks[i].end = allChunks[i + 1].start;
    } else if (allChunks[i + 1].start - allChunks[i].end < 0.12) {
      allChunks[i].end = allChunks[i + 1].start;
    }
  }

  return allChunks;
}

// ============================================================================
// 5. SINTETIZADOR PROCEDURAL DE 16 SFX EN FFMPEG
// ============================================================================
function buildSceneSfxTrack(escenas, totalDuration, videoHash) {
  function getRecipe(type, pitchMod) {
    const p = pitchMod.toFixed(3);
    const catalog = {
      sub_drop: {
        expr: `0.36*exp(-6*t)*sin(2*PI*(150*${p}*exp(-4.2*t)+38)*t)+0.12*exp(-16*t)*sin(2*PI*720*${p}*t)`,
        dur: 0.65
      },
      laser_swipe: {
        expr: `0.20*exp(-7*t)*sin(2*PI*(980*${p}*exp(-5.5*t)+110)*t)`,
        dur: 0.34
      },
      whoosh_fast: {
        expr: `0.22*sin(PI*t/0.28)*sin(2*PI*(160*${p}+480*t*t)*t)+0.09*sin(PI*t/0.28)*sin(2*PI*85*${p}*t)`,
        dur: 0.28
      },
      glitch_data: {
        expr: `0.17*exp(-8*t)*(sin(2*PI*440*${p}*t)*sin(2*PI*38*t)+0.6*sin(2*PI*1320*${p}*t)*sin(2*PI*62*t))`,
        dur: 0.32
      },
      heartbeat: {
        expr: `0.34*exp(-22*t)*sin(2*PI*58*${p}*t)+0.28*exp(-22*max(0,t-0.21))*gt(t,0.21)*sin(2*PI*52*${p}*max(0,t-0.21))`,
        dur: 0.52
      },
      tension_riser: {
        expr: `0.18*(t/0.55)*exp(-2*(0.55-t))*sin(2*PI*(220*${p}+340*t*t)*t)`,
        dur: 0.55
      },
      glass_ping: {
        expr: `0.17*exp(-6.5*t)*(sin(2*PI*1180*${p}*t)+0.5*sin(2*PI*1770*${p}*t))`,
        dur: 0.50
      },
      error_buzz: {
        expr: `0.18*exp(-7.5*t)*(sin(2*PI*145*${p}*t)+0.7*sin(2*PI*153*${p}*t)+0.4*sin(2*PI*290*${p}*t))`,
        dur: 0.40
      },
      clock_tick: {
        expr: `0.23*exp(-42*t)*sin(2*PI*1250*${p}*t)+0.19*exp(-42*max(0,t-0.22))*gt(t,0.22)*sin(2*PI*920*${p}*max(0,t-0.22))`,
        dur: 0.44
      },
      sonar_pulse: {
        expr: `0.21*exp(-5.2*t)*sin(2*PI*660*${p}*t)+0.10*exp(-5*max(0,t-0.26))*gt(t,0.26)*sin(2*PI*660*${p}*max(0,t-0.26))`,
        dur: 0.58
      },
      coin_cash: {
        expr: `0.18*exp(-14*t)*sin(2*PI*1318*${p}*t)+0.20*exp(-8*max(0,t-0.08))*gt(t,0.08)*sin(2*PI*1567*${p}*max(0,t-0.08))`,
        dur: 0.48
      },
      camera_shutter: {
        expr: `0.25*exp(-55*t)*sin(2*PI*1800*${p}*t)+0.20*exp(-45*max(0,t-0.06))*gt(t,0.06)*sin(2*PI*950*${p}*max(0,t-0.06))`,
        dur: 0.22
      },
      vinyl_rewind: {
        expr: `0.20*exp(-4.5*t)*sin(2*PI*(780*${p}-1400*t*t)*t)`,
        dur: 0.36
      },
      electric_zap: {
        expr: `0.19*exp(-11*t)*(sin(2*PI*310*${p}*t)*sin(2*PI*95*t)+0.5*sin(2*PI*940*${p}*t))`,
        dur: 0.30
      },
      revelacion_chord: {
        expr: `0.15*exp(-3.5*t)*(sin(2*PI*523.25*${p}*t)+0.8*sin(2*PI*659.25*${p}*t)+0.6*sin(2*PI*783.99*${p}*t)+0.45*sin(2*PI*1046.5*${p}*t))`,
        dur: 0.75
      },
      mystery_question: {
        expr: `0.19*exp(-5.0*t)*sin(2*PI*(290*${p}+290*t)*t)`,
        dur: 0.45
      }
    };
    return catalog[type] || catalog.whoosh_fast;
  }

  const allTypes = [
    'sub_drop', 'laser_swipe', 'whoosh_fast', 'glitch_data', 'heartbeat',
    'tension_riser', 'glass_ping', 'error_buzz', 'clock_tick', 'sonar_pulse',
    'coin_cash', 'camera_shutter', 'vinyl_rewind', 'electric_zap', 'revelacion_chord', 'mystery_question'
  ];

  const inputs = [];
  const filterParts = [];
  const usedSfx = new Set();

  escenas.forEach((esc, idx) => {
    let rawType = String(esc.sfx || '').toLowerCase().trim();
    if (!rawType || usedSfx.has(rawType)) {
      rawType = allTypes[(videoHash + idx * 3) % allTypes.length];
    }
    usedSfx.add(rawType);

    const pitchMod = 0.86 + (((videoHash + idx * 17) % 31) / 100);
    const recipe = getRecipe(rawType, pitchMod);

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
    const filterCompat = `${filterParts.join(';')};${mixLabels}amix=inputs=${escenas.length}:duration=longest:dropout_transition=0,volume=${Math.max(1.5, escenas.length * 0.55).toFixed(2)}[sfxout]`;
    execSync(
      `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterCompat}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`,
      { stdio: 'ignore' }
    );
  }

  return fs.existsSync('hook_sfx.wav') && fs.statSync('hook_sfx.wav').size > 1000;
}

// ============================================================================
// 6. FLUJO PRINCIPAL DE RENDERIZADO v2.0
// ============================================================================
async function main() {
  console.log('🚀 Iniciando Motor Viral v2.0 (Escenas Mixtas Trimodales + Cámara 2.5D + Iconify)...');

  let payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  if (Array.isArray(payload) && payload.length > 0) payload = payload[0];
  if (payload.json) payload = payload.json;

  const rawBase64 = (payload.audio_base64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error('❌ CRÍTICO: payload.audio_base64 llegó vacío desde n8n.');
  }
  fs.writeFileSync('audio_raw.mp3', Buffer.from(rawBase64, 'base64'));

  const hasExactTimestamps = !!(payload.alignment && payload.alignment.characters);
  if (hasExactTimestamps) {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  } else {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "silenceremove=stop_periods=-1:stop_duration=0.22:stop_threshold=-38dB,atempo=1.04,apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  }

  let realAudioDuration = 25;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) realAudioDuration = parsed;
  } catch (err) {
    realAudioDuration = Number(payload.duracion_total) || 25;
  }

  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

  // Paletas fieles a tu identidad de marca espacial neón
  const accentPalettes = [
    { name: 'Cian y Magenta Neón', hex: '#00f2fe', altHex: '#ff2a85', glow: 'rgba(0, 242, 254, 0.78)', altGlow: 'rgba(255, 42, 133, 0.72)', bgCenter: '#0f293a', bgEdge: '#04060b' },
    { name: 'Verde y Violeta Espacial', hex: '#39ff14', altHex: '#c77dff', glow: 'rgba(57, 255, 20, 0.72)', altGlow: 'rgba(199, 125, 255, 0.74)', bgCenter: '#181130', bgEdge: '#05040a' },
    { name: 'Violeta y Verde Ácido', hex: '#c77dff', altHex: '#39ff14', glow: 'rgba(199, 125, 255, 0.78)', altGlow: 'rgba(57, 255, 20, 0.72)', bgCenter: '#1e1035', bgEdge: '#050309' },
    { name: 'Amarillo y Rojo Neón', hex: '#ffd000', altHex: '#ff2a5f', glow: 'rgba(255, 208, 0, 0.78)', altGlow: 'rgba(255, 42, 95, 0.72)', bgCenter: '#2a1d0d', bgEdge: '#070503' },
    { name: 'Magenta y Cian Futuro', hex: '#ff2a85', altHex: '#00f2fe', glow: 'rgba(255, 42, 133, 0.78)', altGlow: 'rgba(0, 242, 254, 0.72)', bgCenter: '#2b1027', bgEdge: '#070308' }
  ];

  const seedStr = JSON.stringify(payload.escenas || '') + (payload.TituloYT || '') + String(Date.now());
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const chosenAccent = accentPalettes[hash % accentPalettes.length];
  const subStyleMode = (hash >>> 5) % 3;

  const escenasOriginales = payload.escenas || [];
  const ultimaEscenaFinOriginal = escenasOriginales.length > 0
    ? Number(escenasOriginales[escenasOriginales.length - 1].fin)
    : duracionExactaVideo;
  const timeScale = duracionExactaVideo / Math.max(0.1, ultimaEscenaFinOriginal);

  const modosRotativos = ['icon_composition', 'data_viz', 'svg_custom'];
  const transicionesCatalogo = [
    'punch_zoom', 'whip_left', 'whip_right', 'drop_bounce',
    'glitch_shake', 'spiral_zoom', 'pendulum', 'elastic_pop'
  ];

  // Resolver todos los iconos de Iconify en paralelo antes de renderizar
  const escenasProcesadas = [];
  for (let idx = 0; idx < escenasOriginales.length; idx++) {
    const esc = escenasOriginales[idx];
    const inicioEscena = (idx === 0) ? 0 : Number(esc.inicio) * timeScale;
    const finEscena = (idx === escenasOriginales.length - 1)
      ? duracionExactaVideo
      : Number(esc.fin) * timeScale;

    const subTexto = esc.subtitulo || '';
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim());
    const [t1, t2] = sanitizeSvgTexts(esc, matchesDestacados);

    let modo = String(esc.modo_visual || '').toLowerCase().trim();
    if (!modosRotativos.includes(modo)) {
      modo = modosRotativos[(hash + idx) % 3];
    }
    if (idx > 0 && modo === escenasProcesadas[idx - 1].modo_visual) {
      modo = modosRotativos.find(m => m !== escenasProcesadas[idx - 1].modo_visual) || 'icon_composition';
    }

    let svgInterno = '';
    if (modo === 'icon_composition') {
      const iconSpecs = Array.isArray(esc.iconos) && esc.iconos.length > 0
        ? esc.iconos.slice(0, 3)
        : ['lucide:brain', 'lucide:zap'];
      const resolvedIcons = await Promise.all(iconSpecs.map(spec => fetchIconifySvg(spec)));
      svgInterno = buildModeIconComposition(esc, resolvedIcons, t1, t2);
    } else if (modo === 'data_viz') {
      svgInterno = buildModeDataViz(esc, t1, t2);
    } else {
      svgInterno = buildModeSvgCustom(esc, t1, t2, hash + idx * 19);
    }

    // Estación de Cámara 2.5D en el espacio mental (coordenadas X, Y y profundidad Z)
    const camAngle = idx * 2.15 + (hash % 7);
    const camRadius = idx === 0 ? 0 : (160 + (idx % 3) * 65);
    const camX = Math.round(Math.cos(camAngle) * camRadius);
    const camY = Math.round(Math.sin(camAngle) * camRadius);
    const camZ = 1 + (idx % 2 === 0 ? 0.14 : -0.10);

    const rawTrans = String(esc.transicion || '').toLowerCase().trim();
    const transicionElegida = (idx === 0)
      ? 'punch_zoom'
      : (transicionesCatalogo.includes(rawTrans) ? rawTrans : transicionesCatalogo[(hash + idx * 3) % transicionesCatalogo.length]);

    escenasProcesadas.push({
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      modo_visual: modo,
      svgInterno,
      plano: idx === 0 ? 'primer_plano' : (esc.plano || 'medio'),
      transicion: transicionElegida,
      camX,
      camY,
      camZ
    });
  }

  const subtitleChunks = buildSubtitleChunks(escenasProcesadas, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio: Voz + Música de fondo + Pista de 16 SFX
  try {
    let hasHookSfx = false;
    try {
      hasHookSfx = buildSceneSfxTrack(escenasProcesadas, duracionExactaVideo, hash);
    } catch (sfxErr) {
      console.warn('⚠️ Aviso SFX:', sfxErr.message);
    }

    const bgMusicPath = path.resolve('bg_music.mp3');
    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.08,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );

      if (hasHookSfx) {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.05[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      } else {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.05[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      }
    } else {
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (audioErr) {
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');
      :root {
        --accent-color: ${chosenAccent.hex};
        --accent-alt: ${chosenAccent.altHex};
        --accent-glow: ${chosenAccent.glow};
        --accent-alt-glow: ${chosenAccent.altGlow};
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: radial-gradient(circle at 50% 38%, ${chosenAccent.bgCenter} 0%, ${chosenAccent.bgEdge} 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      #bg-canvas {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        z-index: 2; pointer-events: none;
      }
      .vignette {
        position: absolute; inset: 0;
        background: radial-gradient(circle at 50% 42%, transparent 46%, rgba(0,0,0,0.78) 100%);
        z-index: 3; pointer-events: none;
      }
      .glow-spot {
        position: absolute; top: 38%; left: 50%; width: 560px; height: 560px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, var(--accent-glow) 0%, var(--accent-alt-glow) 44%, transparent 72%);
        opacity: 0.50;
        pointer-events: none; z-index: 4;
      }
      .hook-flash {
        position: absolute; inset: 0;
        background: radial-gradient(circle at 50% 40%, var(--accent-color) 0%, transparent 75%);
        opacity: 0; pointer-events: none; z-index: 28;
        mix-blend-mode: screen;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 10px;
        background: linear-gradient(90deg, var(--accent-alt), var(--accent-color)); width: 0%; z-index: 30;
        box-shadow: 0 0 18px var(--accent-glow);
      }
      .top-tag {
        position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
        background: rgba(8, 8, 16, 0.88); color: var(--accent-color);
        font-size: 20px; font-weight: 900; padding: 10px 28px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid var(--accent-color); white-space: nowrap;
        box-shadow: 0 0 24px var(--accent-glow); z-index: 20;
      }

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
      svg.main-stage-svg {
        width: 590px; height: 590px;
        overflow: visible;
        filter: drop-shadow(0 16px 32px rgba(0,0,0,0.88));
      }

      svg text {
        font-family: 'Montserrat', sans-serif;
        font-weight: 900;
        paint-order: stroke fill;
        stroke: #06060c;
        stroke-width: 3px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .stroke-neon {
        stroke: var(--accent-color); stroke-width: 5.5;
        stroke-linecap: round; stroke-linejoin: round; fill: none;
        filter: drop-shadow(0 0 14px var(--accent-glow));
      }
      .stroke-alt {
        stroke: var(--accent-alt); stroke-width: 5.5;
        stroke-linecap: round; stroke-linejoin: round; fill: none;
        filter: drop-shadow(0 0 14px var(--accent-alt-glow));
      }
      .stroke-white {
        stroke: #ffffff; stroke-width: 5;
        stroke-linecap: round; stroke-linejoin: round; fill: none;
        filter: drop-shadow(0 0 8px rgba(255,255,255,0.45));
      }
      .stroke-yellow {
        stroke: #ffd000; stroke-width: 5.5;
        stroke-linecap: round; stroke-linejoin: round; fill: none;
        filter: drop-shadow(0 0 14px rgba(255, 208, 0, 0.88));
      }
      .icon-svg-inner * {
        stroke-width: 2.2 !important;
        stroke-linecap: round;
        stroke-linejoin: round;
        fill: none;
      }

      .subtitle-container {
        position: absolute;
        bottom: 115px; left: 30px; right: 30px;
        min-height: 150px;
        display: flex; justify-content: center; align-items: center;
        z-index: 25; pointer-events: none;
      }
      .subtitle-box {
        display: flex; flex-wrap: wrap;
        justify-content: center; align-items: center;
        gap: 14px 22px; text-align: center;
        padding: 18px 28px;
        background: rgba(8, 8, 16, 0.84);
        border: 2px solid rgba(255, 255, 255, 0.16);
        border-radius: 26px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.90);
      }
      .subtitle-box.style-1 {
        border: 2px solid var(--accent-color);
        box-shadow: 0 14px 36px rgba(0,0,0,0.9), 0 0 22px var(--accent-glow);
      }
      .subtitle-box.style-2 {
        border-left: 6px solid var(--accent-color);
        border-right: 6px solid var(--accent-alt);
        border-radius: 18px;
      }
      .sub-word {
        display: inline-block; margin: 0 3px;
        font-size: 39px; font-weight: 900;
        text-transform: uppercase; letter-spacing: 1px; line-height: 1.18;
        color: #ffffff; paint-order: stroke fill;
        -webkit-text-stroke: 7px #05050a;
        text-shadow: 0 6px 16px rgba(0, 0, 0, 0.95);
      }
      .sub-word.kw {
        color: var(--accent-color);
        filter: drop-shadow(0 0 14px var(--accent-glow));
      }
      .sub-word.active { transform: scale(1.10) translateY(-4px); }
      .sub-word.kw.active { transform: scale(1.15) translateY(-5px) rotate(-1.5deg); }
      .sub-word.future { opacity: 0.42; }
    </style>
  </head>
  <body>
    <canvas id="bg-canvas" width="720" height="1280"></canvas>
    <div class="vignette"></div>
    <div class="glow-spot" id="glow"></div>
    <div class="hook-flash" id="hook-flash"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag">${payload.categoria || 'PSICOLOGÍA'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg class="main-stage-svg" viewBox="0 0 400 400">${e.svgInterno}</svg>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="subtitle-container">
      <div class="subtitle-box style-${subStyleMode}" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const totalFrames = ${totalFrames};
      const accentHex = "${chosenAccent.hex}";
      const accentAltHex = "${chosenAccent.altHex}";

      const canvas = document.getElementById('bg-canvas');
      const ctx = canvas.getContext('2d');

      // 3 Capas de partículas 2.5D con distinta profundidad Z (paralaje real)
      const stars = Array.from({ length: 54 }, (_, i) => ({
        x: (i * 137) % 720,
        y: (i * 251) % 1280,
        z: 0.25 + (i % 5) * 0.32, // Profundidad de paralaje (0.25 lejana -> 1.53 cercana)
        r: 1.4 + (i % 4) * 1.1,
        isAlt: i % 3 === 0
      }));

      function cubicBezierEase(p) {
        return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      }

      // Motor de Cámara Espacial 2.5D con túnel de anillos concéntricos y paralaje
      function renderCamera25D(t, activeIdx, sceneLocalT) {
        ctx.clearRect(0, 0, 720, 1280);

        const curr = escenas[activeIdx] || { camX: 0, camY: 0, camZ: 1 };
        const prev = activeIdx > 0 ? escenas[activeIdx - 1] : { camX: 0, camY: 0, camZ: 1 };

        // Interpolación cubic-bezier durante los primeros 0.55s del cambio de escena
        const transP = Math.min(1, sceneLocalT / 0.55);
        const easeP = cubicBezierEase(transP);

        const camX = prev.camX + (curr.camX - prev.camX) * easeP + Math.sin(t * 0.8) * 24;
        const camY = prev.camY + (curr.camY - prev.camY) * easeP + Math.cos(t * 0.6) * 24;
        const camZoom = prev.camZ + (curr.camZ - prev.camZ) * easeP + (sceneLocalT * 0.03);

        ctx.save();

        // Capa 1: Anillos concéntricos de túnel espacial 2.5D con desplazamiento de paralaje
        const vanishX = 360 - camX * 0.38;
        const vanishY = 470 - camY * 0.38;

        for (let r = 0; r < 7; r++) {
          const depthProgress = ((r / 7) + (t * 0.14)) % 1;
          const radius = Math.pow(depthProgress, 1.7) * 680 * camZoom;
          const alpha = (1 - depthProgress) * 0.14;

          ctx.strokeStyle = r % 2 === 0 ? accentHex : accentAltHex;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1.2 + depthProgress * 2.2;
          ctx.beginPath();
          ctx.arc(vanishX, vanishY, Math.max(2, radius), 0, Math.PI * 2);
          ctx.stroke();
        }

        // Capa 2: Rejilla de perspectiva sutil y constelaciones en paralaje
        stars.forEach((st, idx) => {
          const px = ((st.x - camX * st.z) % 720 + 720) % 720;
          const py = ((st.y - camY * st.z - t * 28 * st.z) % 1280 + 1280) % 1280;

          ctx.fillStyle = st.isAlt ? accentAltHex : accentHex;
          ctx.globalAlpha = Math.min(0.85, 0.18 + st.z * 0.35);
          ctx.beginPath();
          ctx.arc(px, py, st.r * st.z, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.restore();
      }

      // Preparar trazos dibujables en tiempo real para SVG Custom e Iconos
      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('.draw, .custom-svg-stage path, .custom-svg-stage line, .custom-svg-stage polyline, .custom-svg-stage polygon, .custom-svg-stage circle, .custom-svg-stage rect');
        let idx = 0;
        shapes.forEach(shape => {
          if (shape.classList.contains('donut-ring')) return;
          shape.setAttribute('pathLength', '100');
          shape.dataset.drawIdx = idx++;
          shape.style.strokeDasharray = '100';
          shape.style.strokeDashoffset = '100';
        });
      });

      function easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      }

      const subBox = document.getElementById('sub-box');
      const hookFlash = document.getElementById('hook-flash');
      const glowEl = document.getElementById('glow');
      let lastChunkIdx = -2;

      window.setFrameData = function(frameIdx, t) {
        const linearRatio = (frameIdx + 1) / totalFrames;
        document.getElementById('pbar').style.width = Math.min(100, Math.pow(linearRatio, 0.65) * 100) + '%';

        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        const activeScene = escenas[activeIdx];
        const sceneLocalT = activeScene ? Math.max(0, t - activeScene.inicio) : 0;

        // Actualizar cámara 2.5D en el fondo
        renderCamera25D(t, activeIdx, sceneLocalT);

        if (t < 0.25) {
          hookFlash.style.opacity = String((1 - t / 0.25) * 0.42);
        } else if (sceneLocalT < 0.14) {
          hookFlash.style.opacity = String((1 - sceneLocalT / 0.14) * 0.16);
        } else {
          hookFlash.style.opacity = '0';
        }

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          if (idx === activeIdx) {
            const localT = Math.max(0, t - e.inicio);
            const durEscena = Math.max(0.2, e.fin - e.inicio);
            sc.style.opacity = '1';

            // Transición de entrada con cubic-bezier + deriva 2.5D continua
            const p = Math.min(1, localT / 0.34);
            const ease = cubicBezierEase(p);
            const tr = e.transicion || 'punch_zoom';

            let tx = 0;
            let ty = Math.sin(localT * 4.2) * 8;
            let scale = (0.86 + 0.14 * ease) * (1 + (localT / durEscena) * 0.08);
            let rot = Math.sin(localT * 2.5) * 1.6;

            if (tr === 'whip_left') tx = -260 * (1 - ease);
            else if (tr === 'whip_right') tx = 260 * (1 - ease);
            else if (tr === 'drop_bounce') ty = -240 * (1 - easeOutBack(p));
            else if (tr === 'spiral_zoom') rot += (1 - ease) * 24;

            inner.style.transform = \`translate(\${tx.toFixed(1)}px, \${ty.toFixed(1)}px) scale(\${scale.toFixed(3)}) rotate(\${rot.toFixed(2)}deg)\`;

            // 1. Animar trazado progresivo (Modo A y elementos dibujables)
            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              const delay = Math.min(0.25, dIdx * 0.035);
              const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.45));
              shape.style.strokeDashoffset = String(100 * (1 - drawP));
            });

            // 2. Animar Físicas de Iconos (Modo B: icon_composition)
            sc.querySelectorAll('.icon-actor').forEach(actor => {
              const aIdx = parseInt(actor.dataset.idx, 10);
              const total = parseInt(actor.dataset.total, 10);
              const phys = actor.dataset.physics || 'orbitar';
              let ix = 0, iy = 0, iscale = 1, irot = 0, iop = 1;

              if (total === 1) {
                iscale = 1.25 + Math.sin(localT * 7) * 0.12;
                iy = Math.sin(localT * 5) * 10;
              } else if (phys === 'orbitar') {
                const angle = localT * 2.4 + (aIdx * (Math.PI * 2 / total));
                ix = Math.cos(angle) * 82;
                iy = Math.sin(angle) * 68;
                iscale = 0.92 + Math.sin(angle) * 0.14;
              } else if (phys === 'colisionar') {
                const dir = aIdx === 0 ? -1 : (aIdx === 1 ? 1 : 0);
                const clashP = Math.min(1, localT / 0.45);
                const bounce = Math.abs(Math.sin(localT * 6)) * 18;
                ix = dir * (130 * (1 - clashP) + 46 + bounce);
                iy = aIdx === 2 ? -78 : 0;
              } else if (phys === 'balanza') {
                const side = aIdx === 0 ? -92 : (aIdx === 1 ? 92 : 0);
                ix = side;
                iy = Math.sin(localT * 4.5 + aIdx * Math.PI) * 38;
              } else if (phys === 'transformar') {
                const cycle = (localT / durEscena) * total;
                const dist = Math.abs(cycle - (aIdx + 0.5));
                iop = Math.max(0.22, 1 - dist * 0.9);
                iscale = 0.75 + iop * 0.45;
                ix = (aIdx - (total - 1) / 2) * 78;
              } else {
                // escalar_pulso
                const spread = (aIdx - (total - 1) / 2) * 105;
                ix = spread;
                iscale = 0.95 + Math.sin(localT * 8 + aIdx * 2) * 0.18;
              }

              actor.style.transformOrigin = '200px 195px';
              actor.style.opacity = String(iop);
              actor.style.transform = \`translate(\${ix.toFixed(1)}px, \${iy.toFixed(1)}px) scale(\${iscale.toFixed(3)}) rotate(\${irot.toFixed(1)}deg)\`;
            });

            // 3. Animar Gráficas y Contadores Numéricos (Modo C: data_viz)
            const vizProgress = cubicBezierEase(Math.min(1, localT / Math.min(1.1, durEscena * 0.65)));

            sc.querySelectorAll('.donut-ring').forEach(ring => {
              const targetPct = parseFloat(ring.dataset.targetPct || '80');
              ring.style.strokeDashoffset = String(100 - targetPct * vizProgress);
            });

            sc.querySelectorAll('.bar-rect-1, .bar-rect-2').forEach(bar => {
              const targetH = parseFloat(bar.dataset.targetH || '120');
              const curH = Math.max(8, targetH * vizProgress);
              bar.setAttribute('y', String(305 - curH));
              bar.setAttribute('height', String(curH));
            });

            sc.querySelectorAll('.counter-num').forEach(cnt => {
              const targetVal = parseFloat(cnt.dataset.target || '0');
              const suffix = cnt.dataset.suffix || '';
              const curVal = Math.round(targetVal * vizProgress);
              cnt.textContent = curVal + suffix;
            });

            // 4. Animar elementos flotantes y pulsantes
            sc.querySelectorAll('.float').forEach(el => {
              el.style.transform = \`translateY(\${(Math.sin(localT * 5.8) * 9).toFixed(1)}px)\`;
            });
            sc.querySelectorAll('.pulse').forEach(el => {
              const ps = 1 + Math.sin(localT * 9.5) * 0.12;
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = \`scale(\${ps.toFixed(3)})\`;
            });

          } else {
            sc.style.opacity = '0';
          }
        });

        // Subtítulos inferiores sincronizados
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

        const chunkLocalT = Math.max(0, t - chunk.start);
        const boxScale = 0.92 + 0.08 * easeOutBack(Math.min(1, chunkLocalT / 0.12));
        subBox.style.transform = \`scale(\${boxScale})\`;

        if (cIdx !== lastChunkIdx) {
          lastChunkIdx = cIdx;
          subBox.innerHTML = chunk.words.map((w, wIdx) => {
            const kwClass = w.highlight ? 'kw' : '';
            return \`<span class="sub-word \${kwClass}" id="sw-\${wIdx}">\${w.text}</span>\`;
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

  fs.writeFileSync('index.html', htmlContent);

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
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');

  console.log(`🎬 Grabando ${totalFrames} fotogramas (${duracionExactaVideo.toFixed(2)}s) con cámara 2.5D...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo output.mp4 v2.0 generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
