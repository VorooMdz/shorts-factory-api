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
    console.log(`🎬 Escena ${idx} solicitada -> diagrama: ${esc.diagrama \vert{}\vert{} 'N/A'}, cuerpo:${esc.cuerpo || 'N/A'}, cara: ${esc.cara \vert{}\vert{} 'N/A'}, prop:${esc.prop || 'N/A'}`);

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
      .highlight-red { color: #ff2a5f; text-shadow: 0 0 25px rgba(255, 42, 95, 0.95), 0 5
