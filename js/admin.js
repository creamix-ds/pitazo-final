/* Panel de administración: ingreso con Google y carga de datos en la planilla.
   Los permisos reales los controla la API (backend/Code.gs); acá solo se ocultan
   las opciones que el usuario no puede usar. */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const CLAVE_TOKEN = 'lf_admin_token';
  // S.B: lo liviano de todas las ligas (ligas, clubes, equipos, torneos, usuarios).
  // S.C[liga]: jugadores, partidos, eventos y noticias de cada liga ya cargada.
  // S.T junta todo, así las secciones trabajan como si tuvieran todo.
  const S = { token: null, perfil: null, T: null, B: null, C: {}, ocupado: false };
  let $main = null;
  let rutaActual = [];

  // ---------- utilidades ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function fecha(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
  }
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const aviso = t => (window.LF && window.LF.aviso ? window.LF.aviso(t) : alert(t));
  const ir = h => { if (location.hash === h) mostrar($main, rutaActual); else location.hash = h; };

  const T = n => (S.T && S.T[n]) || [];
  const porId = (n, id) => T(n).find(x => String(x.id) === String(id));
  const esDev = () => S.T && S.T.usuario.rol === 'dev';
  const misClubes = () => esDev() ? T('clubes') : T('clubes').filter(c => S.T.usuario.clubes.indexOf(String(c.id)) >= 0);
  // Equipos de un torneo según su columna "participantes" (ligas L.., clubes CL.., equipos E..).
  // Vacía = toda la liga del torneo. Se toman los equipos de la categoría del torneo.
  function participantesDe(t, visto) {
    if (!t) return [];
    const deCategoria = e => !t.categoria || !e.categoria || e.categoria === t.categoria;
    // Fase final ("clasifica": T08:1-8 o clubes en orden): para elegir equipos alcanza con todos los del torneo de origen.
    if (String(t.clasifica || '').trim()) {
      visto = visto || new Set([t.id]);
      const ids = [];
      String(t.clasifica).split(/[,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean).forEach(seg => {
        const m = seg.match(/^(T\d+)\s*:/);
        if (m) { if (!visto.has(m[1])) { visto.add(m[1]); participantesDe(porId('torneos', m[1]), visto).forEach(e => ids.push(e)); } return; }
        if (/^CL\d+$/.test(seg)) T('equipos').filter(e => deCategoria(e) && String(e.club_id) === seg).forEach(e => ids.push(String(e.id)));
        else if (porId('equipos', seg)) ids.push(seg);
      });
      return [...new Set(ids)];
    }
    const tokens = sinZonas(t.participantes).split(/[\s,;]+/).filter(Boolean);
    const ids = new Set();
    (tokens.length ? tokens : [t.liga_id]).forEach(k => {
      const K = String(k).toUpperCase();
      if (/^L\d+$/.test(K)) T('equipos').filter(e => deCategoria(e) && (porId('clubes', e.club_id) || {}).liga_id === K).forEach(e => ids.add(String(e.id)));
      else if (/^CL\d+$/.test(K)) T('equipos').filter(e => deCategoria(e) && String(e.club_id) === K).forEach(e => ids.add(String(e.id)));
      else if (porId('equipos', K)) ids.add(K);
    });
    return [...ids];
  }
  // Fase de grupos: la columna "zonas" reparte los equipos ("Zona A: CL02, CL04; Zona B: CL05, CL07").
  // "participantes" sigue con la lista completa, así la API valida igual que siempre.
  const esGrupos = t => !!t && String(t.tipo || '').toLowerCase() === 'grupos';
  const sinZonas = texto => String(texto || '').replace(/(^|;)\s*[^:;,]*:/g, '$1 ');
  function zonasDeTexto(texto) {
    const r = { nombres: [], club: {}, liga: {} };
    String(texto || '').split(';').forEach(seg => {
      const m = seg.match(/^([^:]+):(.*)$/);
      if (!m) return;
      const n = m[1].trim();
      r.nombres.push(n);
      m[2].split(/[\s,]+/).filter(Boolean).forEach(k => { const K = k.toUpperCase(); if (/^L\d+$/.test(K)) r.liga[K] = n; else r.club[K] = n; });
    });
    return r;
  }
  function gruposDe(t) {
    if (!esGrupos(t)) return [{ nombre: '', eids: participantesDe(t) }];
    const out = [];
    String(t.zonas || '').split(';').forEach(seg => {
      const m = seg.match(/^([^:]+):(.*)$/);
      if (m && m[2].trim()) out.push({ nombre: m[1].trim(), eids: participantesDe(Object.assign({}, t, { participantes: m[2], clasifica: '' })) });
    });
    return out;
  }
  const ligasDeTorneo = t => [...new Set(participantesDe(t).map(eid => (porId('clubes', (porId('equipos', eid) || {}).club_id) || {}).liga_id).filter(Boolean))];
  const misLigas = () => esDev() ? T('ligas') : T('ligas').filter(l => S.T.usuario.ligas.indexOf(String(l.id)) >= 0);
  const misEquipos = () => { const c = new Set(misClubes().map(x => String(x.id))); return T('equipos').filter(e => c.has(String(e.club_id))); };
  const esMiEquipo = eid => esDev() || misEquipos().some(e => String(e.id) === String(eid));
  const clubDeEquipo = eid => { const e = porId('equipos', eid); return e ? porId('clubes', e.club_id) : null; };
  const nombreEquipo = eid => {
    const e = porId('equipos', eid); const c = e && porId('clubes', e.club_id);
    if (!c) return eid || '';
    const cats = T('equipos').filter(x => x.club_id === e.club_id).length;
    return cats > 1 && e.categoria ? `${c.nombre} (${e.categoria})` : c.nombre;
  };
  const nombreJugador = j => j ? `${j.nombre || ''} ${j.apellido || ''}`.trim() : 'Sin identificar';
  const golesDe = jid => T('eventos').filter(e => e.jugador_id === jid && e.tipo === 'Gol').length;

  function decodificar(token) {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(Array.from(atob(b)).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  }
  function leerSesion() {
    if (S.token) return;
    try {
      const t = sessionStorage.getItem(CLAVE_TOKEN);
      if (!t) return;
      const p = decodificar(t);
      if (p.exp * 1000 > Date.now() + 30000) { S.token = t; S.perfil = p; } else sessionStorage.removeItem(CLAVE_TOKEN);
    } catch (e) { /* sin sesión */ }
  }
  function cerrarSesion(mensaje) {
    S.token = null; S.perfil = null; S.T = null; S.B = null; S.C = {};
    try { sessionStorage.removeItem(CLAVE_TOKEN); } catch (e) {}
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) {}
    vistaIngreso(mensaje);
  }

  async function api(cuerpo) {
    // Si la planilla no responde en 45 s se corta, así el panel no queda trabado.
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 45000);
    let j;
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: S.token }, cuerpo)),
        signal: corte.signal
      });
      j = await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('La planilla tardó demasiado en responder. Revisá si el cambio quedó guardado antes de repetirlo.');
      throw new Error('No hay conexión con la planilla. Probá de nuevo en unos segundos.');
    } finally { clearTimeout(reloj); }
    if (!j.ok) {
      if (/sesión vencida|no corresponde/i.test(j.error)) { cerrarSesion(j.error); throw new Error('__sesion__'); }
      throw new Error(j.error || 'No se pudo guardar.');
    }
    return j.data;
  }

  // Aplica cambios y refresca los datos. Devuelve los ids creados.
  async function guardar(ops, mensaje) {
    if (S.ocupado) return null;
    S.ocupado = true; marcarOcupado(true);
    try {
      ops.forEach(op => { if (!op.liga) { const l = ligaDeOp(op); if (l) op.liga = l; } });
      const datos = await api({ accion: 'admin_lote', ops });
      if (datos.cambios) {
        // La API devuelve solo las filas que cambiaron: se aplican sobre lo que ya está cargado.
        aplicarCambios(datos.cambios);
        if (window.LF && window.LF.aplicar) window.LF.aplicar(datos.cambios);
        else if (window.LF && window.LF.recargar) window.LF.recargar();
      }
      if (mensaje) aviso(mensaje);
      return datos.creados || [];
    } catch (e) {
      if (e.message !== '__sesion__') aviso(e.message);
      return null;
    } finally {
      S.ocupado = false; marcarOcupado(false);
    }
  }
  function aplicarCambios(cambios) {
    cambios.forEach(c => {
      const k = c.tabla.toLowerCase();
      const lista = ['ligas', 'clubes', 'equipos', 'torneos', 'usuarios'].includes(k) ? S.B[k] : (S.C[c.liga] || {})[k];
      if (!lista) return;
      const id = c.op === 'borrar' ? c.id : c.fila.id;
      const i = lista.findIndex(x => String(x.id) === String(id));
      if (c.op === 'borrar') { if (i >= 0) lista.splice(i, 1); return; }
      if (i >= 0) lista[i] = Object.assign({}, lista[i], c.fila); else lista.push(c.fila);
    });
    unir();
  }
  function unir() {
    const B = S.B;
    S.T = { usuario: B.usuario, valores: B.valores, ligas: B.ligas, clubes: B.clubes, equipos: B.equipos, torneos: B.torneos, usuarios: B.usuarios, jugadores: [], partidos: [], eventos: [], noticias: [] };
    Object.keys(S.C).forEach(l => ['jugadores', 'partidos', 'eventos', 'noticias'].forEach(k => { S.T[k] = S.T[k].concat(S.C[l][k] || []); }));
  }
  // Liga en la que vive el dato que toca una operación (la API la usa para ir directo a su planilla).
  function ligaDeOp(op) {
    const f = Object.assign({}, op.op === 'crear' ? {} : (porId(op.tabla.toLowerCase(), op.id) || {}), op.op === 'crear' ? op.fila : {});
    const ligaClub = cid => (porId('clubes', cid) || {}).liga_id;
    const ligaEquipo = eid => ligaClub((porId('equipos', eid) || {}).club_id);
    const ligaTorneo = tid => (porId('torneos', tid) || {}).liga_id;
    switch (op.tabla) {
      case 'Clubes': case 'Torneos': case 'Noticias': return f.liga_id || (op.cambios || {}).liga_id;
      case 'Equipos': return ligaClub(f.club_id);
      case 'Jugadores': return ligaEquipo(f.equipo_id);
      case 'Partidos': return ligaTorneo(f.torneo_id);
      case 'Eventos': return ligaTorneo((porId('partidos', f.partido_id) || {}).torneo_id);
    }
    return '';
  }
  // Trae el detalle de las ligas que falten.
  async function asegurar(lids) {
    const faltan = [...new Set(lids.filter(Boolean))].filter(l => !S.C[l] && T('ligas').some(x => x.id === l));
    if (!faltan.length) return;
    const r = await api({ accion: 'admin_ligas', ligas: faltan });
    Object.assign(S.C, r.detalle || {});
    unir();
  }
  function marcarOcupado(si) {
    document.body.classList.toggle('guardando', si);
    document.querySelectorAll('[data-guardar]').forEach(b => { b.disabled = si; });
  }

  // ---------- entrada ----------
  function mostrar(main, partes) {
    $main = main; rutaActual = partes || [];
    cerrarCajon();
    leerSesion();
    if (!CFG.API_URL || !CFG.GOOGLE_CLIENT_ID) return vistaSinConfigurar();
    if (!S.token) return vistaIngreso();
    if (!S.T) return iniciar();
    vistaPanel();
  }

  function vistaSinConfigurar() {
    $main.innerHTML = `${banda('Panel de clubes', 'Carga de resultados, planteles y noticias.')}
      <div class="contenedor pagina"><section class="panel" style="max-width:720px"><div class="panel__cuerpo">
        <h2>El panel todavía no está conectado</h2>
        <p style="margin-top:8px">Para usarlo hacen falta dos datos en <code>js/config.js</code>:</p>
        <ul class="lista-pasos">
          <li><b>API_URL</b>: ${CFG.API_URL ? 'configurada.' : 'la URL /exec de la aplicación web de Apps Script.'}</li>
          <li><b>GOOGLE_CLIENT_ID</b>: ${CFG.GOOGLE_CLIENT_ID ? 'configurado.' : 'el ID de cliente OAuth de Google para el ingreso.'}</li>
        </ul>
        <p class="nota" style="margin:12px 0 0">Los pasos están en el README del repositorio, en la sección "Panel de administración".</p>
      </div></section></div>`;
  }

  function banda(titulo, sub, extra) {
    return `<section class="banda"><div class="contenedor" style="padding-bottom:${extra ? 0 : 28}px">
      <div class="banda__fila"><div><h1>${esc(titulo)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra && extra.derecha ? extra.derecha : ''}</div>
      ${extra && extra.pestanas ? extra.pestanas : ''}</div></section>`;
  }

  function vistaIngreso(mensaje) {
    $main.innerHTML = `${banda('Panel de clubes', 'Ingresá con la cuenta de Google que la liga registró para tu club.')}
      <div class="contenedor pagina"><section class="panel ingreso"><div class="panel__cuerpo">
        <h2>Ingresar</h2>
        <p>Usá el mismo email que figura en la lista de usuarios de la plataforma. Si no lo tenés, pedíselo al administrador de tu liga.</p>
        ${mensaje ? `<p class="error-form" role="alert">${esc(mensaje)}</p>` : ''}
        <div id="boton-google" class="boton-google"><span class="nota" style="margin:0">Cargando el ingreso con Google…</span></div>
      </div></section></div>`;
    cargarGoogle().then(() => {
      const el = document.getElementById('boton-google');
      if (!el) return;
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: r => alIngresar(r.credential), auto_select: false, cancel_on_tap_outside: true });
      el.innerHTML = '';
      google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'es', width: 300 });
    }).catch(e => {
      const el = document.getElementById('boton-google');
      if (el) el.innerHTML = `<p class="error-form">${esc(e.message)}</p>`;
    });
  }

  function cargarGoogle() {
    return new Promise((ok, mal) => {
      if (window.google && google.accounts && google.accounts.id) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => mal(new Error('No se pudo cargar el ingreso con Google. Revisá tu conexión o desactivá el bloqueador de anuncios para este sitio.'));
      document.head.appendChild(s);
    });
  }

  async function alIngresar(token) {
    S.token = token;
    try { S.perfil = decodificar(token); sessionStorage.setItem(CLAVE_TOKEN, token); } catch (e) {}
    await iniciar();
  }

  async function iniciar() {
    $main.innerHTML = `${banda('Panel de clubes', 'Verificando tu acceso…')}<div class="contenedor pagina"><p class="vacio">Cargando datos…</p></div>`;
    try {
      const datos = await api({ accion: 'admin_datos' });
      S.C = datos.detalle || {};
      delete datos.detalle;
      S.B = datos;
      unir();
      vistaPanel();
    } catch (e) {
      if (e.message === '__sesion__') return;
      S.token = null; try { sessionStorage.removeItem(CLAVE_TOKEN); } catch (x) {}
      vistaIngreso(e.message);
    }
  }

  // ---------- panel ----------
  function secciones() {
    if (esDev()) return [['resultados', 'Resultados'], ['fixture', 'Fixture'], ['plantel', 'Planteles'], ['clubes', 'Clubes'], ['noticias', 'Noticias'], ['torneos', 'Torneos'], ['ligas', 'Ligas'], ['usuarios', 'Usuarios']];
    return [['resultados', 'Resultados'], ['plantel', 'Plantel'], ['club', misClubes().length > 1 ? 'Mis clubes' : 'Mi club'], ['noticias', 'Noticias']];
  }

  function vistaPanel() {
    const u = S.T.usuario;
    const lista = secciones();
    const sec = lista.some(s => s[0] === rutaActual[0]) ? rutaActual[0] : 'resultados';
    const quien = esDev() ? 'Desarrollador' : misClubes().map(c => c.nombre).join(', ');
    const foto = S.perfil && S.perfil.picture ? `<img src="${esc(S.perfil.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc((u.nombre || u.email).slice(0, 1).toUpperCase())}</span>`;
    $main.innerHTML = banda('Panel de clubes', '', {
      derecha: `<div class="sesion"><div class="sesion__foto">${foto}</div><div><b>${esc(u.nombre || u.email)}</b><small>${esc(quien)}</small></div>
        <button class="boton boton--claro" id="btn-salir" type="button">Salir</button></div>`,
      pestanas: `<nav class="pestanas" aria-label="Secciones del panel">${lista.map(([k, n]) => `<a href="#/admin/${k}" ${k === sec ? 'aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`
    }) + '<div class="contenedor pagina" id="admin-cuerpo"></div>';
    document.getElementById('btn-salir').addEventListener('click', () => { cerrarSesion('Cerraste la sesión.'); location.hash = '#/admin'; });
    const $c = document.getElementById('admin-cuerpo');
    const faltan = ligasPara(sec).filter(l => !S.C[l]);
    if (faltan.length) {
      $c.innerHTML = '<p class="vacio">Cargando datos de la liga…</p>';
      asegurar(faltan).then(() => { if (document.getElementById('admin-cuerpo') === $c) vistaPanel(); })
        .catch(e => { if (e.message !== '__sesion__') $c.innerHTML = `<p class="vacio">${esc(e.message)}</p>`; });
      return;
    }
    ({ resultados: secResultados, fixture: secFixture, plantel: secPlantel, club: secMiClub, clubes: secClubes, noticias: secNoticias, torneos: secTorneos, ligas: secLigas, usuarios: secUsuarios }[sec])($c, rutaActual.slice(1));
  }

  // Ligas que necesita cada sección del panel.
  function ligasPara(sec) {
    if (sec === 'resultados' || sec === 'fixture') {
      const t = porId('torneos', torneoElegido());
      return t ? [t.liga_id].concat(ligasDeTorneo(t)) : [];
    }
    if (sec === 'plantel') { const c = clubElegido(); return c ? [c.liga_id] : []; }
    if (sec === 'noticias') return ligasNoticias().map(l => l.id);
    return [];
  }
  function clubElegido() {
    const clubes = misClubes().slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!filtro.club || !clubes.some(c => c.id === filtro.club)) filtro.club = (clubes[0] || {}).id;
    return porId('clubes', filtro.club);
  }
  // Un admin de club ve las noticias de sus ligas; dev, las de la liga elegida en el filtro.
  function ligasNoticias() {
    const ligas = misLigas();
    if (!esDev()) return ligas;
    if (!filtro.ligaNoticias || !ligas.some(l => l.id === filtro.ligaNoticias)) filtro.ligaNoticias = (ligas[0] || {}).id;
    return ligas.filter(l => l.id === filtro.ligaNoticias);
  }

  // ---------- componentes de formulario ----------
  // campo: { k, l, t: texto|num|fecha|hora|url|email|area|select, op: [[valor, etiqueta]], req, ayuda, ancho: 'medio' }
  function formulario(campos, fila) {
    return `<div class="grilla-form">${campos.map(c => {
      const v = fila[c.k] == null ? '' : fila[c.k];
      const id = 'f-' + c.k;
      const comun = `id="${id}" name="${c.k}" ${c.req ? 'required' : ''} ${c.solo === 'lectura' ? 'disabled' : ''}`;
      if (c.t === 'oculto') return `<input type="hidden" id="${id}" name="${c.k}" value="${esc(v)}">`;
      let control;
      if (c.t === 'select') control = `<select ${comun}>${(typeof c.op === 'function' ? c.op() : c.op).map(([val, et]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(et)}</option>`).join('')}</select>`;
      else if (c.t === 'area') control = `<textarea ${comun} rows="${c.filas || 4}">${esc(v)}</textarea>`;
      else {
        const tipo = { num: 'number', fecha: 'date', hora: 'time', url: 'url', email: 'email' }[c.t] || 'text';
        control = `<input type="${tipo}" ${comun} value="${esc(v)}" ${c.t === 'num' ? `step="${c.paso || 1}" inputmode="decimal"` : ''} ${c.ph ? `placeholder="${esc(c.ph)}"` : ''}>`;
      }
      return `<div class="campo${c.ancho === 'medio' ? ' campo--medio' : ''}"><label for="${id}">${esc(c.l)}${c.req ? ' <span aria-hidden="true">*</span>' : ''}</label>${control}${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</div>`;
    }).join('')}</div>`;
  }
  function leerFormulario(form, campos) {
    const o = {};
    campos.forEach(c => {
      if (c.solo === 'lectura') return;
      const el = form.elements[c.k]; if (!el) return;
      let v = el.value.trim();
      if (c.t === 'num') v = v === '' ? '' : Number(v);
      o[c.k] = v;
    });
    return o;
  }
  function cambiosEntre(antes, despues) {
    const c = {};
    Object.keys(despues).forEach(k => { if (String(antes[k] == null ? '' : antes[k]) !== String(despues[k])) c[k] = despues[k]; });
    return c;
  }

  // Cajón lateral para editar
  function abrirCajon(titulo, cuerpo, alMontar, ancho, sinFoco) {
    cerrarCajon();
    const velo = document.createElement('div');
    velo.className = 'velo'; velo.id = 'cajon';
    velo.innerHTML = `<aside class="cajon${ancho ? ' cajon--ancho' : ''}${sinFoco ? ' cajon--quieto' : ''}" role="dialog" aria-modal="true" aria-labelledby="cajon-titulo">
      <header class="cajon__cabeza"><h2 id="cajon-titulo">${titulo}</h2><button type="button" class="cajon__cerrar" aria-label="Cerrar">×</button></header>
      <div class="cajon__cuerpo">${cuerpo}</div></aside>`;
    document.body.appendChild(velo);
    document.body.classList.add('con-cajon');
    const volver = document.activeElement;
    const cerrar = () => { cerrarCajon(); const base = '#/admin/' + (rutaActual[0] || 'resultados'); if (rutaActual.length > 1) history.replaceState(null, '', base); if (volver && volver.focus) volver.focus(); };
    velo.addEventListener('click', e => { if (e.target === velo) cerrar(); });
    velo.querySelector('.cajon__cerrar').addEventListener('click', cerrar);
    velo.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
    if (!sinFoco) {
      const primero = velo.querySelector('.cajon__cuerpo input:not([type=radio]), .cajon__cuerpo select, .cajon__cuerpo textarea');
      (primero || velo.querySelector('.cajon__cerrar')).focus({ preventScroll: true });
    } else velo.querySelector('.cajon__cerrar').focus({ preventScroll: true });
    if (alMontar) alMontar(velo.querySelector('.cajon__cuerpo'), cerrar);
    return cerrar;
  }
  function cerrarCajon() {
    const v = document.getElementById('cajon'); if (v) v.remove();
    document.body.classList.remove('con-cajon');
  }

  // Lista + formulario genérico para una tabla
  function editorTabla($c, cfg) {
    const items = cfg.items();
    $c.innerHTML = `<section class="panel">
      <div class="panel__cabeza"><h2>${esc(cfg.titulo)}</h2>${cfg.puedeCrear === false ? '' : `<button class="boton boton--primario" type="button" id="btn-nuevo">${esc(cfg.nuevoTexto || 'Agregar')}</button>`}</div>
      ${cfg.filtros || ''}
      ${items.length ? `<ul class="lista-admin">${items.map(it => { const r = cfg.resumen(it); return `<li><button type="button" class="fila-admin" data-id="${esc(it[cfg.clave || 'id'])}">
        ${r.icono || ''}<span class="fila-admin__texto"><b>${esc(r.t)}</b>${r.s ? `<small>${r.s}</small>` : ''}</span>${r.der ? `<span class="fila-admin__der">${r.der}</span>` : ''}</button></li>`; }).join('')}</ul>`
        : `<p class="vacio" style="padding:24px 16px">${esc(cfg.vacio || 'Todavía no hay datos cargados.')}</p>`}
    </section>${cfg.pie || ''}`;
    if (cfg.alMontar) cfg.alMontar($c);
    const nuevo = $c.querySelector('#btn-nuevo');
    if (nuevo) nuevo.addEventListener('click', () => abrirFormTabla(cfg, null));
    $c.querySelectorAll('.fila-admin').forEach(b => b.addEventListener('click', () => abrirFormTabla(cfg, items.find(x => String(x[cfg.clave || 'id']) === b.dataset.id))));
  }

  function abrirFormTabla(cfg, item) {
    const nuevo = !item;
    const base = nuevo ? Object.assign({}, cfg.porDefecto ? cfg.porDefecto() : {}) : item;
    const campos = typeof cfg.campos === 'function' ? cfg.campos(base, nuevo) : cfg.campos;
    const soloLectura = !nuevo && cfg.puedeEditar && !cfg.puedeEditar(item);
    const borrable = !nuevo && cfg.puedeBorrar && cfg.puedeBorrar(item);
    abrirCajon(nuevo ? esc(cfg.nuevoTexto || 'Agregar') : esc(cfg.resumen(item).t),
      `<form id="form-tabla" novalidate>${formulario(campos.map(c => soloLectura ? Object.assign({}, c, { solo: 'lectura' }) : c), base)}
        ${cfg.extraForm ? cfg.extraForm(item) : ''}
        <p class="error-form" id="error-form" role="alert" hidden></p>
        <div class="acciones acciones--form">
          ${soloLectura ? '<p class="nota" style="margin:0">Solo lectura: no tenés permiso para modificar esto.</p>' : `<button class="boton boton--primario" type="submit" data-guardar>${nuevo ? 'Guardar' : 'Guardar cambios'}</button>`}
          ${borrable ? `<button class="boton boton--peligro" type="button" id="btn-borrar" data-guardar>${esc(cfg.borrarTexto || 'Borrar')}</button>` : ''}
        </div></form>`,
      (cuerpo, cerrar) => {
        const form = cuerpo.querySelector('#form-tabla');
        if (cfg.alMontarForm) cfg.alMontarForm(form, item);
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          const $err = form.querySelector('#error-form');
          const faltan = campos.filter(c => c.req && !String(form.elements[c.k].value).trim()).map(c => c.l);
          if (faltan.length) { $err.hidden = false; $err.textContent = 'Completá: ' + faltan.join(', ') + '.'; return; }
          const datos = leerFormulario(form, campos);
          let ops;
          if (nuevo) ops = [{ op: 'crear', tabla: cfg.tabla, fila: datos }];
          else {
            const cambios = cambiosEntre(item, datos);
            if (!Object.keys(cambios).length) { cerrar(); return; }
            ops = [{ op: 'editar', tabla: cfg.tabla, id: item[cfg.clave || 'id'], cambios }];
          }
          const r = await guardar(ops, nuevo ? 'Guardado.' : 'Cambios guardados.');
          if (r) { cerrar(); vistaPanel(); }
        });
        const b = cuerpo.querySelector('#btn-borrar');
        if (b) b.addEventListener('click', async () => {
          if (!confirm(cfg.confirmarBorrar || '¿Seguro que querés borrarlo? No se puede deshacer.')) return;
          const r = await guardar([{ op: 'borrar', tabla: cfg.tabla, id: item[cfg.clave || 'id'] }], 'Borrado.');
          if (r) { cerrar(); vistaPanel(); }
        });
      });
  }

  // ---------- opciones de listas ----------
  const SI_NO = [['SI', 'Sí'], ['NO', 'No']];
  const POSICIONES = [['', 'Sin dato'], ['Arquero', 'Arquero'], ['Defensor', 'Defensor'], ['Mediocampista', 'Mediocampista'], ['Delantero', 'Delantero']];
  const CATEGORIAS = ['Primera', 'Reserva', 'Sub 21', 'Sub 17', 'Sub 15', 'Femenino', 'Femenino Sub 16', 'Veteranos'];
  const ESTADOS = ['Programado', 'En juego', 'Finalizado', 'Postergado'];
  const PROVINCIAS = ['Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Ciudad de Buenos Aires', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
  const opLigas = vacio => (vacio ? [['', 'Ninguna']] : []).concat(misLigas().map(l => [l.id, l.nombre]));
  const opClubes = (vacio, lid) => (vacio ? [['', 'Ninguno']] : []).concat(T('clubes').filter(c => !lid || c.liga_id === lid).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => [c.id, c.nombre]));
  const opEquipos = lista => lista.slice().sort((a, b) => nombreEquipo(a.id).localeCompare(nombreEquipo(b.id))).map(e => [e.id, nombreEquipo(e.id)]);
  const juegaAlgunoMio = t => { const mios = new Set(T('equipos').filter(e => misClubes().some(c => String(c.id) === String(e.club_id))).map(e => String(e.id))); return participantesDe(t).some(e => mios.has(e)); };
  const opTorneos = () => T('torneos').filter(t => esDev() || misLigas().some(l => l.id === t.liga_id) || juegaAlgunoMio(t)).map(t => [t.id, `${t.nombre} ${t.temporada}${t.categoria ? ', ' + t.categoria : ''}`]);

  function selectorEn($c, id, etiqueta, opciones, valor, alCambiar) {
    if (opciones.length < 2) return '';
    setTimeout(() => { const s = $c.querySelector('#' + id); if (s) s.addEventListener('change', () => alCambiar(s.value)); });
    return `<label class="filtro"><span>${esc(etiqueta)}</span><select id="${id}">${opciones.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(valor) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  }

  // ---------- Resultados ----------
  const filtro = { torneo: null, fecha: null, club: null, verInactivos: false, liga: null, ligaNoticias: null };
  function torneoElegido() {
    const ops = opTorneos();
    if (!filtro.torneo || !ops.some(o => o[0] === filtro.torneo)) {
      const conPend = ops.find(([tid]) => {
        const t = porId('torneos', tid);
        return t && (S.C[t.liga_id] ? T('partidos').some(p => p.torneo_id === tid && p.estado !== 'Finalizado') : t._pend > 0);
      });
      filtro.torneo = (conPend || ops[ops.length - 1] || [null])[0];
    }
    return filtro.torneo;
  }
  function chipEstado(p) {
    const cls = { 'En juego': 'vivo', 'Finalizado': 'fin', 'Postergado': 'post' }[p.estado] || 'prog';
    return `<span class="chip-estado chip-estado--${cls}">${esc(p.estado || 'Programado')}</span>`;
  }
  function marcadorTexto(p) {
    if (num(p.goles_local) != null && num(p.goles_visitante) != null) return `${p.goles_local} - ${p.goles_visitante}`;
    if (p.resultado_manual) return { L: 'Ganó local', E: 'Empate', V: 'Ganó visitante' }[p.resultado_manual] || '';
    return 'vs';
  }

  function secResultados($c, resto) {
    const tid = torneoElegido();
    if (!tid) { $c.innerHTML = '<p class="vacio">No hay torneos cargados todavía.</p>'; return; }
    let partidos = T('partidos').filter(p => p.torneo_id === tid);
    const fechas = [...new Set(partidos.map(p => num(p.fecha_nro)))].filter(n => n != null).sort((a, b) => a - b);
    const pendiente = fechas.find(f => partidos.some(p => num(p.fecha_nro) === f && p.estado !== 'Finalizado'));
    if (esDev()) {
      if (filtro.fecha == null || !fechas.includes(filtro.fecha)) filtro.fecha = pendiente != null ? pendiente : fechas[fechas.length - 1];
      partidos = partidos.filter(p => num(p.fecha_nro) === filtro.fecha);
    } else {
      partidos = partidos.filter(p => esMiEquipo(p.local_id) || esMiEquipo(p.visitante_id));
    }
    partidos.sort((a, b) => num(a.fecha_nro) - num(b.fecha_nro));
    const proximo = partidos.find(p => p.estado !== 'Finalizado');
    $c.innerHTML = `<section class="panel">
      <div class="panel__cabeza"><h2>${esDev() ? `Fecha ${filtro.fecha}` : 'Partidos de tu club'}</h2>
        ${selectorEn($c, 'sel-torneo', 'Torneo', opTorneos(), tid, v => { filtro.torneo = v; filtro.fecha = null; vistaPanel(); })}</div>
      ${esDev() ? `<nav class="fechas" aria-label="Elegir fecha">${fechas.map(f => `<a href="#" data-fecha="${f}" ${f === filtro.fecha ? 'aria-current="page"' : ''}>F${f}</a>`).join('')}</nav>` : ''}
      ${partidos.length ? `<ul class="lista-admin">${partidos.map(p => `<li><button type="button" class="fila-admin fila-partido${proximo && p.id === proximo.id ? ' es-proximo' : ''}" data-id="${esc(p.id)}">
          <span class="fila-partido__fecha">F${esc(p.fecha_nro)}<small>${fecha(p.fecha_jugada || p.fecha_programada)}</small></span>
          <span class="fila-partido__equipos"><span>${esc(nombreEquipo(p.local_id))}</span><b>${esc(marcadorTexto(p))}</b><span>${esc(nombreEquipo(p.visitante_id))}</span></span>
          ${chipEstado(p)}<span class="fila-admin__accion">Cargar</span></button></li>`).join('')}</ul>`
        : '<p class="vacio" style="padding:24px 16px">No hay partidos para mostrar.</p>'}
    </section>
    <p class="nota" style="margin-left:0">Durante el partido, marcalo "En juego" y cargá cada gol: quienes siguen a los equipos reciben el aviso.</p>`;
    $c.querySelectorAll('[data-fecha]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); filtro.fecha = Number(a.dataset.fecha); vistaPanel(); }));
    $c.querySelectorAll('.fila-partido').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#/admin/resultados/' + b.dataset.id); rutaActual = ['resultados', b.dataset.id]; editorPartido(b.dataset.id); }));
    if (resto[0] && porId('partidos', resto[0])) editorPartido(resto[0]);
  }

  function editorPartido(pid) {
    const p = porId('partidos', pid);
    if (!p) return;
    const previo = document.querySelector('#cajon .cajon__cuerpo');
    const scrollPrevio = previo ? previo.scrollTop : 0;
    const reabrir = !!previo;
    const torneo = porId('torneos', p.torneo_id);
    const L = p.local_id, V = p.visitante_id;
    const eventos = T('eventos').filter(e => e.partido_id === pid);
    const gl = num(p.goles_local), gv = num(p.goles_visitante);
    const jugadoresDe = eid => T('jugadores').filter(j => j.equipo_id === eid && j.activo !== 'NO').sort((a, b) => (num(a.numero) || 999) - (num(b.numero) || 999) || String(a.apellido).localeCompare(b.apellido));
    const icono = t => `<span class="ev-icono ev-icono--${{ 'Gol': 'gol', 'Gol en contra': 'gc', 'Amarilla': 'am', 'Roja': 'roja' }[t]}" aria-hidden="true"></span>`;
    const lado = (eid, goles, campo) => `<div class="ed-lado">
        <span class="ed-equipo">${esc(nombreEquipo(eid))}</span>
        <div class="ed-stepper">
          <button type="button" data-guardar data-sumar="${campo}" data-delta="-1" aria-label="Restar un gol a ${esc(nombreEquipo(eid))}" ${!goles ? 'disabled' : ''}>−</button>
          <output aria-live="polite">${goles == null ? '–' : goles}</output>
          <button type="button" data-guardar data-sumar="${campo}" data-delta="1" aria-label="Sumar un gol a ${esc(nombreEquipo(eid))}">+</button>
        </div></div>`;
    const cuerpo = `
      <p class="ed-sub">${torneo ? esc(torneo.nombre) + ', ' : ''}fecha ${esc(p.fecha_nro)}, ${fecha(p.fecha_jugada || p.fecha_programada) || 'sin fecha'}</p>
      <div class="ed-marcador">${lado(L, gl, 'goles_local')}<span class="ed-vs">-</span>${lado(V, gv, 'goles_visitante')}</div>
      <fieldset class="segmentos"><legend>Estado del partido</legend>
        ${ESTADOS.map(e => `<button type="button" data-guardar data-estado="${e}" aria-pressed="${p.estado === e}">${e}</button>`).join('')}
      </fieldset>
      <h3 class="ed-titulo">Goles y tarjetas</h3>
      ${eventos.length ? `<ul class="ed-eventos">${eventos.map(e => { const j = porId('jugadores', e.jugador_id); return `<li>${icono(e.tipo)}
        <span><b>${esc(nombreJugador(j))}</b><small>${esc(e.tipo)}${e.minuto !== '' && e.minuto != null ? `, ${esc(e.minuto)}'` : ''}, ${esc(nombreEquipo(e.equipo_id))}</small></span>
        <button type="button" class="boton boton--chico" data-guardar data-quitar="${esc(e.id)}">Quitar</button></li>`; }).join('')}</ul>` : '<p class="nota" style="margin:0 0 12px">Todavía no hay goles ni tarjetas cargados.</p>'}
      <form class="ed-nuevo" id="form-evento">
        <div class="segmentos segmentos--equipo" role="radiogroup" aria-label="Equipo del jugador">
          <label><input type="radio" name="equipo" value="${esc(L)}" checked><span>${esc(nombreEquipo(L))}</span></label>
          <label><input type="radio" name="equipo" value="${esc(V)}"><span>${esc(nombreEquipo(V))}</span></label>
        </div>
        <div class="grilla-form">
          <div class="campo campo--medio"><label for="ev-tipo">Tipo</label><select id="ev-tipo" name="tipo">
            <option>Gol</option><option>Gol en contra</option><option>Amarilla</option><option>Roja</option></select></div>
          <div class="campo campo--medio"><label for="ev-min">Minuto</label><input id="ev-min" name="minuto" type="number" min="0" max="130" inputmode="numeric" placeholder="Opcional"></div>
          <div class="campo"><label for="ev-jugador">Jugador</label><select id="ev-jugador" name="jugador"></select></div>
          <div class="campo campo--medio" data-nuevo hidden><label for="ev-nombre">Nombre</label><input id="ev-nombre" name="nombre"></div>
          <div class="campo campo--medio" data-nuevo hidden><label for="ev-apellido">Apellido *</label><input id="ev-apellido" name="apellido"></div>
        </div>
        <p class="nota" style="margin:0 0 10px" id="ev-ayuda">El gol suma automáticamente al marcador.</p>
        <button class="boton boton--primario" type="submit" data-guardar>Registrar</button>
      </form>
      <details class="ed-mas"${p.estado === 'Postergado' ? ' open' : ''}><summary>Fecha, cancha y otros datos</summary>
        <form id="form-datos-partido">${formulario(camposDatosPartido(), p)}
          <div class="acciones acciones--form"><button class="boton boton--primario" type="submit" data-guardar>Guardar datos</button></div></form>
      </details>`;
    abrirCajon(`${esc(nombreEquipo(L))} <span class="ed-contra">vs</span> ${esc(nombreEquipo(V))}`, cuerpo, (c) => {
      const form = c.querySelector('#form-evento');
      const $jug = form.querySelector('#ev-jugador');
      const llenarJugadores = () => {
        const eid = form.elements.equipo.value;
        const puedeCrear = esMiEquipo(eid);
        $jug.innerHTML = `<option value="">Sin identificar</option>${jugadoresDe(eid).map(j => `<option value="${esc(j.id)}">${j.numero ? esc(j.numero) + '. ' : ''}${esc(nombreJugador(j))}</option>`).join('')}${puedeCrear ? '<option value="__nuevo__">Otro: agregar al plantel…</option>' : ''}`;
        mostrarNuevo();
      };
      const mostrarNuevo = () => form.querySelectorAll('[data-nuevo]').forEach(x => { x.hidden = $jug.value !== '__nuevo__'; });
      const ayuda = () => {
        const t = form.elements.tipo.value;
        form.querySelector('#ev-ayuda').textContent = t === 'Gol' ? 'El gol suma automáticamente al marcador.' : t === 'Gol en contra' ? 'Elegí el equipo del jugador que lo hizo: el gol suma al rival.' : 'Las tarjetas no cambian el marcador.';
      };
      form.querySelectorAll('input[name="equipo"]').forEach(r => r.addEventListener('change', llenarJugadores));
      $jug.addEventListener('change', mostrarNuevo);
      form.elements.tipo.addEventListener('change', ayuda);
      llenarJugadores();

      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const eid = form.elements.equipo.value, tipo = form.elements.tipo.value;
        let jid = $jug.value;
        const ops = [];
        if (jid === '__nuevo__') {
          const ap = form.elements.apellido.value.trim();
          if (!ap) { aviso('Escribí al menos el apellido del jugador.'); form.elements.apellido.focus(); return; }
          ops.push({ op: 'crear', tabla: 'Jugadores', fila: { equipo_id: eid, nombre: form.elements.nombre.value.trim(), apellido: ap } });
          jid = '$0';
        }
        const minuto = form.elements.minuto.value.trim();
        ops.push({ op: 'crear', tabla: 'Eventos', fila: { partido_id: pid, tipo, jugador_id: jid, equipo_id: eid, minuto: minuto === '' ? '' : Number(minuto) } });
        const beneficia = tipo === 'Gol' ? eid : tipo === 'Gol en contra' ? (eid === L ? V : L) : null;
        if (beneficia) ops.push({ op: 'sumar', tabla: 'Partidos', id: pid, campo: beneficia === L ? 'goles_local' : 'goles_visitante', delta: 1 });
        const r = await guardar(ops, beneficia ? `Gol de ${nombreEquipo(beneficia)} registrado.` : 'Tarjeta registrada.');
        if (r) { editorPartido(pid); refrescarFondo(); }
      });

      c.querySelectorAll('[data-sumar]').forEach(b => b.addEventListener('click', async () => {
        const r = await guardar([{ op: 'sumar', tabla: 'Partidos', id: pid, campo: b.dataset.sumar, delta: Number(b.dataset.delta) }], 'Marcador actualizado.');
        if (r) { editorPartido(pid); refrescarFondo(); }
      }));
      c.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', async () => {
        const nuevo = b.dataset.estado;
        if (nuevo === p.estado) return;
        const cambios = { estado: nuevo };
        if (nuevo === 'En juego' && gl == null && gv == null) { cambios.goles_local = 0; cambios.goles_visitante = 0; }
        if ((nuevo === 'En juego' || nuevo === 'Finalizado') && !p.fecha_jugada) cambios.fecha_jugada = hoyISO();
        const r = await guardar([{ op: 'editar', tabla: 'Partidos', id: pid, cambios }], `Partido marcado como ${nuevo.toLowerCase()}.`);
        if (r) { editorPartido(pid); refrescarFondo(); }
      }));
      c.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
        const e = porId('eventos', b.dataset.quitar);
        if (!e || !confirm('¿Quitar este evento?')) return;
        const ops = [{ op: 'borrar', tabla: 'Eventos', id: e.id }];
        const beneficia = e.tipo === 'Gol' ? e.equipo_id : e.tipo === 'Gol en contra' ? (e.equipo_id === L ? V : L) : null;
        if (beneficia) ops.push({ op: 'sumar', tabla: 'Partidos', id: pid, campo: beneficia === L ? 'goles_local' : 'goles_visitante', delta: -1 });
        const r = await guardar(ops, 'Evento quitado.');
        if (r) { editorPartido(pid); refrescarFondo(); }
      }));
      const fd = c.querySelector('#form-datos-partido');
      fd.addEventListener('submit', async ev => {
        ev.preventDefault();
        const cambios = cambiosEntre(p, leerFormulario(fd, camposDatosPartido()));
        if (!Object.keys(cambios).length) return aviso('No hay cambios para guardar.');
        const r = await guardar([{ op: 'editar', tabla: 'Partidos', id: pid, cambios }], 'Datos del partido guardados.');
        if (r) { editorPartido(pid); refrescarFondo(); }
      });
      if (reabrir) c.scrollTop = scrollPrevio;
    }, true, reabrir);
  }
  function camposDatosPartido() {
    return [
      { k: 'fecha_jugada', l: 'Fecha en que se jugó', t: 'fecha', ancho: 'medio' },
      { k: 'hora', l: 'Hora', t: 'hora', ancho: 'medio' },
      { k: 'cancha', l: 'Cancha' },
      { k: 'resultado_manual', l: 'Resultado sin marcador', t: 'select', op: [['', 'Usar el marcador'], ['L', 'Ganó el local'], ['E', 'Empate'], ['V', 'Ganó el visitante']], ayuda: 'Solo si no se conoce el marcador.' },
      { k: 'observaciones', l: 'Observaciones', t: 'area', filas: 2 }
    ];
  }
  function refrescarFondo() {
    const $c = document.getElementById('admin-cuerpo');
    if ($c && (rutaActual[0] || 'resultados') === 'resultados') secResultados($c, []);
  }
  function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // ---------- Fixture (dev) ----------
  function secFixture($c) {
    const tid = torneoElegido();
    editorTabla($c, {
      tabla: 'Partidos', titulo: 'Fixture', nuevoTexto: 'Agregar partido',
      filtros: `<div class="barra-filtros">${selectorEn($c, 'sel-torneo-fx', 'Torneo', opTorneos(), tid, v => { filtro.torneo = v; vistaPanel(); })}</div>`,
      items: () => T('partidos').filter(p => p.torneo_id === tid).sort((a, b) => num(a.fecha_nro) - num(b.fecha_nro)),
      resumen: p => ({ t: `${nombreEquipo(p.local_id)} vs ${nombreEquipo(p.visitante_id)}`, s: `Fecha ${esc(p.fecha_nro)}, ${fecha(p.fecha_programada) || 'sin fecha'}${p.hora ? ', ' + esc(p.hora) : ''}`, der: chipEstado(p) }),
      porDefecto: () => {
        const ps = T('partidos').filter(p => p.torneo_id === tid);
        return { torneo_id: tid, fecha_nro: ps.length ? Math.max(...ps.map(p => num(p.fecha_nro) || 0)) : 1, estado: 'Programado' };
      },
      campos: f => {
        const t = porId('torneos', f.torneo_id || tid);
        const ids = new Set(participantesDe(t));
        const equipos = T('equipos').filter(e => ids.has(String(e.id)));
        return [
          { k: 'torneo_id', l: 'Torneo', t: 'select', op: opTorneos, req: 1 },
          { k: 'fecha_nro', l: 'Número de fecha', t: 'num', req: 1, ancho: 'medio' },
          ...(t && (esLlave(t) || esGrupos(t)) ? [
            { k: 'fase', l: 'Fase', ph: 'Ej.: Cuartos de final', ancho: 'medio', ayuda: esGrupos(t) ? 'Vacío = partido de la fase de grupos. Para los playoffs: Cuartos de final, Semifinal, Final.' : '' },
            { k: 'llave', l: 'Número de llave', t: 'num', ancho: 'medio', ayuda: 'Ida y vuelta llevan el mismo número.' },
            { k: 'penales', l: 'Penales (local-visitante)', ph: 'Ej.: 4-3', ancho: 'medio' }] : []),
          { k: 'estado', l: 'Estado', t: 'select', op: ESTADOS.map(e => [e, e]), ancho: 'medio' },
          { k: 'local_id', l: 'Local', t: 'select', op: [['', 'Elegí un equipo']].concat(opEquipos(equipos)), req: 1, ancho: 'medio' },
          { k: 'visitante_id', l: 'Visitante', t: 'select', op: [['', 'Elegí un equipo']].concat(opEquipos(equipos)), req: 1, ancho: 'medio' },
          { k: 'fecha_programada', l: 'Fecha programada', t: 'fecha', ancho: 'medio' },
          { k: 'hora', l: 'Hora', t: 'hora', ancho: 'medio' },
          { k: 'cancha', l: 'Cancha' },
          { k: 'fuente', l: 'Link a la crónica', t: 'url' }
        ];
      },
      puedeBorrar: p => !T('eventos').some(e => e.partido_id === p.id),
      confirmarBorrar: '¿Borrar este partido del fixture?',
      pie: (() => {
        const t = porId('torneos', tid);
        if (!t || esLlave(t)) return '';
        return `<p class="nota" style="margin-left:0"><button type="button" class="boton" id="btn-armar-fixture">Armar fixture automático</button> Todos contra todos${esGrupos(t) ? ' dentro de cada zona' : ''}.</p>`
          + (esGrupos(t) && Number(t.playoffs) ? `<p class="nota" style="margin-left:0"><button type="button" class="boton" id="btn-armar-playoffs">Armar cruces de playoffs</button> Crea la próxima ronda con los equipos ya definidos.</p>` : '');
      })(),
      alMontar: $x => {
        const b = $x.querySelector('#btn-armar-fixture'); if (b) b.addEventListener('click', () => armarFixture(porId('torneos', tid)));
        const c = $x.querySelector('#btn-armar-playoffs'); if (c) c.addEventListener('click', () => armarPlayoffs(porId('torneos', tid)));
      }
    });
  }
  const esLlave = t => !!t && String(t.tipo || '').toLowerCase() === 'llave';

  // Todos contra todos (método del círculo): devuelve las fechas, cada una con sus cruces [local, visitante].
  // Próxima ronda de playoffs de una fase de grupos: los cruces los calcula el sitio (misma lógica que el cuadro).
  async function armarPlayoffs(t) {
    if (!t) return;
    if (!window.LF || !window.LF.crucesPendientes) { aviso('Recargá la página e intentá de nuevo.'); return; }
    let r;
    try { r = await window.LF.crucesPendientes(t.id); } catch (e) { aviso('No se pudieron calcular los cruces.'); return; }
    if (!r) { aviso('Elegí cuántos pasan de cada zona en Torneos > ' + t.nombre + '.'); return; }
    if (r.terminado) { aviso('Los playoffs ya tienen todos sus partidos cargados.'); return; }
    if (!r.cruces.length) { aviso(`Todavía no se sabe quién juega ${r.ronda}: faltan resultados.`); return; }
    const ps = T('partidos').filter(p => p.torneo_id === t.id);
    const base = Math.max(0, ...ps.map(p => num(p.fecha_nro) || 0));
    const llaveBase = Math.max(0, ...ps.filter(p => String(p.fase || '').trim()).map(p => num(p.llave) || 0));
    abrirCajon('Armar cruces de playoffs', `<form id="form-po" novalidate>
      <h3 style="margin:0 0 8px">${esc(r.ronda)}</h3>
      ${r.provisorio ? '<p class="error-form">La fase de grupos todavía no terminó: los cruces salen de la tabla actual.</p>' : ''}
      <ul class="lista-cruces">${r.cruces.map(c => `<li>${esc(c.na)} <span>vs</span> ${esc(c.nb)}</li>`).join('')}</ul>
      ${r.faltan ? `<p class="nota" style="margin:0 0 8px">Quedan ${r.faltan} cruces de esta ronda sin definir: los podés crear después.</p>` : ''}
      <div class="grilla-form">
        <div class="campo campo--medio"><label for="po-vueltas">Formato</label><select id="po-vueltas"><option value="1">Partido único</option><option value="2">Ida y vuelta</option></select><small>En ida y vuelta, la vuelta es en la cancha del mejor ubicado.</small></div>
        <div class="campo campo--medio"><label for="po-inicio">Fecha</label><input type="date" id="po-inicio"><small>Opcional. La vuelta, una semana después.</small></div>
      </div>
      <div class="acciones acciones--form"><button class="boton boton--primario" type="submit" data-guardar>Crear partidos</button></div></form>`,
    (cuerpo, cerrar) => {
      const form = cuerpo.querySelector('#form-po');
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const vueltas = Number(form.querySelector('#po-vueltas').value);
        const inicio = form.querySelector('#po-inicio').value;
        const dia = k => { if (!inicio) return ''; const d = new Date(inicio + 'T12:00:00'); d.setDate(d.getDate() + 7 * k); return d.toISOString().slice(0, 10); };
        const filas = [];
        r.cruces.forEach((c, i) => {
          const llave = llaveBase + i + 1;
          // Partido único o vuelta: de local el mejor ubicado (a).
          if (vueltas === 2) filas.push({ torneo_id: t.id, fecha_nro: base + 1, local_id: c.b, visitante_id: c.a, fecha_programada: dia(0), fase: r.ronda, llave, estado: 'Programado' });
          filas.push({ torneo_id: t.id, fecha_nro: base + vueltas, local_id: c.a, visitante_id: c.b, fecha_programada: dia(vueltas - 1), fase: r.ronda, llave, estado: 'Programado' });
        });
        for (let i = 0; i < filas.length; i += 40) {
          const ok = await guardar(filas.slice(i, i + 40).map(fila => ({ op: 'crear', tabla: 'Partidos', fila })), i + 40 >= filas.length ? `${r.ronda}: ${filas.length === 1 ? 'partido creado' : filas.length + ' partidos creados'}.` : '');
          if (!ok) return;
        }
        cerrar(); vistaPanel();
      });
    });
  }

  function todosContraTodos(eids) {
    const L = eids.slice();
    if (L.length % 2) L.push(null);
    const n = L.length, fechas = [];
    for (let r = 0; r < n - 1; r++) {
      const f = [];
      for (let i = 0; i < n / 2; i++) {
        const a = L[i], b = L[n - 1 - i];
        if (a && b) f.push(i === 0 && r % 2 ? [b, a] : [a, b]);
      }
      fechas.push(f);
      L.splice(1, 0, L.pop());
    }
    return fechas;
  }
  function armarFixture(t) {
    if (!t) return;
    const grupos = gruposDe(t).filter(g => g.eids.length >= 2);
    const yaHay = T('partidos').filter(p => p.torneo_id === t.id && !String(p.fase || '').trim()).length;
    if (!grupos.length) { aviso('El torneo necesita al menos 2 equipos.'); return; }
    abrirCajon('Armar fixture automático', `<form id="form-armar" novalidate>
      <p class="nota" style="margin:0 0 12px">${grupos.map(g => `${g.nombre ? esc(g.nombre) + ': ' : ''}${g.eids.length} equipos`).join(' · ')}</p>
      ${yaHay ? `<p class="error-form">Este torneo ya tiene ${yaHay} partidos cargados. El fixture nuevo se agrega a continuación, sin borrar nada.</p>` : ''}
      <div class="grilla-form">
        <div class="campo campo--medio"><label for="fx-vueltas">Formato</label><select id="fx-vueltas"><option value="1">Solo ida</option><option value="2">Ida y vuelta</option></select></div>
        <div class="campo campo--medio"><label for="fx-inicio">Primera fecha</label><input type="date" id="fx-inicio"><small>Opcional. Las demás van una por semana.</small></div>
      </div>
      <p class="nota" id="fx-resumen" style="margin:8px 0 0"></p>
      <div class="acciones acciones--form"><button class="boton boton--primario" type="submit" data-guardar>Crear partidos</button></div></form>`,
    (cuerpo, cerrar) => {
      const form = cuerpo.querySelector('#form-armar');
      const armar = () => {
        const vueltas = Number(form.querySelector('#fx-vueltas').value);
        const inicio = form.querySelector('#fx-inicio').value;
        const base = yaHay ? Math.max(0, ...T('partidos').filter(p => p.torneo_id === t.id).map(p => num(p.fecha_nro) || 0)) : 0;
        const filas = [];
        grupos.forEach(g => {
          let fechas = todosContraTodos(g.eids);
          if (vueltas === 2) fechas = fechas.concat(fechas.map(f => f.map(([a, b]) => [b, a])));
          fechas.forEach((f, i) => f.forEach(([a, b]) => {
            let dia = '';
            if (inicio) { const d = new Date(inicio + 'T12:00:00'); d.setDate(d.getDate() + 7 * i); dia = d.toISOString().slice(0, 10); }
            filas.push({ torneo_id: t.id, fecha_nro: base + i + 1, local_id: a, visitante_id: b, fecha_programada: dia, estado: 'Programado' });
          }));
        });
        return filas;
      };
      const resumen = () => { const f = armar(); form.querySelector('#fx-resumen').textContent = `Se van a crear ${f.length} partidos en ${new Set(f.map(x => x.fecha_nro)).size} fechas.`; };
      form.addEventListener('change', resumen); resumen();
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const filas = armar();
        // La API acepta hasta 40 cambios por pedido: se mandan de a tandas.
        for (let i = 0; i < filas.length; i += 40) {
          const r = await guardar(filas.slice(i, i + 40).map(fila => ({ op: 'crear', tabla: 'Partidos', fila })), i + 40 >= filas.length ? `Fixture armado: ${filas.length} partidos.` : '');
          if (!r) return;
        }
        cerrar(); vistaPanel();
      });
    });
  }

  // ---------- Plantel ----------
  function secPlantel($c) {
    const clubes = misClubes().slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    const club = clubElegido();
    if (!club) { $c.innerHTML = '<p class="vacio">No hay clubes cargados.</p>'; return; }
    const equipos = T('equipos').filter(e => e.club_id === club.id);
    const eids = new Set(equipos.map(e => e.id));
    const camposJug = () => [
      { k: 'equipo_id', l: 'Equipo', t: 'select', op: opEquipos(equipos), req: 1 },
      { k: 'nombre', l: 'Nombre', ancho: 'medio' },
      { k: 'apellido', l: 'Apellido', req: 1, ancho: 'medio' },
      { k: 'numero', l: 'Número de camiseta', t: 'num', ancho: 'medio' },
      { k: 'posicion', l: 'Posición', t: 'select', op: POSICIONES, ancho: 'medio' },
      { k: 'activo', l: 'En el plantel', t: 'select', op: SI_NO, ayuda: 'Si deja el club, marcá "No": se conserva su historial de goles.' },
      { k: 'foto', l: 'Foto (link a la imagen)', t: 'url' },
      { k: 'observaciones', l: 'Observaciones', t: 'area', filas: 2 }
    ];
    editorTabla($c, {
      tabla: 'Jugadores', titulo: `Plantel de ${club.nombre}`, nuevoTexto: 'Agregar jugador',
      filtros: `<div class="barra-filtros">${selectorEn($c, 'sel-club', 'Club', clubes.map(c => [c.id, c.nombre]), club.id, v => { filtro.club = v; vistaPanel(); })}
        <label class="interruptor"><input type="checkbox" id="ver-inactivos" ${filtro.verInactivos ? 'checked' : ''}><span>Mostrar jugadores que ya no están</span></label></div>`,
      alMontar: c => { const x = c.querySelector('#ver-inactivos'); if (x) x.addEventListener('change', () => { filtro.verInactivos = x.checked; vistaPanel(); }); },
      items: () => T('jugadores').filter(j => eids.has(j.equipo_id) && (filtro.verInactivos || j.activo !== 'NO'))
        .sort((a, b) => (num(a.numero) || 999) - (num(b.numero) || 999) || String(a.apellido).localeCompare(b.apellido)),
      resumen: j => {
        const g = golesDe(j.id);
        return {
          icono: `<span class="dorsal">${esc(j.numero || '–')}</span>`,
          t: nombreJugador(j),
          s: [j.posicion, equipos.length > 1 ? (porId('equipos', j.equipo_id) || {}).categoria : '', j.activo === 'NO' ? 'Ya no está en el plantel' : ''].filter(Boolean).map(esc).join(', '),
          der: g ? `<span class="cifra">${g}</span> ${g === 1 ? 'gol' : 'goles'}` : ''
        };
      },
      porDefecto: () => ({ equipo_id: (equipos[0] || {}).id, activo: 'SI' }),
      campos: camposJug,
      puedeBorrar: j => esDev() && !T('eventos').some(e => e.jugador_id === j.id),
      vacio: 'Todavía no hay jugadores cargados. Agregá el plantel con el botón de arriba.'
    });
  }

  // ---------- Club ----------
  function camposClub(dev) {
    return (dev ? [{ k: 'liga_id', l: 'Liga', t: 'select', op: () => opLigas(false), req: 1 }] : []).concat([
      { k: 'nombre', l: 'Nombre del club', req: 1 },
      { k: 'ciudad', l: 'Ciudad', ancho: 'medio' },
      { k: 'cancha', l: 'Cancha', ancho: 'medio' },
      { k: 'direccion', l: 'Dirección de la cancha' },
      { k: 'escudo', l: 'Escudo (link a la imagen)', t: 'url', ayuda: 'Una imagen cuadrada, idealmente PNG con fondo transparente.' },
      { k: 'web', l: 'Sitio web o red social', t: 'url', ph: 'https://' },
      { k: 'contacto', l: 'Contacto', ayuda: 'WhatsApp, email o link de Instagram.' }
    ]);
  }
  function categoriasHTML(club) {
    const eqs = T('equipos').filter(e => e.club_id === club.id);
    return `<div class="categorias"><h3>Categorías</h3>
      <ul>${eqs.map(e => `<li>${esc(e.categoria)}</li>`).join('')}</ul>
      ${esDev() ? `<div class="categorias__nueva"><select id="nueva-cat">${CATEGORIAS.filter(c => !eqs.some(e => e.categoria === c)).map(c => `<option>${c}</option>`).join('')}</select>
        <button type="button" class="boton" id="btn-cat" data-guardar>Agregar categoría</button></div>` : ''}</div>`;
  }
  function montarCategorias(form, club) {
    const b = form.querySelector('#btn-cat');
    if (b) b.addEventListener('click', async () => {
      const cat = form.querySelector('#nueva-cat').value;
      if (!cat) return;
      const r = await guardar([{ op: 'crear', tabla: 'Equipos', fila: { club_id: club.id, categoria: cat } }], `Categoría ${cat} agregada.`);
      if (r) { cerrarCajon(); vistaPanel(); }
    });
  }
  function secMiClub($c) {
    const clubes = misClubes();
    if (!filtro.club || !clubes.some(c => c.id === filtro.club)) filtro.club = (clubes[0] || {}).id;
    const club = porId('clubes', filtro.club);
    if (!club) { $c.innerHTML = '<p class="vacio">No tenés un club asignado.</p>'; return; }
    const campos = camposClub(false);
    $c.innerHTML = `<div class="grilla"><section class="panel">
      <div class="panel__cabeza"><h2>Datos de ${esc(club.nombre)}</h2>${selectorEn($c, 'sel-mi-club', 'Club', clubes.map(c => [c.id, c.nombre]), club.id, v => { filtro.club = v; vistaPanel(); })}</div>
      <form class="panel__cuerpo" id="form-club">${formulario(campos, club)}
        <div class="acciones acciones--form"><button class="boton boton--primario" type="submit" data-guardar>Guardar cambios</button></div></form>
    </section><aside><section class="panel"><div class="panel__cabeza"><h2>Así se ve</h2></div><div class="panel__cuerpo vista-previa" id="vista-club"></div></section>
      <section class="panel"><div class="panel__cuerpo">${categoriasHTML(club)}</div></section></aside></div>`;
    const form = $c.querySelector('#form-club');
    const previa = () => {
      const d = leerFormulario(form, campos);
      const img = /^https?:\/\//.test(d.escudo) ? `<img src="${esc(d.escudo)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc((d.nombre || '?').slice(0, 2).toUpperCase())}'))">` : esc((d.nombre || '?').slice(0, 2).toUpperCase());
      $c.querySelector('#vista-club').innerHTML = `<div class="previa-club"><span class="previa-club__escudo">${img}</span><div><b>${esc(d.nombre)}</b><small>${esc(d.ciudad)}${d.cancha ? `. Cancha: ${esc(d.cancha)}` : ''}</small></div></div>`;
    };
    form.addEventListener('input', previa); previa();
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!form.elements.nombre.value.trim()) return aviso('El nombre del club no puede quedar vacío.');
      const cambios = cambiosEntre(club, leerFormulario(form, campos));
      if (!Object.keys(cambios).length) return aviso('No hay cambios para guardar.');
      if (await guardar([{ op: 'editar', tabla: 'Clubes', id: club.id, cambios }], 'Datos del club guardados.')) vistaPanel();
    });
  }
  function secClubes($c) {
    const ligas = misLigas();
    editorTabla($c, {
      tabla: 'Clubes', titulo: 'Clubes', nuevoTexto: 'Agregar club',
      filtros: `<div class="barra-filtros">${selectorEn($c, 'sel-liga-cl', 'Liga', [['', 'Todas']].concat(ligas.map(l => [l.id, l.nombre])), filtro.liga || '', v => { filtro.liga = v; vistaPanel(); })}</div>`,
      items: () => T('clubes').filter(c => !filtro.liga || c.liga_id === filtro.liga).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      resumen: c => ({ t: c.nombre, s: [c.ciudad, (porId('ligas', c.liga_id) || {}).nombre].filter(Boolean).map(esc).join(', '), der: `${T('equipos').filter(e => e.club_id === c.id).length} cat.` }),
      porDefecto: () => ({ liga_id: filtro.liga || (ligas[0] || {}).id }),
      campos: () => camposClub(true),
      extraForm: c => c ? categoriasHTML(c) : '<p class="nota" style="margin:0 0 12px">Al guardar se crea su equipo de Primera.</p>',
      alMontarForm: (form, c) => { if (c) montarCategorias(form, c); },
      puedeBorrar: c => !T('equipos').some(e => e.club_id === c.id),
      confirmarBorrar: '¿Borrar este club?'
    });
  }

  // ---------- Noticias ----------
  function secNoticias($c) {
    const ligas = ligasNoticias();
    const u = S.T.usuario;
    const propia = n => esDev() || String(n.autor_email).toLowerCase() === u.email;
    editorTabla($c, {
      tabla: 'Noticias', titulo: 'Noticias', nuevoTexto: 'Nueva noticia',
      filtros: esDev() ? `<div class="barra-filtros">${selectorEn($c, 'sel-liga-not', 'Liga', misLigas().map(l => [l.id, l.nombre]), filtro.ligaNoticias, v => { filtro.ligaNoticias = v; vistaPanel(); })}</div>` : '',
      items: () => T('noticias').filter(n => ligas.some(l => l.id === n.liga_id)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
      resumen: n => ({ t: n.titulo, s: `${fecha(n.fecha)}${ligas.length > 1 ? ', ' + esc((porId('ligas', n.liga_id) || {}).nombre) : ''}${propia(n) ? '' : ', publicada por la liga'}` }),
      porDefecto: () => ({ liga_id: (ligas[0] || {}).id, fecha: hoyISO() }),
      campos: () => [
        { k: 'liga_id', l: 'Liga', t: 'select', op: () => opLigas(false), req: 1 },
        { k: 'fecha', l: 'Fecha', t: 'fecha', ancho: 'medio' },
        { k: 'fuente', l: 'Fuente', ancho: 'medio', ph: 'Ej.: Prensa del club' },
        { k: 'titulo', l: 'Título', req: 1 },
        { k: 'resumen', l: 'Texto', t: 'area', filas: 6, req: 1 },
        { k: 'url', l: 'Link a la nota completa', t: 'url' },
        { k: 'imagen', l: 'Imagen (link)', t: 'url' }
      ],
      puedeEditar: propia,
      puedeBorrar: propia,
      confirmarBorrar: '¿Borrar esta noticia?',
      vacio: 'Todavía no hay noticias. Publicá la primera con el botón de arriba.'
    });
  }

  // ---------- Dev: torneos, ligas, usuarios ----------
  function secTorneos($c) {
    editorTabla($c, {
      tabla: 'Torneos', titulo: 'Torneos', nuevoTexto: 'Agregar torneo',
      items: () => T('torneos'),
      resumen: t => { const n = ligasDeTorneo(t).length; return { t: `${t.nombre} ${t.temporada}`, s: [t.categoria, n > 1 ? `Entre ${n} ligas` : (porId('ligas', t.liga_id) || {}).nombre, `${participantesDe(t).length} equipos`, t.estado].filter(Boolean).map(esc).join(', '), der: `${partidosDeTorneo(t)} partidos` }; },
      porDefecto: () => ({ liga_id: (T('ligas')[0] || {}).id, temporada: String(new Date().getFullYear()), categoria: 'Primera' }),
      extraForm: () => selectorParticipantes(),
      alMontarForm: (form, t) => montarParticipantes(form, t),
      campos: () => [
        { k: 'liga_id', l: 'Liga organizadora', t: 'select', op: () => opLigas(false), req: 1, ayuda: 'Donde se guardan los partidos del torneo. Los equipos que juegan se eligen más abajo.' },
        { k: 'participantes', t: 'oculto' },
        { k: 'zonas', t: 'oculto' },
        { k: 'nombre', l: 'Nombre del torneo', req: 1 },
        { k: 'temporada', l: 'Temporada', ancho: 'medio' },
        { k: 'categoria', l: 'Categoría', t: 'select', op: CATEGORIAS.map(c => [c, c]), ancho: 'medio' },
        { k: 'estado', l: 'Estado', ph: 'Ej.: Fase regular' },
        { k: 'tipo', l: 'Tipo de torneo', t: 'select', op: [['', 'Tabla de posiciones'], ['grupos', 'Fase de grupos (zonas)'], ['llave', 'Llave de eliminación (playoffs)']], ancho: 'medio' },
        { k: 'clasifica', l: 'Clasificados de otro torneo', ph: 'Ej.: T08:1-8', ancho: 'medio', ayuda: 'Para hexagonales y playoffs: T08:1-6 toma del 1° al 6° de la tabla del torneo T08, en ese orden. De una fase de grupos: T50:1-2 toma 1° y 2° de cada zona, y T50:Zona A:1-2 solo de esa zona. También podés poner clubes en orden de siembra: CL64, CL66. Si lo completás, no hace falta marcar equipos abajo.' },
        { k: 'playoffs', l: 'Playoffs al terminar las zonas', t: 'select', op: [['', 'Sin playoffs'], ['1', 'Pasa el 1° de cada zona'], ['2', 'Pasan 1° y 2° de cada zona'], ['3', 'Pasan del 1° al 3° de cada zona'], ['4', 'Pasan del 1° al 4° de cada zona']], ancho: 'medio', ayuda: 'Los cruces se arman en el mismo torneo: 1° de una zona contra 2° de otra. Se cargan desde Fixture.' },
        { k: 'formato', l: 'Formato', t: 'area', filas: 3, ayuda: 'Se muestra debajo de la tabla de posiciones.' }
      ],
      puedeBorrar: t => !partidosDeTorneo(t)
    });
  }
  // Partidos de un torneo: contados en la base si su liga no está cargada.
  const partidosDeTorneo = t => S.C[t.liga_id] ? T('partidos').filter(p => p.torneo_id === t.id).length : (Number(t._partidos) || 0);
  // Selector de equipos de un torneo: ligas enteras y/o clubes sueltos de cualquier liga.
  function selectorParticipantes() {
    const ligas = T('ligas').slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    return `<fieldset class="participantes"><legend>Equipos que juegan</legend>
      <p class="ayuda">Marcá ligas enteras o clubes sueltos. Pueden ser de distintas ligas: en ese caso el torneo aparece en el apartado "Torneos" del sitio.</p>
      ${ligas.map(l => `<details class="part-liga" data-liga="${esc(l.id)}">
        <summary><label><input type="checkbox" data-liga="${esc(l.id)}"> Toda la ${esc(l.nombre)}</label><span class="part-cuenta"></span></summary>
        <div class="part-clubes">${T('clubes').filter(c => c.liga_id === l.id).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => `<label><input type="checkbox" data-club="${esc(c.id)}" data-de="${esc(l.id)}"> ${esc(c.nombre)}</label>`).join('') || '<small>Sin clubes cargados.</small>'}</div>
      </details>`).join('')}
      <div class="part-zonas" hidden>
        <div class="part-zonas__cabeza"><h3>Zonas</h3>
          <label class="filtro"><span>Cantidad</span><select class="zonas-cant">${[2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
          <button type="button" class="boton zonas-repartir">Repartir en orden</button></div>
        <p class="ayuda">Elegí la zona de cada club. "Repartir en orden" los alterna A, B, C… en el orden de la lista.</p>
        <div class="zonas-lista"></div>
      </div>
      <p class="part-total" aria-live="polite"></p></fieldset>`;
  }
  function montarParticipantes(form, t) {
    const oculto = form.elements.participantes;
    const fs = form.querySelector('.participantes');
    const tokens = sinZonas(t && t.participantes).split(/[\s,;]+/).filter(Boolean).map(x => x.toUpperCase());
    if (!tokens.length) tokens.push(String((t && t.liga_id) || form.elements.liga_id.value));
    // Zonas (solo para "Fase de grupos")
    const tipoSel = form.elements.tipo;
    const bloqueZonas = fs.querySelector('.part-zonas');
    const ini = zonasDeTexto(t && t.zonas);
    const ocultoZonas = form.elements.zonas;
    const letra = i => 'Zona ' + 'ABCDEFGH'[i];
    let nombres = ini.nombres.length >= 2 ? ini.nombres.slice() : [letra(0), letra(1)];
    const zonaDe = {};
    Object.keys(ini.club).forEach(c => { zonaDe[c] = ini.club[c]; });
    Object.keys(ini.liga).forEach(l => T('clubes').filter(c => c.liga_id === l).forEach(c => { zonaDe[c.id] = ini.liga[l]; }));
    const cant = fs.querySelector('.zonas-cant');
    cant.value = String(Math.min(8, Math.max(2, nombres.length)));
    const elegidos = () => [...fs.querySelectorAll('input[data-club]')].filter(c => c.checked).map(c => c.dataset.club);
    const nombreClub = id => (porId('clubes', id) || {}).nombre || id;
    let errorZonas = '';
    const dibujarZonas = () => {
      const lista = elegidos();
      // Los clubes sin zona van a la que tiene menos.
      lista.forEach(id => {
        if (nombres.includes(zonaDe[id])) return;
        const cuenta = nombres.map(n => lista.filter(x => zonaDe[x] === n).length);
        zonaDe[id] = nombres[cuenta.indexOf(Math.min(...cuenta))];
      });
      fs.querySelector('.zonas-lista').innerHTML = nombres.map(n => {
        const de = lista.filter(id => zonaDe[id] === n);
        return `<div class="zona-col"><b>${esc(n)} <small>${de.length}</small></b>${de.map(id => `<label class="zona-club"><span>${esc(nombreClub(id))}</span>
          <select data-zona-de="${esc(id)}" aria-label="Zona de ${esc(nombreClub(id))}">${nombres.map(x => `<option ${x === n ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`).join('') || '<small class="zona-vacia">Sin equipos</small>'}</div>`;
      }).join('');
    };
    cant.addEventListener('change', () => {
      const n = Number(cant.value);
      nombres = Array.from({ length: n }, (_, i) => nombres[i] || letra(i));
      actualizar();
    });
    fs.querySelector('.zonas-repartir').addEventListener('click', () => {
      elegidos().forEach((id, i) => { zonaDe[id] = nombres[i % nombres.length]; });
      actualizar();
    });
    fs.querySelector('.zonas-lista').addEventListener('change', e => {
      e.stopPropagation();
      if (e.target.dataset.zonaDe) { zonaDe[e.target.dataset.zonaDe] = e.target.value; actualizar(); }
    });
    if (tipoSel) tipoSel.addEventListener('change', () => actualizar());
    fs.querySelectorAll('input[data-liga]').forEach(i => { i.checked = tokens.includes(i.dataset.liga); });
    fs.querySelectorAll('input[data-club]').forEach(i => { i.checked = tokens.includes(i.dataset.club); });
    const actualizar = () => {
      const valor = [];
      let equipos = 0;
      fs.querySelectorAll('.part-liga').forEach(d => {
        const toda = d.querySelector('input[data-liga]');
        const clubes = [...d.querySelectorAll('input[data-club]')];
        clubes.forEach(c => { if (toda.checked) c.checked = true; c.disabled = toda.checked; });
        const marcados = clubes.filter(c => c.checked);
        if (toda.checked) valor.push(toda.dataset.liga); else marcados.forEach(c => valor.push(c.dataset.club));
        equipos += marcados.length;
        d.querySelector('.part-cuenta').textContent = marcados.length ? `${marcados.length} de ${clubes.length}` : '';
        if (marcados.length) d.open = true;
      });
      oculto.value = valor.join(', ');
      fs.querySelector('.part-total').textContent = equipos ? `${equipos} clubes elegidos.` : 'Elegí al menos una liga o un club.';
      const grupos = tipoSel && tipoSel.value === 'grupos';
      bloqueZonas.hidden = !grupos;
      // En una fase de grupos los playoffs van dentro del mismo torneo; "clasificados de otro torneo" no aplica.
      const campo = n => form.elements[n] && form.elements[n].closest('.campo');
      if (campo('playoffs')) campo('playoffs').hidden = !grupos;
      if (campo('clasifica')) campo('clasifica').hidden = grupos;
      if (grupos && form.elements.clasifica) form.elements.clasifica.value = '';
      errorZonas = '';
      ocultoZonas.value = '';
      if (grupos) {
        dibujarZonas();
        const lista = elegidos();
        ocultoZonas.value = nombres.map(n => { const de = lista.filter(id => zonaDe[id] === n); return de.length ? `${n}: ${de.join(', ')}` : ''; }).filter(Boolean).join('; ');
        const cortas = nombres.filter(n => lista.filter(id => zonaDe[id] === n).length < 2);
        if (lista.length && cortas.length) errorZonas = `Cada zona necesita al menos 2 equipos (${cortas.join(', ')}).`;
        if (errorZonas) fs.querySelector('.part-total').textContent = errorZonas;
        else if (lista.length) fs.querySelector('.part-total').textContent = `${lista.length} clubes en ${nombres.length} zonas.`;
      }
    };
    fs.addEventListener('change', e => {
      // Marcar o desmarcar "toda la liga" marca o desmarca todos sus clubes.
      if (e.target.dataset.liga) fs.querySelectorAll(`input[data-de="${e.target.dataset.liga}"]`).forEach(c => { c.checked = e.target.checked; });
      actualizar();
    });
    fs.querySelectorAll('summary label').forEach(l => l.addEventListener('click', e => e.stopPropagation()));
    form.addEventListener('submit', e => {
      if (!oculto.value || errorZonas) { e.preventDefault(); e.stopImmediatePropagation(); fs.querySelector('.part-total').textContent = errorZonas || 'Elegí al menos una liga o un club.'; fs.scrollIntoView({ block: 'nearest' }); }
    }, true);
    actualizar();
  }

  function secLigas($c) {
    editorTabla($c, {
      tabla: 'Ligas', titulo: 'Ligas', nuevoTexto: 'Agregar liga',
      items: () => T('ligas'),
      resumen: l => ({ t: l.nombre, s: [l.ciudad, l.provincia, l.activa === 'NO' ? 'Oculta en el sitio' : ''].filter(Boolean).map(esc).join(', '), der: `${T('clubes').filter(c => c.liga_id === l.id).length} clubes` }),
      porDefecto: () => ({ activa: 'SI', provincia: 'Buenos Aires' }),
      campos: () => [
        { k: 'nombre', l: 'Nombre de la liga', req: 1 },
        { k: 'provincia', l: 'Provincia', t: 'select', op: PROVINCIAS.map(p => [p, p]), req: 1, ancho: 'medio' },
        { k: 'ciudad', l: 'Ciudad', ancho: 'medio' },
        { k: 'lat', l: 'Latitud', t: 'num', paso: 'any', ancho: 'medio', ayuda: 'Ej.: -36.2306' },
        { k: 'lng', l: 'Longitud', t: 'num', paso: 'any', ancho: 'medio', ayuda: 'Ej.: -61.1131' },
        { k: 'logo', l: 'Logo (link a la imagen)', t: 'url' },
        { k: 'web', l: 'Sitio web', t: 'url' },
        { k: 'contacto', l: 'Contacto' },
        { k: 'activa', l: 'Visible en el sitio', t: 'select', op: SI_NO }
      ],
      extraForm: () => '<p class="nota" style="margin:0 0 12px">Para la latitud y longitud: en Google Maps, clic derecho sobre la ciudad y copiá los números que aparecen arriba.</p>',
      puedeBorrar: l => !T('clubes').some(c => c.liga_id === l.id) && !T('torneos').some(t => t.liga_id === l.id)
    });
  }
  function secUsuarios($c) {
    const yo = S.T.usuario.email;
    editorTabla($c, {
      tabla: 'Usuarios', titulo: 'Usuarios del panel', nuevoTexto: 'Agregar usuario',
      items: () => T('usuarios').slice().sort((a, b) => (a.rol === 'dev' ? -1 : 1) - (b.rol === 'dev' ? -1 : 1) || String(a.nombre).localeCompare(b.nombre)),
      resumen: u => ({
        t: u.nombre || u.email || 'Sin nombre',
        s: [u.email || 'Falta el email', u.rol === 'dev' ? 'Desarrollador' : (porId('clubes', u.club_id) || {}).nombre].filter(Boolean).map(esc).join(', '),
        der: u.activo === 'SI' && u.email ? '<span class="chip-estado chip-estado--fin">Activo</span>' : '<span class="chip-estado chip-estado--prog">Sin acceso</span>'
      }),
      porDefecto: () => ({ rol: 'admin_club', activo: 'SI', liga_id: (T('ligas')[0] || {}).id }),
      campos: () => [
        { k: 'email', l: 'Email de Google', t: 'email', req: 1, ayuda: 'La cuenta con la que va a ingresar (Gmail o Google Workspace).' },
        { k: 'nombre', l: 'Nombre' },
        { k: 'rol', l: 'Rol', t: 'select', op: [['admin_club', 'Admin de club'], ['dev', 'Desarrollador (acceso total)']], ancho: 'medio' },
        { k: 'activo', l: 'Acceso habilitado', t: 'select', op: SI_NO, ancho: 'medio' },
        { k: 'liga_id', l: 'Liga', t: 'select', op: () => opLigas(true), ancho: 'medio' },
        { k: 'club_id', l: 'Club', t: 'select', op: () => opClubes(true), ancho: 'medio', ayuda: 'Obligatorio para un admin de club.' }
      ],
      alMontarForm: form => {
        const liga = form.elements.liga_id, club = form.elements.club_id;
        if (!liga || !club) return;
        const filtrar = () => { const actual = club.value; club.innerHTML = opClubes(true, liga.value).map(([v, n]) => `<option value="${esc(v)}" ${v === actual ? 'selected' : ''}>${esc(n)}</option>`).join(''); };
        liga.addEventListener('change', filtrar); filtrar();
      },
      puedeBorrar: u => String(u.email).toLowerCase() !== yo,
      borrarTexto: 'Quitar usuario', confirmarBorrar: '¿Quitarle el acceso y borrar este usuario?'
    });
  }

  window.Admin = { mostrar, activo: () => !!S.T };
})();
