const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado con sincronización WAV exacta...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));

  // 1. Guardar MP3 original y convertir a WAV limpio (con 0.25s de respiro final para evitar cortes abruptos)
  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio_raw.mp3', Buffer.from(audioBase64, 'base64'));

  // Convertimos a WAV añadiendo 0.25s de silencio al final para que la última sílaba jamás quede truncada
  execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.25" -c:a pcm_s16le audio.wav', { stdio: 'ignore' });

  // ============================================================================
  // 2. OBTENCIÓN DE LA DURACIÓN REAL EXACTA (CORREGIDO: nk=1 sobre WAV)
  // ============================================================================
  let realAudioDuration = 35;
  try {
    // NOTA: 'nk=1' (nokey=1) devuelve solo el número. Antes ponía 'n=1' y parseFloat daba NaN.
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 audio.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) {
      realAudioDuration = parsed;
      console.log(`🎙️ Duración real exacta medida en WAV: ${realAudioDuration.toFixed(3)}s`);
    } else {
      throw new Error(`Salida de ffprobe no numérica: ${probeOutput}`);
    }
  } catch (err) {
    console.error('⚠️ Fallo al medir con ffprobe, usando fallback:', err.message);
    realAudioDuration = Number(payload.duracion_total) || 35;
  }

  // El vídeo durará EXACTAMENTE lo que dura el audio WAV (ni más ni menos)
  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

  // ============================================================================
  // 3. ESCALADO PROPORCIONAL EXACTO DE ESCENAS DE 0 A 100% DEL TIEMPO
  // ============================================================================
  const escenasOriginales = payload.escenas || [];
  const ultimaEscenaFinOriginal = escenasOriginales.length > 0
    ? Number(escenasOriginales[escenasOriginales.length - 1].fin)
    : duracionExactaVideo;

  const timeScale = duracionExactaVideo / Math.max(0.1, ultimaEscenaFinOriginal);

  const escenasProcesadas = escenasOriginales.map((esc, idx) => {
    const inicioEscena = (idx === 0) ? 0 : Number(esc.inicio) * timeScale;
    const finEscena = (idx === escenasOriginales.length - 1)
      ? duracionExactaVideo
      : Number(esc.fin) * timeScale;

    let svgInterno = '';

    if (esc.diagrama && catalogo[esc.diagrama]) {
      svgInterno = `<g class="layer-main">${catalogo[esc.diagrama]}</g>`;
    } else {
      const cuerpoKey = (esc.cuerpo && catalogo[esc.cuerpo]) ? esc.cuerpo : 'cuerpo_base_quieto';
      const caraKey = (esc.cara && catalogo[esc.cara]) ? esc.cara : 'cara_duda';
      const propKey = (esc.prop && catalogo[esc.prop]) ? esc.prop : null;

      if (catalogo[cuerpoKey]) svgInterno += `<g class="layer-body">${catalogo[cuerpoKey]}</g>`;
      if (catalogo[caraKey]) svgInterno += `<g class="layer-face">${catalogo[caraKey]}</g>`;
      if (propKey && catalogo[propKey]) svgInterno += `<g class="layer-prop">${catalogo[propKey]}</g>`;
    }

    const subTexto = esc.subtitulo || '';
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim().toUpperCase());
    const t1 = esc.texto_1 || matchesDestacados[0] || 'REALIDAD';
    const t2 = esc.texto_2 || matchesDestacados[1] || 'ILUSIÓN';
    const t3 = esc.texto_3 || matchesDestacados[2] || 'SESGO';

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3)
      .replace(/\{TEXTO_1\}/g, t1)
      .replace(/\{TEXTO_2\}/g, t2)
      .replace(/\{TEXTO_3\}/g, t3);

    const planosRotativos = ['medio', 'general', 'primer_plano', 'medio'];
    const planoElegido = esc.plano || planosRotativos[idx % planosRotativos.length];

    return {
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      svgInterno,
      esDiagrama: !!esc.diagrama,
      plano: planoElegido
    };
  });

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
        opacity: 0; z-index: 10;
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
    </style>
  </head>
  <body>
    <div class="grid-bg"></div>
    <div class="glow-spot" id="glow"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag">${payload.categoria || 'PSICOLOGÍA'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg viewBox="0 0 200 240">${e.svgInterno}</svg>
          </div>
        </div>
      `).join('')}
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas)};
      const totalFrames = ${totalFrames};

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

      window.setFrameData = function(frameIdx, t) {
        // La barra de progreso se calcula directamente con el índice de fotograma: 0% en el primer frame, 100% en el último
        const progressPct = ((frameIdx + 1) / totalFrames) * 100;
        document.getElementById('pbar').style.width = Math.min(100, progressPct) + '%';
        
        const glowScale = 1 + Math.sin(t * 3.5) * 0.16;
        document.getElementById('glow').style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        // Buscamos la escena activa (si t roza el final, mantenemos activa la última escena para que nunca quede pantalla vacía)
        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = escenas.length - 1;

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          if (idx === activeIdx) {
            const localT = Math.max(0, t - e.inicio);
            const durEscena = Math.max(0.1, e.fin - e.inicio);
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

  // Limpiamos SIEMPRE el directorio frames por si hubiera fotogramas residuales
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

  console.log(`🎬 Grabando exactamente ${totalFrames} fotogramas (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final sincronizado al milisegundo...');
  // Usamos audio.wav (que ya mide exactamente lo mismo que los fotogramas) y cerramos exactamente en duracionExactaVideo
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo output.mp4 generado con barra al 100% y audio íntegro!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
