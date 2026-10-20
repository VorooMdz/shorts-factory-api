const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado nivel pro...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));

  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  const escenas = payload.escenas || [];
  const duracionTotal = payload.duracion_total || (escenas.length > 0 ? escenas[escenas.length - 1].fin : 15);
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // Procesar escenas y preparar bloques de texto visuales
  const escenasProcesadas = escenas.map((esc, idx) => {
    let svgInterno = '';

    if (esc.diagrama && catalogo[esc.diagrama]) {
      svgInterno += catalogo[esc.diagrama];
    } else {
      if (esc.cuerpo && catalogo[esc.cuerpo]) svgInterno += catalogo[esc.cuerpo];
      if (esc.cara && catalogo[esc.cara]) svgInterno += catalogo[esc.cara];
      if (esc.prop && catalogo[esc.prop]) svgInterno += catalogo[esc.prop];
    }

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, esc.texto_1 || '')
      .replace(/\{\{TEXTO_2\}\}/g, esc.texto_2 || '')
      .replace(/\{\{TEXTO_3\}\}/g, esc.texto_3 || '');

    // Limpiar subtítulo y formatear marcas de color de forma limpia
    let subtituloHtml = (esc.subtitulo || '')
      .replace(/\*\*(.*?)\*\*/g, '<span class="highlight-red">$1</span>')
      .replace(/\*(.*?)\*/g, '<span class="highlight-yellow">$1</span>');

    return {
      ...esc,
      id: idx,
      svgInterno,
      subtituloHtml,
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
        background: radial-gradient(circle at center, #1b1b2f 0%, #08080d 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      .grid-bg {
        position: absolute; inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
        background-size: 60px 60px;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 12px;
        background: linear-gradient(90deg, #ff2a5f, #ffd000); width: 0%; z-index: 30;
        box-shadow: 0 0 20px rgba(255, 42, 95, 0.9);
      }
      .top-tag {
        position: absolute; top: 65px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.1); color: #e0e0f0;
        font-size: 22px; font-weight: 900; padding: 12px 30px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid rgba(255,255,255,0.2); white-space: nowrap;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      
      /* Contenedor de Escenas con Animación de Entrada Elástica */
      .scene {
        position: absolute; inset: 0;
        display: flex; justify-content: center; align-items: center;
        padding-bottom: 240px; opacity: 0; transform: scale(0.7);
        transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .scene.active-scene {
        opacity: 1; transform: scale(1);
      }
      svg { width: 580px; height: 680px; overflow: visible; }
      .plano-primer_plano svg { transform: scale(1.55) translateY(55px); }
      .plano-medio svg { transform: scale(1.22) translateY(20px); }
      .plano-general svg { transform: scale(1); }

      .stroke-white { stroke: #ffffff; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; fill: none; }
      .stroke-red { stroke: #ff2a5f; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }
      .draw { stroke-dasharray: 800; stroke-dashoffset: 800; }

      /* Subtítulos Estilo Vídeo Viral (Grandes, Centrados y con Rebote) */
      .captions-box {
        position: absolute; bottom: 140px; left: 5%; width: 90%;
        text-align: center; z-index: 25; height: 180px;
        display: flex; align-items: center; justify-content: center;
      }
      .caption {
        display: none;
        font-size: 50px; font-weight: 900; color: #ffffff;
        text-transform: uppercase; line-height: 1.25;
        text-shadow: 0 10px 30px rgba(0,0,0,0.95), 0 5px 0 #000;
        max-width: 680px;
        animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      }
      .caption.active-caption {
        display: block;
      }
      .highlight-red { color: #ff2a5f; text-shadow: 0 0 25px rgba(255, 42, 95, 0.9), 0 5px 0 #000; }
      .highlight-yellow { color: #ffd000; text-shadow: 0 0 25px rgba(255, 208, 0, 0.9), 0 5px 0 #000; }

      @keyframes popIn {
        0% { transform: scale(0.85); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div class="grid-bg"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag">${payload.categoria || 'Psicología • Sesgos Cognitivos'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <svg viewBox="0 0 200 240">${e.svgInterno}</svg>
        </div>
      `).join('')}
    </div>

    <div class="captions-box">
      ${escenasProcesadas.map(e => `
        <div class="caption" id="cap-${e.id}">${e.subtituloHtml}</div>
      `).join('')}
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas.map(e => ({ id: e.id, inicio: e.inicio, fin: e.fin })))};
      const duracionTotal = ${duracionTotal};

      window.setFrameTime = function(t) {
        document.getElementById('pbar').style.width = Math.min(100, (t / duracionTotal) * 100) + '%';

        escenas.forEach(e => {
          const sc = document.getElementById('scene-' + e.id);
          const cp = document.getElementById('cap-' + e.id);

          if (t >= e.inicio && t < e.fin) {
            const localT = t - e.inicio;
            
            sc.classList.add('active-scene');
            cp.classList.add('active-caption');

            // Animación de trazo SVG progresiva y fluida
            const drawProgress = Math.min(1, localT / 0.6);
            sc.querySelectorAll('.draw').forEach(el => {
              el.style.strokeDashoffset = 800 * (1 - drawProgress);
            });

            // Animación de flotación y pulso orgánico muy dinámico
            const floatOffset = Math.sin(localT * 7) * 12;
            sc.querySelectorAll('.float').forEach(el => {
              el.style.transform = 'translateY(' + floatOffset + 'px)';
            });

            const pulseScale = 1 + Math.sin(localT * 12) * 0.15;
            sc.querySelectorAll('.pulse').forEach(el => {
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = 'scale(' + pulseScale + ')';
            });
          } else {
            sc.classList.remove('active-scene');
            cp.classList.remove('active-caption');
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
