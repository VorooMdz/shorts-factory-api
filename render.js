const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// 0. UTILIDADES DE RED Y BÚSQUEDA SEMÁNTICA DE VECTORES PROFESIONALES
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

async function resolveAndFetchVector(rawQuery) {
  let q = String(rawQuery || 'brain').trim().toLowerCase();
  const cleanName = q.includes(':') ? q.split(':')[1] : q;
  const prefix = q.includes(':') ? q.split(':')[0] : 'lucide';

  // Priorizar siempre Lucide (trazos limpios y continuos en viewBox 0 0 24 24)
  let svg = await fetchText(`https://api.iconify.design/lucide/${cleanName}.svg`);
  if (!svg || !svg.includes('<svg')) {
    svg = await fetchText(`https://api.iconify.design/${prefix}/${cleanName}.svg`);
  }
  if (!svg || !svg.includes('<svg')) {
    svg = await fetchText(`https://api.iconify.design/tabler/${cleanName}.svg`);
  }

  if (!svg || !svg.includes('<svg')) {
    const searchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(cleanName)}&prefixes=lucide,tabler&limit=5`;
    const searchRes = await fetchText(searchUrl);
    if (searchRes) {
      try {
        const parsed = JSON.parse(searchRes);
        if (Array.isArray(parsed.icons) && parsed.icons.length > 0) {
          const bestMatch = parsed.icons[0];
          const [bPref, bName] = bestMatch.split(':');
          svg = await fetchText(`https://api.iconify.design/${bPref}/${bName}.svg`);
        }
      } catch (e) {}
    }
  }

  if (!svg || !svg.includes('<svg')) {
    svg = await fetchText('https://api.iconify.design/lucide/brain.svg');
  }

  if (svg && svg.includes('<svg')) {
    const vbMatch = svg.match(/viewBox=["']([^"']+)["']/i);
    const viewBox = vbMatch ? vbMatch[1] : '0 0 24 24';
    const inner = svg
      .replace(/<svg[^>]*>/gi, '')
      .replace(/<\/svg>/gi, '')
      .replace(/fill\s*=\s*["'][^"']*["']/gi, 'fill="none"')
      .replace(/stroke\s*=\s*["'][^"']*["']/gi, '')
      .replace(/stroke-width\s*=\s*["'][^"']*["']/gi, '');
    return { viewBox, inner };
  }

  return { viewBox: '0 0 24 24', inner: '<circle cx="12" cy="12" r="9"/>' };
}

async function preloadAllSceneVectors(escenas) {
  const vectorCache = {};
  for (const s of (escenas || [])) {
    const list = Array.isArray(s.iconos) ? [...s.iconos] : [];
    if (s.objeto_1) list.push(s.objeto_1);
    if (s.objeto_2) list.push(s.objeto_2);
    for (const item of list) {
      const key = String(item || '').trim().toLowerCase();
      if (key && !vectorCache[key]) {
        vectorCache[key] = await resolveAndFetchVector(key);
      }
    }
  }
  return vectorCache;
}

// ============================================================================
// MEGABIBLIOTECA INTEGRADA DE ANIMALES, VEHÍCULOS, OBJETOS Y PROPS
// ============================================================================
const EXPANDED_SVG_PACK = {
  diag_perro_pavlov: `
    <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M55,155 L55,115 L75,90 L115,90 L135,70 L155,75 L150,100 L130,115 L130,155" />
      <path class="stroke-yellow draw" d="M65,90 L50,110 L68,112 Z" />
      <circle cx="138" cy="82" r="3.5" fill="#ffffff" />
      <path class="stroke-red pulse" d="M155,95 Q162,110 155,120 Q148,110 155,95 Z" />
      <path class="stroke-yellow pulse" d="M38,65 L52,65 L45,50 Z" />
      <circle class="pulse" cx="45" cy="72" r="4" fill="#ffd000" />
    </g>
    <text x="100" y="220" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_rata_experimento: `
    <text x="100" y="24" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="28" y="45" width="144" height="140" rx="12" />
    <g class="float">
      <path class="stroke-white draw" d="M55,145 Q75,110 115,125 L140,140 L55,145 Z" />
      <circle class="stroke-yellow draw" cx="118" cy="118" r="10" />
      <circle cx="130" cy="133" r="3" fill="#ff2a5f" />
      <path class="stroke-red draw" d="M55,142 Q35,135 42,115" />
      <rect class="stroke-red pulse" x="142" y="95" width="18" height="18" rx="4" />
    </g>
    <text x="100" y="220" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_dilema_tranvia: `
    <text x="52" y="26" text-anchor="middle" fill="#ffffff" font-size="12">{{TEXTO_1}}</text>
    <text x="148" y="26" text-anchor="middle" fill="#ff2a5f" font-size="12">{{TEXTO_2}}</text>
    <path class="stroke-white draw" d="M100,195 L100,125 L45,60 M100,125 L155,60" />
    <g class="pulse">
      <rect class="stroke-yellow draw" x="72" y="140" width="56" height="38" rx="6" />
      <circle cx="88" cy="184" r="5" fill="#ffffff" />
      <circle cx="112" cy="184" r="5" fill="#ffffff" />
    </g>
  `,
  diag_ruleta_casino: `
    <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <circle class="stroke-yellow draw" cx="100" cy="120" r="58" />
      <circle class="stroke-red draw" cx="100" cy="120" r="22" />
      <line class="stroke-white draw" x1="42" y1="120" x2="158" y2="120" />
      <line class="stroke-white draw" x1="100" y1="62" x2="100" y2="178" />
      <circle cx="128" cy="85" r="6" fill="#ffffff" />
    </g>
    <text x="100" y="220" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_caja_skinner: `
    <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="35" y="50" width="130" height="130" rx="12" />
    <circle class="stroke-red pulse" cx="100" cy="115" r="26" />
    <text x="100" y="220" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `
};

// 1. Extractor inteligente de textos internos para SVGs
function sanitizeSvgTexts(esc, matchesDestacados) {
  let raw1 = (esc.texto_1 || '').trim();
  let raw2 = (esc.texto_2 || '').trim();
  let raw3 = (esc.texto_3 || '').trim();

  if (/ vs\.? /i.test(raw1) && (!raw2 || /^vs\.?$/i.test(raw2))) {
    const parts = raw1.split(/ vs\.? /i);
    raw1 = parts[0].trim();
    raw2 = (parts[1] || '').trim();
  }

  const cleanRedundant = (str) => String(str || '')
    .replace(/undefined|null/gi, '')
    .replace(/\(\s*(señuelo|ganador|trampa|premio)\s*\)/gi, '')
    .replace(/\b(vs\.?|versus)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

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

  raw1 = cleanRedundant(raw1) || fallback1;
  raw2 = cleanRedundant(raw2) || fallback2;
  raw3 = cleanRedundant(raw3) || fallback3;

  if (raw2.toUpperCase() === raw1.toUpperCase() && subWords.length > 1) {
    raw2 = subWords.find(w => w !== raw1.toUpperCase()) || fallback2;
  }

  return [
    raw1.toUpperCase().slice(0, 14),
    raw2.toUpperCase().slice(0, 14),
    raw3.toUpperCase().slice(0, 14)
  ];
}

// 1.5 Renderizador de Iconify con Trazos 100% Completos y Continuos (Sin cortes de dasharray)
function buildIllustratedSceneSvg(esc, vectorCache, t1, t2) {
  const rawList = [];
  if (Array.isArray(esc.iconos)) rawList.push(...esc.iconos);
  if (esc.objeto_1 && !rawList.includes(esc.objeto_1)) rawList.push(esc.objeto_1);
  if (esc.objeto_2 && !rawList.includes(esc.objeto_2)) rawList.push(esc.objeto_2);

  const cleanKeys = rawList.map(k => String(k || '').trim().toLowerCase()).filter(Boolean).slice(0, 2);
  if (cleanKeys.length === 0) cleanKeys.push('lucide:brain');

  // IMPORTANTE: Usamos icon-stroke-* (con stroke-width: 1.85 nativo para viewBox 24x24 y SIN non-scaling-stroke)
  // Así el trazado se dibuja de principio a fin sin romperse jamás en líneas discontinuas
  const styleStroke = (innerSvg, colorClass) => {
    return innerSvg.replace(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/gi, `<$1 class="${colorClass} draw"`);
  };

  if (cleanKeys.length === 1) {
    const v1 = vectorCache[cleanKeys[0]] || { viewBox: '0 0 24 24', inner: '<circle cx="12" cy="12" r="9"/>' };
    const styled1 = styleStroke(v1.inner, 'icon-stroke-yellow');
    return `
      <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
      <circle cx="100" cy="118" r="64" class="stroke-white draw" opacity="0.20" />
      <g class="float">
        <g class="pulse">
          <svg class="nested-icon" x="42" y="60" width="116" height="116" viewBox="${v1.viewBox}" overflow="visible">
            ${styled1}
          </svg>
        </g>
      </g>
      <text x="100" y="222" text-anchor="middle" fill="#ffffff" font-size="13">${t2}</text>
    `;
  }

  // Dos iconos emparejados en tarjetas o con flecha de conexión limpia (sin palo suelto)
  const v1 = vectorCache[cleanKeys[0]] || { viewBox: '0 0 24 24', inner: '<circle cx="12" cy="12" r="9"/>' };
  const v2 = vectorCache[cleanKeys[1]] || { viewBox: '0 0 24 24', inner: '<circle cx="12" cy="12" r="9"/>' };
  const styled1 = styleStroke(v1.inner, 'icon-stroke-yellow');
  const styled2 = styleStroke(v2.inner, 'icon-stroke-red');

  return `
    <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
    <rect x="10" y="62" width="80" height="106" rx="14" class="stroke-white draw" opacity="0.22" />
    <rect x="110" y="62" width="80" height="106" rx="14" class="stroke-white draw" opacity="0.22" />
    <g class="float">
      <svg class="nested-icon" x="18" y="83" width="64" height="64" viewBox="${v1.viewBox}" overflow="visible">
        ${styled1}
      </svg>
    </g>
    <g class="pulse">
      <path d="M93,115 L107,115 M102,109 L108,115 L102,121" class="stroke-white draw" stroke-width="3.5" />
      <svg class="nested-icon" x="118" y="83" width="64" height="64" viewBox="${v2.viewBox}" overflow="visible">
        ${styled2}
      </svg>
    </g>
    <text x="100" y="222" text-anchor="middle" fill="#ffffff" font-size="13">${t2}</text>
  `;
}

// 1.6 Visualización de Datos que coloca el número en la posición coherente (ej. 0% abajo si cae a cero)
function buildDynamicDataVizSvg(esc, idx, hash, t1, t2) {
  const dv = esc.data_viz || {};
  const sub = String(esc.subtitulo || '');

  const wordNumMap = {
    'cero': '0', 'un': '1', 'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
    'cinco': '5', 'diez': '10', 'doce': '12', 'quince': '15', 'veinte': '20',
    'treinta': '30', 'cuarenta': '40', 'cincuenta': '50', 'sesenta': '60',
    'setenta': '70', 'setenta y cinco': '75', 'ochenta': '80', 'ochenta y cinco': '85',
    'noventa': '90', 'cien': '100'
  };

  let rawVal = String(dv.valor ?? '').replace(/undefined|null/gi, '').trim();
  let suf = String(dv.sufijo ?? '').replace(/undefined|null/gi, '').trim();

  const subNumMatch = sub.match(/(\d+(?:[.,]\d+)?)\s*(%|€|\$|por\s*ciento|euros|horas|años)?/i);
  if (subNumMatch) {
    rawVal = subNumMatch[1];
    const unit = (subNumMatch[2] || '').toLowerCase();
    if (unit.includes('por') || unit === '%') suf = '%';
    else if (unit.includes('euro') || unit === '€') suf = '€';
  } else {
    for (const [w, n] of Object.entries(wordNumMap)) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(sub)) {
        rawVal = n;
        if (/por\s*ciento|%/i.test(sub)) suf = '%';
        break;
      }
    }
  }

  if (!rawVal) rawVal = '90';
  if (!suf && !/[%€$a-zA-Z]/.test(rawVal)) suf = '%';

  const displayVal = `${rawVal}${suf}`.slice(0, 9);
  const isZeroOrDrop = /^0(%|$)/.test(displayVal) || /cero|cae|desploma|baja|apaga|olvida/i.test(sub);

  const tipos = ['gauge_radial', 'versus_bars', 'crash_curve', 'split_brain', 'price_anchor'];
  let chosenType = (dv.tipo && tipos.includes(dv.tipo)) ? dv.tipo : tipos[(hash + idx) % tipos.length];
  if (isZeroOrDrop) chosenType = 'crash_curve';

  if (chosenType === 'crash_curve') {
    const labelX = isZeroOrDrop ? 162 : 102;
    const labelY = isZeroOrDrop ? 150 : 56;
    return `
      <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
      <polyline points="24,55 24,185 178,185" class="stroke-white draw" />
      <path d="M28,165 Q75,55 105,72 L162,175" class="stroke-yellow draw" />
      <circle cx="102" cy="72" r="6" fill="#ffd000" />
      <circle cx="162" cy="175" r="8" fill="#ff2a5f" class="pulse" />
      <text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#ff2a5f" font-size="20" class="pulse">${displayVal}</text>
      <text x="100" y="222" text-anchor="middle" fill="#ffffff" font-size="13">${t2}</text>
    `;
  } else if (chosenType === 'price_anchor') {
    return `
      <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
      <g class="float">
        <rect x="32" y="52" width="136" height="48" rx="10" class="stroke-white draw" />
        <line x1="42" y1="88" x2="158" y2="62" class="stroke-red draw" />
        <rect x="36" y="118" width="128" height="62" rx="12" class="stroke-yellow pulse" />
        <text x="100" y="158" text-anchor="middle" fill="#ffd000" font-size="25">${displayVal}</text>
      </g>
      <text x="100" y="222" text-anchor="middle" fill="#ff2a5f" font-size="13">${t2}</text>
    `;
  } else if (chosenType === 'split_brain') {
    return `
      <text x="55" y="26" text-anchor="middle" fill="#ffffff" font-size="12">${t1}</text>
      <text x="145" y="26" text-anchor="middle" fill="#ff2a5f" font-size="12">${t2}</text>
      <path d="M96,52 C55,52 42,85 46,120 C42,155 68,185 96,185 Z" class="stroke-white draw" />
      <path d="M104,52 C145,52 158,85 154,120 C158,155 132,185 104,185 Z" class="stroke-red pulse" />
      <line x1="100" y1="38" x2="100" y2="200" class="stroke-yellow draw" />
      <text x="100" y="222" text-anchor="middle" fill="#ffd000" font-size="15">${displayVal}</text>
    `;
  } else if (chosenType === 'versus_bars') {
    return `
      <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
      <line x1="22" y1="184" x2="178" y2="184" class="stroke-white draw" />
      <rect x="36" y="122" width="36" height="62" rx="5" class="stroke-white draw" />
      <rect x="82" y="92" width="36" height="92" rx="5" class="stroke-yellow draw" />
      <rect x="128" y="56" width="36" height="128" rx="5" class="stroke-red pulse" />
      <text x="146" y="47" text-anchor="middle" fill="#ffd000" font-size="15">${displayVal}</text>
      <text x="100" y="222" text-anchor="middle" fill="#ffffff" font-size="13">${t2}</text>
    `;
  } else {
    return `
      <text x="100" y="24" text-anchor="middle" fill="#ffd000" font-size="13">${t1}</text>
      <circle cx="100" cy="122" r="56" class="stroke-white draw" opacity="0.22" />
      <circle cx="100" cy="122" r="56" class="stroke-red draw pulse" />
      <text x="100" y="131" text-anchor="middle" fill="#ffd000" font-size="25">${displayVal}</text>
      <text x="100" y="222" text-anchor="middle" fill="#ffffff" font-size="13">${t2}</text>
    `;
  }
}

// 1.7 Asignador Emocional Semántico para que el Avatar nunca tenga poses incoherentes con el texto
function pickSemanticAvatarKeys(esc, catalogo, usedCuerpos, usedCaras, usedProps, allCuerpos, allCaras, allProps, hash, idx) {
  const text = `${esc.subtitulo || ''} ${esc.texto_1 || ''} ${esc.texto_2 || ''}`.toLowerCase();

  let cCand = esc.cuerpo || esc.cuerpo_id;
  let fCand = esc.cara || esc.cara_id;
  let pCand = esc.prop || esc.prop_id;

  // Reglas semánticas según lo que dice el narrador en la escena
  if (/shock|pánico|panico|miedo|boom|terror|alerta|peligro|borrado|olvida/.test(text)) {
    cCand = 'cuerpo_manos_cabeza';
    fCand = 'cara_shock';
    pCand = 'prop_nube_tormenta';
  } else if (/pregunta|duda|qué|que |cómo|como |por qué|curios|extrañ/.test(text)) {
    cCand = 'cuerpo_rascando_cabeza';
    fCand = 'cara_duda';
    pCand = 'prop_interrogaciones';
  } else if (/descubr|psicólog|psicolog|estudio|experimento|ciencia|idea|foco|paz/.test(text)) {
    cCand = 'cuerpo_senalando_arriba';
    fCand = 'cara_eureka';
    pCand = 'prop_bombilla';
  } else if (/dinero|precio|pagar|cuenta|euro|ganar|valor|coste/.test(text)) {
    cCand = 'cuerpo_sosteniendo_objeto';
    fCand = 'cara_ambicion';
    pCand = 'prop_bolsa_dinero';
  } else if (/no |rechaz|frena|para|basta|cierra|bloque/.test(text)) {
    cCand = 'cuerpo_rechazando_stop';
    fCand = 'cara_enfado';
    pCand = 'prop_escudo';
  }

  let cuerpoKey = (cCand && catalogo[cCand] && !/_[0-9]+$/.test(cCand))
    ? cCand
    : allCuerpos[(hash + idx * 3) % allCuerpos.length];
  if (usedCuerpos.has(cuerpoKey) && allCuerpos.length > usedCuerpos.size) {
    cuerpoKey = allCuerpos.find(c => !usedCuerpos.has(c)) || cuerpoKey;
  }
  usedCuerpos.add(cuerpoKey);

  let caraKey = (fCand && catalogo[fCand] && !/_[0-9]+$/.test(fCand))
    ? fCand
    : allCaras[(hash + idx * 5) % allCaras.length];
  if (usedCaras.has(caraKey) && allCaras.length > usedCaras.size) {
    caraKey = allCaras.find(c => !usedCaras.has(c)) || caraKey;
  }
  usedCaras.add(caraKey);

  let propKey = (pCand && catalogo[pCand] && !/_[0-9]+$/.test(pCand))
    ? pCand
    : allProps[(hash + idx * 7) % allProps.length];
  if (usedProps.has(propKey) && allProps.length > usedProps.size) {
    propKey = allProps.find(p => !usedProps.has(p)) || propKey;
  }
  if (propKey) usedProps.add(propKey);

  return { cuerpoKey, caraKey, propKey };
}

function normalizeForMatch(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// 2. Motor de alineación de subtítulos y escenas
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

// 3. Sintetizador Procedural de 26 Efectos
function buildSceneSfxTrack(escenas, totalDuration, videoHash) {
  function getRecipe(type, pitchMod, customFreq) {
    const p = pitchMod.toFixed(3);
    const cf = (customFreq && customFreq >= 80 && customFreq <= 2400) ? customFreq : Math.round(440 * pitchMod);

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
      },
      dog_bark: {
        expr: `0.32*exp(-14*t)*sin(2*PI*(320+90*sin(2*PI*12*t))*exp(-2.8*t)*t)+0.26*exp(-14*max(0,t-0.18))*gt(t,0.18)*sin(2*PI*360*exp(-3*max(0,t-0.18))*max(0,t-0.18))`,
        dur: 0.42
      },
      bell_ring: {
        expr: `0.22*exp(-2.8*t)*(sin(2*PI*880*${p}*t)+0.6*sin(2*PI*1760*${p}*t)+0.35*sin(2*PI*2420*${p}*t))`,
        dur: 0.85
      },
      siren_alert: {
        expr: `0.20*exp(-2.2*t)*sin(2*PI*(620+220*sin(2*PI*6*t))*t)`,
        dur: 0.65
      },
      water_drop: {
        expr: `0.26*exp(-12*t)*sin(2*PI*(420+1100*t)*t)`,
        dur: 0.25
      },
      magic_chime: {
        expr: `0.16*exp(-4*t)*(sin(2*PI*1046*t)+sin(2*PI*1318*max(0,t-0.06))*gt(t,0.06)+sin(2*PI*1568*max(0,t-0.12))*gt(t,0.12))`,
        dur: 0.60
      },
      explosion_boom: {
        expr: `0.38*exp(-4.5*t)*(sin(2*PI*65*exp(-2*t)*t)+0.5*sin(2*PI*110*t)*sin(2*PI*43*t))`,
        dur: 0.70
      },
      whistle_bird: {
        expr: `0.18*exp(-5*t)*sin(2*PI*(1400+450*sin(2*PI*14*t))*t)`,
        dur: 0.40
      },
      custom_synth: {
        expr: `0.20*exp(-6*t)*(sin(2*PI*${cf}*t)+0.5*sin(2*PI*${Math.round(cf * 1.5)}*t))`,
        dur: 0.45
      }
    };

    catalog.perro = catalog.dog_bark;
    catalog.ladrido = catalog.dog_bark;
    catalog.campana = catalog.bell_ring;
    catalog.sirena = catalog.siren_alert;
    catalog.alarma = catalog.siren_alert;
    catalog.gota = catalog.water_drop;
    catalog.agua = catalog.water_drop;
    catalog.magia = catalog.magic_chime;
    catalog.explosion = catalog.explosion_boom;
    catalog.dinero = catalog.coin_cash;
    catalog.reloj = catalog.clock_tick;
    catalog.latido = catalog.heartbeat;
    catalog.shock = catalog.sub_drop;
    catalog.whoosh = catalog.whoosh_fast;
    catalog.pop = catalog.glass_ping;

    return catalog[type] || (customFreq ? catalog.custom_synth : catalog.whoosh_fast);
  }

  const allTypes = [
    'sub_drop', 'laser_swipe', 'whoosh_fast', 'glitch_data', 'heartbeat',
    'tension_riser', 'glass_ping', 'error_buzz', 'clock_tick', 'sonar_pulse',
    'coin_cash', 'camera_shutter', 'vinyl_rewind', 'electric_zap', 'revelacion_chord',
    'mystery_question', 'bell_ring', 'magic_chime', 'water_drop'
  ];

  const inputs = [];
  const filterParts = [];
  const usedSfx = new Set();

  escenas.forEach((esc, idx) => {
    let rawType = String(esc.sfx || '').toLowerCase().trim();
    if (!rawType || (usedSfx.has(rawType) && !['dog_bark', 'bell_ring', 'coin_cash', 'water_drop'].includes(rawType))) {
      rawType = allTypes[(videoHash + idx * 3) % allTypes.length];
    }
    usedSfx.add(rawType);

    const pitchMod = 0.86 + (((videoHash + idx * 17) % 31) / 100);
    const customFreq = Number(esc.sfx_freq) || null;
    const recipe = getRecipe(rawType, pitchMod, customFreq);

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

async function main() {
  const payloadUrl = process.argv[2];
  if (payloadUrl && /^https?:\/\//i.test(payloadUrl)) {
    console.log('📥 Descargando payload desde URL...');
    await downloadFile(payloadUrl, 'payload.json');
  }

  console.log('🚀 Iniciando motor de renderizado Viral v8.5 (Trazos Iconify 100% Continuos + Anti-Colisión de Texto + Avatar Emocional)...');

  const rawCatalogo = fs.existsSync('catalogo.json') ? JSON.parse(fs.readFileSync('catalogo.json', 'utf8')) : {};
  const catalogo = { ...rawCatalogo, ...EXPANDED_SVG_PACK };

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

  const accentPalettes = [
    { name: 'Cian Eléctrico', hex: '#00f2fe', altHex: '#ff2a85', glow: 'rgba(0, 242, 254, 0.78)', altGlow: 'rgba(255, 42, 133, 0.72)', bgCenter: '#0f293a', bgEdge: '#04070b' },
    { name: 'Verde Neón', hex: '#39ff14', altHex: '#00f2fe', glow: 'rgba(57, 255, 20, 0.72)', altGlow: 'rgba(0, 242, 254, 0.72)', bgCenter: '#112c1a', bgEdge: '#050906' },
    { name: 'Amarillo Dorado', hex: '#ffd000', altHex: '#ff2a5f', glow: 'rgba(255, 208, 0, 0.78)', altGlow: 'rgba(255, 42, 95, 0.72)', bgCenter: '#2e240e', bgEdge: '#080604' },
    { name: 'Magenta Vibrante', hex: '#ff2a85', altHex: '#ffd000', glow: 'rgba(255, 42, 133, 0.78)', altGlow: 'rgba(255, 208, 0, 0.72)', bgCenter: '#2d1128', bgEdge: '#080408' },
    { name: 'Naranja Fuego', hex: '#ff6b00', altHex: '#00f2fe', glow: 'rgba(255, 107, 0, 0.78)', altGlow: 'rgba(0, 242, 254, 0.72)', bgCenter: '#30190c', bgEdge: '#090503' },
    { name: 'Violeta Eléctrico', hex: '#c77dff', altHex: '#39ff14', glow: 'rgba(199, 125, 255, 0.78)', altGlow: 'rgba(57, 255, 20, 0.72)', bgCenter: '#211338', bgEdge: '#06040a' },
    { name: 'Rojo Carmesí', hex: '#ff2a5f', altHex: '#ffd000', glow: 'rgba(255, 42, 95, 0.80)', altGlow: 'rgba(255, 208, 0, 0.75)', bgCenter: '#31101c', bgEdge: '#090306' }
  ];

  const seedStr = JSON.stringify(payload.escenas || '') + (payload.TituloYT || '') + String(Date.now());
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const chosenAccent = accentPalettes[hash % accentPalettes.length];
  const bgPatternMode = (hash >>> 3) % 5;
  const subStyleMode = (hash >>> 6) % 3;
  console.log(`🎨 Paleta: ${chosenAccent.name} | Atmósfera: #${bgPatternMode} | Estilo Sub: #${subStyleMode}`);

  const escenasOriginales = payload.escenas || [];
  console.log('🔍 Buscando y descargando vectores profesionales para cada escena del guion...');
  const vectorCache = await preloadAllSceneVectors(escenasOriginales);

  const ultimaEscenaFinOriginal = escenasOriginales.length > 0
    ? Number(escenasOriginales[escenasOriginales.length - 1].fin || 25)
    : duracionExactaVideo;
  const timeScale = duracionExactaVideo / Math.max(0.1, ultimaEscenaFinOriginal);

  // Filtrar estrictamente los elementos artesanales del catálogo (excluyendo los rellenos _0.._229)
  const filterCleanCatalog = (prefix) => {
    const clean = Object.keys(catalogo).filter(k => k.startsWith(prefix) && !/_[0-9]+$/.test(k));
    return clean.length > 0 ? clean : Object.keys(catalogo).filter(k => k.startsWith(prefix));
  };

  const allCuerpos = filterCleanCatalog('cuerpo_');
  const allCaras = filterCleanCatalog('cara_');
  const allProps = filterCleanCatalog('prop_');
  const allDiags = filterCleanCatalog('diag_');

  const usedCuerpos = new Set();
  const usedCaras = new Set();
  const usedProps = new Set();
  const usedDiags = new Set();

  const transicionesCatalogo = [
    'punch_zoom', 'whip_left', 'whip_right', 'drop_bounce',
    'glitch_shake', 'spiral_zoom', 'pendulum', 'elastic_pop'
  ];

  const escenasProcesadas = escenasOriginales.map((esc, idx) => {
    const inicioEscena = (idx === 0) ? 0 : (Number(esc.inicio) || idx * 3) * timeScale;
    const finEscena = (idx === escenasOriginales.length - 1)
      ? duracionExactaVideo
      : (Number(esc.fin) || (idx + 1) * 3) * timeScale;

    const subTexto = esc.subtitulo || '';
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim());
    const [t1, t2, t3] = sanitizeSvgTexts(esc, matchesDestacados);

    let svgInterno = '';
    let esDiagrama = false;

    const diagCandidate = esc.diagrama || esc.diag_id;

    if (diagCandidate && catalogo[diagCandidate] && !/_[0-9]+$/.test(diagCandidate)) {
      let diagKey = diagCandidate;
      if (usedDiags.has(diagKey) && allDiags.length > usedDiags.size) {
        diagKey = allDiags.find(d => !usedDiags.has(d)) || diagKey;
      }
      usedDiags.add(diagKey);
      let rawDiagSvg = catalogo[diagKey];
      if (/LÓGICA/i.test(rawDiagSvg) && /EMOCIÓN/i.test(rawDiagSvg)) {
        rawDiagSvg = rawDiagSvg.replace(/LÓGICA/gi, t1).replace(/EMOCIÓN/gi, t2);
      }
      if (!/<text\b/i.test(rawDiagSvg) && !/\{?\{TEXTO_1\}?\}/.test(rawDiagSvg)) {
        rawDiagSvg += `
          <text x="100" y="24" text-anchor="middle" fill="#ffffff" font-size="13">${t1}</text>
          <text x="100" y="222" text-anchor="middle" fill="#ffd000" font-size="13">${t2}</text>
        `;
      }
      svgInterno = `<g class="layer-main">${rawDiagSvg}</g>`;
      esDiagrama = true;
    } else if (esc.modo_visual === 'data_viz') {
      svgInterno = `<g class="layer-main">${buildDynamicDataVizSvg(esc, idx, hash, t1, t2)}</g>`;
      esDiagrama = true;
    } else if (esc.modo_visual === 'icon_composition' || esc.modo_visual === 'svg_custom') {
      svgInterno = `<g class="layer-main">${buildIllustratedSceneSvg(esc, vectorCache, t1, t2)}</g>`;
      esDiagrama = true;
    } else {
      const { cuerpoKey, caraKey, propKey } = pickSemanticAvatarKeys(
        esc, catalogo, usedCuerpos, usedCaras, usedProps, allCuerpos, allCaras, allProps, hash, idx
      );

      // Si el prop ya incluye {{TEXTO_1}} dentro (como prop_cartel_mano o prop_bocadillo_texto), no duplicamos el título arriba
      const propRaw = (propKey && catalogo[propKey]) ? catalogo[propKey] : '';
      const propHasInternalText = /\{\{TEXTO_1\}\}|\{TEXTO_1\}/.test(propRaw);

      if (!propHasInternalText) {
        svgInterno += `<text x="100" y="16" text-anchor="middle" fill="#ffd000" font-size="12.5">${t1}</text>`;
      }

      // Desplazamos el avatar 14px hacia abajo para que los accesorios de cabeza (corona, bombilla, interrogaciones) nunca choquen con el título superior
      svgInterno += `<g transform="translate(0, 14) scale(0.95)" style="transform-origin: 100px 120px;">`;
      if (catalogo[cuerpoKey]) svgInterno += `<g class="layer-body">${catalogo[cuerpoKey]}</g>`;
      if (catalogo[caraKey]) svgInterno += `<g class="layer-face" data-cara="${caraKey}">${catalogo[caraKey]}</g>`;
      if (propRaw) svgInterno += `<g class="layer-prop">${propRaw}</g>`;
      svgInterno += `</g>`;

      svgInterno += `<text x="100" y="234" text-anchor="middle" fill="#ffffff" font-size="12.5">${t2}</text>`;
    }

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1).replace(/\{TEXTO_1\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2).replace(/\{TEXTO_2\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3).replace(/\{TEXTO_3\}/g, t3)
      .replace(/undefined/gi, '');

    const planosRotativos = ['primer_plano', 'medio', 'general', 'primer_plano'];
    const planoElegido = (idx === 0) ? 'primer_plano' : (esc.plano || planosRotativos[(hash + idx) % planosRotativos.length]);

    const rawTrans = String(esc.transicion || '').toLowerCase().trim();
    const transicionElegida = (idx === 0)
      ? 'punch_zoom'
      : (transicionesCatalogo.includes(rawTrans) ? rawTrans : transicionesCatalogo[(hash + idx * 3) % transicionesCatalogo.length]);

    return {
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      svgInterno,
      esDiagrama,
      plano: planoElegido,
      transicion: transicionElegida,
      drawMode: (hash + idx) % 3
    };
  });

  const subtitleChunks = buildSubtitleChunks(escenasProcesadas, payload.alignment, duracionExactaVideo);

  // Mezcla de Audio: Voz + Música de fondo (bg_music.mp3) + Sintetizador SFX Contextual
  try {
    let hasHookSfx = false;
    try {
      console.log('⚡ Sintetizando pista SFX contextual y procedural...');
      hasHookSfx = buildSceneSfxTrack(escenasProcesadas, duracionExactaVideo, hash);
    } catch (sfxErr) {
      console.warn('⚠️ No se pudo sintetizar la pista SFX:', sfxErr.message);
    }

    const bgMusicPath = path.resolve('bg_music.mp3');
    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.10,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
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
    console.warn('⚠️ Fallback a voz limpia:', audioErr.message);
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
        background: radial-gradient(circle at 50% 36%, ${chosenAccent.bgCenter} 0%, ${chosenAccent.bgEdge} 100%);
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
        background: radial-gradient(circle at 50% 45%, transparent 48%, rgba(0,0,0,0.72) 100%);
        z-index: 3; pointer-events: none;
      }
      .glow-spot {
        position: absolute; top: 36%; left: 50%; width: 540px; height: 540px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, var(--accent-glow) 0%, var(--accent-alt-glow) 42%, transparent 72%);
        opacity: 0.52;
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
        padding-bottom: 220px;
        display: flex; justify-content: center; align-items: center;
        opacity: 0; z-index: 10;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform, filter;
      }
      svg.root-svg { width: 530px; height: 630px; overflow: visible; filter: drop-shadow(0 16px 32px rgba(0,0,0,0.88)); }
      .plano-primer_plano svg.root-svg { width: 645px; height: 765px; }
      .plano-medio svg.root-svg { width: 585px; height: 695px; }
      .plano-general svg.root-svg { width: 525px; height: 625px; }

      svg text {
        font-family: 'Montserrat', sans-serif;
        font-weight: 900;
        paint-order: stroke fill;
        stroke: #0a0a12;
        stroke-width: 2.5px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* TRAZOS NEÓN EN COORDENADAS RAÍZ (200x240) */
      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.42)); }
      .stroke-red { stroke: var(--accent-alt); stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px var(--accent-alt-glow)); }
      .stroke-yellow { stroke: var(--accent-color); stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px var(--accent-glow)); }

      /* TRAZOS NEÓN NATIVOS PARA ICONIFY ANIDADO (24x24) -> 100% CONTINUOS Y SIN CORTES */
      .icon-stroke-white { stroke: #ffffff; stroke-width: 1.85; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 6px rgba(255,255,255,0.45)); }
      .icon-stroke-red { stroke: var(--accent-alt); stroke-width: 1.85; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 10px var(--accent-alt-glow)); }
      .icon-stroke-yellow { stroke: var(--accent-color); stroke-width: 1.85; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 10px var(--accent-glow)); }

      .subtitle-container {
        position: absolute;
        bottom: 118px;
        left: 30px;
        right: 30px;
        min-height: 150px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 25;
        pointer-events: none;
      }
      .subtitle-box {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 14px 24px;
        text-align: center;
        padding: 18px 28px;
        background: rgba(8, 8, 16, 0.82);
        border: 2px solid rgba(255, 255, 255, 0.16);
        border-radius: 26px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.90);
        will-change: transform, opacity;
      }
      .subtitle-box.style-1 {
        background: linear-gradient(180deg, rgba(16, 16, 30, 0.88) 0%, rgba(6, 6, 12, 0.94) 100%);
        border: 2px solid var(--accent-color);
        box-shadow: 0 14px 36px rgba(0,0,0,0.9), 0 0 22px var(--accent-glow);
      }
      .subtitle-box.style-2 {
        background: rgba(6, 6, 12, 0.88);
        border-left: 6px solid var(--accent-color);
        border-right: 6px solid var(--accent-alt);
        border-radius: 18px;
      }
      .sub-word {
        display: inline-block;
        margin: 0 3px;
        font-size: 39px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        line-height: 1.18;
        color: #ffffff;
        paint-order: stroke fill;
        -webkit-text-stroke: 7px #05050a;
        text-shadow: 0 6px 16px rgba(0, 0, 0, 0.95);
        will-change: transform, opacity;
      }
      .sub-word.kw {
        color: var(--accent-color);
        filter: drop-shadow(0 0 14px var(--accent-glow));
      }
      .sub-word.active {
        transform: scale(1.10) translateY(-4px);
      }
      .sub-word.kw.active {
        transform: scale(1.15) translateY(-5px) rotate(-1.5deg);
      }
      .sub-word.future {
        opacity: 0.42;
      }
    </style>
  </head>
  <body>
    <canvas id="bg-canvas" width="720" height="1280"></canvas>
    <div class="vignette"></div>
    <div class="glow-spot" id="glow"></div>
    <div class="hook-flash" id="hook-flash"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag" id="top-tag">${payload.subrama || payload.categoria || 'PSICOLOGÍA'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg class="root-svg" viewBox="0 0 200 240">${e.svgInterno}</svg>
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
      const bgPatternMode = ${bgPatternMode};
      const accentHex = "${chosenAccent.hex}";
      const accentAltHex = "${chosenAccent.altHex}";

      const canvas = document.getElementById('bg-canvas');
      const ctx = canvas.getContext('2d');
      const particles = Array.from({ length: 36 }, (_, i) => ({
        x: (i * 97) % 720,
        y: (i * 173) % 1280,
        r: 1.8 + (i % 4) * 1.3,
        vx: ((i % 5) - 2) * 14,
        vy: -22 - (i % 6) * 12,
        alpha: 0.18 + (i % 5) * 0.10,
        isAlt: i % 3 === 0
      }));

      function renderAtmosphere(t, sceneLocalT) {
        ctx.clearRect(0, 0, 720, 1280);
        const burst = sceneLocalT < 0.20 ? (1 - sceneLocalT / 0.20) : 0;

        ctx.save();
        if (bgPatternMode === 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.045)';
          ctx.lineWidth = 1;
          const offset = (t * 28) % 55;
          for (let x = 0; x < 720; x += 55) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1280); ctx.stroke();
          }
          for (let y = offset; y < 1280; y += 55) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(720, y); ctx.stroke();
          }
        } else if (bgPatternMode === 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1.5;
          for (let r = 1; r <= 6; r++) {
            const rad = ((r * 110 + t * 45) % 680);
            ctx.beginPath();
            ctx.arc(360, 480, rad, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (bgPatternMode === 2) {
          ctx.strokeStyle = 'rgba(255,255,255,0.055)';
          ctx.lineWidth = 1;
          for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            const px1 = (p1.x + p1.vx * t + 7200) % 720;
            const py1 = (p1.y + p1.vy * t + 12800) % 1280;
            for (let j = i + 1; j < particles.length; j++) {
              const p2 = particles[j];
              const px2 = (p2.x + p2.vx * t + 7200) % 720;
              const py2 = (p2.y + p2.vy * t + 12800) % 1280;
              const dist = Math.hypot(px1 - px2, py1 - py2);
              if (dist < 135) {
                ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
              }
            }
          }
        } else if (bgPatternMode === 3) {
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 1.5;
          const shift = (t * 35) % 90;
          for (let i = -1280; i < 720; i += 90) {
            ctx.beginPath();
            ctx.moveTo(i + shift, 0);
            ctx.lineTo(i + shift + 720, 1280);
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.065)';
          ctx.lineWidth = 1.5;
          const yShift = (t * 20) % 90;
          for (let x = 60; x < 720; x += 90) {
            for (let y = yShift; y < 1280; y += 90) {
              ctx.beginPath();
              ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
              ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
              ctx.stroke();
            }
          }
        }

        particles.forEach((p, idx) => {
          const speedBoost = 1 + burst * 0.4;
          const px = (p.x + p.vx * t * speedBoost + Math.sin(t * 2 + idx) * 18 + 7200) % 720;
          const py = (p.y + p.vy * t * speedBoost + 12800) % 1280;
          ctx.fillStyle = p.isAlt ? accentAltHex : accentHex;
          ctx.globalAlpha = Math.min(0.85, p.alpha + burst * 0.25);
          ctx.beginPath();
          ctx.arc(px, py, p.r * (1 + burst * 0.5), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      document.fonts.ready.then(() => {
        document.querySelectorAll('.scene svg.root-svg').forEach(svg => {
          const texts = Array.from(svg.querySelectorAll('text'));
          texts.forEach(txt => {
            const content = (txt.textContent || '').trim();
            if (content.length <= 2) return;

            const x = parseFloat(txt.getAttribute('x') || '100');
            const y = parseFloat(txt.getAttribute('y') || '120');

            const sameRowTexts = texts.filter(other => {
              if (other === txt) return false;
              const oy = parseFloat(other.getAttribute('y') || '0');
              return Math.abs(oy - y) < 14;
            });

            let maxAllowedWidth = 170;
            if (sameRowTexts.length >= 2) {
              maxAllowedWidth = 52;
            } else if (sameRowTexts.length === 1) {
              const ox = parseFloat(sameRowTexts[0].getAttribute('x') || '100');
              const dist = Math.abs(x - ox);
              maxAllowedWidth = Math.max(54, dist - 28);
            } else if (x < 65 || x > 135) {
              maxAllowedWidth = 60;
            }

            let currentSize = parseFloat(txt.getAttribute('font-size') || '12');
            while (txt.getComputedTextLength() > maxAllowedWidth && currentSize > 6.5) {
              currentSize -= 0.5;
              txt.setAttribute('font-size', String(currentSize));
            }

            if (txt.getComputedTextLength() > maxAllowedWidth) {
              txt.setAttribute('textLength', String(maxAllowedWidth));
              txt.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
          });
        });
      });

      // Medir longitud geométrica real (getTotalLength) en lugar de pathLength=100 para evitar trazos rotos en iconos anidados
      document.querySelectorAll('.scene svg.root-svg').forEach(svg => {
        const shapes = svg.querySelectorAll('.draw, line, polyline, path, rect, polygon, circle, ellipse');
        let idx = 0;
        shapes.forEach(shape => {
          const fillAttr = shape.getAttribute('fill');
          const hasSolidFill = fillAttr && fillAttr !== 'none' && !fillAttr.startsWith('rgba');
          if (hasSolidFill && !shape.classList.contains('draw')) return;

          let len = 100;
          if (typeof shape.getTotalLength === 'function') {
            try {
              const measured = shape.getTotalLength();
              if (measured && measured > 0) len = measured;
            } catch (e) {}
          }
          shape.dataset.realLen = String(len);
          shape.dataset.drawIdx = String(idx++);
          shape.style.strokeDasharray = String(len);
          shape.style.strokeDashoffset = String(len);
        });
        svg.dataset.totalShapes = String(idx);
      });

      function easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      }

      function easeOutElastic(x) {
        if (x === 0 || x === 1) return x;
        return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
      }

      const subBox = document.getElementById('sub-box');
      const hookFlash = document.getElementById('hook-flash');
      const glowEl = document.getElementById('glow');
      let lastChunkIdx = -2;

      window.setFrameData = function(frameIdx, t) {
        const linearRatio = (frameIdx + 1) / totalFrames;
        const psychPct = Math.pow(linearRatio, 0.62) * 100;
        document.getElementById('pbar').style.width = Math.min(100, psychPct) + '%';
        
        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        const activeScene = escenas[activeIdx];
        const sceneLocalT = activeScene ? Math.max(0, t - activeScene.inicio) : 0;

        renderAtmosphere(t, sceneLocalT);

        if (t < 0.25) {
          hookFlash.style.opacity = String((1 - t / 0.25) * 0.44);
        } else if (sceneLocalT < 0.14) {
          hookFlash.style.opacity = String((1 - sceneLocalT / 0.14) * 0.16);
        } else {
          hookFlash.style.opacity = '0';
        }

        const glowX = 50 + Math.sin(activeIdx * 2.1 + t * 1.5) * 12;
        const glowY = 36 + Math.cos(activeIdx * 1.7 + t * 1.2) * 7;
        const glowScale = 1 + Math.sin(t * 4.5) * 0.18 + (sceneLocalT < 0.25 ? (1 - sceneLocalT / 0.25) * 0.35 : 0);
        glowEl.style.left = glowX + '%';
        glowEl.style.top = glowY + '%';
        glowEl.style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          if (idx === activeIdx) {
            const localT = Math.max(0, t - e.inicio);
            const durEscena = Math.max(0.1, e.fin - e.inicio);
            sc.style.opacity = '1';

            let tx = 0;
            let ty = Math.sin(localT * 5.2) * 8;
            let scale = 1;
            let rot = 0;

            const tr = e.transicion || 'elastic_pop';
            const p = Math.min(1, localT / 0.28);
            const easeCubic = 1 - Math.pow(1 - p, 3);

            if (idx === 0 || tr === 'punch_zoom') {
              scale = 1.78 - 0.78 * easeCubic;
              rot = (1 - easeCubic) * -9 + Math.sin(localT * 3.2) * 2.0;
            } else if (tr === 'whip_left') {
              const b = easeOutBack(p);
              tx = -340 * (1 - b);
              scale = 0.75 + 0.25 * b;
              rot = -18 * (1 - b) + Math.sin(localT * 3.0) * 2.2;
            } else if (tr === 'whip_right') {
              const b = easeOutBack(p);
              tx = 340 * (1 - b);
              scale = 0.75 + 0.25 * b;
              rot = 18 * (1 - b) + Math.sin(localT * 3.0) * 2.2;
            } else if (tr === 'drop_bounce') {
              const el = easeOutElastic(Math.min(1, localT / 0.42));
              ty = -320 * (1 - el) + Math.sin(localT * 5.2) * 8;
              scale = 0.85 + 0.15 * el;
              rot = Math.sin(localT * 3.5) * 2.0;
            } else if (tr === 'glitch_shake') {
              const b = easeOutBack(p);
              scale = 0.60 + 0.40 * b;
              const shakeDecay = localT < 0.45 ? (1 - localT / 0.45) : 0.18;
              tx += Math.sin(localT * 55) * 14 * shakeDecay;
              ty += Math.cos(localT * 62) * 10 * shakeDecay;
              rot = Math.sin(localT * 40) * 5 * shakeDecay;
            } else if (tr === 'spiral_zoom') {
              const b = easeOutBack(p);
              scale = 0.30 + 0.70 * b;
              rot = (1 - easeCubic) * 28 + Math.sin(localT * 2.8) * 2.0;
            } else if (tr === 'pendulum') {
              const b = easeOutBack(p);
              scale = 0.65 + 0.35 * b;
              rot = Math.sin(localT * 6.2) * 7.5;
              tx += Math.sin(localT * 6.2) * 18;
            } else {
              const el = easeOutElastic(Math.min(1, localT / 0.38));
              scale = 0.35 + 0.65 * el;
              rot = Math.sin(localT * 2.8) * (e.esDiagrama ? 1.5 : 2.8);
            }

            scale *= (1 + (localT / durEscena) * 0.09);
            if (localT > durEscena * 0.48) {
              const midP = Math.min(1, (localT - durEscena * 0.48) / 0.22);
              scale *= (1 + 0.08 * easeOutBack(midP));
            }

            inner.style.transform = \`translate(\${tx.toFixed(1)}px, \${ty.toFixed(1)}px) scale(\${scale.toFixed(3)}) rotate(\${rot.toFixed(2)}deg)\`;

            const svgEl = sc.querySelector('svg.root-svg');
            const totalShapes = Math.max(1, parseInt(svgEl?.dataset.totalShapes || '8', 10));
            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              const realLen = parseFloat(shape.dataset.realLen || '100');
              let drawP = 1;
              if (idx === 0) {
                drawP = Math.max(0.68, Math.min(1, 0.68 + (localT / 0.18) * 0.32));
              } else if (e.drawMode === 1) {
                drawP = Math.max(0, Math.min(1, localT / 0.28));
              } else if (e.drawMode === 2) {
                const revIdx = Math.max(0, totalShapes - 1 - dIdx);
                const delay = Math.min(0.16, revIdx * 0.02);
                drawP = Math.max(0, Math.min(1, (localT - delay) / 0.30));
              } else {
                const delay = Math.min(0.16, dIdx * 0.02);
                drawP = Math.max(0, Math.min(1, (localT - delay) / 0.32));
              }
              shape.style.strokeDashoffset = String(realLen * (1 - drawP));
            });

            const bodyLayer = sc.querySelector('.layer-body');
            if (bodyLayer) {
              const breathScaleY = 1 + Math.sin(localT * 6.0) * 0.025;
              const breathScaleX = 1 - Math.sin(localT * 6.0) * 0.015;
              bodyLayer.style.transformOrigin = '100px 140px';
              bodyLayer.style.transform = \`scale(\${breathScaleX}, \${breathScaleY})\`;
            }

            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const caraType = faceLayer.dataset.cara || '';
              let faceX = 0;
              let faceY = Math.sin(localT * 7.5) * 3.2;
              let faceRot = Math.sin(localT * 5.2) * 4.0;

              if (/estres|enfado|miedo|panico|grito|shock/.test(caraType)) {
                faceX = Math.sin(localT * 38) * 2.2;
                faceRot += Math.cos(localT * 32) * 3.0;
              } else if (/duda|pensando|sospecha/.test(caraType)) {
                faceRot = -6 + Math.sin(localT * 3.5) * 6.0;
              }

              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translate(\${faceX}px, \${faceY}px) rotate(\${faceRot}deg)\`;
            }

            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propX = Math.cos(localT * 5.0) * 4.0;
              const propY = Math.sin(localT * 6.8 + 1) * 5.0;
              const propScale = 1 + Math.sin(localT * 10.5) * 0.08;
              const propRot = Math.sin(localT * 4.5) * 4.5;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translate(\${propX}px, \${propY}px) scale(\${propScale}) rotate(\${propRot}deg)\`;
            }

            sc.querySelectorAll('.float').forEach(el => {
              const fOffset = Math.sin(localT * 6.8) * 5.5;
              el.style.transform = \`translateY(\${fOffset}px)\`;
            });

            sc.querySelectorAll('.pulse').forEach(el => {
              const pScale = 1 + Math.sin(localT * 11.5) * 0.08;
              el.style.transformOrigin = '100px 118px';
              el.style.transform = \`scale(\${pScale})\`;
            });

          } else {
            sc.style.opacity = '0';
          }
        });

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
        const popP = Math.min(1, chunkLocalT / 0.12);
        const boxScale = 0.90 + 0.10 * easeOutBack(popP);
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
          const isCurrent = (t >= w.start && t <= w.end);
          const isFuture = (t < w.start);

          el.classList.toggle('active', isCurrent);
          el.classList.toggle('future', isFuture);
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

  console.log(`🎬 Grabando exactamente ${totalFrames} fotogramas (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final con mapeo explícito de vídeo y audio...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo output.mp4 v8.5 generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
