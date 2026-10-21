const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado universal definitivo...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  const claves = Object.keys(catalogo);

  const carasDisponibles = claves.filter(k => k.startsWith('cara_'));
  const cuerposDisponibles = claves.filter(k => k.startsWith('cuerpo_'));
  const propsDisponibles = claves.filter(k => k.startsWith('prop_'));
  const diagsDisponibles = claves.filter(k => k.startsWith('diag_'));

  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  // ============================================================================
  // 1. SINCRONIZACIÓN AUTOMÁTICA DE AUDIO REAL CON FFPROBE
  // ============================================================================
  let realAudioDuration = payload.duracion_total || 30;
  try {
    const probeOutput = execSync('ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:n=1 audio.mp3', { encoding: 'utf8' });
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) {
      realAudioDuration = parsed;
      console.log(`🎙️ Duración real del audio detectada: ${realAudioDuration}s`);
    }
  } catch (err) {
    console.log('⚠️ No se pudo usar ffprobe, usando duración estimada del payload.');
  }

  const escenasOriginales = payload.escenas || [];
  const ultimaEscenaFinOriginal = escenasOriginales.length > 0 ? escenasOriginales[escenasOriginales.length - 1].fin : realAudioDuration;
  const timeScale = realAudioDuration / Math.max(1, ultimaEscenaFinOriginal);

  const duracionTotal = realAudioDuration + 1.0;
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // ============================================================================
  // 2. SELECCIÓN DE ARTE DINÁMICA Y VARIADA (Anti-repetición automática)
  // ============================================================================
  function seleccionarArteDinamico(esc, idx) {
    if (esc.diagrama && catalogo[esc.diagrama]) {
      return { tipo: 'diagrama', diag: esc.diagrama };
    }

    // Intercalar diagramas visuales dinámicos cada 3 escenas para dar ritmo profesional
    if (idx > 0 && idx % 3 === 0 && diagsDisponibles.length > 0) {
      const diagAleatorio = diagsDisponibles[(idx * 7) % diagsDisponibles.length];
      if (catalogo[diagAleatorio]) return { tipo: 'diagrama', diag: diagAleatorio };
    }

    // Seleccionar elementos variados rotando por catálogo si vienen vacíos o repetidos
    const cuerpoPorDefecto = cuerposDisponibles[(idx * 3) % cuerposDisponibles.length];
    const caraPorDefecto = carasDisponibles[(idx * 5) % carasDisponibles.length];
    const propPorDefecto = propsDisponibles[(idx * 2) % propsDisponibles.length];

    const cuerpoFinal = (esc.cuerpo && catalogo[esc.cuerpo] && esc.cuerpo !== 'cuerpo_base_quieto') ? esc.cuerpo : cuerpoPorDefecto;
    const caraFinal = (esc.cara && catalogo[esc.cara] && esc.cara !== 'cara_duda') ? esc.cara : caraPorDefecto;
    const propFinal = (esc.prop && catalogo[esc.prop] && esc.prop !== 'prop_interrogaciones') ? esc.prop : propPorDefecto;

    return { tipo: 'stickman', cuerpo: cuerpoFinal, cara: caraFinal, prop: propFinal };
  }

  // ============================================================================
  // 3. PROCESAR ESCENAS Y SUBTÍTULOS ESCALADOS AL AUDIO REAL
  // ============================================================================
  const todosLosSubtitulos = [];

  const escenasProcesadas = escenasOriginales.map((esc, idx) => {
    const inicioEscena = esc.inicio * timeScale;
    const finEscena = esc.fin * timeScale;
    const subTexto = esc.subtitulo || '';
    
    const arte = seleccionarArteDinamico(esc, idx);
    let svgInterno = '';

    if (arte.tipo === 'diagrama') {
      svgInterno = `<g class="layer-main">${catalogo[arte.diag]}</g>`;
    } else {
      svgInterno += `<g class="layer-body">${catalogo[arte.cuerpo]}</g>`;
      svgInterno += `<g class="layer-face">${catalogo[arte.cara]}</g>`;
      if (arte.prop && catalogo[arte.prop]) {
        svgInterno += `<g class="layer-prop">${catalogo[arte.prop]}</g>`;
      }
    }

    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim().toUpperCase());
    const t1 = esc.texto_1 || matchesDestacados[0] || 'REALIDAD';
    const t2 = esc.texto_2 || matchesDestacados[1] || 'ILUSIÓN';
    const t3 = esc.texto_3 || matchesDestacados[2] || 'SESGO';

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3);

    let enRojo = false;
    let enAmarillo = false;
    const palabrasCrudas = subTexto.trim().split(/\s+/);

    const palabrasColoreadas = palabrasCrudas.map(palabra => {
      let p = palabra;
      let color = 'none';

      if (p.startsWith('**')) { enRojo = true; p = p.slice(2); }
      else if (p.startsWith('*')) { enAmarillo = true; p = p.slice(1); }

      if (enRojo) color = 'red';
      else if (enAmarillo) color = 'yellow';

      if (p.includes('**')) { enRojo = false; p = p.replace(/\*\*/g, ''); }
      else if (p.includes('*')) { enAmarillo = false; p = p.replace(/\*/g, ''); }

      if (color === 'red') return `<span class="highlight-red">${p}</span>`;
      if (color === 'yellow') return `<span class="highlight-yellow">${p}</span>`;
      return p;
    });

    const chunkSize = 3;
    const subChunks = [];
    for (let i = 0; i < palabrasColoreadas.length; i += chunkSize) {
      subChunks.push(palabrasColoreadas.slice(i, i + chunkSize).join(' '));
    }

    const duracionEscena = (finEscena - inicioEscena);
    const tiempoPorChunk = duracionEscena / Math.max(1, subChunks.length);
    const offset = 0.45;

    subChunks.forEach((chunkHtml, cIdx) => {
      const sInicio = Math.max(0, inicioEscena + (cIdx * tiempoPorChunk) - offset);
      const sFin = (cIdx === subChunks.length - 1) ? (finEscena + 0.2 - offset) : (sInicio + tiempoPorChunk);

      todosLosSubtitulos.push({
        uid: `sub-${idx}-${cIdx}`,
        inicio: sInicio,
        fin: Math.max(sInicio + 0.2, sFin),
        html: chunkHtml
      });
    });

    const planosRotativos = ['medio', 'general', 'primer_plano', 'medio'];
    const planoElegido = esc.plano || planosRotativos[idx % planosRotativos.length];

    return {
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      svgInterno,
      esDiagrama: arte.tipo === 'diagrama',
      plano: planoElegido
    };
  });

  // Prevención de solapamientos en subtítulos
  for (let i = 0; i < todosLosSubtitulos.length - 1; i++) {
    if (todosLosSubtitulos[i].fin > todosLosSubtitulos[i + 1].inicio) {
      todosLosSubtitulos[i].fin = todosLosSubtitulos[i + 1].inicio;
    }
  }
  if (todosLosSubtitulos.length > 0) {
    todosLosSubtitulos[todosLosSubtitulos.length - 1].fin = realAudioDuration;
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: radial-gradient(circle at 50% 42%, #1d1d35 0%, #06060a 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      .grid-bg {
        position: absolute; inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
        background-size: 50px 50px;
      }
      .glow-spot {
        position: absolute; top: 38%; left: 50%; width: 480px; height: 480px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, rgba(255, 42, 95, 0.16) 0%, rgba(255, 208, 0, 0.06) 45%, transparent 70%);
        pointer-events: none; z-index: 1;
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
        box-shadow: 0 10px 30px rgba(0,0,0,0.6); z-index: 20;
      }
      
      .scene {
        position: absolute; inset: 0;
        display: flex; justify-content: center; align-items: center;
        padding-bottom: 230px; opacity: 0; z-index: 10;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform;
      }
      svg { width: 560px; height: 670px; overflow: visible; filter: drop-shadow(0 15px 30px rgba(0,0,0,0.85)); }
      .plano-primer_plano svg { width: 690px; height: 820px; }
      .plano-medio svg { width: 610px; height: 730px; }
      .plano-general svg { width: 560px; height: 670px; }

      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.35)); }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }

      .captions-box {
        position: absolute; bottom: 130px; left: 5%; width: 90%;
        text-align: center; z-index: 25; height: 180px;
        display: flex; align-items: center; justify-content: center;
      }
      .caption {
        position: absolute;
        display: none;
        font-size: 54px; font-weight: 900; color: #ffffff;
        text-transform: uppercase; line-height: 1.22;
        text-shadow: 0 10px 30px rgba(0,0,0,0.95), 0 5px 0 #000;
        width: 100%; max-width: 660px;
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
    <div class="glow-spot" id="glow"></div>
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
      ${todosLosSubtitulos.map(sub => `
        <div class="caption" id="${sub.uid}">${sub.html}</div>
      `).join('')}
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas.map(e => ({ id: e.id, inicio: e.inicio, fin: e.fin, esDiagrama: e.esDiagrama })))};
      const subtitulos = ${JSON.stringify(todosLosSubtitulos)};
      const duracionTotal = ${duracionTotal};

      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('.draw, line, polyline, path, rect, polygon, circle, ellipse');
        let idx = 0;
        shapes.forEach(shape => {
          const fillAttr = shape.getAttribute('fill');
          const hasSolidFill = fillAttr && fillAttr !== 'none' && !fillAttr.startsWith('rgba');
          if (hasSolidFill && !shape.classList.contains('draw')) return;

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

      window.setFrameTime = function(t) {
        document.getElementById('pbar').style.width = Math.min(100, (t / duracionTotal) * 100) + '%';
        
        const glowScale = 1 + Math.sin(t * 3.5) * 0.16;
        document.getElementById('glow').style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        subtitulos.forEach(sub => {
          const subEl = document.getElementById(sub.uid);
          if (t >= sub.inicio && t < sub.fin) {
            subEl.classList.add('active-caption');
            const subLocalT = t - sub.inicio;
            const popProgress = Math.min(1, subLocalT / 0.12);
            const subScale = 0.78 + 0.22 * easeOutBack(popProgress);
            subEl.style.transform = 'scale(' + subScale + ')';
          } else {
            subEl.classList.remove('active-caption');
          }
        });

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);
          const finReal = (idx === escenas.length - 1) ? duracionTotal : e.fin;

          if (t >= e.inicio && t < finReal) {
            const localT = t - e.inicio;
            const durEscena = finReal - e.inicio;
            sc.style.opacity = '1';

            const entryProgress = Math.min(1, localT / 0.35);
            let scale = 0.45 + 0.55 * easeOutBack(entryProgress);

            if (localT > durEscena * 0.5) {
              const midProgress = Math.min(1, (localT - durEscena * 0.5) / 0.25);
              scale *= (1 + 0.09 * easeOutBack(midProgress));
            }

            const floatY = Math.sin(localT * 4.5) * 10;
            const tiltDeg = Math.sin(localT * 2.4) * (e.esDiagrama ? 1.2 : 2.2);
            inner.style.transform = \`translateY(\${floatY}px) scale(\${scale}) rotate(\${tiltDeg}deg)\`;

            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              const delay = Math.min(0.25, dIdx * 0.03);
              const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.45));
              shape.style.strokeDashoffset = String(100 * (1 - drawP));
            });

            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const faceY = Math.sin(localT * 7) * 3;
              const faceRot = Math.sin(localT * 4.5) * 3.5;
              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translateY(\${faceY}px) rotate(\${faceRot}deg)\`;
            }

            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propY = Math.sin(localT * 6 + 1) * 8;
              const propScale = 1 + Math.sin(localT * 9) * 0.08;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translateY(\${propY}px) scale(\${propScale})\`;
            }

            sc.querySelectorAll('.float').forEach(el => {
              const fOffset = Math.sin(localT * 6) * 7;
              el.style.transform = \`translateY(\${fOffset}px)\`;
            });

            sc.querySelectorAll('.pulse').forEach(el => {
              const pScale = 1 + Math.sin(localT * 10) * 0.12;
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = \`scale(\${pScale})\`;
            });

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
