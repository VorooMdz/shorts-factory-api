const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Iniciando motor de renderizado narrativo v3...');

  const catalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  const claves = Object.keys(catalogo);

  const audioBase64 = payload.audio_base64.replace(/^data:audio\/\w+;base64,/, '');
  fs.writeFileSync('audio.mp3', Buffer.from(audioBase64, 'base64'));

  const escenas = payload.escenas || [];
  const duracionBase = payload.duracion_total || (escenas.length > 0 ? escenas[escenas.length - 1].fin : 15);
  const duracionTotal = duracionBase + 2.0;
  const fps = 30;
  const totalFrames = Math.ceil(duracionTotal * fps);

  // ============================================================================
  // 1. MOTOR DE DIRECCIÓN DE ARTE: Analiza qué se dice en la escena y elige la
  //    mejor combinación de Diagrama o Stickman (Cuerpo + Cara + Prop) del catálogo
  // ============================================================================
  const usadosDiag = new Set();

  function resolverArteEscena(esc, idx) {
    const sub = (esc.subtitulo || '').toLowerCase();

    // A) Si n8n mandó un diagrama válido directamente, lo respetamos
    if (esc.diagrama && catalogo[esc.diagrama]) {
      usadosDiag.add(esc.diagrama);
      return { tipo: 'diagrama', diag: esc.diagrama };
    }

    // B) Reglas narrativas de alta precisión: si el guion menciona conceptos clave,
    //    usamos los diagramas conceptuales del catálogo para que case al 100% con la voz
    const reglasDiagramas = [
      { regex: /dos fotos|dos retratos|elegir.*entre|compar|vs|más atractiv/, diag: 'diag_comparacion_vs', t1: 'FOTO A', t2: 'FOTO B' },
      { regex: /prestidigitaci|truco|secreto|intercambi|cambiaron|dos puertas/, diag: 'diag_dos_puertas', t1: 'ELEGIDA', t2: 'TRAMPA' },
      { regex: /\d+\s*%|por ciento|estadístic|mayoría|notó el/, diag: 'diag_diana_foco', t1: 'NO LO NOTÓ' },
      { regex: /lógica.*emoci|excusas|justific|pasión|coherencia/, diag: 'diag_cerebro_dual' },
      { regex: /compras|votos|opiniones|rebaño|todos los días|a diario/, diag: 'diag_efecto_rebano' },
      { regex: /azar|automátic|espectador|sin pensar/, diag: 'diag_piloto_automatico', t1: 'PILOTO AUTO' },
      { regex: /precio|descuento|oferta|caro|barato/, diag: 'diag_ancla_precio', t1: 'PRECIO ANCLA' },
      { regex: /señuelo|tres opciones/, diag: 'diag_3_opciones_senuelo', t1: 'A', t2: 'B', t3: 'C' },
      { regex: /iceberg|oculto|subconsciente/, diag: 'diag_iceberg', t1: 'TÚ CREES', t2: 'REALIDAD' },
      { regex: /laberinto|salida|atrapad/, diag: 'diag_laberinto_mente' }
    ];

    // Intercalamos diagramas cuando el texto encaja y no hemos repetido ese diagrama
    for (const r of reglasDiagramas) {
      if (r.regex.test(sub) && catalogo[r.diag] && !usadosDiag.has(r.diag)) {
        usadosDiag.add(r.diag);
        return { tipo: 'diagrama', diag: r.diag, t1: r.t1, t2: r.t2, t3: r.t3 };
      }
    }

    // C) Si es escena de Stickman, seleccionamos Cuerpo + Cara + Prop coherentes con la frase
    let cuerpo = (esc.cuerpo && catalogo[esc.cuerpo]) ? esc.cuerpo : null;
    let cara = (esc.cara && catalogo[esc.cara]) ? esc.cara : null;
    let prop = (esc.prop && catalogo[esc.prop]) ? esc.prop : null;

    // Corregir o enriquecer según el significado real de la frase
    if (/cerebro|mente|inventa|excusa/.test(sub)) {
      cuerpo = cuerpo || 'cuerpo_rascando_cabeza';
      cara = 'cara_cerebro_visible';
      prop = 'prop_interrogaciones';
    } else if (/dueño|control|espectador|enga|manipul|hackear/.test(sub)) {
      cuerpo = 'cuerpo_atrapado_hilos';
      cara = 'cara_hipnotizado';
      prop = 'prop_cruceta_marioneta';
    } else if (/ceguera|ciego|no notó|sin ver/.test(sub)) {
      cuerpo = 'cuerpo_caminando_ciego';
      cara = 'cara_vendada';
      prop = 'prop_interrogaciones';
    } else if (/rechazad|falso|secreto|truco/.test(sub)) {
      cuerpo = 'cuerpo_sosteniendo_objeto';
      cara = 'cara_sonrisa_falsa';
      prop = 'prop_mascara_feliz';
    } else if (/compra|dinero|gasto/.test(sub)) {
      cuerpo = 'cuerpo_sosteniendo_objeto';
      cara = 'cara_ambicion';
      prop = 'prop_bolsa_dinero';
    } else if (/estudio|científic|experimento|investig/.test(sub)) {
      cuerpo = 'cuerpo_hablando_pizarra';
      cara = 'cara_gafas_intelectual';
      prop = 'prop_lupa';
    } else if (/despertar|sígueme|solución|verdad/.test(sub)) {
      cuerpo = 'cuerpo_victoria';
      cara = 'cara_eureka';
      prop = 'prop_bombilla';
    }

    // Fallbacks seguros si aún faltan cuerpo o cara (NUNCA asignamos prop aleatorio si no pega)
    if (!cuerpo) cuerpo = 'cuerpo_indeciso_dividido';
    if (!cara) cara = 'cara_duda';

    return { tipo: 'stickman', cuerpo, cara, prop };
  }

  // ============================================================================
  // 2. PROCESAR ESCENAS Y SUBTÍTULOS (Sin solapamientos y conservando colores)
  // ============================================================================
  const todosLosSubtitulos = [];

  const escenasProcesadas = escenas.map((esc, idx) => {
    const subTexto = esc.subtitulo || '';
    const arte = resolverArteEscena(esc, idx);
    let svgInterno = '';

    if (arte.tipo === 'diagrama') {
      console.log(`🎬 Escena ${idx} [DIAGRAMA]: ${arte.diag}`);
      svgInterno = `<g class="layer-main">${catalogo[arte.diag]}</g>`;
    } else {
      console.log(`🎬 Escena ${idx} [STICKMAN]: ${arte.cuerpo} + ${arte.cara} + ${arte.prop || 'sin_prop'}`);
      svgInterno += `<g class="layer-body">${catalogo[arte.cuerpo]}</g>`;
      svgInterno += `<g class="layer-face">${catalogo[arte.cara]}</g>`;
      if (arte.prop && catalogo[arte.prop]) {
        svgInterno += `<g class="layer-prop">${catalogo[arte.prop]}</g>`;
      }
    }

    // Rellenar variables {{TEXTO_1}}, {{TEXTO_2}}, {{TEXTO_3}} de forma inteligente
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim().toUpperCase());
    const t1 = esc.texto_1 || arte.t1 || matchesDestacados[0] || 'REALIDAD';
    const t2 = esc.texto_2 || arte.t2 || matchesDestacados[1] || 'ILUSIÓN';
    const t3 = esc.texto_3 || arte.t3 || matchesDestacados[2] || 'SESGO';

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3);

    // Tokenizar palabras conservando el color rojo (**) o amarillo (*) aunque se partan en diferentes bloques
    let enRojo = false;
    let enAmarillo = false;
    const palabrasCrudas = subTexto.trim().split(/\s+/);

    const palabrasColoreadas = palabrasCrudas.map(palabra => {
      let p = palabra;
      let color = 'none';

      // Detectar inicio de ** o *
      if (p.startsWith('**')) { enRojo = true; p = p.slice(2); }
      else if (p.startsWith('*')) { enAmarillo = true; p = p.slice(1); }

      if (enRojo) color = 'red';
      else if (enAmarillo) color = 'yellow';

      // Detectar cierre de ** o * (incluso si hay signos de puntuación pegados como "tomaste.**" o "**palabra**,")
      if (p.includes('**')) {
        enRojo = false;
        p = p.replace(/\*\*/g, '');
      } else if (p.includes('*')) {
        enAmarillo = false;
        p = p.replace(/\*/g, '');
      }

      if (color === 'red') return `<span class="highlight-red">${p}</span>`;
      if (color === 'yellow') return `<span class="highlight-yellow">${p}</span>`;
      return p;
    });

    const chunkSize = 3;
    const subChunks = [];
    for (let i = 0; i < palabrasColoreadas.length; i += chunkSize) {
      subChunks.push(palabrasColoreadas.slice(i, i + chunkSize).join(' '));
    }

    const duracionEscena = (esc.fin - esc.inicio);
    const tiempoPorChunk = duracionEscena / subChunks.length;
    const offset = 0.55; // Adelanto exacto de 0.55s que te gustó

    subChunks.forEach((chunkHtml, cIdx) => {
      const sInicio = Math.max(0, esc.inicio + (cIdx * tiempoPorChunk) - offset);
      const sFin = (cIdx === subChunks.length - 1) ? (esc.fin + 0.4 - offset) : (sInicio + tiempoPorChunk);

      todosLosSubtitulos.push({
        uid: `sub-${idx}-${cIdx}`,
        inicio: sInicio,
        fin: sFin,
        html: chunkHtml
      });
    });

    const planosRotativos = ['medio', 'general', 'primer_plano', 'medio'];
    const planoElegido = (arte.tipo === 'diagrama') ? 'general' : (esc.plano || planosRotativos[idx % planosRotativos.length]);

    return {
      ...esc,
      id: idx,
      svgInterno,
      esDiagrama: arte.tipo === 'diagrama',
      plano: planoElegido
    };
  });

  // REGLA DE ORO ANTI-SOLAPAMIENTO: Garantizar que un subtítulo termina exactamente cuando empieza el siguiente
  for (let i = 0; i < todosLosSubtitulos.length - 1; i++) {
    if (todosLosSubtitulos[i].fin > todosLosSubtitulos[i + 1].inicio) {
      todosLosSubtitulos[i].fin = todosLosSubtitulos[i + 1].inicio;
    }
  }
  // Asegurar que el último subtítulo del vídeo se mantenga hasta el final para poder leerlo entero
  if (todosLosSubtitulos.length > 0) {
    todosLosSubtitulos[todosLosSubtitulos.length - 1].fin = duracionTotal;
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

      /* Contenedor de Subtítulos Blindado (1 solo bloque centrado siempre) */
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

      // Aplicar efecto Whiteboard SOLO a líneas y trazos (no a círculos rellenos ni ojos)
      document.querySelectorAll('.scene svg').forEach(svg => {
        const shapes = svg.querySelectorAll('.draw, line, polyline, path, rect, polygon, circle, ellipse');
        let idx = 0;
        shapes.forEach(shape => {
          const fillAttr = shape.getAttribute('fill');
          const hasSolidFill = fillAttr && fillAttr !== 'none' && !fillAttr.startsWith('rgba');
          // Si es un ojo o figura pequeña rellena, no le aplicamos dasharray para que no se deforme
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

        // 1. Renderizar UN ÚNICO subtítulo activo en cada instante
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

        // 2. Renderizar Escenas y Animaciones Dinámicas
        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);
          const finReal = (idx === escenas.length - 1) ? duracionTotal : e.fin;

          if (t >= e.inicio && t < finReal) {
            const localT = t - e.inicio;
            const durEscena = finReal - e.inicio;
            sc.style.opacity = '1';

            // Entrada con rebote elástico + Zoom Punch a mitad de la escena para mantener retención
            const entryProgress = Math.min(1, localT / 0.35);
            let scale = 0.45 + 0.55 * easeOutBack(entryProgress);

            if (localT > durEscena * 0.5) {
              const midProgress = Math.min(1, (localT - durEscena * 0.5) / 0.25);
              scale *= (1 + 0.09 * easeOutBack(midProgress));
            }

            const floatY = Math.sin(localT * 4.5) * 10;
            const tiltDeg = Math.sin(localT * 2.4) * (e.esDiagrama ? 1.2 : 2.2);
            inner.style.transform = \`translateY(\${floatY}px) scale(\${scale}) rotate(\${tiltDeg}deg)\`;

            // Efecto Whiteboard progresivo en los trazos
            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              const delay = Math.min(0.25, dIdx * 0.03);
              const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.45));
              shape.style.strokeDashoffset = String(100 * (1 - drawP));
            });

            // Animación expresiva en la cara
            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const faceY = Math.sin(localT * 7) * 3;
              const faceRot = Math.sin(localT * 4.5) * 3.5;
              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translateY(\${faceY}px) rotate(\${faceRot}deg)\`;
            }

            // Animación viva en el prop (objeto flotante)
            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propY = Math.sin(localT * 6 + 1) * 8;
              const propScale = 1 + Math.sin(localT * 9) * 0.08;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translateY(\${propY}px) scale(\${propScale})\`;
            }

            // Clases internas del catálogo (.float y .pulse)
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
