/**
 * API de la plataforma de ligas amateur.
 *
 * Instalación:
 *  1. Abrí la planilla > Extensiones > Apps Script y pegá este archivo.
 *  2. Implementar > Nueva implementación > Aplicación web.
 *     Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario.
 *  3. Copiá la URL /exec. Esa es la base de la API para el sitio en GitHub Pages.
 *
 * Endpoints (GET):
 *  ?r=todo                          (todas las tablas en un solo pedido; es lo que usa el sitio)
 *  ?r=ligas
 *  ?r=clubes&liga=L01
 *  ?r=equipos&liga=L01
 *  ?r=jugadores&equipo=E02
 *  ?r=torneos&liga=L01
 *  ?r=partidos&torneo=T01            (opcional: &fecha=13, &equipo=E02, &estado=Finalizado)
 *  ?r=eventos&partido=P049
 *  ?r=noticias&liga=L01              (opcional: &limite=10)
 *  ?r=posiciones&torneo=T01
 *  ?r=goleadores&torneo=T01          (opcional: &limite=10)
 *
 * Endpoints (POST, body JSON enviado como text/plain para evitar el preflight de CORS):
 *  {"accion":"suscribir","token_push":"...","liga_id":"L01","equipo_id":"E02"}
 *  {"accion":"admin_datos","token":"<ID token de Google>"}
 *  {"accion":"admin_lote","token":"...","ops":[{"op":"crear|editar|borrar|sumar", ...}]}
 *
 * El panel de administración necesita GOOGLE_CLIENT_ID (más abajo) y que la
 * implementación tenga permiso para conectarse a servicios externos (UrlFetchApp).
 *
 * Pestañas: Clubes, Equipos, Jugadores, Torneos, Partidos, Eventos y Noticias tienen
 * una pestaña por liga (Partidos_L01, Partidos_L02...). Todas tienen las mismas columnas.
 * Cuando el panel carga algo de una liga nueva, la pestaña se crea sola.
 */

const CACHE_SEGUNDOS = 600; // los cambios del panel la renuevan al instante; los hechos a mano en la planilla tardan hasta 10 minutos

// ID de la planilla (lo que va entre /d/ y /edit en su URL).
const API_PLANILLA_ID = '17e2wXdLBrZNAt8c8uTA4kc9uURa43vDJlcqi9oD6GNI';

// Siempre abre la planilla por su ID, aunque el script esté vinculado a otra hoja.
let PLANILLA_ = null;
function planilla_() {
  if (!PLANILLA_) PLANILLA_ = SpreadsheetApp.openById(API_PLANILLA_ID);
  return PLANILLA_;
}

// Tablas que tienen una pestaña por liga: Clubes_L01, Clubes_L02, Partidos_L01...
// La API las lee juntas, como si fueran una sola tabla, y escribe cada fila en la
// pestaña de su liga. Ligas, Usuarios, Suscripciones, Fuentes y Registro son únicas.
const POR_LIGA = ['Clubes', 'Equipos', 'Jugadores', 'Torneos', 'Partidos', 'Eventos', 'Noticias'];

let HOJAS_ = null;
function hojasDe_(tabla) {
  if (!HOJAS_) HOJAS_ = planilla_().getSheets();
  if (POR_LIGA.indexOf(tabla) < 0) return HOJAS_.filter(sh => sh.getName() === tabla);
  const re = new RegExp('^' + tabla + '(_L\\d+)?$');
  return HOJAS_.filter(sh => re.test(sh.getName()));
}

// Memoria de lecturas dentro de una misma ejecución. Se vacía después de cada escritura.
let FILAS_ = {};
function olvidar_() { FILAS_ = {}; HOJAS_ = null; }

function doGet(e) {
  const p = (e && e.parameter) || { r: 'posiciones', torneo: 'T01' };
  try {
    const version = PropertiesService.getScriptProperties().getProperty('version') || '0';
    const cacheKey = version + JSON.stringify(p);
    const cache = CacheService.getScriptCache();
    const cached = cacheLeer_(cache, cacheKey);
    if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

    const data = route_(p);
    const text = JSON.stringify({ ok: true, data: data });
    cacheGuardar_(cache, cacheKey, text);
    return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// La caché de Apps Script guarda hasta 100 KB por clave: las respuestas grandes se parten en pedazos.
function cacheGuardar_(cache, clave, texto) {
  const TAM = 90000, partes = {};
  const n = Math.ceil(texto.length / TAM);
  if (n > 50) return;
  for (let i = 0; i < n; i++) partes[clave + '#' + i] = texto.slice(i * TAM, (i + 1) * TAM);
  partes[clave + '#n'] = String(n);
  try { cache.putAll(partes, CACHE_SEGUNDOS); } catch (err) {}
}
function cacheLeer_(cache, clave) {
  const n = Number(cache.get(clave + '#n'));
  if (!n) return null;
  const claves = []; for (let i = 0; i < n; i++) claves.push(clave + '#' + i);
  const got = cache.getAll(claves);
  let texto = '';
  for (let i = 0; i < n; i++) { if (got[claves[i]] == null) return null; texto += got[claves[i]]; }
  return texto;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.accion === 'suscribir') return json_({ ok: true, data: suscribir_(body) });
    if (body.accion === 'admin_datos') return json_({ ok: true, data: adminDatos_(body) });
    if (body.accion === 'admin_lote') return json_({ ok: true, data: adminLote_(body) });
    throw new Error('Acción desconocida');
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function route_(p) {
  switch (p.r) {
    case 'todo':
      return {
        ligas: rows_('Ligas').filter(l => l.activa === 'SI'),
        clubes: rows_('Clubes'),
        equipos: rows_('Equipos'),
        jugadores: rows_('Jugadores').filter(j => j.activo === 'SI'),
        torneos: rows_('Torneos'),
        partidos: rows_('Partidos'),
        eventos: rows_('Eventos'),
        noticias: rows_('Noticias').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      };
    case 'ligas':
      return rows_('Ligas').filter(l => l.activa === 'SI');
    case 'clubes':
      return rows_('Clubes').filter(by_('liga_id', p.liga));
    case 'equipos': {
      const clubes = ids_(rows_('Clubes').filter(by_('liga_id', p.liga)));
      return rows_('Equipos').filter(eq => !p.liga || clubes.has(eq.club_id));
    }
    case 'jugadores':
      return rows_('Jugadores').filter(by_('equipo_id', p.equipo)).filter(j => j.activo === 'SI');
    case 'torneos':
      return rows_('Torneos').filter(by_('liga_id', p.liga));
    case 'partidos':
      return partidos_(p);
    case 'eventos':
      return rows_('Eventos').filter(by_('partido_id', p.partido));
    case 'noticias': {
      const n = rows_('Noticias').filter(by_('liga_id', p.liga))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      return p.limite ? n.slice(0, Number(p.limite)) : n;
    }
    case 'posiciones':
      return posiciones_(p.torneo);
    case 'goleadores':
      return goleadores_(p.torneo, p.limite);
    default:
      throw new Error('Recurso desconocido. Usá ?r=ligas, clubes, equipos, jugadores, torneos, partidos, eventos, noticias, posiciones o goleadores');
  }
}

function partidos_(p) {
  return rows_('Partidos')
    .filter(by_('torneo_id', p.torneo))
    .filter(m => !p.fecha || String(m.fecha_nro) === String(p.fecha))
    .filter(m => !p.estado || m.estado === p.estado)
    .filter(m => !p.equipo || m.local_id === p.equipo || m.visitante_id === p.equipo);
}

/** Tabla calculada en el servidor (no depende de la pestaña Posiciones). */
function posiciones_(torneo) {
  const nombres = {};
  rows_('Equipos').forEach(e => nombres[e.id] = e.club);
  const t = {};
  const fila = id => t[id] || (t[id] = { equipo_id: id, equipo: nombres[id] || id, PJ: 0, G: 0, E: 0, P: 0, GF: 0, GC: 0, DIF: 0, PTS: 0 });

  rows_('Partidos').filter(by_('torneo_id', torneo)).forEach(m => {
    const L = fila(m.local_id), V = fila(m.visitante_id);
    if (m.estado !== 'Finalizado') return;
    const res = resultado_(m);
    if (!res) return;
    L.PJ++; V.PJ++;
    if (num_(m.goles_local) && num_(m.goles_visitante)) {
      L.GF += m.goles_local; L.GC += m.goles_visitante;
      V.GF += m.goles_visitante; V.GC += m.goles_local;
    }
    if (res === 'L') { L.G++; V.P++; L.PTS += 3; }
    else if (res === 'V') { V.G++; L.P++; V.PTS += 3; }
    else { L.E++; V.E++; L.PTS++; V.PTS++; }
  });

  return Object.values(t)
    .map(r => (r.DIF = r.GF - r.GC, r))
    .sort((a, b) => b.PTS - a.PTS || b.DIF - a.DIF || b.GF - a.GF)
    .map((r, i) => (r.pos = i + 1, r));
}

function goleadores_(torneo, limite) {
  const partidos = ids_(rows_('Partidos').filter(by_('torneo_id', torneo)));
  const jug = {};
  rows_('Jugadores').forEach(j => jug[j.id] = j);
  const goles = {};
  rows_('Eventos')
    .filter(ev => ev.tipo === 'Gol' && (!torneo || partidos.has(ev.partido_id)))
    .forEach(ev => goles[ev.jugador_id] = (goles[ev.jugador_id] || 0) + 1);
  const lista = Object.keys(goles).map(id => ({
    jugador_id: id,
    jugador: jug[id] ? (jug[id].nombre + ' ' + jug[id].apellido) : id,
    club: jug[id] ? jug[id].club : '',
    goles: goles[id]
  })).sort((a, b) => b.goles - a.goles || a.jugador.localeCompare(b.jugador));
  return limite ? lista.slice(0, Number(limite)) : lista;
}

function suscribir_(b) {
  if (!b.token_push || !b.liga_id) throw new Error('Faltan token_push o liga_id');
  const sh = planilla_().getSheetByName('Suscripciones');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existentes = rows_('Suscripciones');
    const ya = existentes.find(s => s.token_push === b.token_push && s.equipo_id === (b.equipo_id || ''));
    if (ya) return { id: ya.id, nuevo: false };
    const id = 'S' + Utilities.getUuid().slice(0, 8);
    sh.appendRow([id, b.token_push, b.liga_id, b.equipo_id || '', new Date(), 'SI']);
    return { id: id, nuevo: true };
  } finally {
    lock.releaseLock();
  }
}

// ===================== PANEL DE ADMINISTRACIÓN =====================
//
// Ingreso con cuenta de Google: el sitio manda el ID token, acá se verifica con Google
// y se busca el email en la pestaña Usuarios (activo = SI).
//   rol dev        → puede editar todo.
//   rol admin_club → solo los datos de su club (club_id) y las noticias de su liga.
// Cada cambio queda anotado en la pestaña Registro.

// ID de cliente OAuth de Google. El mismo valor va en js/config.js (GOOGLE_CLIENT_ID).
const GOOGLE_CLIENT_ID = '1052940348586-oe5937rmtir144qe57spetjjlos8rjr4.apps.googleusercontent.com';

const TABLAS_ADMIN = {
  Ligas:     { pref: 'L',  dig: 2 },
  Clubes:    { pref: 'CL', dig: 2 },
  Equipos:   { pref: 'E',  dig: 2, formulas: { club: '=INDEX(Clubes!C:C,MATCH({club_id},Clubes!A:A,0))' } },
  Jugadores: { pref: 'J',  dig: 3, formulas: {
    club: '=INDEX(Equipos!D:D,MATCH({equipo_id},Equipos!A:A,0))',
    goles: '=COUNTIFS(Eventos!{Eventos.jugador_id},{id},Eventos!{Eventos.tipo},"Gol")' } },
  Torneos:   { pref: 'T',  dig: 2 },
  Partidos:  { pref: 'P',  dig: 3, formulas: {
    local: '={buscarEquipo:local_id}',
    visitante: '={buscarEquipo:visitante_id}',
    resultado: '=IF({estado}<>"Finalizado","",IF(AND(ISNUMBER({goles_local}),ISNUMBER({goles_visitante})),IF({goles_local}>{goles_visitante},"L",IF({goles_local}<{goles_visitante},"V","E")),{resultado_manual}))' } },
  Eventos:   { pref: 'EV', dig: 3 },
  Noticias:  { pref: 'N',  dig: 2 },
  Usuarios:  { pref: 'U',  dig: 2 }
};

// Campos que puede tocar un admin de club, por tabla.
const CAMPOS_CLUB = {
  Clubes: ['nombre', 'ciudad', 'escudo', 'web', 'contacto', 'cancha', 'direccion'],
  Jugadores: ['equipo_id', 'nombre', 'apellido', 'numero', 'posicion', 'foto', 'activo', 'observaciones'],
  Partidos: ['fecha_jugada', 'hora', 'cancha', 'goles_local', 'goles_visitante', 'resultado_manual', 'estado', 'observaciones'],
  Eventos: ['partido_id', 'minuto', 'tipo', 'jugador_id', 'equipo_id', 'observaciones'],
  Noticias: ['liga_id', 'fecha', 'titulo', 'resumen', 'fuente', 'url', 'imagen']
};

const REQUERIDOS = {
  Ligas: ['nombre', 'provincia'], Clubes: ['liga_id', 'nombre'], Equipos: ['club_id', 'categoria'],
  Jugadores: ['equipo_id', 'apellido'], Torneos: ['liga_id', 'nombre'],
  Partidos: ['torneo_id', 'local_id', 'visitante_id'], Eventos: ['partido_id', 'tipo', 'equipo_id'],
  Noticias: ['liga_id', 'titulo'], Usuarios: ['email', 'rol']
};

// Qué tablas apuntan a cada una (para no borrar algo que está en uso).
const REFERENCIAS = {
  Ligas: [['Clubes', 'liga_id'], ['Torneos', 'liga_id'], ['Noticias', 'liga_id']],
  Clubes: [['Equipos', 'club_id']],
  Equipos: [['Jugadores', 'equipo_id'], ['Partidos', 'local_id'], ['Partidos', 'visitante_id']],
  Jugadores: [['Eventos', 'jugador_id']],
  Torneos: [['Partidos', 'torneo_id']],
  Partidos: [['Eventos', 'partido_id']]
};

const VALORES = {
  rol: ['dev', 'admin_club'],
  estado_partido: ['Programado', 'En juego', 'Finalizado', 'Postergado'],
  tipo_evento: ['Gol', 'Gol en contra', 'Amarilla', 'Roja'],
  resultado_manual: ['', 'L', 'E', 'V'],
  si_no: ['SI', 'NO']
};

function adminDatos_(body) {
  const ctx = sesion_(body.token);
  return datosPara_(ctx);
}

function adminLote_(body) {
  const ctx = sesion_(body.token);
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length) throw new Error('No hay cambios para guardar.');
  if (ops.length > 40) throw new Error('Demasiados cambios juntos. Guardá de a partes.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const creados = [];
  try {
    ops.forEach(op => validarOp_(ctx, op, creados));
    ops.forEach(op => creados.push(aplicarOp_(ctx, op, creados)));
    olvidar_();
    PropertiesService.getScriptProperties().setProperty('version', String(Date.now()));
  } finally {
    lock.releaseLock();
  }
  const datos = datosPara_(sesion_(body.token));
  datos.creados = creados;
  return datos;
}

// ---------- sesión ----------

function sesion_(token) {
  if (!GOOGLE_CLIENT_ID) throw new Error('El panel no está configurado: falta GOOGLE_CLIENT_ID en Code.gs.');
  if (!token) throw new Error('Sesión vencida. Volvé a ingresar.');
  const info = verificarToken_(token);
  const filas = rows_('Usuarios').filter(u => String(u.email).toLowerCase().trim() === info.email && u.activo === 'SI');
  if (!filas.length) throw new Error('La cuenta ' + info.email + ' no tiene acceso al panel. Pedile al administrador que la agregue en la pestaña Usuarios.');
  const dev = filas.some(u => u.rol === 'dev');
  const clubes = dev ? [] : filas.filter(u => u.rol === 'admin_club' && u.club_id).map(u => String(u.club_id));
  const ligas = dev ? [] : filas.map(u => String(u.liga_id)).filter(Boolean);
  if (!dev && !clubes.length) throw new Error('Tu usuario no tiene un club asignado. Revisá la columna club_id en Usuarios.');
  const equipos = new Set(rows_('Equipos').filter(e => clubes.indexOf(String(e.club_id)) >= 0).map(e => String(e.id)));
  return {
    usuario: { email: info.email, nombre: filas[0].nombre || info.nombre, rol: dev ? 'dev' : 'admin_club', clubes: clubes, ligas: ligas },
    equipos: equipos
  };
}

function verificarToken_(token) {
  const cache = CacheService.getScriptCache();
  const clave = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Sesión vencida. Volvé a ingresar.');
  const t = JSON.parse(res.getContentText());
  if (t.aud !== GOOGLE_CLIENT_ID) throw new Error('El ingreso no corresponde a este sitio.');
  if (String(t.email_verified) !== 'true') throw new Error('La cuenta de Google no tiene el email verificado.');
  const vence = Number(t.exp) * 1000;
  if (vence < Date.now()) throw new Error('Sesión vencida. Volvé a ingresar.');
  const info = { email: String(t.email).toLowerCase(), nombre: t.name || '' };
  cache.put(clave, JSON.stringify(info), Math.max(1, Math.min(900, Math.floor((vence - Date.now()) / 1000))));
  return info;
}

function datosPara_(ctx) {
  const u = ctx.usuario;
  const dev = u.rol === 'dev';
  const datos = {
    usuario: u,
    valores: VALORES,
    ligas: rows_('Ligas'),
    clubes: rows_('Clubes'),
    equipos: rows_('Equipos'),
    jugadores: rows_('Jugadores').filter(j => dev || j.activo === 'SI' || ctx.equipos.has(String(j.equipo_id))),
    torneos: rows_('Torneos'),
    partidos: rows_('Partidos'),
    eventos: rows_('Eventos'),
    noticias: rows_('Noticias')
  };
  if (dev) datos.usuarios = rows_('Usuarios');
  return datos;
}

// ---------- permisos ----------

function validarOp_(ctx, op, creados) {
  const tabla = op.tabla;
  if (!TABLAS_ADMIN[tabla]) throw new Error('Tabla desconocida: ' + tabla);
  if (['crear', 'editar', 'borrar', 'sumar'].indexOf(op.op) < 0) throw new Error('Operación desconocida: ' + op.op);
  let vieja = null, ligaHoja = '';
  if (op.op !== 'crear') {
    const u = ubicar_(tabla, op.id);
    if (!u) throw new Error('No se encontró ' + tabla + ' ' + op.id + '. Puede que otro usuario lo haya borrado.');
    vieja = filaObjeto_(u.h, u.n);
    ligaHoja = u.h.liga;
  }
  let nueva = null;
  if (op.op === 'crear') nueva = resolverRefs_(op.fila || {}, creados);
  if (op.op === 'editar') {
    nueva = Object.assign({}, vieja, resolverRefs_(op.cambios || {}, creados));
    if (ligaHoja && POR_LIGA.indexOf(tabla) >= 0) {
      const ligaNueva = ligaDe_(tabla, nueva);
      if (ligaNueva && ligaNueva !== ligaHoja) throw new Error('Ese cambio pasaría el dato a otra liga. Para eso, borralo y crealo de nuevo en la otra liga.');
    }
  }
  if (op.op === 'sumar') {
    if (tabla !== 'Partidos' || ['goles_local', 'goles_visitante'].indexOf(op.campo) < 0) throw new Error('Solo se pueden sumar goles a un partido.');
  }
  const campos = op.op === 'crear' ? Object.keys(op.fila || {}) : op.op === 'editar' ? Object.keys(op.cambios || {}) : op.op === 'sumar' ? [op.campo] : [];
  permitir_(ctx, tabla, op.op, nueva, vieja, campos);
  if (nueva) validarValores_(tabla, nueva, op.op);
}

function permitir_(ctx, tabla, accion, nueva, vieja, campos) {
  const u = ctx.usuario;
  if (u.rol === 'dev') return;
  const mios = ctx.equipos;
  const no = m => { throw new Error(m); };
  const permitidos = CAMPOS_CLUB[tabla];
  if (!permitidos) no('No tenés permiso para modificar ' + tabla + '.');
  campos.forEach(c => { if (permitidos.indexOf(c) < 0 && !(tabla === 'Noticias' && c === 'autor_email')) no('No tenés permiso para modificar el campo ' + c + '.'); });
  const juegaMiClub = p => p && (mios.has(String(p.local_id)) || mios.has(String(p.visitante_id)));
  switch (tabla) {
    case 'Clubes':
      if (accion !== 'editar' || u.clubes.indexOf(String(vieja.id)) < 0) no('Solo podés editar los datos de tu club.');
      return;
    case 'Jugadores':
      if (accion === 'borrar') no('Para sacar a un jugador del plantel, marcalo como inactivo.');
      [vieja, nueva].forEach(f => { if (f && !mios.has(String(f.equipo_id))) no('Solo podés cargar jugadores de tu club.'); });
      return;
    case 'Partidos':
      if (accion === 'crear' || accion === 'borrar') no('El fixture lo carga la liga.');
      if (!juegaMiClub(vieja)) no('Solo podés cargar resultados de partidos de tu club.');
      return;
    case 'Eventos':
      [vieja, nueva].forEach(f => {
        if (!f) return;
        const p = filaPorId_('Partidos', f.partido_id);
        if (!juegaMiClub(p)) no('Solo podés cargar goles y tarjetas de partidos de tu club.');
      });
      return;
    case 'Noticias':
      if (nueva && u.ligas.indexOf(String(nueva.liga_id)) < 0) no('Solo podés publicar noticias de tu liga.');
      if (vieja && String(vieja.autor_email).toLowerCase() !== u.email) no('Solo podés modificar las noticias que publicaste vos.');
      return;
  }
  no('No tenés permiso para modificar ' + tabla + '.');
}

/** Equipos de un torneo según "participantes" (L.., CL.., E..). Vacía = toda su liga. */
function participantes_(t) {
  const equipos = rows_('Equipos'), clubes = rows_('Clubes');
  const ligaDeClub = {}; clubes.forEach(c => ligaDeClub[String(c.id)] = String(c.liga_id));
  const deCat = e => !t.categoria || !e.categoria || e.categoria === t.categoria;
  const tokens = String(t.participantes || '').split(/[\s,;]+/).filter(String);
  const ids = {};
  (tokens.length ? tokens : [t.liga_id]).forEach(k => {
    const K = String(k).toUpperCase();
    equipos.forEach(e => {
      if ((/^L\d+$/.test(K) && ligaDeClub[String(e.club_id)] === K && deCat(e)) ||
          (/^CL\d+$/.test(K) && String(e.club_id) === K && deCat(e)) || String(e.id) === K) ids[String(e.id)] = true;
    });
  });
  return ids;
}

function validarValores_(tabla, f, accion) {
  const no = m => { throw new Error(m); };
  if (tabla === 'Torneos' && f.participantes) {
    const malos = String(f.participantes).split(/[\s,;]+/).filter(String).filter(k => !/^(L|CL|E)\d+$/i.test(k));
    if (malos.length) no('Participantes inválidos: ' + malos.join(', ') + '. Usá códigos de liga (L01), club (CL05) o equipo (E07).');
  }
  if (tabla === 'Partidos' && f.torneo_id && f.local_id && f.visitante_id) {
    const t = rows_('Torneos').find(x => String(x.id) === String(f.torneo_id));
    if (t && String(t.participantes || '').trim()) {
      const ids = participantes_(t);
      [f.local_id, f.visitante_id].forEach(e => { if (!ids[String(e)]) no('El equipo ' + e + ' no juega este torneo. Sumalo en los participantes del torneo.'); });
    }
  }
  if (accion === 'crear') (REQUERIDOS[tabla] || []).forEach(c => { if (f[c] === '' || f[c] == null) no('Falta completar ' + c + '.'); });
  if (tabla === 'Partidos') {
    if (f.estado && VALORES.estado_partido.indexOf(f.estado) < 0) no('Estado de partido inválido.');
    if (f.local_id && f.local_id === f.visitante_id) no('Un equipo no puede jugar contra sí mismo.');
    ['goles_local', 'goles_visitante'].forEach(c => { if (f[c] !== '' && f[c] != null && !(Number(f[c]) >= 0)) no('Los goles tienen que ser un número desde 0.'); });
    if (f.resultado_manual && VALORES.resultado_manual.indexOf(f.resultado_manual) < 0) no('El resultado manual tiene que ser L, E o V.');
  }
  if (tabla === 'Eventos') {
    if (VALORES.tipo_evento.indexOf(f.tipo) < 0) no('Tipo de evento inválido.');
    const p = filaPorId_('Partidos', f.partido_id);
    if (!p) no('El partido no existe.');
    if (String(f.equipo_id) !== String(p.local_id) && String(f.equipo_id) !== String(p.visitante_id)) no('Ese equipo no juega ese partido.');
  }
  if (tabla === 'Usuarios') {
    if (VALORES.rol.indexOf(f.rol) < 0) no('El rol tiene que ser dev o admin_club.');
    if (f.rol === 'admin_club' && !f.club_id) no('Un admin de club necesita un club asignado.');
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email).trim())) no('El email no es válido.');
  }
  ['activo', 'activa'].forEach(c => { if (f[c] && VALORES.si_no.indexOf(f[c]) < 0) no('El campo ' + c + ' tiene que ser SI o NO.'); });
}

// ---------- aplicar cambios ----------

function aplicarOp_(ctx, op, creados) {
  const tabla = op.tabla;
  const formulas = (TABLAS_ADMIN[tabla].formulas) || {};
  const u = ctx.usuario;
  olvidar_();

  if (op.op === 'crear') {
    const fila = resolverRefs_(op.fila || {}, creados);
    const def = TABLAS_ADMIN[tabla];
    const h = hojaParaCrear_(tabla, fila);
    if (h.head.indexOf('id') >= 0) fila.id = siguienteId_(tabla, def.pref, def.dig);
    if (tabla === 'Noticias') { fila.autor_email = u.email; if (!fila.fecha) fila.fecha = hoy_(); }
    if (tabla === 'Jugadores' && !fila.activo) fila.activo = 'SI';
    if (tabla === 'Ligas' && !fila.activa) fila.activa = 'SI';
    if (tabla === 'Usuarios' && !fila.activo) fila.activo = 'SI';
    if (tabla === 'Partidos' && !fila.estado) fila.estado = 'Programado';
    if (tabla === 'Usuarios' && fila.email) fila.email = String(fila.email).toLowerCase().trim();
    const n = h.sh.getLastRow() + 1;
    const valores = h.head.map(c => formulas[c] ? '' : valorCelda_(fila[c]));
    h.sh.getRange(n, 1, 1, h.head.length).setValues([valores]);
    h.head.forEach((c, i) => { if (formulas[c]) h.sh.getRange(n, i + 1).setFormula(formula_(formulas[c], h.head, n, h.liga)); });
    registrar_(u.email, 'crear', h.sh.getName(), fila.id || fila.email, fila);
    olvidar_();
    if (tabla === 'Clubes' && op.crearEquipo !== false) {
      aplicarOp_(ctx, { op: 'crear', tabla: 'Equipos', fila: { club_id: fila.id, categoria: 'Primera' } }, creados);
    }
    return fila.id || '';
  }

  const ub = ubicar_(tabla, op.id);
  if (!ub) throw new Error('No se encontró ' + tabla + ' ' + op.id + '.');
  const h = ub.h, n = ub.n;
  if (op.op === 'borrar') {
    (REFERENCIAS[tabla] || []).forEach(([t, c]) => {
      if (rows_(t).some(r => String(r[c]) === String(op.id))) throw new Error('No se puede borrar: está en uso en ' + t + '. Primero borrá o cambiá esos datos.');
    });
    h.sh.deleteRow(n);
    registrar_(u.email, 'borrar', tabla, op.id, {});
    return op.id;
  }

  if (op.op === 'sumar') {
    const col = h.head.indexOf(op.campo);
    const celda = h.sh.getRange(n, col + 1);
    const actual = Number(celda.getValue()) || 0;
    const nuevo = Math.max(0, actual + (Number(op.delta) || 0));
    celda.setValue(nuevo);
    registrar_(u.email, 'sumar', tabla, op.id, { campo: op.campo, valor: nuevo });
    return op.id;
  }

  // editar
  const cambios = resolverRefs_(op.cambios || {}, creados);
  Object.keys(cambios).forEach(c => {
    const col = h.head.indexOf(c);
    if (col < 0 || c === 'id' || formulas[c]) return;
    let v = cambios[c];
    if (tabla === 'Usuarios' && c === 'email') v = String(v || '').toLowerCase().trim();
    h.sh.getRange(n, col + 1).setValue(valorCelda_(v));
  });
  registrar_(u.email, 'editar', tabla, op.id, cambios);
  return op.id;
}

// ---------- utilidades del panel ----------

function leerHoja_(sh) {
  const values = sh.getDataRange().getValues();
  const nombre = sh.getName();
  const m = nombre.match(/_(L\d+)$/);
  return { sh: sh, head: values[0].map(String), values: values, liga: m ? m[1] : '' };
}

/** Busca en qué pestaña está un id. Devuelve { h, n } o null. */
function ubicar_(tabla, id) {
  const hojas = hojasDe_(tabla);
  for (let i = 0; i < hojas.length; i++) {
    const h = leerHoja_(hojas[i]);
    const n = buscarFila_(h, id);
    if (n) return { h: h, n: n };
  }
  return null;
}

/** Liga a la que pertenece una fila, siguiendo sus referencias. */
function ligaDe_(tabla, f) {
  const porId = (t, id) => rows_(t).find(r => String(r.id) === String(id)) || null;
  switch (tabla) {
    case 'Clubes': case 'Torneos': case 'Noticias':
      return f.liga_id ? String(f.liga_id) : '';
    case 'Equipos': { const c = porId('Clubes', f.club_id); return c ? String(c.liga_id) : ''; }
    case 'Jugadores': { const e = porId('Equipos', f.equipo_id); return e ? ligaDe_('Equipos', e) : ''; }
    case 'Partidos': { const t = porId('Torneos', f.torneo_id); return t ? String(t.liga_id) : ''; }
    case 'Eventos': { const p = porId('Partidos', f.partido_id); return p ? ligaDe_('Partidos', p) : ''; }
  }
  return '';
}

/** Pestaña donde va una fila nueva. Si la liga todavía no tiene su pestaña, la crea. */
function hojaParaCrear_(tabla, fila) {
  if (POR_LIGA.indexOf(tabla) < 0) {
    const sh = planilla_().getSheetByName(tabla);
    if (!sh) throw new Error('No existe la pestaña ' + tabla);
    return leerHoja_(sh);
  }
  // Planilla vieja, sin pestañas por liga: sigue escribiendo en la pestaña única.
  const unica = planilla_().getSheetByName(tabla);
  if (unica && hojasDe_(tabla).length === 1) return leerHoja_(unica);
  const liga = ligaDe_(tabla, fila);
  if (!/^L\d+$/.test(liga)) throw new Error('No se pudo saber a qué liga pertenece este dato de ' + tabla + '.');
  const nombre = tabla + '_' + liga;
  let sh = planilla_().getSheetByName(nombre);
  if (!sh) {
    const grupo = hojasDe_(tabla);
    if (!grupo.length) throw new Error('No existe ninguna pestaña de ' + tabla + ' para copiar las columnas.');
    const modelo = grupo[0], ultima = grupo[grupo.length - 1];
    const head = modelo.getRange(1, 1, 1, modelo.getLastColumn()).getValues();
    sh = planilla_().insertSheet(nombre, ultima.getIndex()); // getIndex empieza en 1: queda justo después
    sh.getRange(1, 1, 1, head[0].length).setValues(head).setFontWeight('bold');
    sh.setFrozenRows(1);
    HOJAS_ = null;
  }
  return leerHoja_(sh);
}

function buscarFila_(h, id) {
  const col = h.head.indexOf('id');
  if (col < 0 || id === '' || id == null) return 0;
  for (let i = 1; i < h.values.length; i++) if (String(h.values[i][col]) === String(id)) return i + 1;
  return 0;
}

function filaObjeto_(h, n) {
  const tz = Session.getScriptTimeZone();
  const o = {};
  h.head.forEach((c, i) => { const v = h.values[n - 1][i]; o[c] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
  return o;
}

function filaPorId_(tabla, id) {
  const u = ubicar_(tabla, id);
  return u ? filaObjeto_(u.h, u.n) : null;
}

// Los ids no se repiten entre ligas: busca el mayor en todas las pestañas de la tabla.
function siguienteId_(tabla, pref, dig) {
  let max = 0;
  hojasDe_(tabla).forEach(sh => {
    const h = leerHoja_(sh);
    const col = h.head.indexOf('id');
    if (col < 0) return;
    for (let i = 1; i < h.values.length; i++) {
      const m = String(h.values[i][col]).match(new RegExp('^' + pref + '(\\d+)$'));
      if (m) max = Math.max(max, Number(m[1]));
    }
  });
  return pref + String(max + 1).padStart(dig, '0');
}

// Las fórmulas apuntan a las pestañas de la misma liga (Equipos_L02!, Eventos_L02!...).
// {Tabla.campo} se reemplaza por la columna completa de ese campo en la otra pestaña
// (por ejemplo D:D), buscada por el nombre del encabezado.
function formula_(plantilla, head, fila, liga) {
  const sufijo = liga ? '_' + liga : '';
  // {buscarEquipo:campo}: nombre del equipo buscándolo en todas las pestañas de Equipos,
  // porque en un torneo entre ligas los equipos vienen de pestañas distintas.
  plantilla = plantilla.replace(/\{buscarEquipo:(\w+)\}/g, (_, c) => {
    const celda = columna_(head.indexOf(c) + 1) + fila;
    return hojasDe_('Equipos').map(sh => sh.getName()).reduceRight(
      (resto, n) => 'IFERROR(INDEX(' + n + '!D:D,MATCH(' + celda + ',' + n + '!A:A,0)),' + resto + ')', '""');
  });
  return plantilla
    .replace(/\{(\w+)\.(\w+)\}/g, (_, t, c) => {
      const sh = planilla_().getSheetByName(t + sufijo) || hojasDe_(t)[0];
      const cab = sh ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      const l = columna_(cab.indexOf(c) + 1);
      return l + ':' + l;
    })
    .replace(/\b(Clubes|Equipos|Eventos)!/g, (_, t) => t + sufijo + '!')
    .replace(/\{(\w+)\}/g, (_, c) => columna_(head.indexOf(c) + 1) + fila);
}

function columna_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Los textos que empiezan con = + - @ se guardan como texto, no como fórmula.
function valorCelda_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  v = String(v).trim();
  if (/^-?\d+([.,]\d+)?$/.test(v)) return Number(v.replace(',', '.'));
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

// En un lote, "$0", "$1"... se reemplazan por el id creado en esa operación.
function resolverRefs_(obj, creados) {
  const o = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    const m = typeof v === 'string' && v.match(/^\$(\d+)$/);
    o[k] = m ? (creados[Number(m[1])] !== undefined ? creados[Number(m[1])] : '__pendiente__') : v;
  });
  return o;
}

function registrar_(email, accion, tabla, id, detalle) {
  let sh = planilla_().getSheetByName('Registro');
  if (!sh) { sh = planilla_().insertSheet('Registro'); sh.appendRow(['fecha', 'email', 'accion', 'tabla', 'id', 'detalle']); }
  sh.appendRow([new Date(), email, accion, tabla, id, JSON.stringify(detalle).slice(0, 500)]);
}

function hoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


// ---------- utilidades ----------

/**
 * Lee una tabla como lista de objetos usando la fila 1 como nombres de campo.
 * Si la tabla tiene una pestaña por liga, junta las filas de todas.
 */
function rows_(nombre) {
  if (FILAS_[nombre]) return FILAS_[nombre];
  const hojas = hojasDe_(nombre);
  if (!hojas.length) throw new Error('No existe la pestaña ' + nombre);
  const tz = Session.getScriptTimeZone();
  const todas = [];
  hojas.forEach(sh => {
    const values = sh.getDataRange().getValues();
    const head = values.shift().map(String);
    values
      .filter(r => r[0] !== '' && r[0] !== null)
      .forEach(r => {
        const o = {};
        head.forEach((h, i) => {
          if (!h) return;
          const v = r[i];
          o[h] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v;
        });
        todas.push(o);
      });
  });
  FILAS_[nombre] = todas;
  return todas;
}

function resultado_(m) {
  if (num_(m.goles_local) && num_(m.goles_visitante)) {
    return m.goles_local > m.goles_visitante ? 'L' : m.goles_local < m.goles_visitante ? 'V' : 'E';
  }
  return m.resultado_manual || '';
}

function by_(campo, valor) { return o => !valor || String(o[campo]) === String(valor); }
function ids_(lista) { return new Set(lista.map(o => o.id)); }
function num_(v) { return typeof v === 'number' && !isNaN(v); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Opcional: deja lista la respuesta de ?r=todo para que nadie espere al entrar.
 * En Apps Script: Activadores > Agregar activador > calentarCache, "Según el tiempo", cada 5 minutos.
 */
function calentarCache() {
  const version = PropertiesService.getScriptProperties().getProperty('version') || '0';
  const p = { r: 'todo' };
  cacheGuardar_(CacheService.getScriptCache(), version + JSON.stringify(p), JSON.stringify({ ok: true, data: route_(p) }));
}

/** Probá desde el editor: Ejecutar > test_ y mirá el registro. */
function test_() {
  Logger.log(JSON.stringify(posiciones_('T01').slice(0, 3)));
  Logger.log(JSON.stringify(goleadores_('T01', 5)));
}
