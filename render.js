const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
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

function getAudioDuration(filePath) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`).toString().trim();
    const dur = parseFloat(out);
    return (!isNaN(dur) && dur > 0) ? dur : null;
  } catch (e) {
    console.warn("⚠️ No se pudo obtener duración con ffprobe, usando fallback.");
    return null;
  }
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

  // Cargar catálogo de SVGs
  let catalogo = {};
  if (fs.existsSync('catalogo.json')) {
    catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
    console.log(`📚 Catálogo cargado (${Object.keys(catalogo).length} elementos).`);
  }

  // Guardar audio MP3
  fs.writeFileSync('audio.mp3', Buffer.from(payload.audio_base64, 'base64'));

  // Obtener duración exacta del audio MP3 real
  const realAudioDuration = getAudioDuration('audio.mp3');
  const duracionTotal = realAudioDuration ? (realAudioDuration + 0.35) : (payload.duracion_total || 26);
  console.log(`⏱️ Duración exacta del audio: ${realAudioDuration ? realAudioDuration.toFixed(2) : 'N/A'}s | Duración vídeo: ${duracionTotal.toFixed(2)}s`);

  console.log("🎨 Generando motor HTML/CSS/JS animado para Puppeteer v2.0...");
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;900&display=swap');
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: radial-gradient(circle at 50% 42%, #131424 0%, #050508 75%);
        font-family: 'Montserrat', sans-serif;
      }
      .bg-grid {
        position: absolute;
        inset: 0;
        background-image: 
          linear-gradient(rgba(0, 242, 254, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 242, 254, 0.03) 1px, transparent 1px);
        background-size: 60px 60px;
        pointer-events: none;
      }
      .badge {
        position: absolute;
        top: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(10, 12, 22, 0.85);
        border: 2px solid #00f2fe;
        box-shadow: 0 0 25px rgba(0, 242, 254, 0.25);
        color: #fff;
        padding: 14px 40px;
        border-radius: 50px;
        font-size: 26px;
        font-weight: 800;
        letter-spacing: 2px;
        text-transform: uppercase;
        white-space: nowrap;
        z-index: 10;
      }
      #stage {
        position: absolute;
        inset: 0;
      }
      .scene {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px;
        opacity: 0;
        pointer-events: none;
      }
      .scene.active {
        opacity: 1;
      }
      .visual-container {
        width: 820px;
        height: 820px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        margin-top: -120px;
      }
      svg { width: 100%; height: 100%; overflow: visible; }
      .stroke-neon { stroke: #00f2fe; stroke-width: 5; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-alt { stroke: #ff2a5f; stroke-width: 5; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-red { stroke: #ff2a5f; stroke-width: 4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-white { stroke: #ffffff; stroke-width: 4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-yellow { stroke: #ffd000; stroke-width: 4; fill: none; stroke-linecap: round; stroke-linejoin: round; }

      .icon-card {
        background: rgba(255, 255, 255, 0.04);
        border: 2px solid rgba(0, 242, 254, 0.35);
        border-radius: 36px;
        padding: 45px;
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.5), inset 0 0 25px rgba(0, 242, 254, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .dataviz-card {
        background: rgba(255, 255, 255, 0.03);
        border: 2px solid rgba(255, 208, 0, 0.35);
        border-radius: 40px;
        padding: 60px 80px;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
        min-width: 680px;
      }

      .subtitle-box {
        position: absolute;
        bottom: 240px;
        left: 50%;
        transform: translateX(-50%);
        width: 940px;
        text-align: center;
        font-size: 62px;
        font-weight: 900;
        color: #ffffff;
        text-shadow: 0 6px 24px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9);
        line-height: 1.25;
        z-index: 20;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 14px 18px;
      }
      .sub-word {
        display: inline-block;
        transition: none;
        padding: 2px 8px;
        border-radius: 12px;
      }
      .sub-word.spoken {
        color: #ffffff;
      }
      .sub-word.future {
        color: rgba(255, 255, 255, 0.55);
      }
      .sub-word.current {
        color: #ffe600;
        background: rgba(255, 230, 0, 0.14);
        transform: scale(1.12);
        text-shadow: 0 0 25px rgba(255, 230, 0, 0.6), 0 4px 15px rgba(0,0,0,0.95);
      }
      .sub-word.key-emphasis {
        color: #00f2fe;
      }
      .progress-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 12px;
        background: linear-gradient(90deg, #00f2fe, #ffe600);
        width: 0%;
        z-index: 30;
      }
    </style>
  </head>
  <body>
    <div class="bg-grid"></div>
    <div class="badge">${(payload.subrama && payload.subrama !== 'undefined') ? payload.subrama : 'PSICOLOGÍA APLICADA'}</div>
    <div id="stage"></div>
    <div class="subtitle-box" id="subtitle"></div>
    <div class="progress-bar" id="progressBar"></div>

    <script>
      const payload = ${JSON.stringify(payload)};
      const catalogo = ${JSON.stringify(catalogo)};
      const totalVideoDuration = ${duracionTotal};
      const stage = document.getElementById('stage');
      const subtitleDiv = document.getElementById('subtitle');
      const progressBar = document.getElementById('progressBar');

      function cleanText(val, fallback = '') {
        if (val === undefined || val === null) return fallback;
        const s = String(val).trim();
        if (s === '' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return fallback;
        return s;
      }

      function applyPlaceholders(svgStr, s) {
        const t1 = cleanText(s.texto_1, 'MENTE');
        const t2 = cleanText(s.texto_2, 'IMPULSO');
        const t3 = cleanText(s.texto_3, 'CONTROL');
        return svgStr
          .replace(/\\{\\{TEXTO_1\\}\\}/g, t1).replace(/\\{TEXTO_1\\}/g, t1)
          .replace(/\\{\\{TEXTO_2\\}\\}/g, t2).replace(/\\{TEXTO_2\\}/g, t2)
          .replace(/\\{\\{TEXTO_3\\}\\}/g, t3).replace(/\\{TEXTO_3\\}/g, t3)
          .replace(/undefined/gi, '');
      }

      // 1. Normalizar y escalar los tiempos de las escenas a la duración real del audio
      const rawScenes = Array.isArray(payload.escenas) ? payload.escenas : [];
      let maxEnd = 0;
      rawScenes.forEach((s, idx) => {
        s._start = typeof s.inicio === 'number' ? s.inicio : (typeof s.tiempo_inicio === 'number' ? s.tiempo_inicio : idx * 3);
        s._end = typeof s.fin === 'number' ? s.fin : (typeof s.tiempo_fin === 'number' ? s.tiempo_fin : s._start + 3);
        if (s._end > maxEnd) maxEnd = s._end;
      });
      const timeScale = (maxEnd > 0) ? (totalVideoDuration / maxEnd) : 1;
      rawScenes.forEach((s, idx) => {
        s.realStart = s._start * timeScale;
        s.realEnd = (idx === rawScenes.length - 1) ? totalVideoDuration : (s._end * timeScale);
      });

      // 2. Extraer timestamps palabra por palabra desde ElevenLabs alignment
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

      // Agrupar palabras en páginas de máximo 6 palabras para subtitulado dinámico ágil
      const subtitlePages = [];
      const wordsPerPage = 6;
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

      // 3. Pre-construir todas las escenas en el DOM una sola vez
      rawScenes.forEach((s, idx) => {
        const sceneEl = document.createElement('div');
        sceneEl.className = 'scene';
        sceneEl.id = 'scene-' + idx;

        const t1 = cleanText(s.texto_1, '');
        const t2 = cleanText(s.texto_2, '');
        let visualHTML = '';

        const cuerpoSvg = catalogo[s.cuerpo_id] || catalogo['cuerpo_base_quieto'] || '';
        const caraSvg = catalogo[s.cara_id] || catalogo['cara_shock'] || '';
        const propSvg = catalogo[s.prop_id] || '';
        const diagSvg = catalogo[s.diag_id] || '';

        if (s.modo_visual === 'catalogo_avatar' || (cuerpoSvg && s.cuerpo_id)) {
          const combined = applyPlaceholders(cuerpoSvg + caraSvg + propSvg, s);
          visualHTML = \`
            <div style="display:flex; flex-direction:column; align-items:center; width:100%; height:100%;">
              <svg viewBox="0 0 200 240" style="width:680px; height:680px;">\${combined}</svg>
              \${t1 ? \`<div style="margin-top:10px; font-size:42px; font-weight:900; color:#ffd000; letter-spacing:3px; text-transform:uppercase;">\${t1}</div>\` : ''}
            </div>\`;
        } else if (s.modo_visual === 'catalogo_diagrama' || (diagSvg && s.diag_id)) {
          const combined = applyPlaceholders(diagSvg, s);
          visualHTML = \`<svg viewBox="0 0 200 240" style="width:740px; height:740px;">\${combined}</svg>\`;
        } else if (s.modo_visual === 'svg_custom' && cleanText(s.svg_code)) {
          const rawSvg = applyPlaceholders(cleanText(s.svg_code), s);
          const vb = rawSvg.includes('300') ? '0 0 400 400' : '0 0 200 240';
          visualHTML = \`<svg viewBox="\${vb}" style="width:720px; height:720px;">\${rawSvg}</svg>\`;
        } else if (s.modo_visual === 'icon_composition') {
          const icons = (Array.isArray(s.iconos) && s.iconos.length > 0) ? s.iconos : ['brain', 'sparkles'];
          visualHTML = \`
            <div style="display:flex; flex-direction:column; align-items:center; gap:45px;">
              <div style="display:flex; gap:45px; align-items:center; justify-content:center;">
                \${icons.map((ic, k) => \`
                  <div class="icon-card anim-float" data-phase="\${k}">
                    <i data-lucide="\${cleanText(ic, 'brain').replace('lucide:', '')}" style="width:150px; height:150px; color:\${k % 2 === 0 ? '#00f2fe' : '#ffe600'};"></i>
                  </div>
                \`).join('')}
              </div>
              \${t1 ? \`<div style="font-size:44px; font-weight:900; color:#fff; letter-spacing:3px; text-transform:uppercase;">\${t1}</div>\` : ''}
            </div>\`;
        } else if (s.modo_visual === 'data_viz') {
          const dv = (s.data_viz && typeof s.data_viz === 'object') ? s.data_viz : {};
          const rawVal = cleanText(dv.valor ?? dv.value ?? dv.numero, '');
          const numMatch = rawVal.match(/\\d+(\\.\\d+)?/);
          const targetNum = numMatch ? parseFloat(numMatch[0]) : 92;
          const suf = cleanText(dv.sufijo ?? dv.unidad, '%');
          const et1 = cleanText(dv.etiqueta_1 ?? dv.label ?? t1, 'IMPACTO COGNITIVO');
          const et2 = cleanText(dv.etiqueta_2 ?? t2, '');
          visualHTML = \`
            <div class="dataviz-card anim-pulse">
              <div class="counter-val" data-target="\${targetNum}" data-suffix="\${suf}" style="font-size:150px; font-weight:900; color:#00f2fe; text-shadow:0 0 35px rgba(0,242,254,0.45);">0\${suf}</div>
              <div style="font-size:40px; font-weight:800; margin-top:24px; color:#ffe600; letter-spacing:2px; text-transform:uppercase;">\${et1}</div>
              \${et2 ? \`<div style="font-size:28px; font-weight:600; margin-top:12px; color:rgba(255,255,255,0.7);">\${et2}</div>\` : ''}
            </div>\`;
        } else {
          // Fallback al catálogo si el modo no coincide
          const fallbackSvg = applyPlaceholders(cuerpoSvg + caraSvg + propSvg, s);
          visualHTML = \`<svg viewBox="0 0 200 240" style="width:680px; height:680px;">\${fallbackSvg}</svg>\`;
        }

        sceneEl.innerHTML = \`<div class="visual-container">\${visualHTML}</div>\`;
        stage.appendChild(sceneEl);
      });

      lucide.createIcons();

      // Inicializar longitudes de trazos SVG para animar el dibujado
      document.querySelectorAll('.draw, path, line, polyline, polygon, circle, rect').forEach(el => {
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
        // Barra de progreso inferior
        const pct = Math.min(100, Math.max(0, (timeSec / totalVideoDuration) * 100));
        progressBar.style.width = pct + '%';

        // Determinar escena activa
        let activeIdx = 0;
        for (let i = 0; i < rawScenes.length; i++) {
          if (timeSec >= rawScenes[i].realStart && timeSec <= rawScenes[i].realEnd) {
            activeIdx = i;
            break;
          }
        }

        const sc = rawScenes[activeIdx];
        const sceneDuration = Math.max(0.1, sc.realEnd - sc.realStart);
        const sceneElapsed = Math.max(0, timeSec - sc.realStart);
        const sceneProgress = Math.min(1, sceneElapsed / sceneDuration);

        // Activar solo la escena actual y animar sus elementos matemáticamente por frame
        for (let i = 0; i < rawScenes.length; i++) {
          const el = document.getElementById('scene-' + i);
          if (!el) continue;
          if (i === activeIdx) {
            el.classList.add('active');
            
            // Transición de entrada suave (primeros 0.25s)
            const entryProgress = Math.min(1, sceneElapsed / 0.25);
            const easeOut = 1 - Math.pow(1 - entryProgress, 3);
            const container = el.querySelector('.visual-container');
            if (container) {
              const zoomDrift = 1 + (sceneProgress * 0.06);
              container.style.transform = \`scale(\${(0.88 + 0.12 * easeOut) * zoomDrift}) translateY(\${(1 - easeOut) * 35}px)\`;
              container.style.opacity = easeOut;
            }

            // Animación matemática de elementos .pulse y .anim-pulse
            el.querySelectorAll('.pulse, .anim-pulse').forEach((pEl, k) => {
              const sVal = 1 + 0.07 * Math.sin(timeSec * 5 + k);
              pEl.style.transform = \`scale(\${sVal})\`;
              pEl.style.transformOrigin = 'center';
            });

            // Animación matemática de elementos .float y .anim-float
            el.querySelectorAll('.float, .anim-float').forEach((fEl, k) => {
              const yVal = -14 * Math.sin(timeSec * 3.2 + k * 1.4);
              fEl.style.transform = \`translateY(\${yVal}px)\`;
            });

            // Animación de trazado progresivo SVG (.draw)
            el.querySelectorAll('[data-path-len]').forEach(dEl => {
              const len = parseFloat(dEl.dataset.pathLen);
              const drawProg = Math.min(1, sceneElapsed / 0.75);
              dEl.style.strokeDashoffset = len * (1 - drawProg);
            });

            // Animación de contadores numéricos en data_viz
            el.querySelectorAll('.counter-val').forEach(cEl => {
              const target = parseFloat(cEl.dataset.target || '90');
              const suffix = cEl.dataset.suffix || '%';
              const countProg = Math.min(1, sceneElapsed / 0.8);
              const curVal = Math.round(target * (1 - Math.pow(1 - countProg, 3)));
              cEl.textContent = curVal + suffix;
            });
          } else {
            el.classList.remove('active');
          }
        }

        // Subtitulado dinámico palabra por palabra sincronizado con el audio
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

          subtitleDiv.innerHTML = activePage.words.map(w => {
            let cls = 'sub-word ';
            if (timeSec >= w.start && timeSec <= w.end + 0.08) {
              cls += 'current';
            } else if (timeSec > w.end + 0.08) {
              cls += 'spoken';
            } else {
              cls += 'future';
            }
            return \`<span class="\${cls}">\${w.word}</span>\`;
          }).join('');
        } else if (sc) {
          // Fallback palabra por palabra proporcional a la escena si no viniera alignment
          const rawSub = cleanText(sc.subtitulo, '');
          const tokens = rawSub.split(/\\s+/).filter(Boolean);
          const activeWordIdx = Math.min(tokens.length - 1, Math.floor(sceneProgress * tokens.length));
          subtitleDiv.innerHTML = tokens.map((tok, idx) => {
            const isBold = tok.includes('**');
            const cleanTok = tok.replace(/\\*\\*/g, '');
            let cls = 'sub-word ';
            if (idx === activeWordIdx) cls += 'current';
            else if (idx < activeWordIdx) cls += (isBold ? 'spoken key-emphasis' : 'spoken');
            else cls += 'future';
            return \`<span class="\${cls}">\${cleanTok}</span>\`;
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

  console.log("🎥 Renderizando fotogramas con Puppeteer y sincronizando audio...");
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

  console.log("🎬 Compilando vídeo final completo con FFmpeg...");
  execSync(`ffmpeg -y -framerate ${fps} -i frames/frame_%05d.png -i audio.mp3 -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k output.mp4`);
  console.log("✅ ¡Vídeo renderizado con éxito!");
}

main().catch(err => {
  console.error("❌ Error en render.js:", err);
  process.exit(1);
});
