// Configuración del sitio.
//
// API_URL: la URL /exec de tu Apps Script implementado como aplicación web.
// Mientras esté vacía, el sitio usa la copia de datos de data/snapshot.json.
//
// Ejemplo: 'https://script.google.com/macros/s/AKfycb.../exec'
window.CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwnQBffCUCtToLGMtJupEoCZcxLfyj_gW059hGNc5oJ6ZcPi8-__mtDr9NZyNvuj8RN/exec',

  // ID de cliente OAuth de Google para el panel de clubes (#/admin).
  // Se crea en Google Cloud Console; el mismo valor va en backend/Code.gs.
  GOOGLE_CLIENT_ID: '1052940348586-oe5937rmtir144qe57spetjjlos8rjr4.apps.googleusercontent.com',

  // Cada cuántos segundos se revisan los partidos en juego del equipo que seguís.
  REFRESCO_EN_VIVO_SEG: 60,

  // Contacto que aparece en el pie para ligas que quieren sumarse.
  CONTACTO: ''
};
