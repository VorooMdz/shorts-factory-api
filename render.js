const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado conectado al catálogo real...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  const claves = Object.keys(catalogo);

  const carasDisponibles = claves.filter(k => k.startsWith('cara_'));
  const cuerposDisponibles = claves.filter(k => k.startsWith('cuerpo_'));
  const propsDisponibles = claves.filter(k => k.startsWith('prop_'));
  const diagsDisponibles = claves.filter(k => k.startsWith('diag_'));

  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  const escenas = payload.escenas || [];
  const duracionBase = payload.duracion_total || (escenas.length > 0 ? escenas[escenas.length - 1].fin : 15);
  const duracionTotal = duracionBase + 2.0;
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // Buscador inteligente: cruza lo que pide n8n o el texto del subtítulo con las claves reales de catalogo.json
  function buscarMejorPieza(valorPedido, textoSubtitulo, listaClaves, prefijo, idxEscena, obligatorio = true) {
    // 1. Coincidencia exacta en catalogo.json
    if (valorPedido && catalogo[valorPedido]) return valorPedido;

    // 2. Coincidencia parcial con lo que pidió n8n (ej. "shock" -> "cara_shock")
    if (valorPedido && typeof valorPedido === 'string') {
      const tokens = valorPedido.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(w => w.length > 2 && w !== prefijo);
      for (const t of tokens) {
        const match = listaClaves.find(k => k.toLowerCase().includes(t));
        if (match) return match;
      }
    }

    // 3. Selección inteligente según el contenido del subtítulo de la escena
    const sub = (textoSubtitulo || '').toLowerCase();
    const mapaSemantico = {
      cara: [
        { regex: /mentira|enga|truco|falso|secreto/, key: 'cara_sonrisa_falsa' },
        { regex: /duda|seguro|decidiste|elegir|opci/, key: 'cara_duda' },
        { regex: /atractivo|pasi|amor|gust/, key: 'cara_enamorado_sesgo' },
        { regex: /ciego|ceguera|notó|ver/, key: 'cara_vendada' },
        { regex: /científic|lógic|estudio|razon/, key: 'cara_gafas_intelectual' },
        { regex: /compra|dinero|precio|voto/, key: 'cara_hipnotizado' },
        { regex: /mente|cerebro|hackear|control/, key: 'cara_cerebro_visible' },
        { regex: /80|ochenta|ciento|calcul/, key: 'cara_calculando' },
        { regex: /shock|sorpresa|increíble/, key: 'cara_shock' }
      ],
      cuerpo: [
        { regex: /mentira|duda|seguro|por qué/, key: 'cuerpo_rascando_cabeza' },
        { regex: /elegir|dos|retratos|cambio|opci/, key: 'cuerpo_indeciso_dividido' },
        { regex: /truco|cartas|entregaron|fotos/, key: 'cuerpo_sosteniendo_objeto' },
        { regex: /ciego|ceguera|notó/, key: 'cuerpo_caminando_ciego' },
        { regex: /control|hackear|atrapado|hilos/, key: 'cuerpo_atrapado_hilos' },
        { regex: /científic|explicó|razones|lógic/, key: 'cuerpo_hablando_pizarra' },
        { regex: /compra|todos los días|polític/, key: 'cuerpo_mirando_movil' }
      ],
      prop: [
        { regex: /mentira|seguro|por qué|\?/, key: 'prop_interrogaciones' },
        { regex: /control|hackear|manipul|decidiste/, key: 'prop_cruceta_marioneta' },
        { regex: /científic|estudio|notó|mir/, key: 'prop_lupa' },
        { regex: /atractivo|cara|espejo|falso/, key: 'prop_mascara_feliz' },
        { regex: /compra|producto|dinero/, key: 'prop_bolsa_dinero' },
        { regex: /idea|razones|mente/, key: 'prop_bombilla' },
        { regex: /voto|opiniones|polític/, key: 'prop_megafono' }
      ],
      diag: [
        { regex: /dos retratos|elegir el más|vs/, key: 'diag_comparacion_vs' },
        { regex: /lógic.*emoci|pasión.*lógic|cerebro/, key: 'diag_cerebro_dual' },
        { regex: /truco|ceguera a la elección|dos puertas/, key: 'diag_dos_puertas' },
        { regex: /todos los días|opiniones ajenas|rebaño/, key: 'diag_efecto_rebano' },
        { regex: /80|ochenta por ciento/, key: 'diag_diana_foco' }
      ]
    };

    if (mapaSemantico[prefijo]) {
      for (const regla of mapaSemantico[prefijo]) {
        if (regla.regex.test(sub) && catalogo[regla.key]) {
          return regla.key;
        }
      }
    }

    // 4. Si es obligatorio (cuerpo y cara), rotamos entre las piezas del catálogo para máxima variedad
    if (obligatorio && listaClaves.length > 0) {
      return listaClaves[(idxEscena * 3) % listaClaves.length];
    }
    return null;
  }

  const escenasProcesadas = escenas.map((esc, idx) => {
    const subTexto = esc.subtitulo || '';
    let svgInterno = '';

    // Comprobar si la escena pide explícitamente un diagrama o si alternamos un diagrama en escenas clave
    let diagKey = null;
    if (esc.diagrama) {
      diagKey = buscarMejorPieza(esc.diagrama, subTexto, diagsDisponibles, 'diag', idx, false);
    } else if (!esc.cuerpo && !esc.cara && idx % 3 === 1) {
      // Si n8n no especificó nada en absoluto, intercalamos diagramas visuales con stickmans
      diagKey = buscarMejorPieza(null, subTexto, diagsDisponibles, 'diag', idx, false);
    }

    if (diagKey && catalogo[diagKey]) {
      console.log(`🎬 Escena ${idx}: Usando Diagrama [${diagKey}]`);
      svgInterno = `<g class="layer-main">${catalogo[diagKey]}</g>`;
    } else {
      const cuerpoKey = buscarMejorPieza(esc.cuerpo, subTexto, cuerposDisponibles, 'cuerpo', idx, true);
      const caraKey = buscarMejorPieza(esc.cara, subTexto, carasDisponibles, 'cara', idx, true);
      const propKey = buscarMejorPieza(esc.prop, subTexto, propsDisponibles, 'prop', idx, true);

      console.log(`🎬 Escena ${idx}: Stickman armado -> Cuerpo: [${cuerpoKey}], Cara: [${caraKey}], Prop: [${propKey}]`);

      if (cuerpoKey && catalogo[cuerpoKey]) svgInterno += `<g class="layer-body">${catalogo[cuerpoKey]}</g>`;
      if (caraKey && catalogo[caraKey]) svgInterno += `<g class="layer-face">${catalogo[caraKey]}</g>`;
      if (propKey && catalogo[propKey]) svgInterno += `<g class="layer-prop">${catalogo[propKey]}</g>`;
    }

    // Extraer palabras destacadas del subtítulo por si el SVG tiene {{TEXTO_1}}, {{TEXTO_2}}, {{TEXTO_3}}
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].toUpperCase());
    const t1 = esc.texto_1 || matchesDestacados[0] || 'OPCIÓN A';
    const t2 = esc.texto_2 || matchesDestacados[1] || 'OPCIÓN B';
    const t3 = esc.texto_3 || matchesDestacados[2] || 'SESGO';

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3);

    // Subtítulos (INTACTOS: bloques de 3 palabras y 0.55s de adelanto)
    const palabrasCrudas = subTexto.split(' ');
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

    // Alternar planos automáticamente si n8n no los envía para dar dinamismo de cámara
    const planosRotativos = ['medio', 'general', 'primer_plano', 'medio'];
    const planoElegido = esc.plano || planosRotativos[idx % planosRotativos.length];

    return {
      ...esc,
      id: idx,
      svgInterno,
      subCaptions,
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
        background: radial-gradient(circle at 50% 42%, #1e1e36 0%, #07070c 100%);
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
        position: absolute; top: 38%; left: 50%; width: 460px; height: 460px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, rgba(255, 42, 95, 0.14) 0%, rgba(255, 208, 0, 0.05) 45%, transparent 70%);
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
      .plano-primer_plano svg { width: 720px; height: 860px; }
      .plano-medio svg { width: 620px; height: 740px; }
      .plano-general svg { width: 540px; height: 650px; }

      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.35)); }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.9)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.9)); }

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

      // Normalizar absolutamente todas las figuras del catálogo con pathLength="100" para dibujado perfecto
      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('path, line, polyline, polygon, circle, rect, ellipse');
        shapes.forEach((shape, idx) => {
          shape.setAttribute('pathLength', '100');
          shape.dataset.drawIdx = idx;
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
        
        // Pulso ambiental de fondo
        const glowScale = 1 + Math.sin(t * 3) * 0.15;
        document.getElementById('glow').style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        escenas.forEach(e => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          // 1. Subtítulos (con su adelanto de 0.55s libre de cortes de escena)
          e.subCaptions.forEach(sub => {
            const subEl = document.getElementById('sub-' + e.id + '-' + sub.id);
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

          // 2. Animación multicapa de los Stickers y Diagramas del Catálogo
          if (t >= e.inicio && t < e.fin) {
            const localT = t - e.inicio;
            sc.style.opacity = '1';

            // Entrada con rebote elástico + levitación continua de toda la figura
            const entryProgress = Math.min(1, localT / 0.38);
            const entryScale = 0.4 + 0.6 * easeOutBack(entryProgress);
            const floatY = Math.sin(localT * 4.5) * 10;
            const tiltDeg = Math.sin(localT * 2.2) * 2;
            inner.style.transform = \`translateY(\${floatY}px) scale(\${entryScale}) rotate(\${tiltDeg}deg)\`;

            // Efecto Whiteboard: trazado progresivo de cada línea en los primeros 0.75s
            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const idx = parseInt(shape.dataset.drawIdx, 10);
              const delay = Math.min(0.25, idx * 0.025);
              const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.55));
              shape.style.strokeDashoffset = String(100 * (1 - drawP));
            });

            // Animación independiente para la CARA (gesticulación sutil)
            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const faceY = Math.sin(localT * 7) * 3.5;
              const faceRot = Math.cos(localT * 5) * 3;
              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translateY(\${faceY}px) rotate(\${faceRot}deg)\`;
            }

            // Animación independiente para el PROP (flotación amplia y rebote)
            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propY = Math.sin(localT * 6 + 1) * 9;
              const propScale = 1 + Math.sin(localT * 9) * 0.1;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translateY(\${propY}px) scale(\${propScale})\`;
            }

            // Animación para elementos con clases .float y .pulse internas del catálogo
            sc.querySelectorAll('.float').forEach(el => {
              const fOffset = Math.sin(localT * 6.5) * 8;
              el.style.transform = \`translateY(\${fOffset}px)\`;
            });

            sc.querySelectorAll('.pulse').forEach(el => {
              const pScale = 1 + Math.sin(localT * 11) * 0.14;
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
