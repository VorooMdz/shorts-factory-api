const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado...');

  // 1. Leer el catálogo de piezas y los datos enviados por n8n
  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));

  // 2. Guardar el audio Base64 de ElevenLabs como archivo MP3 físico
  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  const escenas = payload.escenas || [];
  const duracionTotal = payload.duracion_total || (escenas.length > 0 ? escenas[escenas.length - 1].fin : 15);
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // 3. Ensamblar el SVG de cada escena combinando las piezas de catalogo.json
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

    // Convertimos el subtítulo en palabras individuales envueltas en spans para animarlas dinámicamente
    const textoLimpio = (esc.subtitulo || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1');
    
    // Generar HTML donde cada palabra es un span secuencial
    const palabras = textoLimpio.split(' ');
    let subtituloHtml = palabras.map((palabra, pIdx) => {
      // Aplicar resaltados si contenía marcas originales
      let claseColor = '';
      if ((esc.subtitulo || '').includes(`**${palabra}**`)) claseColor = ' hl-red';
      else if ((esc.subtitulo || '').includes(`*${palabra}*`)) claseColor = ' hl-yellow';
      
      return `<span class="word${claseColor}" data-word-idx="${pIdx}">${palabra}</span>`;
    }).join(' ');

    return {
      ...esc,
      id: idx,
      svgInterno,
      subtituloHtml,
      totalPalabras: palabras.length,
      plano: esc.plano || 'general',
      color_acento: esc.color_acento || '#ff2a5f'
    };
  });

  // 4. Generar plantilla HTML con diseño mejorado y subtítulos dinámicos
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
        background: radial-gradient(circle at center, #181822 0%, #0a0a0f 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      .grid-bg {
        position: absolute; inset: 0;
        background-image: 
          linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
        background-size: 45px 45px;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 10px;
        background: #ff2a5f; width: 0%; z-index: 30;
      }
      .top-tag {
        position: absolute; top: 65px; left: 50%; transform: translateX(-50%);
        background: rgba(255, 255, 255, 0.07); color: #b0b0c0;
        font-size: 20px; font-weight: 800; padding: 10px 26px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 1px solid rgba(255,255,255,0.12); white-space: nowrap;
      }
      .scene {
        position: absolute; inset: 0;
        display: flex; justify-content: center; align-items: center;
        padding-bottom: 220px; opacity: 0;
      }
      svg { width: 540px; height: 648px; overflow: visible; }
      .plano-primer_plano svg { transform: scale(1.55) translateY(55px); }
      .plano-medio svg { transform: scale(1.22) translateY(20px); }
      .plano-general svg { transform: scale(1); }

      .stroke-white { stroke: #ffffff; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; fill: none; }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 10px rgba(255, 42, 95, 0.6)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 10px rgba(255, 208, 0, 0.55)); }
      .draw { stroke-dasharray: 700; stroke-dashoffset: 700; }

      .captions-box {
        position: absolute; bottom: 140px; left: 5%; width: 90%;
        text-align: center; z-index: 25;
      }
      .caption {
        font-size: 44px; font-weight: 900; color: #ffffff;
        text-transform: uppercase; line-height: 1.25;
        text-shadow: 0 6px 20px rgba(0,0,0,0.95), 0 4px 0 #000;
        display: none;
      }
      /* Estilo dinámico de palabras tipo Karaoke */
      .word {
        opacity: 0.25;
        display: inline-block;
        transition: opacity 0.12s ease, transform 0.12s ease, color 0.12s ease;
      }
      .word.active {
        opacity: 1;
        transform: scale(1.08);
        color: #ffffff;
      }
      .word.hl-red.active { color: #ff2a5f; text-shadow: 0 0 15px rgba(255, 42, 95, 0.8); }
      .word.hl-yellow.active { color: #ffd000; text-shadow: 0 0 15px rgba(255, 208, 0, 0.8); }
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
      const escenas = ${JSON.stringify(escenasProcesadas.map(e => ({ id: e.id, inicio: e.inicio, fin: e.fin, totalPalabras: e.totalPalabras })))};
      const duracionTotal = ${duracionTotal};

      window.setFrameTime = function(t) {
        document.getElementById('pbar').style.width = Math.min(100, (t / duracionTotal) * 100) + '%';

        escenas.forEach(e => {
          const sc = document.getElementById('scene-' + e.id);
          const cp = document.getElementById('cap-' + e.id);

          if (t >= e.inicio && t < e.fin) {
            const localT = t - e.inicio;
            const duracionEscena = e.fin - e.inicio;
            sc.style.opacity = '1';
            cp.style.display = 'block';

            // Animación de palabras tipo karaoke repartidas proporcionalmente en el tiempo de la escena
            const palabrasNodes = cp.querySelectorAll('.word');
            const tiempoPorPalabra = duracionEscena / e.totalPalabras;
            const palabraActivaIdx = Math.floor(localT / tiempoPorPalabra);

            palabrasNodes.forEach((wNode, wIdx) => {
              if (wIdx <= palabraActivaIdx) {
                wNode.classList.add('active');
              } else {
                wNode.classList.remove('active');
              }
            });

            // Dibujado progresivo de los trazos SVG
            const drawProgress = Math.min(1, localT / 0.9);
            sc.querySelectorAll('.draw').forEach(el => {
              el.style.strokeDashoffset = 700 * (1 - drawProgress);
            });

            // Movimiento orgánico
            const floatOffset = Math.sin(localT * 4) * 6;
            sc.querySelectorAll('.float').forEach(el => {
              el.style.transform = 'translateY(' + floatOffset + 'px)';
            });

            const pulseScale = 1 + Math.sin(localT * 6) * 0.08;
            sc.querySelectorAll('.pulse').forEach(el => {
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = 'scale(' + pulseScale + ')';
            });
          } else {
            sc.style.opacity = '0';
            cp.style.display = 'none';
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
