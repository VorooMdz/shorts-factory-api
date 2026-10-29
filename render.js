const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

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

function getAudioDuration(filePath) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
    const dur = parseFloat(out);
    return (!isNaN(dur) && dur > 0) ? dur : null;
  } catch (e) {
    return null;
  }
}

function generateSfxFiles() {
  const sfxDefs = {
    pop: `ffmpeg -y -f lavfi -i "sine=frequency=520:duration=0.09" -af "asetrate=44100*1.4,aresample=44100,afade=t=out:st=0.02:d=0.07,volume=0.35" sfx_pop.wav`,
    ding: `ffmpeg -y -f lavfi -i "sine=frequency=1180:duration=0.35" -af "afade=t=out:st=0.05:d=0.30,volume=0.28" sfx_ding.wav`,
    alarm: `ffmpeg -y -f lavfi -i "sine=frequency=740:duration=0.22" -af "tremolo=f=18:d=0.8,afade=t=out:st=0.10:d=0.12,volume=0.30" sfx_alarm.wav`,
    bass: `ffmpeg -y -f lavfi -i "sine=frequency=95:duration=0.35" -af "afade=t=out:st=0.08:d=0.27,volume=0.45" sfx_bass.wav`,
    tick: `ffmpeg -y -f lavfi -i "sine=frequency=900:duration=0.04" -af "afade=t=out:st=0.01:d=0.03,volume=0.35" sfx_tick.wav`,
    whoosh: `ffmpeg -y -f lavfi -i "anoisesrc=d=0.22:c=pink:r=44100" -af "bandpass=f=900:width_type=h:w=600,afade=t=in:st=0:d=0.08,afade=t=out:st=0.08:d=0.14,volume=0.40" sfx_whoosh.wav`
  };
  for (const [name, cmd] of Object.entries(sfxDefs)) {
    try {
      execSync(`${cmd} -loglevel error`);
    } catch (e) {
      console.warn(`⚠️ No se pudo generar SFX ${name}`);
    }
  }
}

async function preloadIconifySvgs(escenas) {
  const iconMap = {};
  for (const s of (escenas || [])) {
    if (Array.isArray(s.iconos)) {
      for (const rawIcon of s.iconos) {
        const clean = String(rawIcon || 'lucide:brain').trim();
        const [prefix, name] = clean.includes(':') ? clean.split(':') : ['lucide', clean];
        const key = `${prefix}:${name}`;
        if (!iconMap[key]) {
          const svg = await fetchText(`https://api.iconify.design/${prefix}/${name}.svg`);
          if (svg && svg.includes('<svg')) {
            iconMap[key] = svg;
          }
        }
      }
    }
  }
  return iconMap;
}

async function main() {
  const payloadUrl = process.argv[2];
  if (!payloadUrl) {
    console.error("❌ No se ha proporcionado la URL del payload.");
    process.exit(1);
  }

  console.log("📥 Descargando payload...");
  await downloadFile(payloadUrl, 'payload.json');
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));

  let catalogo = {};
  if (fs.existsSync('catalogo.json')) {
    catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  }

  fs.writeFileSync('audio.mp3', Buffer.from(payload.audio_base64, 'base64'));

  const realAudioDuration = getAudioDuration('audio.mp3');
  const duracionTotal = realAudioDuration ? (realAudioDuration + 0.35) : (payload.duracion_total || 25);
  console.log(`⏱️ Duración locución: ${realAudioDuration ? realAudioDuration.toFixed(2) : 'N/A'}s | Duración total: ${duracionTotal.toFixed(2)}s`);

  console.log("🔌 Precargando vectores desde Iconify API...");
  const iconSvgMap = await preloadIconifySvgs(payload.escenas);

  console.log("🎨 Construyendo motor visual 2.5D y animaciones neón...");
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&display=swap');
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #110714;
        font-family: 'Montserrat', sans-serif;
      }

      /* Fondo espacial 2.5D con orbe cálido y partículas como en el vídeo original */
      #space-bg {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 45%, #240d26 0%, #100612 65%, #070309 100%);
        z-index: 1;
      }
      #warm-orb {
        position: absolute;
        width: 760px;
        height: 760px;
        left: 50%;
        top: 43%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 42, 95, 0.38) 0%, rgba(255, 208, 0, 0.42) 38%, rgba(255, 170, 0, 0.12) 62%, rgba(0,0,0,0) 76%);
        filter: blur(22px);
        z-index: 2;
      }
      #parallax-canvas {
        position: absolute;
        inset: 0;
        z-index: 3;
      }

      /* Barra de progreso superior amarillo -> rosa neón */
      .top-progress-track {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 14px;
        background: rgba(255, 255, 255, 0.06);
        z-index: 40;
      }
      .top-progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #ffd000 0%, #ff2a5f 100%);
        box-shadow: 0 0 18px rgba(255, 42, 95, 0.8);
      }

      /* Badge superior con borde rosa neón */
      .badge {
        position: absolute;
        top: 82px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(22, 8, 26, 0.9);
        border: 3px solid #ff2a5f;
        box-shadow: 0 0 28px rgba(255, 42, 95, 0.55), inset 0 0 14px rgba(255, 42, 95, 0.25);
        color: #ffffff;
        padding: 14px 44px;
        border-radius: 50px;
        font-size: 27px;
        font-weight: 900;
        letter-spacing: 2px;
        text-transform: uppercase;
        white-space: nowrap;
        z-index: 30;
      }

      /* Escenario 2.5D */
      #stage {
        position: absolute;
        inset: 0;
        z-index: 10;
        perspective: 1200px;
      }
      .scene {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
      }
      .visual-container {
        width: 860px;
        height: 860px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        margin-top: -110px;
      }

      /* Trazos gruesos neón idénticos al vídeo de referencia */
      svg { width: 100%; height: 100%; overflow: visible; }
      .stroke-white {
        stroke: #ffffff;
        stroke-width: 6;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.65));
      }
      .stroke-yellow {
        stroke: #ffd000;
        stroke-width: 6;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 16px rgba(255, 208, 0, 0.75));
      }
      .stroke-red, .stroke-alt {
        stroke: #ff2a5f;
        stroke-width: 6;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 16px rgba(255, 42, 95, 0.8));
      }
      .stroke-neon {
        stroke: #00f2fe;
        stroke-width: 6;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 16px rgba(0, 242, 254, 0.75));
      }

      .label-top {
        font-size: 48px;
        font-weight: 900;
        color: #ffffff;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
        margin-bottom: 20px;
        text-align: center;
      }
      .label-bottom {
        font-size: 48px;
        font-weight: 900;
        color: #ffffff;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
        margin-top: 25px;
        text-align: center;
      }
      .label-yellow {
        color: #ffd000;
        text-shadow: 0 0 22px rgba(255, 208, 0, 0.65), 0 4px 18px rgba(0,0,0,0.9);
      }
      .label-pink {
        color: #ff2a5f;
        text-shadow: 0 0 22px rgba(255, 42, 95, 0.7), 0 4px 18px rgba(0,0,0,0.9);
      }

      /* Caja de subtítulos con borde rosa neón como en el vídeo "Así eligen al líder" */
      .subtitle-wrapper {
        position: absolute;
        bottom: 210px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 30;
        display: flex;
        justify-content: center;
        width: 960px;
      }
      .subtitle-box {
        background: rgba(14, 6, 18, 0.88);
        border: 3px solid rgba(255, 42, 95, 0.75);
        box-shadow: 0 0 32px rgba(255, 42, 95, 0.35), 0 10px 30px rgba(0, 0, 0, 0.85);
        border-radius: 28px;
        padding: 26px 48px;
        min-width: 680px;
        max-width: 940px;
        text-align: center;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 14px 20px;
      }
      .sub-word {
        font-size: 56px;
        font-weight: 900;
        text-transform: uppercase;
        color: #ffffff;
        letter-spacing: 1px;
        line-height: 1.15;
        text-shadow: 0 4px 14px rgba(0, 0, 0, 0.9);
        display: inline-block;
      }
      .sub-word.active-pink {
        color: #ff2a5f;
        text-shadow: 0 0 26px rgba(255, 42, 95, 0.95), 0 4px 14px rgba(0, 0, 0, 0.9);
        transform: scale(1.07);
      }
    </style>
  </head>
  <body>
    <div id="space-bg"></div>
    <div id="warm-orb"></div>
    <canvas id="parallax-canvas" width="1080" height="1920"></canvas>

    <div class="top-progress-track">
      <div class="top-progress-fill" id="progressBar"></div>
    </div>

    <div class="badge">${(payload.subrama && payload.subrama !== 'undefined') ? payload.subrama : 'PSICOLOGÍA SOCIAL'}</div>
    <div id="stage"></div>

    <div class="subtitle-wrapper">
      <div class="subtitle-box" id="subtitle"></div>
    </div>

    <script>
      const payload = ${JSON.stringify(payload)};
      const catalogo = ${JSON.stringify(catalogo)};
      const iconSvgMap = ${JSON.stringify(iconSvgMap)};
      const totalVideoDuration = ${duracionTotal};

      const stage = document.getElementById('stage');
      const subtitleDiv = document.getElementById('subtitle');
      const progressBar = document.getElementById('progressBar');
      const warmOrb = document.getElementById('warm-orb');
      const canvas = document.getElementById('parallax-canvas');
      const ctx = canvas.getContext('2d');

      // Sistema de partículas y anillos 2.5D con paralaje
      const particles = Array.from({ length: 42 }, (_, i) => ({
        x: (i * 197) % 1080,
        y: (i * 313) % 1920,
        z: 0.3 + ((i * 73) % 100) / 100 * 1.4,
        r: 3 + (i % 5) * 1.8,
        color: i % 3 === 0 ? '#ffd000' : (i % 3 === 1 ? '#ff2a5f' : '#ffffff'),
        alpha: 0.25 + (i % 6) * 0.1
      }));

      function cleanText(val, fallback = '') {
        if (val === undefined || val === null) return fallback;
        const s = String(val).trim();
        if (s === '' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return fallback;
        return s;
      }

      function applyPlaceholders(svgStr, s) {
        const t1 = cleanText(s.texto_1, 'MENTE');
        const t2 = cleanText(s.texto_2, 'IMPULSO');
        return svgStr
          .replace(/\\{\\{TEXTO_1\\}\\}/g, t1).replace(/\\{TEXTO_1\\}/g, t1)
          .replace(/\\{\\{TEXTO_2\\}\\}/g, t2).replace(/\\{TEXTO_2\\}/g, t2)
          .replace(/\\{\\{TEXTO_3\\}\\}/g, t1).replace(/\\{TEXTO_3\\}/g, t1)
          .replace(/undefined/gi, '');
      }

      // Escalar escenas a la duración real del audio
      const rawScenes = Array.isArray(payload.escenas) ? payload.escenas : [];
      let maxEnd = 0;
      rawScenes.forEach((s, idx) => {
        s._start = typeof s.inicio === 'number' ? s.inicio : idx * 3;
        s._end = typeof s.fin === 'number' ? s.fin : s._start + 3;
        if (s._end > maxEnd) maxEnd = s._end;
      });
      const timeScale = (maxEnd > 0) ? (totalVideoDuration / maxEnd) : 1;
      rawScenes.forEach((s, idx) => {
        s.realStart = s._start * timeScale;
        s.realEnd = (idx === rawScenes.length - 1) ? totalVideoDuration : (s._end * timeScale);
      });

      // Extraer palabras sincronizadas con ElevenLabs (3 palabras por bloque como en el vídeo original)
      let wordTimeline = [];
      const align = payload.alignment;
      if (align && Array.isArray(align.characters) && Array.isArray(align.character_start_times_seconds)) {
        let curWord = '';
        let wordStart = null;
        let wordEnd = 0;
        for (let i = 0; i < align.characters.length; i++) {
          const ch = align.characters[i];
          const st = align.character_start_times_seconds[i];
          const et = align.character_end_times_seconds ? align.character_end_times_seconds[i] : (st + 0.05);
          if (ch.trim() === '') {
            if (curWord.length > 0) {
              wordTimeline.push({ word: curWord, start: wordStart, end: wordEnd });
              curWord = '';
              wordStart = null;
            }
          } else {
            if (wordStart === null) wordStart = st;
            curWord += ch;
            wordEnd = et;
          }
        }
        if (curWord.length > 0) {
          wordTimeline.push({ word: curWord, start: wordStart, end: wordEnd });
        }
      }

      const subtitlePages = [];
      const wordsPerPage = 3;
      if (wordTimeline.length > 0) {
        for (let i = 0; i < wordTimeline.length; i += wordsPerPage) {
          const chunk = wordTimeline.slice(i, i + wordsPerPage);
          subtitlePages.push({
            start: chunk[0].start,
            end: (i + wordsPerPage < wordTimeline.length) ? wordTimeline[i + wordsPerPage].start : totalVideoDuration,
            words: chunk
          });
        }
      }

      // Generador de plantillas Data Viz estilo neón ("Así eligen al líder")
      function buildDataVizHTML(s, idx) {
        const dv = s.data_viz || {};
        const tipo = dv.tipo || ['podio', 'split_brain', 'toggle_switch', 'versus_doors', 'bar_chart', 'donut_chart'][idx % 6];
        const et1 = cleanText(dv.etiqueta_1 || s.texto_1, '85% VOTOS');
        const et2 = cleanText(dv.etiqueta_2 || s.texto_2, 'ELEGIDO');
        const val = cleanText(dv.valor, '85');
        const suf = cleanText(dv.sufijo, '%');
        const numMatch = val.match(/\\d+/);
        const targetNum = numMatch ? parseInt(numMatch[0], 10) : 85;

        if (tipo === 'podio') {
          return \`
            <div class="label-top">\${et1}</div>
            <svg viewBox="0 0 220 200" style="width:680px; height:580px;">
              <rect x="75" y="45" width="70" height="130" class="stroke-yellow draw" fill="rgba(255,208,0,0.08)"/>
              <rect x="15" y="95" width="60" height="80" class="stroke-white draw"/>
              <rect x="145" y="110" width="60" height="65" class="stroke-white draw"/>
              <text x="110" y="105" fill="#ffd000" font-size="34" font-weight="900" text-anchor="middle">#1</text>
            </svg>
            <div class="label-bottom">\${et2}</div>\`;
        } else if (tipo === 'split_brain') {
          return \`
            <div style="display:flex; justify-content:space-between; width:640px; margin-bottom:10px;">
              <span class="label-top" style="font-size:40px;">\${et1}</span>
              <span class="label-top label-pink" style="font-size:40px;">\${et2}</span>
            </div>
            <svg viewBox="0 0 200 200" style="width:660px; height:620px;">
              <path d="M95,30 C45,30 30,70 35,110 C30,150 55,180 95,180 Z" class="stroke-white draw" fill="rgba(255,255,255,0.03)"/>
              <path d="M105,30 C155,30 170,70 165,110 C170,150 145,180 105,180 Z" class="stroke-red draw pulse-el" fill="rgba(255,42,95,0.1)"/>
              <line x1="100" y1="15" x2="100" y2="195" class="stroke-yellow draw" stroke-width="3"/>
            </svg>\`;
        } else if (tipo === 'toggle_switch') {
          return \`
            <div class="label-top">\${et1}</div>
            <svg viewBox="0 0 240 140" style="width:700px; height:440px;">
              <rect x="20" y="25" width="200" height="90" rx="45" class="stroke-white draw" fill="rgba(0,0,0,0.35)"/>
              <text x="82" y="80" fill="#ffd000" font-size="28" font-weight="900" text-anchor="middle">AUTO</text>
              <circle cx="172" cy="70" r="34" fill="#ff2a5f" class="pulse-el" filter="drop-shadow(0 0 18px rgba(255,42,95,0.9))"/>
            </svg>
            <div class="label-bottom label-yellow">\${et2}</div>\`;
        } else if (tipo === 'versus_doors') {
          return \`
            <div style="display:flex; justify-content:space-around; width:700px; margin-bottom:10px;">
              <span class="label-top" style="font-size:42px;">\${et1}</span>
              <span class="label-top label-yellow" style="font-size:42px;">\${et2}</span>
            </div>
            <svg viewBox="0 0 220 200" style="width:700px; height:620px;">
              <rect x="25" y="20" width="75" height="160" rx="6" class="stroke-white draw" transform="rotate(-3 62 100)"/>
              <circle cx="85" cy="100" r="5" fill="#ffffff"/>
              <rect x="120" y="20" width="75" height="160" rx="6" class="stroke-yellow draw" fill="rgba(255,208,0,0.08)" transform="rotate(3 157 100)"/>
              <circle cx="135" cy="100" r="5" fill="#ffd000"/>
              <text x="158" y="112" fill="#ff2a5f" font-size="42" font-weight="900" text-anchor="middle" class="pulse-el">?</text>
            </svg>\`;
        } else if (tipo === 'donut_chart') {
          return \`
            <div class="label-top">\${et1}</div>
            <svg viewBox="0 0 220 220" style="width:620px; height:620px;">
              <circle cx="110" cy="110" r="75" stroke="rgba(255,255,255,0.12)" stroke-width="16" fill="none"/>
              <circle cx="110" cy="110" r="75" class="stroke-red draw" stroke-width="16" transform="rotate(-90 110 110)"/>
              <text x="110" y="125" fill="#ffd000" font-size="44" font-weight="900" text-anchor="middle" class="counter-svg" data-target="\${targetNum}" data-suffix="\${suf}">0\${suf}</text>
            </svg>
            <div class="label-bottom label-yellow">\${et2}</div>\`;
        } else {
          return \`
            <div class="label-top label-yellow">\${et1}</div>
            <svg viewBox="0 0 220 200" style="width:680px; height:580px;">
              <line x1="20" y1="175" x2="200" y2="175" class="stroke-white draw"/>
              <rect x="40" y="95" width="38" height="80" rx="4" class="stroke-white draw"/>
              <rect x="92" y="65" width="38" height="110" rx="4" class="stroke-red draw" fill="rgba(255,42,95,0.15)"/>
              <rect x="144" y="25" width="38" height="150" rx="4" class="stroke-yellow draw pulse-el" fill="rgba(255,208,0,0.18)"/>
            </svg>
            <div class="label-bottom">\${et2}</div>\`;
        }
      }

      // Pre-construir las 8 escenas
      rawScenes.forEach((s, idx) => {
        const sceneEl = document.createElement('div');
        sceneEl.className = 'scene';
        sceneEl.id = 'scene-' + idx;

        const t1 = cleanText(s.texto_1, '');
        const t2 = cleanText(s.texto_2, '');
        let visualHTML = '';

        if (s.modo_visual === 'data_viz') {
          visualHTML = buildDataVizHTML(s, idx);
        } else if (s.modo_visual === 'icon_composition') {
          const icons = (Array.isArray(s.iconos) && s.iconos.length > 0) ? s.iconos.slice(0, 3) : ['lucide:brain', 'lucide:zap'];
          const fisica = s.fisica_iconos || 'orbitar';
          const renderedIcons = icons.map((ic, k) => {
            const clean = String(ic).trim();
            const key = clean.includes(':') ? clean : 'lucide:' + clean;
            let rawSvg = iconSvgMap[key] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
            const strokeCls = k === 0 ? 'stroke-yellow' : (k === 1 ? 'stroke-white' : 'stroke-red');
            rawSvg = rawSvg.replace(/<svg[^>]*>/i, \`<svg viewBox="0 0 24 24" class="\${strokeCls}" style="width:240px; height:240px;">\`);
            return \`<div class="icon-actor" data-idx="\${k}" data-total="\${icons.length}" data-fisica="\${fisica}" style="position:absolute;">\${rawSvg}</div>\`;
          }).join('');

          visualHTML = \`
            <div class="label-top label-yellow">\${t1}</div>
            <div style="position:relative; width:680px; height:560px; display:flex; align-items:center; justify-content:center;">
              \${renderedIcons}
            </div>
            <div class="label-bottom">\${t2}</div>\`;
        } else {
          // Modo A: svg_custom o Avatar expresivo único por escena
          const cuerpoSvg = catalogo[s.cuerpo_id] || catalogo['cuerpo_hablando_pizarra'] || '';
          const caraSvg = catalogo[s.cara_id] || catalogo['cara_ambicion'] || '';
          const propSvg = catalogo[s.prop_id] || catalogo['prop_megafono'] || '';
          const customRaw = cleanText(s.svg_code, '');

          if (customRaw && customRaw.includes('<') && idx % 2 === 1) {
            const processed = applyPlaceholders(customRaw, s);
            const vb = processed.includes('300') ? '0 0 400 400' : '0 0 200 240';
            visualHTML = \`
              <div class="label-top label-yellow">\${t1}</div>
              <svg viewBox="\${vb}" style="width:660px; height:600px;">\${processed}</svg>
              <div class="label-bottom">\${t2}</div>\`;
          } else {
            const combined = applyPlaceholders(cuerpoSvg + caraSvg + propSvg, s);
            visualHTML = \`
              \${t1 ? \`<div class="label-top label-yellow">\${t1}</div>\` : ''}
              <svg viewBox="0 0 200 240" style="width:680px; height:640px;">\${combined}</svg>
              \${t2 ? \`<div class="label-bottom">\${t2}</div>\` : ''}\`;
          }
        }

        sceneEl.innerHTML = \`<div class="visual-container">\${visualHTML}</div>\`;
        stage.appendChild(sceneEl);
      });

      // Preparar todos los elementos SVG para animación de dibujado progresivo (stroke-dashoffset)
      document.querySelectorAll('path, line, polyline, polygon, circle, rect, ellipse').forEach(el => {
        if (typeof el.getTotalLength === 'function') {
          try {
            const len = el.getTotalLength();
            if (len > 0) {
              el.dataset.pathLen = len;
              el.style.strokeDasharray = len;
            }
          } catch (e) {}
        }
      });

      window.setElapsed = function(timeSec) {
        // 1. Barra de progreso superior
        const pct = Math.min(100, Math.max(0, (timeSec / totalVideoDuration) * 100));
        progressBar.style.width = pct + '%';

        // 2. Detectar escena activa
        let activeIdx = 0;
        for (let i = 0; i < rawScenes.length; i++) {
          if (timeSec >= rawScenes[i].realStart && timeSec <= rawScenes[i].realEnd) {
            activeIdx = i;
            break;
          }
        }
        const sc = rawScenes[activeIdx] || rawScenes[0];
        const sceneDuration = Math.max(0.1, sc.realEnd - sc.realStart);
        const sceneElapsed = Math.max(0, timeSec - sc.realStart);
        const sceneProgress = Math.min(1, sceneElapsed / sceneDuration);

        // 3. Mover el orbe cálido y renderizar el fondo 2.5D con paralaje
        const orbX = 50 + Math.sin(timeSec * 0.8 + activeIdx) * 8;
        const orbY = 43 + Math.cos(timeSec * 0.7 + activeIdx) * 6;
        const orbScale = 1 + 0.08 * Math.sin(timeSec * 2.5);
        warmOrb.style.left = orbX + '%';
        warmOrb.style.top = orbY + '%';
        warmOrb.style.transform = \`translate(-50%, -50%) scale(\${orbScale})\`;

        ctx.clearRect(0, 0, 1080, 1920);
        // Anillos concéntricos sutiles 2.5D que avanzan hacia la cámara
        for (let r = 0; r < 3; r++) {
          const ringProg = ((timeSec * 0.25) + r / 3) % 1;
          const radius = 120 + ringProg * 680;
          ctx.beginPath();
          ctx.arc(540, 820, radius, 0, Math.PI * 2);
          ctx.strokeStyle = \`rgba(255, 208, 0, \${(1 - ringProg) * 0.09})\`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // Partículas flotantes con paralaje en transición de escena
        const camShiftX = activeIdx * 85 + sceneProgress * 30;
        const camShiftY = timeSec * 45;
        for (const p of particles) {
          const px = ((p.x - camShiftX * p.z) % 1080 + 1080) % 1080;
          const py = ((p.y - camShiftY * p.z) % 1920 + 1920) % 1920;
          ctx.beginPath();
          ctx.arc(px, py, p.r * p.z, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // 4. Animar escena activa (entrada cubic-bezier + trazado neón + físicas)
        for (let i = 0; i < rawScenes.length; i++) {
          const el = document.getElementById('scene-' + i);
          if (!el) continue;
          if (i === activeIdx) {
            el.style.opacity = '1';
            const entryT = Math.min(1, sceneElapsed / 0.28);
            const easeOut = 1 - Math.pow(1 - entryT, 3);
            const container = el.querySelector('.visual-container');
            if (container) {
              const scale = (0.75 + 0.25 * easeOut) * (1 + sceneProgress * 0.05);
              const shiftX = (1 - easeOut) * (i % 2 === 0 ? 120 : -120);
              container.style.transform = \`translate3d(\${shiftX}px, 0, 0) scale(\${scale})\`;
            }

            // Dibujado progresivo de líneas SVG como en el vídeo original
            const drawProg = Math.min(1, sceneElapsed / 0.65);
            const easeDraw = 1 - Math.pow(1 - drawProg, 2);
            el.querySelectorAll('[data-path-len]').forEach(dEl => {
              const len = parseFloat(dEl.dataset.pathLen);
              dEl.style.strokeDashoffset = len * (1 - easeDraw);
            });

            // Pulsos y flotación
            el.querySelectorAll('.pulse, .pulse-el').forEach((pEl, k) => {
              const sVal = 1 + 0.09 * Math.sin(timeSec * 6 + k);
              pEl.style.transform = \`scale(\${sVal})\`;
              pEl.style.transformOrigin = 'center';
            });
            el.querySelectorAll('.float').forEach((fEl, k) => {
              const yVal = -14 * Math.sin(timeSec * 4 + k);
              fEl.style.transform = \`translateY(\${yVal}px)\`;
            });

            // Coreografías físicas de Iconify
            el.querySelectorAll('.icon-actor').forEach(actor => {
              const k = parseInt(actor.dataset.idx, 10);
              const total = parseInt(actor.dataset.total, 10);
              const fisica = actor.dataset.fisica;
              let x = 0, y = 0, scA = 1, rot = 0;

              if (total === 1) {
                scA = 1.2 + 0.12 * Math.sin(timeSec * 5);
                y = -15 * Math.sin(timeSec * 3.5);
              } else if (fisica === 'orbitar') {
                const angle = timeSec * 2.2 + (k * Math.PI * 2 / total);
                x = Math.cos(angle) * 170;
                y = Math.sin(angle) * 95;
              } else if (fisica === 'colisionar') {
                const bounce = Math.abs(Math.sin(timeSec * 4));
                const dir = k === 0 ? -1 : (k === 1 ? 1 : 0);
                x = dir * (65 + bounce * 130);
                scA = 1 + (1 - bounce) * 0.18;
              } else if (fisica === 'balanza') {
                x = (k - (total - 1) / 2) * 230;
                y = Math.sin(timeSec * 3.5 + k * Math.PI) * 55;
              } else {
                x = (k - (total - 1) / 2) * 230;
                scA = 1 + 0.14 * Math.sin(timeSec * 5 + k);
              }
              actor.style.transform = \`translate(\${x}px, \${y}px) scale(\${scA}) rotate(\${rot}deg)\`;
            });

            // Contadores animados
            el.querySelectorAll('.counter-svg').forEach(cEl => {
              const target = parseInt(cEl.dataset.target || '85', 10);
              const suffix = cEl.dataset.suffix || '%';
              const cur = Math.round(target * easeDraw);
              cEl.textContent = cur + suffix;
            });
          } else {
            el.style.opacity = '0';
          }
        }

        // 5. Subtítulos de 3 palabras en MAYÚSCULAS con resaltado rosa neón (#ff2a5f)
        if (subtitlePages.length > 0) {
          let activePage = subtitlePages[0];
          for (const p of subtitlePages) {
            if (timeSec >= p.start && timeSec < p.end) {
              activePage = p;
              break;
            }
          }
          if (timeSec >= subtitlePages[subtitlePages.length - 1].end) {
            activePage = subtitlePages[subtitlePages.length - 1];
          }

          let currentIdx = activePage.words.findIndex(w => timeSec >= w.start && timeSec <= w.end + 0.12);
          if (currentIdx === -1) currentIdx = activePage.words.length - 1;

          subtitleDiv.innerHTML = activePage.words.map((w, idx) => {
            const cls = (idx === currentIdx) ? 'sub-word active-pink' : 'sub-word';
            return \`<span class="\${cls}">\${w.word}</span>\`;
          }).join('');
        }
      };
    </script>
  </body>
  </html>
  `;

  fs.writeFileSync('index.html', htmlContent);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1080,1920']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });
  await page.goto(`file://${process.cwd()}/index.html`, { waitUntil: 'networkidle0' });

  console.log("🎥 Capturando fotogramas a 30 FPS...");
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  if (fs.existsSync('frames')) {
    fs.rmSync('frames', { recursive: true, force: true });
  }
  fs.mkdirSync('frames');

  for (let f = 0; f < totalFrames; f++) {
    const currentTime = f / fps;
    await page.evaluate((t) => {
      if (window.setElapsed) window.setElapsed(t);
    }, currentTime);

    await page.screenshot({ path: `frames/frame_${String(f).padStart(5, '0')}.png` });
  }

  await browser.close();

  console.log("🔊 Generando efectos sonoros (SFX) y mezclando con bg_music.mp3...");
  generateSfxFiles();

  // Calcular tiempos exactos de inicio de cada escena para inyectar los SFX
  const rawScenes = Array.isArray(payload.escenas) ? payload.escenas : [];
  let maxEnd = 0;
  rawScenes.forEach((s, idx) => {
    const st = typeof s.inicio === 'number' ? s.inicio : idx * 3;
    const et = typeof s.fin === 'number' ? s.fin : st + 3;
    if (et > maxEnd) maxEnd = et;
  });
  const scale = maxEnd > 0 ? (duracionTotal / maxEnd) : 1;

  const hasBgMusic = fs.existsSync('bg_music.mp3');
  let ffmpegInputs = `-framerate ${fps} -i frames/frame_%05d.png -i audio.mp3`;
  let inputIdx = 2;
  let bgMusicIdx = -1;

  if (hasBgMusic) {
    ffmpegInputs += ` -stream_loop -1 -i bg_music.mp3`;
    bgMusicIdx = inputIdx++;
  }

  const sfxStreams = [];
  rawScenes.forEach((s, idx) => {
    const sfxName = ['pop', 'whoosh', 'ding', 'alarm', 'bass', 'tick'].includes(s.sfx) ? s.sfx : (idx % 2 === 0 ? 'pop' : 'whoosh');
    const sfxFile = `sfx_${sfxName}.wav`;
    if (fs.existsSync(sfxFile)) {
      const delayMs = Math.max(0, Math.round((typeof s.inicio === 'number' ? s.inicio : idx * 3) * scale * 1000));
      ffmpegInputs += ` -i ${sfxFile}`;
      sfxStreams.push({ idx: inputIdx++, delayMs });
    }
  });

  // Construir filtro de mezcla de audio (Voz + Música de fondo + SFX por escena)
  let filterComplex = `[1:a]volume=1.0[voice];`;
  const mixInputs = ['[voice]'];

  if (bgMusicIdx !== -1) {
    const fadeStart = Math.max(0, duracionTotal - 1.5).toFixed(2);
    filterComplex += `[${bgMusicIdx}:a]atrim=0:${duracionTotal.toFixed(2)},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeStart}:d=1.5,volume=0.16[bgm];`;
    mixInputs.push('[bgm]');
  }

  sfxStreams.forEach((sfx, k) => {
    filterComplex += `[${sfx.idx}:a]adelay=${sfx.delayMs}|${sfx.delayMs}[sfx${k}];`;
    mixInputs.push(`[sfx${k}]`);
  });

  filterComplex += `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[aout]`;

  console.log("🎬 Compilando MP4 final con vídeo 2.5D, locución, música de fondo y SFX...");
  execSync(`ffmpeg -y ${ffmpegInputs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${duracionTotal.toFixed(2)} output.mp4`);
  console.log("✅ ¡Vídeo v2.0 renderizado con éxito!");
}

main().catch(err => {
  console.error("❌ Error en render.js:", err);
  process.exit(1);
});
