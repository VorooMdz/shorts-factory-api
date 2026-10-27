const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

// ============================================================================
// MEGABIBLIOTECA INTEGRADA DE ANIMALES, VEHÍCULOS, OBJETOS Y PROPS (v6.0)
// ============================================================================
const EXPANDED_SVG_PACK = {
  // --- ANIMALES Y BIOLOGÍA ---
  diag_perro_pavlov: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M55,155 L55,115 L75,90 L115,90 L135,70 L155,75 L150,100 L130,115 L130,155" />
      <path class="stroke-yellow draw" d="M65,90 L50,110 L68,112 Z" />
      <circle cx="138" cy="82" r="3.5" fill="#ffffff" />
      <path class="stroke-red pulse" d="M155,95 Q162,110 155,120 Q148,110 155,95 Z" />
      <path class="stroke-yellow pulse" d="M38,65 L52,65 L45,50 Z" />
      <circle class="pulse" cx="45" cy="72" r="4" fill="#ffd000" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_rata_experimento: `
    <text x="100" y="26" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="28" y="45" width="144" height="140" rx="12" />
    <g class="float">
      <path class="stroke-white draw" d="M55,145 Q75,110 115,125 L140,140 L55,145 Z" />
      <circle class="stroke-yellow draw" cx="118" cy="118" r="10" />
      <circle cx="130" cy="133" r="3" fill="#ff2a5f" />
      <path class="stroke-red draw" d="M55,142 Q35,135 42,115" />
      <rect class="stroke-red pulse" x="142" y="95" width="18" height="18" rx="4" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_tiburon_miedo: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-red draw" d="M75,135 L105,65 L125,135 Z" />
      <path class="stroke-white draw" d="M20,140 Q45,125 70,140 T120,140 T180,140" />
      <path class="stroke-yellow draw" d="M30,162 Q60,150 90,162 T150,162 T175,162" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_ovejas_rebano: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <circle class="stroke-white draw" cx="55" cy="115" r="20" />
      <circle class="stroke-white draw" cx="105" cy="115" r="20" />
      <circle class="stroke-red pulse" cx="155" cy="115" r="20" />
      <path class="stroke-yellow draw" d="M40,70 L155,70 L142,58 M155,70 L142,82" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_serpiente_alerta: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-yellow draw" d="M60,170 Q35,140 85,125 T130,90 T95,55" />
      <polygon class="stroke-red pulse" points="95,42 112,58 95,70 78,58" />
      <path class="stroke-red draw" d="M95,42 L90,28 M95,42 L100,28" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_mariposa_caos: `
    <text x="100" y="26" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <path class="stroke-yellow draw" d="M100,95 C55,40 25,85 65,125 C35,155 65,185 100,145" />
      <path class="stroke-red draw" d="M100,95 C145,40 175,85 135,125 C165,155 135,185 100,145" />
      <line class="stroke-white draw" x1="100" y1="70" x2="100" y2="165" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_pulpo_mente: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <circle class="stroke-white draw" cx="100" cy="82" r="28" />
      <circle cx="90" cy="80" r="4" fill="#ffd000" />
      <circle cx="110" cy="80" r="4" fill="#ffd000" />
      <path class="stroke-red draw" d="M80,108 Q50,140 35,170 M92,110 Q75,150 68,180 M108,110 Q125,150 132,180 M120,108 Q150,140 165,170" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_aguila_foco: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <circle class="stroke-red draw" cx="100" cy="120" r="52" />
      <circle class="stroke-yellow draw" cx="100" cy="120" r="24" />
      <circle cx="100" cy="120" r="7" fill="#ff2a5f" />
      <line class="stroke-white draw" x1="30" y1="120" x2="170" y2="120" />
      <line class="stroke-white draw" x1="100" y1="50" x2="100" y2="190" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,

  // --- VEHÍCULOS Y DILEMAS ---
  diag_coche_deportivo: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-red draw" d="M22,140 L38,110 L75,92 L135,92 L168,115 L182,140 Z" />
      <circle class="stroke-white pulse" cx="58" cy="145" r="18" />
      <circle class="stroke-white pulse" cx="148" cy="145" r="18" />
      <line class="stroke-yellow draw" x1="15" y1="72" x2="55" y2="72" />
      <line class="stroke-yellow draw" x1="5" y1="88" x2="40" y2="88" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_dilema_tranvia: `
    <text x="52" y="28" text-anchor="middle" fill="#ffffff" font-size="12">{{TEXTO_1}}</text>
    <text x="148" y="28" text-anchor="middle" fill="#ff2a5f" font-size="12">{{TEXTO_2}}</text>
    <path class="stroke-white draw" d="M100,195 L100,125 L45,60 M100,125 L155,60" />
    <g class="pulse">
      <rect class="stroke-yellow draw" x="72" y="140" width="56" height="38" rx="6" />
      <circle cx="88" cy="184" r="5" fill="#ffffff" />
      <circle cx="112" cy="184" r="5" fill="#ffffff" />
    </g>
  `,
  diag_avion_riesgo: `
    <text x="100" y="26" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M30,135 L165,75 L145,120 L170,138 L135,138 L112,165 L98,132 L30,135 Z" />
      <path class="stroke-red pulse" d="M25,155 L65,142" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_cohete_euforia: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M100,45 C128,80 128,130 122,155 L78,155 C72,130 72,80 100,45 Z" />
      <path class="stroke-red draw" d="M78,135 L55,162 L78,155 M122,135 L145,162 L122,155" />
      <circle class="stroke-yellow draw" cx="100" cy="100" r="12" />
      <polygon class="stroke-red pulse" points="88,158 100,192 112,158" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_barco_hundido: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <polygon class="stroke-white draw" points="45,125 155,145 130,175 60,160" />
      <polygon class="stroke-yellow draw" points="95,65 95,130 138,125" />
      <path class="stroke-red draw" d="M20,152 Q60,138 100,152 T180,152" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_semaforo_freno: `
    <text x="100" y="26" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="70" y="42" width="60" height="145" rx="16" />
    <circle class="stroke-red pulse" cx="100" cy="72" r="14" />
    <circle class="stroke-yellow draw" cx="100" cy="114" r="14" />
    <circle class="stroke-white draw" cx="100" cy="156" r="14" />
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,

  // --- OBJETOS, DINERO, CIENCIA Y EXPERIMENTOS ---
  diag_ruleta_casino: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <circle class="stroke-yellow draw" cx="100" cy="120" r="58" />
      <circle class="stroke-red draw" cx="100" cy="120" r="22" />
      <line class="stroke-white draw" x1="42" y1="120" x2="158" y2="120" />
      <line class="stroke-white draw" x1="100" y1="62" x2="100" y2="178" />
      <line class="stroke-white draw" x1="59" y1="79" x2="141" y2="161" />
      <line class="stroke-white draw" x1="141" y1="79" x2="59" y2="161" />
      <circle cx="128" cy="85" r="6" fill="#ffffff" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_dados_azar: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <rect class="stroke-white draw" x="34" y="75" width="58" height="58" rx="10" />
      <circle cx="50" cy="91" r="4.5" fill="#ff2a5f" />
      <circle cx="76" cy="117" r="4.5" fill="#ff2a5f" />
      <rect class="stroke-yellow draw" x="106" y="102" width="58" height="58" rx="10" />
      <circle cx="122" cy="118" r="4.5" fill="#ffd000" />
      <circle cx="135" cy="131" r="4.5" fill="#ffd000" />
      <circle cx="148" cy="144" r="4.5" fill="#ffd000" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_adn_genetica: `
    <text x="100" y="26" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M60,48 C140,85 60,155 140,192" />
      <path class="stroke-red draw" d="M140,48 C60,85 140,155 60,192" />
      <line class="stroke-yellow draw" x1="75" y1="68" x2="125" y2="68" />
      <line class="stroke-yellow draw" x1="82" y1="120" x2="118" y2="120" />
      <line class="stroke-yellow draw" x1="75" y1="172" x2="125" y2="172" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_jeringuilla_placebo: `
    <text x="100" y="26" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <rect class="stroke-white draw" x="78" y="70" width="44" height="85" rx="4" />
      <line class="stroke-yellow draw" x1="100" y1="40" x2="100" y2="70" />
      <line class="stroke-yellow draw" x1="82" y1="40" x2="118" y2="40" />
      <line class="stroke-red pulse" x1="100" y1="155" x2="100" y2="195" />
      <line class="stroke-red draw" x1="84" y1="115" x2="116" y2="115" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_iman_atraccion: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <path class="stroke-red draw" d="M60,65 L60,130 A40,40 0 0,0 140,130 L140,65" />
      <line class="stroke-white draw" x1="60" y1="82" x2="60" y2="62" />
      <line class="stroke-white draw" x1="140" y1="82" x2="140" y2="62" />
      <path class="stroke-yellow draw" d="M75,45 L65,58 L80,58 L70,72 M125,45 L115,58 L130,58 L120,72" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_bomba_tiempo: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <circle class="stroke-white draw" cx="95" cy="132" r="46" />
      <path class="stroke-yellow draw" d="M122,92 Q142,65 162,72" />
      <circle class="stroke-red pulse" cx="165" cy="72" r="9" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_camara_vigilancia: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <polygon class="stroke-white draw" points="45,85 135,65 150,105 60,125" />
      <line class="stroke-yellow draw" x1="45" y1="105" x2="25" y2="145" />
      <circle class=" pulse" cx="145" cy="84" r="6" fill="#ff2a5f" />
      <path class="stroke-red draw" d="M155,95 L185,135 M145,112 L165,155" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_ajedrez_estrategia: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <polygon class="stroke-yellow draw" points="60,175 140,175 125,85 75,85" />
      <circle class="stroke-white draw" cx="100" cy="65" r="16" />
      <line class="stroke-red pulse" x1="100" y1="35" x2="100" y2="52" />
      <line class="stroke-red pulse" x1="90" y1="43" x2="110" y2="43" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_pildora_eleccion: `
    <text x="55" y="32" text-anchor="middle" fill="#ff2a5f" font-size="12">{{TEXTO_1}}</text>
    <text x="145" y="32" text-anchor="middle" fill="#00f2fe" font-size="12">{{TEXTO_2}}</text>
    <g class="pulse">
      <rect class="stroke-red draw" x="35" y="75" width="42" height="88" rx="21" />
      <line class="stroke-white draw" x1="35" y1="119" x2="77" y2="119" />
      <rect class="stroke-yellow draw" x="123" y="75" width="42" height="88" rx="21" />
      <line class="stroke-white draw" x1="123" y1="119" x2="165" y2="119" />
    </g>
  `,
  diag_caja_skinner: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="35" y="50" width="130" height="130" rx="12" />
    <circle class="stroke-red pulse" cx="100" cy="115" r="26" />
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_mascara_doble: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-white draw" d="M45,70 L100,70 L100,165 C65,165 45,135 45,70 Z" />
      <path class="stroke-red draw" d="M100,70 L155,70 C155,135 135,165 100,165 Z" />
      <path class="stroke-yellow draw" d="M62,125 Q75,142 88,125" />
      <path class="stroke-red draw" d="M112,138 Q125,120 138,138" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_bateria_agotada: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="45" y="65" width="100" height="110" rx="10" />
    <rect class="stroke-white draw" x="145" y="98" width="14" height="44" rx="4" />
    <rect class="stroke-red pulse" x="58" y="135" width="30" height="28" rx="4" />
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_espejo_distorsion: `
    <text x="100" y="26" text-anchor="middle" fill="#00f2fe" font-size="13">{{TEXTO_1}}</text>
    <ellipse class="stroke-white draw" cx="100" cy="118" rx="52" ry="68" />
    <path class="stroke-red pulse" d="M75,85 L110,120 L85,145 L128,165" />
    <text x="100" y="218" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_laberinto_mental: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <rect class="stroke-white draw" x="40" y="55" width="120" height="120" rx="8" />
    <path class="stroke-yellow draw" d="M40,95 L120,95 L120,135 L80,135 L80,75" />
    <circle class="pulse" cx="100" cy="115" r="7" fill="#ff2a5f" />
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_trofeo_exito: `
    <text x="100" y="26" text-anchor="middle" fill="#ffd000" font-size="13">{{TEXTO_1}}</text>
    <g class="float">
      <path class="stroke-yellow draw" d="M60,60 L140,60 L125,130 L75,130 Z" />
      <line class="stroke-white draw" x1="100" y1="130" x2="100" y2="170" />
      <line class="stroke-white draw" x1="65" y1="170" x2="135" y2="170" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,
  diag_cadena_habito: `
    <text x="100" y="26" text-anchor="middle" fill="#ff2a5f" font-size="13">{{TEXTO_1}}</text>
    <g class="pulse">
      <rect class="stroke-white draw" x="35" y="95" width="55" height="36" rx="18" />
      <rect class="stroke-red draw" x="72" y="95" width="55" height="36" rx="18" />
      <rect class="stroke-yellow draw" x="110" y="95" width="55" height="36" rx="18" />
    </g>
    <text x="100" y="218" text-anchor="middle" fill="#ffffff" font-size="13">{{TEXTO_2}}</text>
  `,

  // --- NUEVOS PROPS DE MANO PARA EL PERSONAJE ---
  prop_dado_mano: `<g class="float"><rect class="stroke-yellow draw" x="132" y="88" width="34" height="34" rx="6"/><circle cx="142" cy="98" r="3" fill="#ff2a5f"/><circle cx="156" cy="112" r="3" fill="#ff2a5f"/></g>`,
  prop_iman_mano: `<g class="pulse"><path class="stroke-red draw" d="M132,85 L132,115 A16,16 0 0,0 164,115 L164,85"/></g>`,
  prop_jeringa_mano: `<g class="float"><rect class="stroke-white draw" x="138" y="80" width="18" height="42" rx="3"/><line class="stroke-red draw" x1="147" y1="122" x2="147" y2="142"/></g>`,
  prop_bandera_alerta: `<g class="float"><line class="stroke-white draw" x1="135" y1="65" x2="135" y2="145"/><polygon class="stroke-red pulse" points="135,65 178,80 135,98"/></g>`,
  prop_llave_secreta: `<g class="float"><circle class="stroke-yellow draw" cx="148" cy="85" r="12"/><line class="stroke-yellow draw" x1="148" y1="97" x2="148" y2="135"/><line class="stroke-yellow draw" x1="148" y1="125" x2="160" y2="125"/></g>`,
  prop_billete_euro: `<g class="pulse"><rect class="stroke-yellow draw" x="126" y="88" width="48" height="28" rx="4"/><text x="150" y="107" text-anchor="middle" fill="#ffd000" font-size="14">€</text></g>`,
  prop_copa_premio: `<g class="float"><polygon class="stroke-yellow draw" points="132,82 166,82 156,115 142,115"/><line class="stroke-white draw" x1="149" y1="115" x2="149" y2="135"/></g>`,
  prop_brujula_moral: `<g class="pulse"><circle class="stroke-white draw" cx="148" cy="105" r="20"/><polygon class="stroke-red draw" points="148,90 154,105 148,120 142,105"/></g>`,
  prop_megafono_ruido: `<g class="pulse"><polygon class="stroke-yellow draw" points="125,105 165,82 165,128"/><path class="stroke-red draw" d="M172,90 Q184,105 172,120"/></g>`,
  prop_tijeras_corte: `<g class="float"><circle class="stroke-red draw" cx="138" cy="122" r="8"/><circle class="stroke-red draw" cx="158" cy="122" r="8"/><line class="stroke-white draw" x1="142" y1="115" x2="162" y2="80"/><line class="stroke-white draw" x1="154" y1="115" x2="134" y2="80"/></g>`
};

// 1. Extractor inteligente de textos internos para SVGs
function sanitizeSvgTexts(esc, matchesDestacados) {
  let raw1 = (esc.texto_1 || '').trim();
  let raw2 = (esc.texto_2 || '').trim();
  let raw3 = (esc.texto_3 || '').trim();

  if (/ vs\.? /i.test(raw1) && (!raw2 || /^vs\.?$/i.test(raw2))) {
    const parts = raw1.split(/ vs\.? /i);
    raw1 = parts[0].trim();
    raw2 = (parts[1] || '').trim();
  }

  if (/^(vs\.?|contra|versus)$/i.test(raw2)) {
    raw2 = matchesDestacados[1] || '';
  }

  const cleanRedundant = (str) => str
    .replace(/\(\s*(señuelo|ganador|trampa|premio)\s*\)/gi, '')
    .replace(/\b(vs\.?|versus)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'ERA', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE'
  ]);

  const subWords = (esc.subtitulo || '')
    .replace(/[*#_~`.,;!?¡¿"«»()]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => w.toUpperCase())
    .filter(w => w.length >= 3 && !stopWords.has(w));

  const fallback1 = matchesDestacados[0] || subWords[0] || 'MENTE';
  const fallback2 = matchesDestacados[1] || subWords[1] || subWords[subWords.length - 1] || 'REALIDAD';
  const fallback3 = matchesDestacados[2] || subWords[2] || 'EFECTO';

  raw1 = cleanRedundant(raw1) || fallback1;
  raw2 = cleanRedundant(raw2) || fallback2;
  raw3 = cleanRedundant(raw3) || fallback3;

  if (raw2.toUpperCase() === raw1.toUpperCase() && subWords.length > 1) {
    raw2 = subWords.find(w => w !== raw1.toUpperCase()) || fallback2;
  }

  return [
    raw1.toUpperCase().slice(0, 12),
    raw2.toUpperCase().slice(0, 12),
    raw3.toUpperCase().slice(0, 12)
  ];
}

function normalizeForMatch(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// 2. Motor de alineación de subtítulos y escenas
function buildSubtitleChunks(escenas, alignmentData, realAudioDuration) {
  const stopWords = new Set([
    'DE', 'LA', 'EL', 'EN', 'Y', 'A', 'LOS', 'SE', 'DEL', 'LAS', 'UN', 'POR',
    'CON', 'NO', 'UNA', 'SU', 'PARA', 'ES', 'AL', 'LO', 'COMO', 'MAS', 'MÁS',
    'PERO', 'SUS', 'LE', 'HA', 'ME', 'SI', 'SIN', 'SOBRE', 'ESTE', 'YA', 'ENTRE',
    'CUANDO', 'TODO', 'ESTA', 'SER', 'SON', 'DOS', 'TAMBIEN', 'TAMBIÉN', 'ERA',
    'O', 'QUE', 'QUÉ', 'TU', 'TÚ', 'TE', 'MI', 'MIS', 'TUS', 'NOS', 'NI'
  ]);

  const sceneTokensList = escenas.map(esc => {
    const raw = (esc.subtitulo || '').trim();
    if (!raw) return [];

    const tokens = [];
    let inBold = false;
    const rawWords = raw.split(/\s+/);

    rawWords.forEach(rw => {
      if (!rw) return;
      const starCount = (rw.match(/\*/g) || []).length;
      const startsBold = rw.startsWith('*');
      const endsBold = rw.endsWith('*') && starCount >= 2;

      const isHighlighted = inBold || starCount >= 2 || startsBold;
      const cleanWord = rw.replace(/[*#_~`]/g, '').trim();

      if (starCount % 2 !== 0) {
        inBold = !inBold;
      } else if (startsBold && !endsBold && starCount === 2) {
        inBold = true;
      }

      if (!cleanWord) return;

      if (/^[.,;!?¡¿…]+$/.test(cleanWord)) {
        if (tokens.length > 0) {
          tokens[tokens.length - 1].text += cleanWord;
        }
        return;
      }

      tokens.push({ text: cleanWord, highlight: isHighlighted });
    });

    return tokens;
  });

  let elevenWords = [];
  if (alignmentData && Array.isArray(alignmentData.characters) && Array.isArray(alignmentData.character_start_times_seconds)) {
    const chars = alignmentData.characters;
    const starts = alignmentData.character_start_times_seconds;
    const ends = alignmentData.character_end_times_seconds || starts;
    let curWord = '';
    let wStart = null;
    let wEnd = null;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/\s/.test(ch)) {
        if (curWord.length > 0) {
          if (!/^[.,;!?¡¿…]+$/.test(curWord)) {
            elevenWords.push({
              word: curWord,
              norm: normalizeForMatch(curWord),
              start: wStart,
              end: wEnd
            });
          } else if (elevenWords.length > 0) {
            elevenWords[elevenWords.length - 1].word += curWord;
            elevenWords[elevenWords.length - 1].end = wEnd;
          }
          curWord = '';
          wStart = null;
        }
      } else {
        if (wStart === null) wStart = starts[i];
        wEnd = ends[i];
        curWord += ch;
      }
    }
    if (curWord.length > 0) {
      if (!/^[.,;!?¡¿…]+$/.test(curWord)) {
        elevenWords.push({
          word: curWord,
          norm: normalizeForMatch(curWord),
          start: wStart,
          end: wEnd
        });
      } else if (elevenWords.length > 0) {
        elevenWords[elevenWords.length - 1].word += curWord;
        elevenWords[elevenWords.length - 1].end = wEnd;
      }
    }
  }

  function calcTokenWeight(tk) {
    const clean = tk.text.replace(/[.,;!?¡¿"«»()]/g, '');
    let w = Math.max(2, clean.length);
    if (/\d/.test(clean)) w += 6.5;
    if (/[€$%]/.test(tk.text)) w += 4.5;
    if (/[,;:]/.test(tk.text)) w += 2.8;
    if (/[.!?…]/.test(tk.text)) w += 4.2;
    return w;
  }

  const flatTokens = [];
  sceneTokensList.forEach((tokens, sIdx) => {
    tokens.forEach((tk, tIdx) => {
      flatTokens.push({ sIdx, tIdx, tk, norm: normalizeForMatch(tk.text), matchedStart: null, matchedEnd: null });
    });
  });

  if (elevenWords.length > 0 && flatTokens.length > 0) {
    let ewCursor = 0;
    for (let i = 0; i < flatTokens.length; i++) {
      const rawText = flatTokens[i].tk.text;
      const targetNorm = flatTokens[i].norm;
      const hasCurrencyOrPct = /[€$%]/.test(rawText);
      let bestMatchIdx = -1;

      for (let offset = 0; offset <= 4; offset++) {
        const candidateIdx = ewCursor + offset;
        if (candidateIdx >= elevenWords.length) break;
        const candNorm = elevenWords[candidateIdx].norm;
        if (candNorm && targetNorm && (candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm))) {
          bestMatchIdx = candidateIdx;
          break;
        }
        if (hasCurrencyOrPct && targetNorm === '1' && candNorm === 'un') {
          bestMatchIdx = candidateIdx;
          break;
        }
      }

      if (bestMatchIdx !== -1) {
        let mStart = elevenWords[bestMatchIdx].start;
        let mEnd = elevenWords[bestMatchIdx].end;
        ewCursor = bestMatchIdx + 1;

        while (ewCursor < elevenWords.length && /^(euro|euros|dolar|dolares|por|ciento)$/.test(elevenWords[ewCursor].norm)) {
          const nextVisualNorm = (i + 1 < flatTokens.length) ? flatTokens[i + 1].norm : '';
          if (nextVisualNorm === elevenWords[ewCursor].norm) break;
          mEnd = elevenWords[ewCursor].end;
          ewCursor++;
        }

        flatTokens[i].matchedStart = mStart;
        flatTokens[i].matchedEnd = mEnd;
      } else if (ewCursor < elevenWords.length) {
        flatTokens[i].matchedStart = elevenWords[ewCursor].start;
        flatTokens[i].matchedEnd = elevenWords[ewCursor].end;
        ewCursor++;
      }
    }
  }

  const lastSpokenEnd = elevenWords.length > 0
    ? elevenWords[elevenWords.length - 1].end
    : Math.max(1, realAudioDuration - 0.18);

  const sceneWeights = sceneTokensList.map(tokens => {
    const sum = tokens.reduce((acc, tk) => acc + calcTokenWeight(tk), 0);
    return Math.max(3, sum);
  });
  const totalScriptWeight = sceneWeights.reduce((a, b) => a + b, 0);

  let cumulativeWeight = 0;
  let flatIdx = 0;
  const allChunks = [];

  escenas.forEach((esc, idx) => {
    const tokens = sceneTokensList[idx];
    const sWeight = sceneWeights[idx];

    const phoneticStart = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;
    cumulativeWeight += sWeight;
    const phoneticEnd = (cumulativeWeight / totalScriptWeight) * lastSpokenEnd;

    const sceneFlatSlice = flatTokens.slice(flatIdx, flatIdx + tokens.length);
    flatIdx += tokens.length;

    let sceneStart = (idx === 0) ? 0 : phoneticStart;
    let sceneEnd = (idx === escenas.length - 1) ? realAudioDuration : phoneticEnd;

    const firstMatched = sceneFlatSlice.find(f => f.matchedStart !== null);
    const lastMatched = [...sceneFlatSlice].reverse().find(f => f.matchedEnd !== null);

    if (firstMatched && lastMatched) {
      sceneStart = (idx === 0) ? 0 : Math.max(0, firstMatched.matchedStart - 0.03);
      sceneEnd = (idx === escenas.length - 1)
        ? realAudioDuration
        : Math.min(realAudioDuration, lastMatched.matchedEnd + 0.05);
    }

    esc.inicio = sceneStart;
    esc.fin = sceneEnd;

    if (tokens.length === 0) return;

    const groups = [];
    let currentGroup = [];
    let currentChars = 0;

    sceneFlatSlice.forEach((item) => {
      currentGroup.push(item);
      currentChars += item.tk.text.length;
      const hasPunct = /[.,;!?]/.test(item.tk.text);

      if (currentGroup.length >= 3 || currentChars >= 18 || (hasPunct && currentGroup.length >= 2)) {
        groups.push(currentGroup);
        currentGroup = [];
        currentChars = 0;
      }
    });
    if (currentGroup.length > 0) {
      if (groups.length > 0 && currentGroup.length === 1 && groups[groups.length - 1].length < 3) {
        groups[groups.length - 1].push(currentGroup[0]);
      } else {
        groups.push(currentGroup);
      }
    }

    groups.forEach(g => {
      if (!g.some(item => item.tk.highlight)) {
        let bestIdx = -1;
        let maxLen = 0;
        g.forEach((item, i) => {
          const clean = item.tk.text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g, '').toUpperCase();
          if (!stopWords.has(clean) && clean.length > maxLen) {
            maxLen = clean.length;
            bestIdx = i;
          }
        });
        if (bestIdx !== -1 && maxLen >= 4) {
          g[bestIdx].tk.highlight = true;
        }
      }
    });

    const dur = Math.max(0.2, sceneEnd - sceneStart);
    let cursor = sceneStart;

    groups.forEach((g, gIdx) => {
      const gWeight = g.reduce((acc, item) => acc + calcTokenWeight(item.tk), 0);
      const gDur = (gWeight / sWeight) * dur;
      let gStart = cursor;
      let gEnd = (gIdx === groups.length - 1) ? sceneEnd : (cursor + gDur);

      let wCursor = gStart;
      const timedWords = g.map((item, wIdx) => {
        let wStart, wEnd;
        if (item.matchedStart !== null && item.matchedEnd !== null) {
          wStart = item.matchedStart;
          wEnd = item.matchedEnd;
        } else {
          const wWeight = calcTokenWeight(item.tk);
          const wDur = (wWeight / gWeight) * (gEnd - gStart);
          wStart = wCursor;
          wEnd = (wIdx === g.length - 1) ? gEnd : (wCursor + wDur);
          wCursor = wEnd;
        }
        return {
          text: item.tk.text,
          highlight: item.tk.highlight,
          start: wStart,
          end: wEnd
        };
      });

      if (timedWords.length > 0 && g[0].matchedStart !== null) {
        gStart = timedWords[0].start;
        gEnd = timedWords[timedWords.length - 1].end + 0.04;
      }

      allChunks.push({
        start: gStart,
        end: gEnd,
        words: timedWords
      });

      cursor = gEnd;
    });
  });

  for (let i = 0; i < escenas.length - 1; i++) {
    escenas[i].fin = escenas[i + 1].inicio;
  }
  if (escenas.length > 0) {
    escenas[0].inicio = 0;
    escenas[escenas.length - 1].fin = realAudioDuration;
  }

  for (let i = 0; i < allChunks.length - 1; i++) {
    if (allChunks[i].end > allChunks[i + 1].start) {
      allChunks[i].end = allChunks[i + 1].start;
    } else if (allChunks[i + 1].start - allChunks[i].end < 0.12) {
      allChunks[i].end = allChunks[i + 1].start;
    }
  }

  return allChunks;
}

// 3. Sintetizador Procedural de 16 SFX con Modulación de Frecuencia Única por Escena
function buildSceneSfxTrack(escenas, totalDuration, videoHash) {
  function getRecipe(type, pitchMod) {
    const p = pitchMod.toFixed(3);
    const catalog = {
      sub_drop: {
        expr: `0.36*exp(-6*t)*sin(2*PI*(150*${p}*exp(-4.2*t)+38)*t)+0.12*exp(-16*t)*sin(2*PI*720*${p}*t)`,
        dur: 0.65
      },
      laser_swipe: {
        expr: `0.20*exp(-7*t)*sin(2*PI*(980*${p}*exp(-5.5*t)+110)*t)`,
        dur: 0.34
      },
      whoosh_fast: {
        expr: `0.22*sin(PI*t/0.28)*sin(2*PI*(160*${p}+480*t*t)*t)+0.09*sin(PI*t/0.28)*sin(2*PI*85*${p}*t)`,
        dur: 0.28
      },
      glitch_data: {
        expr: `0.17*exp(-8*t)*(sin(2*PI*440*${p}*t)*sin(2*PI*38*t)+0.6*sin(2*PI*1320*${p}*t)*sin(2*PI*62*t))`,
        dur: 0.32
      },
      heartbeat: {
        expr: `0.34*exp(-22*t)*sin(2*PI*58*${p}*t)+0.28*exp(-22*max(0,t-0.21))*gt(t,0.21)*sin(2*PI*52*${p}*max(0,t-0.21))`,
        dur: 0.52
      },
      tension_riser: {
        expr: `0.18*(t/0.55)*exp(-2*(0.55-t))*sin(2*PI*(220*${p}+340*t*t)*t)`,
        dur: 0.55
      },
      glass_ping: {
        expr: `0.17*exp(-6.5*t)*(sin(2*PI*1180*${p}*t)+0.5*sin(2*PI*1770*${p}*t))`,
        dur: 0.50
      },
      error_buzz: {
        expr: `0.18*exp(-7.5*t)*(sin(2*PI*145*${p}*t)+0.7*sin(2*PI*153*${p}*t)+0.4*sin(2*PI*290*${p}*t))`,
        dur: 0.40
      },
      clock_tick: {
        expr: `0.23*exp(-42*t)*sin(2*PI*1250*${p}*t)+0.19*exp(-42*max(0,t-0.22))*gt(t,0.22)*sin(2*PI*920*${p}*max(0,t-0.22))`,
        dur: 0.44
      },
      sonar_pulse: {
        expr: `0.21*exp(-5.2*t)*sin(2*PI*660*${p}*t)+0.10*exp(-5*max(0,t-0.26))*gt(t,0.26)*sin(2*PI*660*${p}*max(0,t-0.26))`,
        dur: 0.58
      },
      coin_cash: {
        expr: `0.18*exp(-14*t)*sin(2*PI*1318*${p}*t)+0.20*exp(-8*max(0,t-0.08))*gt(t,0.08)*sin(2*PI*1567*${p}*max(0,t-0.08))`,
        dur: 0.48
      },
      camera_shutter: {
        expr: `0.25*exp(-55*t)*sin(2*PI*1800*${p}*t)+0.20*exp(-45*max(0,t-0.06))*gt(t,0.06)*sin(2*PI*950*${p}*max(0,t-0.06))`,
        dur: 0.22
      },
      vinyl_rewind: {
        expr: `0.20*exp(-4.5*t)*sin(2*PI*(780*${p}-1400*t*t)*t)`,
        dur: 0.36
      },
      electric_zap: {
        expr: `0.19*exp(-11*t)*(sin(2*PI*310*${p}*t)*sin(2*PI*95*t)+0.5*sin(2*PI*940*${p}*t))`,
        dur: 0.30
      },
      revelacion_chord: {
        expr: `0.15*exp(-3.5*t)*(sin(2*PI*523.25*${p}*t)+0.8*sin(2*PI*659.25*${p}*t)+0.6*sin(2*PI*783.99*${p}*t)+0.45*sin(2*PI*1046.5*${p}*t))`,
        dur: 0.75
      },
      mystery_question: {
        expr: `0.19*exp(-5.0*t)*sin(2*PI*(290*${p}+290*t)*t)`,
        dur: 0.45
      }
    };

    catalog.shock = catalog.sub_drop;
    catalog.whoosh = catalog.whoosh_fast;
    catalog.alerta = catalog.error_buzz;
    catalog.reloj = catalog.clock_tick;
    catalog.revelacion = catalog.revelacion_chord;
    catalog.duda = catalog.mystery_question;

    return catalog[type] || catalog.whoosh_fast;
  }

  const allTypes = [
    'sub_drop', 'laser_swipe', 'whoosh_fast', 'glitch_data', 'heartbeat',
    'tension_riser', 'glass_ping', 'error_buzz', 'clock_tick', 'sonar_pulse',
    'coin_cash', 'camera_shutter', 'vinyl_rewind', 'electric_zap', 'revelacion_chord', 'mystery_question'
  ];

  const inputs = [];
  const filterParts = [];
  const usedSfx = new Set();

  escenas.forEach((esc, idx) => {
    let rawType = String(esc.sfx || '').toLowerCase().trim();
    if (!rawType || usedSfx.has(rawType)) {
      rawType = allTypes[(videoHash + idx * 3) % allTypes.length];
    }
    usedSfx.add(rawType);

    const pitchMod = 0.86 + (((videoHash + idx * 17) % 31) / 100);
    const recipe = getRecipe(rawType, pitchMod);

    const startSec = idx === 0 ? 0.04 : Math.max(0.05, Number(esc.inicio) || 0);
    const delayMs = Math.round(startSec * 1000);

    inputs.push(`-f lavfi -i "aevalsrc='${recipe.expr}':s=44100:d=${recipe.dur}"`);
    filterParts.push(`[${idx}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration.toFixed(3)}[s${idx}]`);
  });

  if (inputs.length === 0) return false;

  const mixLabels = escenas.map((_, idx) => `[s${idx}]`).join('');
  const filterComplex = `${filterParts.join(';')};${mixLabels}amix=inputs=${escenas.length}:duration=longest:dropout_transition=0:normalize=0[sfxout]`;

  try {
    execSync(
      `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`,
      { stdio: 'ignore' }
    );
  } catch (err) {
    const filterCompat = `${filterParts.join(';')};${mixLabels}amix=inputs=${escenas.length}:duration=longest:dropout_transition=0,volume=${Math.max(1.5, escenas.length * 0.55).toFixed(2)}[sfxout]`;
    execSync(
      `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterCompat}" -map "[sfxout]" -ar 44100 -ac 2 -t ${totalDuration.toFixed(3)} -c:a pcm_s16le hook_sfx.wav`,
      { stdio: 'ignore' }
    );
  }

  return fs.existsSync('hook_sfx.wav') && fs.statSync('hook_sfx.wav').size > 1000;
}

async function main() {
  console.log('🚀 Iniciando motor de renderizado Viral v6.0 (32 Nuevos Animales/Vehículos/Objetos + HUD + Fusión €)...');

  // Fusionamos catalogo.json con la Megabiblioteca Integrada de Animales, Vehículos y Objetos
  const rawCatalogo = JSON.parse(fs.readFileSync('catalogo.json', 'utf8'));
  const catalogo = { ...rawCatalogo, ...EXPANDED_SVG_PACK };

  let payload = JSON.parse(fs.readFileSync('payload.json', 'utf8'));
  if (Array.isArray(payload) && payload.length > 0) payload = payload[0];
  if (payload.json) payload = payload.json;

  const rawBase64 = (payload.audio_base64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error('❌ CRÍTICO: payload.audio_base64 llegó vacío desde n8n. Revisa la salida de ElevenLabs.');
  }
  fs.writeFileSync('audio_raw.mp3', Buffer.from(rawBase64, 'base64'));
  console.log(`📦 Audio MP3 decodificado correctamente (${fs.statSync('audio_raw.mp3').size} bytes).`);

  const hasExactTimestamps = !!(payload.alignment && payload.alignment.characters);

  if (hasExactTimestamps) {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  } else {
    execSync('ffmpeg -y -i audio_raw.mp3 -af "silenceremove=stop_periods=-1:stop_duration=0.22:stop_threshold=-38dB,atempo=1.04,apad=pad_dur=0.15" -ar 44100 -ac 2 -c:a pcm_s16le voice_clean.wav', { stdio: 'inherit' });
  }

  let realAudioDuration = 26;
  try {
    const probeOutput = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nk=1 voice_clean.wav',
      { encoding: 'utf8' }
    );
    const parsed = parseFloat(probeOutput.trim());
    if (!isNaN(parsed) && parsed > 0) {
      realAudioDuration = parsed;
      console.log(`🎙️ Duración real exacta medida en WAV: ${realAudioDuration.toFixed(3)}s`);
    }
  } catch (err) {
    console.error('⚠️ Fallo al medir con ffprobe, usando fallback:', err.message);
    realAudioDuration = Number(payload.duracion_total) || 26;
  }

  const fps = 30;
  const totalFrames = Math.ceil(realAudioDuration * fps);
  const duracionExactaVideo = totalFrames / fps;

  const accentPalettes = [
    { name: 'Cian Eléctrico', hex: '#00f2fe', altHex: '#ff2a85', glow: 'rgba(0, 242, 254, 0.78)', altGlow: 'rgba(255, 42, 133, 0.72)', bgCenter: '#0f293a', bgEdge: '#04070b' },
    { name: 'Verde Neón', hex: '#39ff14', altHex: '#00f2fe', glow: 'rgba(57, 255, 20, 0.72)', altGlow: 'rgba(0, 242, 254, 0.72)', bgCenter: '#112c1a', bgEdge: '#050906' },
    { name: 'Amarillo Dorado', hex: '#ffd000', altHex: '#ff2a5f', glow: 'rgba(255, 208, 0, 0.78)', altGlow: 'rgba(255, 42, 95, 0.72)', bgCenter: '#2e240e', bgEdge: '#080604' },
    { name: 'Magenta Vibrante', hex: '#ff2a85', altHex: '#ffd000', glow: 'rgba(255, 42, 133, 0.78)', altGlow: 'rgba(255, 208, 0, 0.72)', bgCenter: '#2d1128', bgEdge: '#080408' },
    { name: 'Naranja Fuego', hex: '#ff6b00', altHex: '#00f2fe', glow: 'rgba(255, 107, 0, 0.78)', altGlow: 'rgba(0, 242, 254, 0.72)', bgCenter: '#30190c', bgEdge: '#090503' },
    { name: 'Violeta Eléctrico', hex: '#c77dff', altHex: '#39ff14', glow: 'rgba(199, 125, 255, 0.78)', altGlow: 'rgba(57, 255, 20, 0.72)', bgCenter: '#211338', bgEdge: '#06040a' },
    { name: 'Rojo Carmesí', hex: '#ff2a5f', altHex: '#ffd000', glow: 'rgba(255, 42, 95, 0.80)', altGlow: 'rgba(255, 208, 0, 0.75)', bgCenter: '#31101c', bgEdge: '#090306' }
  ];

  const seedStr = JSON.stringify(payload.escenas || '') + (payload.TituloYT || '') + String(Date.now());
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const chosenAccent = accentPalettes[hash % accentPalettes.length];
  const bgPatternMode = (hash >>> 3) % 5;
  const subStyleMode = (hash >>> 6) % 3;
  console.log(`🎨 Paleta: ${chosenAccent.name} | Atmósfera: #${bgPatternMode} | Estilo Sub: #${subStyleMode}`);

  const escenasOriginales = payload.escenas || [];
  const ultimaEscenaFinOriginal = escenasOriginales.length > 0
    ? Number(escenasOriginales[escenasOriginales.length - 1].fin)
    : duracionExactaVideo;

  const timeScale = duracionExactaVideo / Math.max(0.1, ultimaEscenaFinOriginal);

  const filterCleanCatalog = (prefix) => {
    const clean = Object.keys(catalogo).filter(k => k.startsWith(prefix) && !/_[0-9]+$/.test(k));
    return clean.length > 0 ? clean : Object.keys(catalogo).filter(k => k.startsWith(prefix));
  };

  const allCuerpos = filterCleanCatalog('cuerpo_');
  const allCaras = filterCleanCatalog('cara_');
  const allProps = filterCleanCatalog('prop_');
  const allDiags = filterCleanCatalog('diag_');

  const usedCuerpos = new Set();
  const usedCaras = new Set();
  const usedProps = new Set();
  const usedDiags = new Set();

  const transicionesCatalogo = [
    'punch_zoom', 'whip_left', 'whip_right', 'drop_bounce',
    'glitch_shake', 'spiral_zoom', 'pendulum', 'elastic_pop'
  ];

  const escenasProcesadas = escenasOriginales.map((esc, idx) => {
    const inicioEscena = (idx === 0) ? 0 : Number(esc.inicio) * timeScale;
    const finEscena = (idx === escenasOriginales.length - 1)
      ? duracionExactaVideo
      : Number(esc.fin) * timeScale;

    const subTexto = esc.subtitulo || '';
    const matchesDestacados = [...subTexto.matchAll(/\*\*?(.*?)\*\*?/g)].map(m => m[1].replace(/\*/g, '').trim());
    const [t1, t2, t3] = sanitizeSvgTexts(esc, matchesDestacados);

    let svgInterno = '';
    let esDiagrama = false;

    if (esc.diagrama && catalogo[esc.diagrama]) {
      let diagKey = esc.diagrama;
      if (/_[0-9]+$/.test(diagKey) || (usedDiags.has(diagKey) && allDiags.length > usedDiags.size)) {
        diagKey = allDiags.find(d => !usedDiags.has(d)) || allDiags[(hash + idx) % allDiags.length] || diagKey;
      }
      usedDiags.add(diagKey);

      let rawDiagSvg = catalogo[diagKey];

      if (/LÓGICA/i.test(rawDiagSvg) && /EMOCIÓN/i.test(rawDiagSvg)) {
        rawDiagSvg = rawDiagSvg.replace(/LÓGICA/gi, t1).replace(/EMOCIÓN/gi, t2);
      }

      const hasTextTag = /<text\b/i.test(rawDiagSvg) || /\{?\{TEXTO_1\}?\}/.test(rawDiagSvg);
      if (!hasTextTag) {
        rawDiagSvg += `
          <text x="100" y="28" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="900">${t1}</text>
          <text x="100" y="222" text-anchor="middle" fill="#ffd000" font-size="13" font-weight="900">${t2}</text>
        `;
      }

      svgInterno = `<g class="layer-main">${rawDiagSvg}</g>`;
      esDiagrama = true;
    } else {
      let cuerpoKey = (esc.cuerpo && catalogo[esc.cuerpo] && !/_[0-9]+$/.test(esc.cuerpo))
        ? esc.cuerpo
        : allCuerpos[(hash + idx * 3) % allCuerpos.length];
      if (usedCuerpos.has(cuerpoKey) && allCuerpos.length > usedCuerpos.size) {
        cuerpoKey = allCuerpos.find(c => !usedCuerpos.has(c)) || cuerpoKey;
      }
      usedCuerpos.add(cuerpoKey);

      let caraKey = (esc.cara && catalogo[esc.cara] && !/_[0-9]+$/.test(esc.cara))
        ? esc.cara
        : allCaras[(hash + idx * 5) % allCaras.length];
      if (usedCaras.has(caraKey) && allCaras.length > usedCaras.size) {
        caraKey = allCaras.find(c => !usedCaras.has(c)) || caraKey;
      }
      usedCaras.add(caraKey);

      let propKey = (esc.prop && catalogo[esc.prop] && !/_[0-9]+$/.test(esc.prop))
        ? esc.prop
        : allProps[(hash + idx * 7) % allProps.length];
      if (usedProps.has(propKey) && allProps.length > usedProps.size) {
        propKey = allProps.find(p => !usedProps.has(p)) || propKey;
      }
      if (propKey) usedProps.add(propKey);

      if (catalogo[cuerpoKey]) svgInterno += `<g class="layer-body">${catalogo[cuerpoKey]}</g>`;
      if (catalogo[caraKey]) svgInterno += `<g class="layer-face" data-cara="${caraKey}">${catalogo[caraKey]}</g>`;
      if (propKey && catalogo[propKey]) svgInterno += `<g class="layer-prop">${catalogo[propKey]}</g>`;
    }

    svgInterno = svgInterno
      .replace(/\{\{TEXTO_1\}\}/g, t1)
      .replace(/\{\{TEXTO_2\}\}/g, t2)
      .replace(/\{\{TEXTO_3\}\}/g, t3)
      .replace(/\{TEXTO_1\}/g, t1)
      .replace(/\{TEXTO_2\}/g, t2)
      .replace(/\{TEXTO_3\}/g, t3);

    const planosRotativos = ['primer_plano', 'medio', 'general', 'primer_plano'];
    const planoElegido = (idx === 0) ? 'primer_plano' : (esc.plano || planosRotativos[(hash + idx) % planosRotativos.length]);

    const rawTrans = String(esc.transicion || '').toLowerCase().trim();
    const transicionElegida = (idx === 0)
      ? 'punch_zoom'
      : (transicionesCatalogo.includes(rawTrans) ? rawTrans : transicionesCatalogo[(hash + idx * 3) % transicionesCatalogo.length]);

    return {
      ...esc,
      id: idx,
      inicio: inicioEscena,
      fin: finEscena,
      svgInterno,
      esDiagrama,
      plano: planoElegido,
      transicion: transicionElegida,
      drawMode: (hash + idx) % 3
    };
  });

  const subtitleChunks = buildSubtitleChunks(escenasProcesadas, payload.alignment, duracionExactaVideo);

  // 4.5 Síntesis SFX Multipista + Mezcla con Música de Fondo al 8%
  try {
    let hasHookSfx = false;
    try {
      console.log('⚡ Sintetizando los 16 SFX procedurales con modulación de tono...');
      hasHookSfx = buildSceneSfxTrack(escenasProcesadas, duracionExactaVideo, hash);
    } catch (sfxErr) {
      console.warn('⚠️ No se pudo sintetizar la pista SFX:', sfxErr.message);
    }

    const bgMusicPath = path.resolve('bg_music.mp3');
    if (fs.existsSync(bgMusicPath) && fs.statSync(bgMusicPath).size > 1000) {
      const fadeStart = Math.max(0, duracionExactaVideo - 1.5).toFixed(2);
      execSync(
        `ffmpeg -y -stream_loop -1 -i "${bgMusicPath}" -t ${duracionExactaVideo.toFixed(3)} -af "volume=0.08,afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeStart}:d=1.5" -ar 44100 -ac 2 -c:a pcm_s16le music_clean.wav`,
        { stdio: 'inherit' }
      );

      if (hasHookSfx) {
        try {
          execSync(
            `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=1.05[v];[v][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
            { stdio: 'inherit' }
          );
        } catch (amix3Err) {
          execSync(
            `ffmpeg -y -i voice_clean.wav -i music_clean.wav -i hook_sfx.wav -filter_complex "[0:a]volume=3.1[v];[1:a]volume=3.0[m];[2:a]volume=3.0[s];[v][m][s]amix=inputs=3:duration=first:dropout_transition=2" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
            { stdio: 'inherit' }
          );
        }
      } else {
        execSync(
          `ffmpeg -y -i voice_clean.wav -i music_clean.wav -filter_complex "[0:a]volume=1.05[v];[v][1:a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0" -ar 44100 -ac 2 -c:a pcm_s16le audio.wav`,
          { stdio: 'inherit' }
        );
      }
    } else {
      fs.copyFileSync('voice_clean.wav', 'audio.wav');
    }
  } catch (audioErr) {
    console.warn('⚠️ Fallback a voz limpia:', audioErr.message);
    fs.copyFileSync('voice_clean.wav', 'audio.wav');
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');
      :root {
        --accent-color: ${chosenAccent.hex};
        --accent-alt: ${chosenAccent.altHex};
        --accent-glow: ${chosenAccent.glow};
        --accent-alt-glow: ${chosenAccent.altGlow};
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 720px; height: 1280px;
        background: radial-gradient(circle at 50% 36%, ${chosenAccent.bgCenter} 0%, ${chosenAccent.bgEdge} 100%);
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; position: relative;
      }
      #bg-canvas {
        position: absolute; inset: 0;
        width: 720px; height: 1280px;
        z-index: 2; pointer-events: none;
      }
      .vignette {
        position: absolute; inset: 0;
        background: radial-gradient(circle at 50% 45%, transparent 48%, rgba(0,0,0,0.72) 100%);
        z-index: 3; pointer-events: none;
      }
      .glow-spot {
        position: absolute; top: 36%; left: 50%; width: 540px; height: 540px;
        transform: translate(-50%, -50%);
        background: radial-gradient(circle, var(--accent-glow) 0%, var(--accent-alt-glow) 42%, transparent 72%);
        opacity: 0.52;
        pointer-events: none; z-index: 4;
      }
      .hook-flash {
        position: absolute; inset: 0;
        background: radial-gradient(circle at 50% 40%, var(--accent-color) 0%, transparent 75%);
        opacity: 0; pointer-events: none; z-index: 28;
        mix-blend-mode: screen;
      }
      .progress-bar {
        position: absolute; top: 0; left: 0; height: 10px;
        background: linear-gradient(90deg, var(--accent-alt), var(--accent-color)); width: 0%; z-index: 30;
        box-shadow: 0 0 18px var(--accent-glow);
      }
      .top-tag {
        position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
        background: rgba(8, 8, 16, 0.88); color: var(--accent-color);
        font-size: 20px; font-weight: 900; padding: 10px 28px;
        border-radius: 40px; letter-spacing: 2px; text-transform: uppercase;
        border: 2px solid var(--accent-color); white-space: nowrap;
        box-shadow: 0 0 24px var(--accent-glow); z-index: 20;
      }

      .scene {
        position: absolute; inset: 0;
        padding-bottom: 220px;
        display: flex; justify-content: center; align-items: center;
        opacity: 0; z-index: 10;
      }
      .scene-inner {
        display: flex; justify-content: center; align-items: center;
        will-change: transform, filter;
      }
      svg { width: 530px; height: 630px; overflow: visible; filter: drop-shadow(0 16px 32px rgba(0,0,0,0.88)); }
      .plano-primer_plano svg { width: 645px; height: 765px; }
      .plano-medio svg { width: 585px; height: 695px; }
      .plano-general svg { width: 525px; height: 625px; }

      svg text {
        font-family: 'Montserrat', sans-serif;
        font-weight: 900;
        paint-order: stroke fill;
        stroke: #0a0a12;
        stroke-width: 2.5px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* CLASES CRÍTICAS PARA QUE LOS SVGS NUNCA SALGAN NEGROS */
      .stroke-white { stroke: #ffffff; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 8px rgba(255,255,255,0.38)); }
      .stroke-red { stroke: #ff2a5f; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 42, 95, 0.92)); }
      .stroke-yellow { stroke: #ffd000; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; fill: none; filter: drop-shadow(0 0 15px rgba(255, 208, 0, 0.92)); }

      .subtitle-container {
        position: absolute;
        bottom: 118px;
        left: 30px;
        right: 30px;
        min-height: 150px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 25;
        pointer-events: none;
      }
      .subtitle-box {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 14px 24px;
        text-align: center;
        padding: 18px 28px;
        background: rgba(8, 8, 16, 0.82);
        border: 2px solid rgba(255, 255, 255, 0.16);
        border-radius: 26px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.90);
        will-change: transform, opacity;
      }
      .subtitle-box.style-1 {
        background: linear-gradient(180deg, rgba(16, 16, 30, 0.88) 0%, rgba(6, 6, 12, 0.94) 100%);
        border: 2px solid var(--accent-color);
        box-shadow: 0 14px 36px rgba(0,0,0,0.9), 0 0 22px var(--accent-glow);
      }
      .subtitle-box.style-2 {
        background: rgba(6, 6, 12, 0.88);
        border-left: 6px solid var(--accent-color);
        border-right: 6px solid var(--accent-alt);
        border-radius: 18px;
      }
      .sub-word {
        display: inline-block;
        margin: 0 3px;
        font-size: 39px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        line-height: 1.18;
        color: #ffffff;
        paint-order: stroke fill;
        -webkit-text-stroke: 7px #05050a;
        text-shadow: 0 6px 16px rgba(0, 0, 0, 0.95);
        will-change: transform, opacity;
      }
      .sub-word.kw {
        color: var(--accent-color);
        filter: drop-shadow(0 0 14px var(--accent-glow));
      }
      .sub-word.active {
        transform: scale(1.10) translateY(-4px);
      }
      .sub-word.kw.active {
        transform: scale(1.15) translateY(-5px) rotate(-1.5deg);
      }
      .sub-word.future {
        opacity: 0.42;
      }
    </style>
  </head>
  <body>
    <canvas id="bg-canvas" width="720" height="1280"></canvas>
    <div class="vignette"></div>
    <div class="glow-spot" id="glow"></div>
    <div class="hook-flash" id="hook-flash"></div>
    <div class="progress-bar" id="pbar"></div>
    <div class="top-tag" id="top-tag">${payload.categoria || 'PSICOLOGÍA'}</div>

    <div id="scenes-wrapper">
      ${escenasProcesadas.map(e => `
        <div class="scene plano-${e.plano}" id="scene-${e.id}">
          <div class="scene-inner" id="inner-${e.id}">
            <svg viewBox="0 0 200 240">${e.svgInterno}</svg>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="subtitle-container">
      <div class="subtitle-box style-${subStyleMode}" id="sub-box"></div>
    </div>

    <script>
      const escenas = ${JSON.stringify(escenasProcesadas)};
      const subtitleChunks = ${JSON.stringify(subtitleChunks)};
      const totalFrames = ${totalFrames};
      const bgPatternMode = ${bgPatternMode};
      const accentHex = "${chosenAccent.hex}";
      const accentAltHex = "${chosenAccent.altHex}";

      const canvas = document.getElementById('bg-canvas');
      const ctx = canvas.getContext('2d');
      const particles = Array.from({ length: 36 }, (_, i) => ({
        x: (i * 97) % 720,
        y: (i * 173) % 1280,
        r: 1.8 + (i % 4) * 1.3,
        vx: ((i % 5) - 2) * 14,
        vy: -22 - (i % 6) * 12,
        alpha: 0.18 + (i % 5) * 0.10,
        isAlt: i % 3 === 0
      }));

      function renderAtmosphere(t, sceneLocalT) {
        ctx.clearRect(0, 0, 720, 1280);
        const burst = sceneLocalT < 0.20 ? (1 - sceneLocalT / 0.20) : 0;

        ctx.save();
        if (bgPatternMode === 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.045)';
          ctx.lineWidth = 1;
          const offset = (t * 28) % 55;
          for (let x = 0; x < 720; x += 55) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1280); ctx.stroke();
          }
          for (let y = offset; y < 1280; y += 55) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(720, y); ctx.stroke();
          }
        } else if (bgPatternMode === 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1.5;
          for (let r = 1; r <= 6; r++) {
            const rad = ((r * 110 + t * 45) % 680);
            ctx.beginPath();
            ctx.arc(360, 480, rad, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (bgPatternMode === 2) {
          ctx.strokeStyle = 'rgba(255,255,255,0.055)';
          ctx.lineWidth = 1;
          for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            const px1 = (p1.x + p1.vx * t + 7200) % 720;
            const py1 = (p1.y + p1.vy * t + 12800) % 1280;
            for (let j = i + 1; j < particles.length; j++) {
              const p2 = particles[j];
              const px2 = (p2.x + p2.vx * t + 7200) % 720;
              const py2 = (p2.y + p2.vy * t + 12800) % 1280;
              const dist = Math.hypot(px1 - px2, py1 - py2);
              if (dist < 135) {
                ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
              }
            }
          }
        } else if (bgPatternMode === 3) {
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 1.5;
          const shift = (t * 35) % 90;
          for (let i = -1280; i < 720; i += 90) {
            ctx.beginPath();
            ctx.moveTo(i + shift, 0);
            ctx.lineTo(i + shift + 720, 1280);
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.065)';
          ctx.lineWidth = 1.5;
          const yShift = (t * 20) % 90;
          for (let x = 60; x < 720; x += 90) {
            for (let y = yShift; y < 1280; y += 90) {
              ctx.beginPath();
              ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
              ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
              ctx.stroke();
            }
          }
        }

        particles.forEach((p, idx) => {
          const speedBoost = 1 + burst * 0.4;
          const px = (p.x + p.vx * t * speedBoost + Math.sin(t * 2 + idx) * 18 + 7200) % 720;
          const py = (p.y + p.vy * t * speedBoost + 12800) % 1280;
          ctx.fillStyle = p.isAlt ? accentAltHex : accentHex;
          ctx.globalAlpha = Math.min(0.85, p.alpha + burst * 0.25);
          ctx.beginPath();
          ctx.arc(px, py, p.r * (1 + burst * 0.5), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      document.fonts.ready.then(() => {
        document.querySelectorAll('.scene svg').forEach(svg => {
          const texts = Array.from(svg.querySelectorAll('text'));
          texts.forEach(txt => {
            const content = (txt.textContent || '').trim();
            if (content.length <= 2) return;

            const x = parseFloat(txt.getAttribute('x') || '100');
            const y = parseFloat(txt.getAttribute('y') || '120');

            const sameRowTexts = texts.filter(other => {
              if (other === txt) return false;
              const oy = parseFloat(other.getAttribute('y') || '0');
              return Math.abs(oy - y) < 14;
            });

            let maxAllowedWidth = 170;
            if (sameRowTexts.length >= 2) {
              maxAllowedWidth = 52;
            } else if (sameRowTexts.length === 1) {
              const ox = parseFloat(sameRowTexts[0].getAttribute('x') || '100');
              const dist = Math.abs(x - ox);
              maxAllowedWidth = Math.max(54, dist - 28);
            } else if (x < 65 || x > 135) {
              maxAllowedWidth = 60;
            }

            let currentSize = parseFloat(txt.getAttribute('font-size') || '12');
            while (txt.getComputedTextLength() > maxAllowedWidth && currentSize > 6.5) {
              currentSize -= 0.5;
              txt.setAttribute('font-size', String(currentSize));
            }

            if (txt.getComputedTextLength() > maxAllowedWidth) {
              txt.setAttribute('textLength', String(maxAllowedWidth));
              txt.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
          });
        });
      });

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
        svg.dataset.totalShapes = String(idx);
      });

      function easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      }

      function easeOutElastic(x) {
        if (x === 0 || x === 1) return x;
        return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
      }

      const subBox = document.getElementById('sub-box');
      const hookFlash = document.getElementById('hook-flash');
      const glowEl = document.getElementById('glow');
      let lastChunkIdx = -2;

      window.setFrameData = function(frameIdx, t) {
        const linearRatio = (frameIdx + 1) / totalFrames;
        const psychPct = Math.pow(linearRatio, 0.62) * 100;
        document.getElementById('pbar').style.width = Math.min(100, psychPct) + '%';
        
        let activeIdx = escenas.findIndex((e, idx) => {
          if (idx === escenas.length - 1) return t >= e.inicio;
          return t >= e.inicio && t < e.fin;
        });
        if (activeIdx === -1 && escenas.length > 0) activeIdx = 0;

        const activeScene = escenas[activeIdx];
        const sceneLocalT = activeScene ? Math.max(0, t - activeScene.inicio) : 0;

        renderAtmosphere(t, sceneLocalT);

        if (t < 0.25) {
          hookFlash.style.opacity = String((1 - t / 0.25) * 0.44);
        } else if (sceneLocalT < 0.14) {
          hookFlash.style.opacity = String((1 - sceneLocalT / 0.14) * 0.16);
        } else {
          hookFlash.style.opacity = '0';
        }

        const glowX = 50 + Math.sin(activeIdx * 2.1 + t * 1.5) * 12;
        const glowY = 36 + Math.cos(activeIdx * 1.7 + t * 1.2) * 7;
        const glowScale = 1 + Math.sin(t * 4.5) * 0.18 + (sceneLocalT < 0.25 ? (1 - sceneLocalT / 0.25) * 0.35 : 0);
        glowEl.style.left = glowX + '%';
        glowEl.style.top = glowY + '%';
        glowEl.style.transform = \`translate(-50%, -50%) scale(\${glowScale})\`;

        escenas.forEach((e, idx) => {
          const sc = document.getElementById('scene-' + e.id);
          const inner = document.getElementById('inner-' + e.id);

          if (idx === activeIdx) {
            const localT = Math.max(0, t - e.inicio);
            const durEscena = Math.max(0.1, e.fin - e.inicio);
            sc.style.opacity = '1';

            let tx = 0;
            let ty = Math.sin(localT * 5.2) * 10;
            let scale = 1;
            let rot = 0;

            const tr = e.transicion || 'elastic_pop';
            const p = Math.min(1, localT / 0.28);
            const easeCubic = 1 - Math.pow(1 - p, 3);

            if (idx === 0 || tr === 'punch_zoom') {
              scale = 1.78 - 0.78 * easeCubic;
              rot = (1 - easeCubic) * -9 + Math.sin(localT * 3.2) * 2.0;
            } else if (tr === 'whip_left') {
              const b = easeOutBack(p);
              tx = -340 * (1 - b);
              scale = 0.75 + 0.25 * b;
              rot = -18 * (1 - b) + Math.sin(localT * 3.0) * 2.2;
            } else if (tr === 'whip_right') {
              const b = easeOutBack(p);
              tx = 340 * (1 - b);
              scale = 0.75 + 0.25 * b;
              rot = 18 * (1 - b) + Math.sin(localT * 3.0) * 2.2;
            } else if (tr === 'drop_bounce') {
              const el = easeOutElastic(Math.min(1, localT / 0.42));
              ty = -320 * (1 - el) + Math.sin(localT * 5.2) * 8;
              scale = 0.85 + 0.15 * el;
              rot = Math.sin(localT * 3.5) * 2.0;
            } else if (tr === 'glitch_shake') {
              const b = easeOutBack(p);
              scale = 0.60 + 0.40 * b;
              const shakeDecay = localT < 0.45 ? (1 - localT / 0.45) : 0.18;
              tx += Math.sin(localT * 55) * 14 * shakeDecay;
              ty += Math.cos(localT * 62) * 10 * shakeDecay;
              rot = Math.sin(localT * 40) * 5 * shakeDecay;
            } else if (tr === 'spiral_zoom') {
              const b = easeOutBack(p);
              scale = 0.30 + 0.70 * b;
              rot = (1 - easeCubic) * 28 + Math.sin(localT * 2.8) * 2.0;
            } else if (tr === 'pendulum') {
              const b = easeOutBack(p);
              scale = 0.65 + 0.35 * b;
              rot = Math.sin(localT * 6.2) * 7.5;
              tx += Math.sin(localT * 6.2) * 18;
            } else {
              const el = easeOutElastic(Math.min(1, localT / 0.38));
              scale = 0.35 + 0.65 * el;
              rot = Math.sin(localT * 2.8) * (e.esDiagrama ? 1.5 : 2.8);
            }

            scale *= (1 + (localT / durEscena) * 0.09);
            if (localT > durEscena * 0.48) {
              const midP = Math.min(1, (localT - durEscena * 0.48) / 0.22);
              scale *= (1 + 0.08 * easeOutBack(midP));
            }

            inner.style.transform = \`translate(\${tx.toFixed(1)}px, \${ty.toFixed(1)}px) scale(\${scale.toFixed(3)}) rotate(\${rot.toFixed(2)}deg)\`;

            const svgEl = sc.querySelector('svg');
            const totalShapes = Math.max(1, parseInt(svgEl?.dataset.totalShapes || '8', 10));
            sc.querySelectorAll('[data-draw-idx]').forEach(shape => {
              const dIdx = parseInt(shape.dataset.drawIdx, 10);
              if (idx === 0) {
                const drawP0 = Math.max(0.68, Math.min(1, 0.68 + (localT / 0.18) * 0.32));
                shape.style.strokeDashoffset = String(100 * (1 - drawP0));
              } else if (e.drawMode === 1) {
                const drawP = Math.max(0, Math.min(1, localT / 0.28));
                shape.style.strokeDashoffset = String(100 * (1 - drawP));
              } else if (e.drawMode === 2) {
                const revIdx = Math.max(0, totalShapes - 1 - dIdx);
                const delay = Math.min(0.18, revIdx * 0.025);
                const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.32));
                shape.style.strokeDashoffset = String(100 * (1 - drawP));
              } else {
                const delay = Math.min(0.18, dIdx * 0.025);
                const drawP = Math.max(0, Math.min(1, (localT - delay) / 0.34));
                shape.style.strokeDashoffset = String(100 * (1 - drawP));
              }
            });

            const bodyLayer = sc.querySelector('.layer-body');
            if (bodyLayer) {
              const breathScaleY = 1 + Math.sin(localT * 6.0) * 0.025;
              const breathScaleX = 1 - Math.sin(localT * 6.0) * 0.015;
              bodyLayer.style.transformOrigin = '100px 140px';
              bodyLayer.style.transform = \`scale(\${breathScaleX}, \${breathScaleY})\`;
            }

            const faceLayer = sc.querySelector('.layer-face');
            if (faceLayer) {
              const caraType = faceLayer.dataset.cara || '';
              let faceX = 0;
              let faceY = Math.sin(localT * 7.5) * 3.8;
              let faceRot = Math.sin(localT * 5.2) * 4.5;

              if (/estres|enfado|miedo|panico|grito/.test(caraType)) {
                faceX = Math.sin(localT * 38) * 2.2;
                faceRot += Math.cos(localT * 32) * 3.0;
              } else if (/duda|pensando|sospecha/.test(caraType)) {
                faceRot = -6 + Math.sin(localT * 3.5) * 6.0;
              }

              faceLayer.style.transformOrigin = '100px 65px';
              faceLayer.style.transform = \`translate(\${faceX}px, \${faceY}px) rotate(\${faceRot}deg)\`;
            }

            const propLayer = sc.querySelector('.layer-prop');
            if (propLayer) {
              const propX = Math.cos(localT * 5.0) * 5.5;
              const propY = Math.sin(localT * 6.8 + 1) * 10;
              const propScale = 1 + Math.sin(localT * 10.5) * 0.11;
              const propRot = Math.sin(localT * 4.5) * 6;
              propLayer.style.transformOrigin = 'center';
              propLayer.style.transformBox = 'fill-box';
              propLayer.style.transform = \`translate(\${propX}px, \${propY}px) scale(\${propScale}) rotate(\${propRot}deg)\`;
            }

            sc.querySelectorAll('.float').forEach(el => {
              const fOffset = Math.sin(localT * 6.8) * 8.5;
              el.style.transform = \`translateY(\${fOffset}px)\`;
            });

            sc.querySelectorAll('.pulse').forEach(el => {
              const pScale = 1 + Math.sin(localT * 11.5) * 0.14;
              el.style.transformOrigin = 'center';
              el.style.transformBox = 'fill-box';
              el.style.transform = \`scale(\${pScale})\`;
            });

          } else {
            sc.style.opacity = '0';
          }
        });

        let cIdx = subtitleChunks.findIndex((c, idx) => {
          if (idx === subtitleChunks.length - 1) return t >= c.start;
          return t >= c.start && t < c.end;
        });

        if (cIdx === -1) {
          subBox.style.opacity = '0';
          return;
        }

        const chunk = subtitleChunks[cIdx];
        subBox.style.opacity = '1';

        const chunkLocalT = Math.max(0, t - chunk.start);
        const popP = Math.min(1, chunkLocalT / 0.12);
        const boxScale = 0.90 + 0.10 * easeOutBack(popP);
        subBox.style.transform = \`scale(\${boxScale})\`;

        if (cIdx !== lastChunkIdx) {
          lastChunkIdx = cIdx;
          subBox.innerHTML = chunk.words.map((w, wIdx) => {
            const kwClass = w.highlight ? 'kw' : '';
            return \`<span class="sub-word \${kwClass}" id="sw-\${wIdx}">\${w.text}</span>\`;
          }).join('');
        }

        chunk.words.forEach((w, wIdx) => {
          const el = document.getElementById('sw-' + wIdx);
          if (!el) return;
          const isCurrent = (t >= w.start && t <= w.end);
          const isFuture = (t < w.start);

          el.classList.toggle('active', isCurrent);
          el.classList.toggle('future', isFuture);
        });
      };
    </script>
  </body>
  </html>`;

  fs.writeFileSync('index.html', htmlContent);

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
  await page.evaluateHandle('document.fonts.ready');

  console.log(`🎬 Grabando exactamente ${totalFrames} fotogramas (${duracionExactaVideo.toFixed(2)}s)...`);
  for (let i = 0; i < totalFrames; i++) {
    const currentTime = i / fps;
    await page.evaluate((frameIdx, t) => window.setFrameData(frameIdx, t), i, currentTime);
    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: `frames/frame_${frameNum}.jpg`, type: 'jpeg', quality: 92 });
  }

  await browser.close();

  console.log('🔊 Ensamblando MP4 final con mapeo explícito de vídeo y audio...');
  execSync(
    `ffmpeg -y -framerate ${fps} -i frames/frame_%05d.jpg -i audio.wav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -ac 2 -t ${duracionExactaVideo.toFixed(3)} output.mp4`,
    { stdio: 'inherit' }
  );

  console.log('✅ ¡Vídeo output.mp4 v6.0 generado con 32 nuevos activos (animales, vehículos, objetos) y 400 temas!');
}

main().catch(err => {
  console.error('❌ Error en el renderizado:', err);
  process.exit(1);
});
