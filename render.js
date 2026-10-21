const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado con auto-inyección SVG y físicas...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  const clavesCatalogo = Object.keys(catalogo);

  console.log(`📦 Catálogo cargado con ${clavesCatalogo.length} piezas. Ejemplo de claves:`, clavesCatalogo.slice(0, 10));

  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  const escenas = payload.escenas || [];
  const duracionBase = payload.duracion_total || (escenas.length > 0 ? escenas[escenas.length - 1].fin : 15);
  const duracionTotal = duracionBase + 2.0;
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // Función auxiliar para buscar una pieza en el catálogo (exacta o por similitud)
  function obtenerPieza(nombreClave, tipoPorDefecto) {
    if (nombreClave && catalogo[nombreClave]) return catalogo[nombreClave];
    
    // Si n8n mandó un nombre ligeramente distinto, buscamos coincidencia parcial
    if (nombreClave) {
      const limpia = nombreClave.toLowerCase().trim();
      const encontrada = clavesCatalogo.find(k => k.toLowerCase().includes(limpia) || limpia.includes(k.toLowerCase()));
      if (encontrada) return catalogo[encontrada];
    }

    // Fallback: si no vino nada o no coincidió, buscar la primera pieza de ese tipo en el catálogo
    if (tipoPorDefecto) {
      const fallbackKey = clavesCatalogo.find(k => k.toLowerCase().startsWith(tipoPorDefecto.toLowerCase()));
      if (fallbackKey) return catalogo[fallbackKey];
    }
    return '';
  }

  const escenasProcesadas = escenas.map((esc, idx) => {
    console.log(`🎬 Escena ${idx} solicitada -> diagrama: ${esc.diagrama || 'N/A'}, cuerpo: ${esc.cuerpo || 'N/A'}, cara: ${esc.cara || 'N/A'}, prop: ${esc.prop || 'N/A'}`);

    let svgInterno = '';

    // 1. Intentar cargar diagrama o cualquier clave directa que venga en el objeto escena
    const posiblesClavesDirectas = [esc.diagrama, esc.svg, esc.pieza, esc.icono, esc.ilustracion, esc.animacion].filter(Boolean);
    for (const clave of posiblesClavesDirectas) {
      const pieza = obtenerPieza(clave, null);
      if (pieza) {
        svgInterno += `<g class="anim-layer-main">${pieza}</g>`;
        break;
      }
    }

    // 2. Si no era un diagrama único, ensamblar Stickman modular (Cuerpo + Cara + Prop)
    if (!svgInterno) {
      const svgCuerpo = obtenerPieza(esc.cuerpo, 'cuerpo');
      const svgCara = obtenerPieza(esc.cara, 'cara');
      const svgProp = obtenerPieza(esc.prop, null);

      if (svgCuerpo) svgInterno += `<g class="anim-layer-body">${svgCuerpo}</g>`;
      if (svgCara) svgInterno += `<g class="anim-layer-face">${svgCara}</g>`;
      if (svgProp) svgInterno += `<g class="anim-layer-prop">${svgProp}</g>`;
    }

    // 3. Fallback de emergencia: si la escena sigue completamente vacía, usar una pieza del catálogo rotativa
    if (!svgInterno.trim() && clavesCatalogo.length > 0) {
      const claveRotativa = clavesCatalogo[idx % clavesCatalogo.length];
      console.log(`⚠️ Escena ${idx} quedó vacía. Usando pieza de respaldo del catálogo: ${claveRotativa}`);
      svgInterno = `<g class="anim-layer-main">${catalogo[claveRotativa]}</g>`;
    }

    // Reemplazar textos dinámicos si el SVG los incluye
    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, esc.texto_1 || '')
      .replace(/\{\{TEXTO_2\}\}/g, esc.texto_2 || '')
      .replace(/\{\{TEXTO_3\}\}/g, esc.texto_3 || '');

    // Subtítulos (INTACTOS con tu configuración perfecta de 3 palabras y 0.55s de adelanto)
    const textoOriginal = esc.subtitulo || '';
    const palabrasCrudas = textoOriginal.split(' ');
    const chunkSize = 3; 
    const subChunks = [];
    for (let i = 0; i < palabrasCrudas.length; i += chunkSize) {
      subChunks.push(palabrasCrudas.slice(i, i + chunkSize).join(' '));
    }

    const duracionEscena = (esc.fin - esc.inicio);
    const tiempoPorChunk = duracionEscena / subChunks.length;

    const subCaptions = subChunks.map((chunkText, cIdx) => {
      const offset = 0.55;
      const sInicio = Math.max(0, esc.inicio + (cIdx * tiempoPorChunk) - offset);
      const sFin = (cIdx === subChunks.length - 1) ? esc.fin + 0.5 - offset : sInicio + tiempoPorChunk;
      
      const htmlText = chunkText
        .replace(/\*\*(.*?)\*\*/g, '<span class="highlight-red">$1</span>')
        .replace(/\*(.*?)\*/g, '<span class="highlight-yellow">$1</span>')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '');

      return {
        id: cIdx,
        inicio: sInicio,
        fin: sFin,
        html: htmlText
      };
    });

    return {
      ...esc,
      id: idx,
      svgInterno,
      subCaptions,
      plano: esc.plano || 'general'
    };
  });

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: radial-gradient(circle at center, #161625 0%, #050508 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      .grid-bg {
        position: absolute; inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
        background-size: 50px 50px;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000); width: 0%; z-index: 30;
        box-shadow: 0 0 20px rgba(255, 42, 95, 0.9);
      }
      .top-tag {
        position: absolute; top: 65px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.08); color: #e0e0f0;
        font-size: 22px; font-weight: 900; padding: 12px 30px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid rgba(255,255,255,0.18); white-space: nowrap;
        box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      }
      
      .scene {
        position: absolute; inset: 0;
        display: flex; justify-content: center; align-items: center;
        padding-bottom: 240px; opacity: 0;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform;
      }
      svg { width: 560px; height: 660px; overflow: visible; filter: drop-shadow(0 12px 25px rgba(0,0,0,0.7)); }
      .plano-primer_plano svg { width: 780px; height: 900px; }
      .plano-medio svg { width: 660px; height: 780px; }
      .plano-general svg { width: 560px; height: 660px; }

      /* Estilos por defecto para asegurar que cualquier SVG del catálogo se vea brillante */
      svg path, svg line, svg polyline, svg polygon, svg circle, svg rect, svg ellipse {
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .stroke-white { stroke: #ffffff; stroke-width: 6; fill: none; }
      .stroke-red { stroke: #ff2a5f; stroke-width: 6; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 6; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }

      .captions-box {
        position: absolute; bottom: 130px; left: 5%; width: 90%;
        text-align: center; z-index: 25; height: 180px;
        display: flex; align-items: center; justify-content: center;
      }
      .caption {
        display: none;
        font-size: 54px; font-weight: 900; color: #ffffff;
        text-transform: uppercase; line-height: 1.2;
        text-shadow: 0 10px 30px rgba(0,0,0,0.95), 0 5px 0 #000;
        max-width: 680px;
      }
      .caption.active-caption {
        display: block;
      }
      .highlight-red { color: #ff2a5f; text-shadow: 0 0 25px rgba(255, 42, 95, 0.95), 0 5px 0 #000; }
      .highlight-yellow { color: #ffd000; text-shadow: 0 0 25px rgba(255, 208, 0, 0.95), 0 5px 0 #000; }
    </style>
  </head>
  <body>
    <div class="grid-bg"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag">${payload.categoria || 'Psicología • Sesgos Cognitivos'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg viewBox="0 0 200 240">${e.svgInterno}</svg>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="captions-box">
      ${escenasProcesadas.map(e => `
        <div id="caps-scene-${e.id}">
          ${e.subCaptions.map(sub => `
            <div class="caption" id="sub-${e.id}-${sub.id}">${sub.html}</div>
          `).join('')}
        </div>
      `).join('')}
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas.map(e => ({ id: e.id, inicio: e.inicio, fin: e.fin, subCaptions: e.subCaptions })))};
      const duracionTotal = ${duracionTotal};

      // Preparar todos los elementos geométricos de cada SVG para el efecto de dibujado (Whiteboard)
      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('path, line, polyline, polygon, circle, rect, ellipse');
        shapes.forEach(shape => {
          // Si un elemento no tiene ni stroke ni fill definidos, le ponemos trazo blanco por defecto
          const computed = window.getComputedStyle(shape);
          if ((computed.stroke === 'none' || !computed.stroke) && (computed.fill === 'none' || !computed.fill)) {
            shape.style.stroke = '#ffffff';
            shape.style.strokeWidth = '6px';
            shape.style.fill = 'none';
          }
          try {
            if (typeof shape.getTotalLength === 'function') {
              const len = shape.getTotalLength();
              if (len > 0) {
                shape.dataset.pathLen = len;
                shape.style.strokeDasharray = len;
                shape.style.strokeDashoffset = len;
              }
            }
          } catch (err) {}
        });
      });

      // Función matemática de rebote elástico para entradas dinámicas (sustituye a CSS transition en Puppeteer)
      function easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      }

      window.setFrameTime = function(t) {
        document.getElementById('pbar').style.width = Math.min(100, (t / duracionTotal) * 100) + '%';

        escenas.forEach(e => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          // 1. Controlar Subtítulos (independientes gracias al adelanto de 0.55s)
          e.subCaptions.forEach(sub => {
            const subEl = document.getElementById('sub-' + e.id + '-' + sub.id);
            if (t >= sub.inicio && t < sub.fin) {
              subEl.classList.add('active-caption');
              const subLocalT = t - sub.inicio;
              const popProgress = Math.min(1, subLocalT / 0.14);
              const subScale = 0.75 + 0.25 * easeOutBack(popProgress);
              subEl.style.transform = 'scale(' + subScale + ')';
            } else {
              subEl.classList.remove('active-caption');
            }
          });

          // 2. Controlar Escena Visual y Animaciones SVG
          if (t >= e.inicio && t < e.fin) {
            const localT = t - e.inicio;
            sc.style.opacity = '1';

            // A) Entrada elástica + Flotación + Respiración continua en TODO el dibujo
            const entryProgress = Math.min(1, localT / 0.35);
            const baseScale = easeOutBack(entryProgress);
            const floatY = Math.sin(localT * 4.5) * 12;
            const swayRot = Math.sin(localT * 2.5) * 2.5;
            const breathScale = 1 + Math.sin(localT * 7) * 0.035;

            inner.style.transform = \`translateY(\${floatY}px) scale(\${baseScale * breathScale}) rotate(\${swayRot}deg)\`;

            // B) Efecto Whiteboard: dibujar progresivamente todas las líneas del SVG en los primeros 0.85s
            const drawProgress = Math.min(1, localT / 0.85);
            const shapes = sc.querySelectorAll('[data-path-len]');
            shapes.forEach((shape, sIdx) => {
              const len = parseFloat(shape.dataset.pathLen);
              // Pequeño escalonado entre trazos para que se vea más orgánico
              const delay = Math.min(0.3, sIdx * 0.03);
              const p = Math.max(0, Math.min(1, (localT - delay) / 0.65));
              shape.style.strokeDashoffset = len * (1 - p);
            });

            // C) Movimiento secundario para el prop/accesorio si existe
            const propLayer = sc.querySelector('.anim-layer-prop');
            if (propLayer) {
              const propPulse = 1 + Math.sin(localT * 10) * 0.12;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`scale(\${propPulse}) rotate(\${Math.cos(localT * 6) * 6}deg)\`;
            }
          } else {
            sc.style.opacity = '0';
          }
        });
      };
    </script>
  </body>
  </html>`;

  fs.writeFileSync('index.html', htmlContent);
  if (!fs.existsSync('frames')) fs.mkdirSync('frames');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });
  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'networkidle0' });

  console.log('🎬 Grabando ' + totalFrames + ' fotogramas...');
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((t) => window.setFrameTime(t), currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 con FFmpeg...');
  execSync('ffmpeg -y -framerate 30 -i frames/frame_%05d.jpg -i audio.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest output.mp4', { stdio: 'inherit' });

  console.log('✅ ¡Vídeo output.mp4 generado con éxito!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
