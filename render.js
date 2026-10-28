const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
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

  // Guardar audio MP3
  fs.writeFileSync('audio.mp3', Buffer.from(payload.audio_base64, 'base64'));

  console.log("🎨 Generando HTML/CSS para Puppeteer v2.0...");
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap');
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #050508;
        font-family: 'Montserrat', sans-serif;
      }
      .scene {
        position: absolute;
        width: 1080px;
        height: 1920px;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 80px;
      }
      .scene.active { display: flex; }
      .badge {
        position: absolute;
        top: 100px;
        background: rgba(255,255,255,0.08);
        border: 2px solid #00f2fe;
        color: #fff;
        padding: 12px 36px;
        border-radius: 40px;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      .visual-container {
        width: 800px;
        height: 800px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      svg { width: 100%; height: 100%; overflow: visible; }
      .stroke-neon { stroke: #00f2fe; stroke-width: 6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-alt { stroke: #fe00f2; stroke-width: 6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-white { stroke: #ffffff; stroke-width: 6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-yellow { stroke: #ffe600; stroke-width: 6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      
      @keyframes pulseScale { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      .pulse { animation: pulseScale 2s infinite ease-in-out; transform-origin: center; }
      @keyframes floatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
      .float { animation: floatY 3s infinite ease-in-out; }

      .subtitle-box {
        position: absolute;
        bottom: 250px;
        width: 900px;
        text-align: center;
        font-size: 64px;
        font-weight: 900;
        color: #fff;
        text-shadow: 0 4px 20px rgba(0,0,0,0.9);
        line-height: 1.2;
      }
      .highlight { color: #ffe600; }
    </style>
  </head>
  <body>
    <div class="badge">${payload.subrama || 'Psicología'}</div>
    <div id="stage"></div>
    <div class="subtitle-box" id="subtitle"></div>

    <script>
      const payload = ${JSON.stringify(payload)};
      const stage = document.getElementById('stage');
      const subtitleDiv = document.getElementById('subtitle');

      function renderScene(idx) {
        const s = payload.escenas[idx];
        if (!s) return;

        // Subtítulos formateados
        subtitleDiv.innerHTML = (s.subtitulo || '').replace(/\\*\\*(.*?)\\*\\*/g, '<span class="highlight">$1</span>');

        let visualHTML = '';
        if (s.modo_visual === 'svg_custom' && s.svg_code) {
          visualHTML = \`<svg viewBox="0 0 400 400">\${s.svg_code}</svg>\`;
        } else if (s.modo_visual === 'icon_composition' && Array.isArray(s.iconos)) {
          visualHTML = \`<div style="display: flex; gap: 40px; align-items: center; justify-content: center;">\` +
            s.iconos.map(icon => \`<i data-lucide="\${icon.replace('lucide:', '')}" style="width: 160px; height: 160px; color: #00f2fe;" class="pulse"></i>\`).join('') +
            \`</div>\`;
        } else if (s.modo_visual === 'data_viz' && s.data_viz) {
          const dv = s.data_viz;
          visualHTML = \`<div style="text-align:center; color:#fff;">
            <div style="font-size: 110px; font-weight:900; color:#00f2fe;">\${dv.valor}\${dv.sufijo || ''}</div>
            <div style="font-size: 32px; font-weight:700; margin-top:20px; color:#ffe600; letter-spacing:2px;">\${dv.etiqueta_1 || ''}</div>
          </div>\`;
        } else {
          visualHTML = \`<div style="font-size: 40px; color: #fff;">🧠</div>\`;
        }

        stage.innerHTML = \`<div class="scene active"><div class="visual-container">\${visualHTML}</div></div>\`;
        lucide.createIcons();
      }

      window.setElapsed = function(timeSec) {
        for (let i = 0; i < payload.escenas.length; i++) {
          const sc = payload.escenas[i];
          if (timeSec >= sc.inicio && timeSec < sc.fin) {
            renderScene(i);
            break;
          }
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
  await page.goto(`file://${process.cwd()}/index.html`);

  console.log("🎥 Renderizando fotogramas con Puppeteer y sincronizando audio...");
  const fps = 30;
  // Duración estimada o sacada del payload
  const duracionTotal = payload.duracion_total || 25;
  const totalFrames = Math.ceil(duracionTotal * fps);

  if (!fs.existsSync('frames')) fs.mkdirSync('frames');

  for (let f = 0; f < totalFrames; f++) {
    const currentTime = f / fps;
    await page.evaluate((t) => {
      if (window.setElapsed) window.setElapsed(t);
    }, currentTime);

    await page.screenshot({ path: `frames/frame_${String(f).padStart(5, '0')}.png` });
  }

  await browser.close();

  console.log("🎬 Compilando vídeo final con FFmpeg...");
  execSync(`ffmpeg -y -framerate ${fps} -i frames/frame_%05d.png -i audio.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4`);
  console.log("✅ ¡Vídeo renderizado con éxito!");
}

main().catch(err => {
  console.error("❌ Error en render.js:", err);
  process.exit(1);
});
