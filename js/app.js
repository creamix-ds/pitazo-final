/* Pitazo Final: sitio estático que lee la planilla vía Apps Script
   (o data/snapshot.json mientras no haya API configurada). */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const $main = document.getElementById('contenido');
  const D = { ligas: [], clubes: [], equipos: [], jugadores: [], torneos: [], partidos: [], eventos: [], noticias: [] };
  let origen = '';
  let mapa = null;

  // ---------- utilidades ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlSegura = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const porId = (tabla, id) => D[tabla].find(x => x.id === id);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function fecha(iso, conDia) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso || '');
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return `${conDia === false ? '' : DIAS[d.getDay()] + ' '}${d.getDate()} ${MESES[d.getMonth()]}`;
  }
  function iniciales(nombre) {
    const palabras = String(nombre).split(/\s+/).filter(w => !/^(de|del|la|el|y)$/i.test(w));
    return (palabras.length > 1 ? palabras[0][0] + palabras[1][0] : String(nombre).slice(0, 2)).toUpperCase();
  }
  function aviso(texto) {
    const el = document.getElementById('aviso');
    el.textContent = texto; el.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { el.hidden = true; }, 4000);
  }
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const leer = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

  // ---------- datos ----------
  async function api(r, extra) {
    const u = new URL(CFG.API_URL);
    u.searchParams.set('r', r);
    Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u.toString());
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Error de la API');
    return j.data;
  }

  // Los datos llegan en dos partes:
  //  - BASE (?r=base): ligas, clubes, equipos, torneos, últimas noticias y un resumen de cada
  //    liga (tabla y última fecha). Es liviana y alcanza para la portada, el mapa y "Mi equipo".
  //  - CARGA[liga] (?r=liga&id=L01): jugadores, partidos, eventos y noticias de esa liga. Se
  //    pide recién cuando se abre la liga, un club o un torneo que la necesita.
  // D junta todo lo que está cargado, así el resto del sitio trabaja como si tuviera todo.
  const COPIA_BASE = 'lf_base_v2', COPIA_LIGA = 'lf_liga_v2_', COPIA_INDICE = 'lf_ligas_v2';
  let BASE = null;
  const CARGA = {};
  const FRESCAS = new Set();   // ligas pedidas a la API en esta visita
  let COMPLETO = false;        // sin API: data/snapshot.json trae todo junto
  const DETALLE = ['jugadores', 'partidos', 'eventos', 'noticias'];

  const parcial = lid => !COMPLETO && !CARGA[lid];
  const resumenDe = lid => (BASE && BASE.resumenes && BASE.resumenes[lid]) || null;

  function unir() {
    if (!BASE) return;
    ['ligas', 'clubes', 'equipos', 'torneos'].forEach(k => { D[k] = BASE[k] || []; });
    // De cada liga: lo cargado completo o, si no, lo del resumen (partidos de la última fecha).
    const partes = COMPLETO ? [CARGA['*']] : D.ligas.map(l => CARGA[l.id] || resumenDe(l.id)).filter(Boolean);
    ['jugadores', 'partidos', 'eventos'].forEach(k => { D[k] = [].concat(...partes.map(x => x[k] || [])); });
    const vistas = new Set();
    D.noticias = [];
    Object.values(CARGA).concat([{ noticias: BASE.noticias || [] }]).forEach(c => (c.noticias || []).forEach(n => {
      if (!vistas.has(n.id)) { vistas.add(n.id); D.noticias.push(n); }
    }));
    normalizar();
  }

  async function cargarBase() {
    if (!CFG.API_URL) return cargarSnapshot();
    try {
      BASE = await api('base');
      origen = 'Datos en vivo desde la planilla de la liga.';
      guardar(COPIA_BASE, { fecha: Date.now(), datos: BASE });
      unir();
    } catch (e) {
      if (BASE) { console.warn('No se pudo actualizar, sigo con la copia local.', e); return; }
      console.warn('No se pudo leer la API, uso la copia del sitio.', e);
      await cargarSnapshot();
    }
  }
  async function cargarSnapshot() {
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    const s = await res.json();
    COMPLETO = true;
    BASE = { ligas: s.ligas || [], clubes: s.clubes || [], equipos: s.equipos || [], torneos: s.torneos || [], noticias: s.noticias || [], resumenes: {} };
    CARGA['*'] = { jugadores: s.jugadores || [], partidos: s.partidos || [], eventos: s.eventos || [], noticias: s.noticias || [] };
    origen = `Datos actualizados al ${fecha(s.generado, false)}.`;
    unir();
  }

  /** Pide a la API el detalle de esas ligas (las que falten o estén viejas). */
  async function cargarLigas(lids) {
    if (COMPLETO) return;
    await Promise.all(lids.map(async lid => {
      const d = await api('liga', { id: lid });
      CARGA[lid] = d; FRESCAS.add(lid);
      guardarCopiaLiga(lid, d);
    }));
    unir();
  }
  function guardarCopiaLiga(lid, d) {
    guardar(COPIA_LIGA + lid, { fecha: Date.now(), datos: d });
    // Se guardan como máximo 8 ligas en el navegador (las últimas vistas).
    const indice = (leer(COPIA_INDICE) || []).filter(x => x !== lid).concat([lid]);
    while (indice.length > 8) { try { localStorage.removeItem(COPIA_LIGA + indice.shift()); } catch (e) {} }
    guardar(COPIA_INDICE, indice);
  }
  function restaurarCopias() {
    const b = leer(COPIA_BASE);
    if (!b || !b.datos) return false;
    BASE = b.datos;
    (leer(COPIA_INDICE) || []).forEach(lid => { const c = leer(COPIA_LIGA + lid); if (c && c.datos) CARGA[lid] = c.datos; });
    unir();
    return true;
  }

  // Ligas que necesita cada página para mostrarse completa.
  function ligasNecesarias(partes) {
    if (COMPLETO || !BASE) return [];
    const uno = arr => [...new Set(arr.filter(Boolean))].filter(l => D.ligas.some(x => x.id === l));
    if (partes[0] === 'liga') { const l = ligaPorRuta(partes[1]); return l ? [l.id] : []; }
    if (partes[0] === 'club') {
      const c = porId('clubes', partes[1]);
      if (!c) return [];
      const eids = new Set(D.equipos.filter(e => e.club_id === c.id).map(e => e.id));
      return uno([c.liga_id].concat(D.torneos.filter(t => participantesDe(t).some(e => eids.has(e))).map(t => t.liga_id)));
    }
    if (partes[0] === 'torneo') {
      const k = String(partes[1] || '').toLowerCase();
      const t = D.torneos.find(x => String(x.slug).toLowerCase() === k) || D.torneos.find(x => String(x.id).toLowerCase() === k);
      return t ? uno([t.liga_id].concat(ligasDeTorneo(t))) : [];
    }
    return [];
  }

  function normalizar() {
    D.partidos.forEach(p => {
      p.fecha_nro = num(p.fecha_nro);
      p.goles_local = num(p.goles_local);
      p.goles_visitante = num(p.goles_visitante);
      p.llave = num(p.llave);
    });
    D.ligas.forEach(l => { l.lat = num(l.lat); l.lng = num(l.lng); });
    // Dirección de cada liga en el sitio (#/liga/LigadeBolivar). Sale de la columna
    // "slug" de la pestaña Ligas o, si está vacía, del nombre sin tildes ni espacios.
    const usados = new Set();
    D.ligas.forEach(l => {
      let s = aSlug(l.slug || String(l.nombre || '').replace(/\s*(de\s+)?f[uú]tbol\b/i, '')) || l.id;
      if (usados.has(s.toLowerCase())) s = s + l.id;
      usados.add(s.toLowerCase());
      l.slug = s;
    });
    D.torneos.forEach(t => { t.temporada = String(t.temporada || '').replace(/^'/, ''); });
    const usadosT = new Set();
    D.torneos.forEach(t => {
      let s = aSlug(t.slug || t.nombre) || t.id;
      if (usadosT.has(s.toLowerCase())) s = s + (t.temporada || '') + t.id;
      usadosT.add(s.toLowerCase());
      t.slug = s;
    });
    document.getElementById('pie-origen').textContent = origen;
  }

  function aSlug(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '');
  }
  const ligaPorRuta = x => {
    const k = String(x || '').toLowerCase();
    return D.ligas.find(l => String(l.slug).toLowerCase() === k) || D.ligas.find(l => String(l.id).toLowerCase() === k) || null;
  };
  // Link a una liga: acepta el objeto o el id.
  const urlLiga = (l, resto) => {
    if (l && l._base) return l._base + (resto ? '/' + resto : '');
    const liga = typeof l === 'object' ? l : porId('ligas', l);
    return '#/liga/' + encodeURIComponent(liga ? liga.slug : l) + (resto ? '/' + resto : '');
  };

  // ---------- modelo ----------
  const clubDeEquipo = eid => { const e = porId('equipos', eid); return e ? porId('clubes', e.club_id) : null; };
  const nombreEquipo = eid => { const c = clubDeEquipo(eid); return c ? c.nombre : eid; };
  // Equipos que juegan un torneo. La columna "participantes" de Torneos lista ligas
  // enteras (L01), clubes (CL05) o equipos (E07) separados por comas. Vacía = toda la
  // liga del torneo. De las ligas y clubes se toman los equipos de la categoría del torneo.
  function participantesDe(t) {
    if (!t) return [];
    if (String(t.clasifica || '').trim()) return sembrados(t).map(x => x.eid).filter(Boolean);
    const deCategoria = e => !t.categoria || !e.categoria || e.categoria === t.categoria;
    // En una fase de grupos la columna viene por zonas ("Zona A: CL02, CL04; Zona B: ..."):
    // para saber quiénes juegan se ignoran los nombres de las zonas.
    const tokens = String(t.participantes || '').replace(/(^|;)\s*[^:;,]*:/g, '$1 ').split(/[\s,;]+/).filter(Boolean);
    const lista = tokens.length ? tokens : [t.liga_id];
    const ids = new Set();
    lista.forEach(k => {
      const K = k.toUpperCase();
      if (/^L\d+$/.test(K)) D.equipos.filter(e => deCategoria(e) && (porId('clubes', e.club_id) || {}).liga_id === K).forEach(e => ids.add(e.id));
      else if (/^CL\d+$/.test(K)) D.equipos.filter(e => deCategoria(e) && e.club_id === K).forEach(e => ids.add(e.id));
      else if (porId('equipos', K)) ids.add(K);
    });
    return [...ids];
  }
  const ligasDeTorneo = t => [...new Set(participantesDe(t).map(eid => { const c = clubDeEquipo(eid); return c && c.liga_id; }).filter(Boolean))];
  const esInterliga = t => ligasDeTorneo(t).length > 1;
  // Los torneos entre ligas no se mezclan con los de cada liga: tienen su propio apartado.
  const torneosDeLiga = lid => D.torneos.filter(t => t.liga_id === lid && !esInterliga(t));
  const torneosInterliga = () => D.torneos.filter(esInterliga);
  const urlTorneo = (t, resto) => '#/torneo/' + encodeURIComponent(t.slug) + (resto ? '/' + resto : '');
  // Torneo que se muestra de cada liga: el que eligió el visitante en esta visita o, si no,
  // el que tiene el último partido jugado (si empatan, el que está más abajo en la planilla).
  // Los torneos sin partidos cargados solo se muestran si la liga no tiene otro.
  const torneoElegido = {};
  // Fecha del último partido jugado; si todavía no se jugó ninguno, cuenta como muy vieja.
  const actividad = tid => {
    // Para una liga que todavía no se cargó entera, la fecha viene calculada en la base.
    const t = porId('torneos', tid);
    if (t && t._act != null && parcial(t.liga_id)) return t._act;
    return actividadDe(tid);
  };
  const actividadDe = tid => partidosDe(tid).reduce((m, p) => {
    const f = p.estado === 'Finalizado' ? String(p.fecha_jugada || p.fecha_programada || '0') : '0';
    return f > m ? f : m;
  }, partidosDe(tid).length ? '0' : '');
  const torneosConPartidos = lid => torneosDeLiga(lid).filter(t => partidosDe(t.id).length || esLlave(t) || String(t.clasifica || '').trim());
  const torneoActual = lid => {
    const todos = torneosDeLiga(lid);
    const elegido = todos.find(t => t.id === torneoElegido[lid]);
    if (elegido) return elegido;
    if (parcial(lid)) { const r = resumenDe(lid); return (r && porId('torneos', r.torneo)) || todos[todos.length - 1]; }
    // Una fase final en juego (con cruces cargados o clasificados ya definidos) pasa al frente.
    const fase = todos.filter(t => esLlave(t) && !terminado(t.id) && (partidosDe(t.id).length || /^(CL|E)\d/i.test(String(t.clasifica || '').trim())));
    if (fase.length) return fase[fase.length - 1];
    let mejor = null;
    todos.forEach(t => { const a = actividad(t.id); if (a && (!mejor || a >= actividad(mejor.id))) mejor = t; });
    return mejor || todos[todos.length - 1];
  };
  const ligaDeEquipo = eid => { const c = clubDeEquipo(eid); return c ? c.liga_id : null; };
  // En una fase de grupos, los partidos con "fase" (Semifinal, Final...) son los playoffs del
  // mismo torneo: no cuentan para las tablas de las zonas. Se piden con el id "T50~PO".
  const PO = '~PO';
  const esDePlayoff = p => !!String(p.fase || '').trim();
  const partidosDe = tid => {
    tid = String(tid);
    if (tid.endsWith(PO)) { const b = tid.slice(0, -PO.length); return D.partidos.filter(p => p.torneo_id === b && esDePlayoff(p)); }
    const t = porId('torneos', tid);
    const grupos = t && String(t.tipo || '').toLowerCase() === 'grupos';
    return D.partidos.filter(p => p.torneo_id === tid && !(grupos && esDePlayoff(p)));
  };
  const tieneMarcador = p => p.goles_local != null && p.goles_visitante != null;

  function resultado(p) {
    if (p.estado !== 'Finalizado') return '';
    if (tieneMarcador(p)) return p.goles_local > p.goles_visitante ? 'L' : p.goles_local < p.goles_visitante ? 'V' : 'E';
    return p.resultado_manual || '';
  }
  // G, E o P desde el punto de vista de un equipo
  function resultadoPara(p, eid) {
    const r = resultado(p);
    if (!r) return '';
    if (r === 'E') return 'E';
    return (r === 'L') === (p.local_id === eid) ? 'G' : 'P';
  }
  const ordenJugado = p => (p.fecha_jugada || p.fecha_programada || '') + String(p.fecha_nro).padStart(3, '0');

  // Con "equipos", la tabla de una zona: solo esos equipos y los partidos entre ellos.
  // En una fase de grupos sin "equipos", devuelve las tablas de todas las zonas, una
  // detrás de otra, con la zona y el puesto dentro de ella en cada fila.
  function posiciones(tid, equipos) {
    const t = {};
    const fila = id => t[id] || (t[id] = { id, PJ: 0, G: 0, E: 0, P: 0, GF: 0, GC: 0, PTS: 0, forma: [] });
    const tor = porId('torneos', tid);
    if (!equipos && esGrupos(tor)) return gruposDe(tor).flatMap(g => posiciones(tid, g.eids).map((r, i) => Object.assign(r, { grupo: g.nombre, puesto: i + 1 })));
    const solo = equipos ? new Set(equipos) : null;
    if (solo) equipos.forEach(fila);
    else if (tor && String(tor.participantes || '').trim()) participantesDe(tor).forEach(fila);
    const lista = partidosDe(tid).filter(p => !solo || (solo.has(p.local_id) && solo.has(p.visitante_id))).sort((a, b) => ordenJugado(a).localeCompare(ordenJugado(b)));
    lista.forEach(p => {
      const L = fila(p.local_id), V = fila(p.visitante_id);
      const r = resultado(p);
      if (!r) return;
      L.PJ++; V.PJ++;
      if (tieneMarcador(p)) { L.GF += p.goles_local; L.GC += p.goles_visitante; V.GF += p.goles_visitante; V.GC += p.goles_local; }
      if (r === 'L') { L.G++; V.P++; L.PTS += 3; }
      else if (r === 'V') { V.G++; L.P++; V.PTS += 3; }
      else { L.E++; V.E++; L.PTS++; V.PTS++; }
      L.forma.push(resultadoPara(p, p.local_id)); V.forma.push(resultadoPara(p, p.visitante_id));
    });
    return Object.values(t)
      .map(r => Object.assign(r, { DIF: r.GF - r.GC, forma: r.forma.slice(-5) }))
      .sort((a, b) => b.PTS - a.PTS || b.DIF - a.DIF || b.GF - a.GF);
  }

  function goleadores(tid) {
    const ids = new Set(partidosDe(tid).concat(String(tid).endsWith(PO) ? [] : partidosDe(tid + PO)).map(p => p.id));
    const g = {};
    D.eventos.filter(e => e.tipo === 'Gol' && ids.has(e.partido_id)).forEach(e => { g[e.jugador_id] = (g[e.jugador_id] || 0) + 1; });
    return Object.entries(g).map(([jid, goles]) => ({ j: porId('jugadores', jid), goles }))
      .filter(x => x.j)
      .sort((a, b) => b.goles - a.goles || a.j.apellido.localeCompare(b.j.apellido));
  }
  const nombreJugador = j => j ? `${j.nombre || ''} ${j.apellido || ''}`.trim() : 'Sin identificar';

  function fechasDe(tid) {
    return [...new Set(partidosDe(tid).map(p => p.fecha_nro))].filter(n => n != null).sort((a, b) => a - b);
  }
  const fechaPendiente = tid => fechasDe(tid).find(f => partidosDe(tid).some(p => p.fecha_nro === f && p.estado !== 'Finalizado'));
  function ultimaJugada(tid) {
    // La fecha con el partido finalizado más reciente
    const fin = partidosDe(tid).filter(p => p.estado === 'Finalizado').sort((a, b) => ordenJugado(b).localeCompare(ordenJugado(a)));
    return fin.length ? fin[0].fecha_nro : null;
  }

  // ---------- fases finales: hexagonales y llaves ----------
  // Columna "clasifica" de Torneos: de dónde salen los equipos, en orden de siembra.
  //   T08:1-8  → del 1° al 8° de la tabla del torneo T08
  //   T08:1-4, T09:1-4 → los 4 primeros de cada uno
  //   CL64, CL66, E12 → clubes o equipos puestos a mano, en ese orden
  // Mientras el torneo de origen no tenga partidos jugados, los lugares quedan como "1° Primera A".
  const esLlave = t => !!t && String(t.tipo || '').toLowerCase() === 'llave';
  // ---------- fase de grupos ----------
  // Tipo "grupos": la columna "zonas" de Torneos reparte los equipos, separadas por punto y coma:
  //   Zona A: CL02, CL04, CL07; Zona B: CL01, CL05, CL06
  // ("participantes" sigue teniendo la lista completa, sin zonas).
  // Cada zona tiene su tabla con los partidos entre sus equipos.
  const esGrupos = t => !!t && String(t.tipo || '').toLowerCase() === 'grupos';
  function gruposDe(t) {
    if (!t) return [];
    const out = [];
    String(t.zonas || t.participantes || '').split(';').map(x => x.trim()).filter(Boolean).forEach(seg => {
      const m = seg.match(/^([^:]+):(.*)$/);
      if (m) out.push({ nombre: m[1].trim(), eids: m[2].trim() ? participantesDe(Object.assign({}, t, { participantes: m[2], clasifica: '' })) : [] });
    });
    return out.length ? out : [{ nombre: 'Zona única', eids: participantesDe(t) }];
  }
  // Playoffs dentro de la fase de grupos. Columna "playoffs": cuántos pasan de cada zona (2 = 1° y 2°).
  // Se arma un torneo "virtual" tipo llave que toma esos puestos de las zonas.
  const clasificanPorZona = t => esGrupos(t) ? Number((String(t.playoffs || '').match(/\d+/) || [0])[0]) : 0;
  function playoffsDe(t) {
    if (!esGrupos(t)) return null;
    const n = clasificanPorZona(t);
    if (!n && !D.partidos.some(p => p.torneo_id === t.id && esDePlayoff(p))) return null;
    return Object.assign({}, t, { id: t.id + PO, nombre: 'Playoffs', tipo: 'llave', clasifica: n ? `${t.id}:1-${n}` : '', participantes: '', zonas: '', playoffs: '', _padre: t.id });
  }
  const playoffsEnJuego = t => { const f = playoffsDe(t); return f && partidosDe(f.id).length ? f : null; };
  const grupoDeEquipo = (t, eid) => gruposDe(t).find(g => g.eids.includes(eid)) || null;
  const grupoDePartido = (t, p) => { const g = grupoDeEquipo(t, p.local_id); return g && g.eids.includes(p.visitante_id) ? g : null; };
  // Puesto de un equipo: dentro de su zona en una fase de grupos.
  function puestoDe(t, eid) {
    const tabla = t ? posiciones(t.id) : [];
    const i = tabla.findIndex(r => r.id === eid);
    if (i < 0) return { pos: 0, fila: null };
    return { pos: tabla[i].puesto || i + 1, fila: tabla[i] };
  }
  const terminado = tid => { const ps = partidosDe(tid); return ps.length > 0 && ps.every(p => p.estado === 'Finalizado'); };
  const conJugados = tid => partidosDe(tid).some(p => p.estado === 'Finalizado');
  // T08:1-8 · T50:Zona A:1-2 · T50:1-2
  const RE_CLASIFICA = /^(T\d+)\s*:\s*(?:([^:]+?)\s*:\s*)?(\d+)(?:\s*-\s*(\d+))?$/;
  let sembrando = new Set();
  function sembrados(t) {
    const segs = String(t.clasifica || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
    const out = [];
    if (sembrando.has(t.id)) return out;
    sembrando.add(t.id);
    try {
      const deCategoria = e => !t.categoria || !e.categoria || e.categoria === t.categoria;
      segs.forEach(seg => {
        const m = seg.toUpperCase().match(RE_CLASIFICA);
        if (m) {
          const src = porId('torneos', m[1]);
          const a = Number(m[3]), b = Number(m[4] || m[3]);
          const jugado = src && conJugados(src.id);
          // De una fase de grupos: "T50:Zona A:1-2" (una zona) o "T50:1-2" (esos puestos de cada zona: 1° A, 1° B, 2° A, 2° B...).
          if (esGrupos(src)) {
            const zonas = m[2] ? gruposDe(src).filter(g => g.nombre.toUpperCase() === m[2].trim()) : gruposDe(src);
            for (let i = a; i <= b; i++) zonas.forEach(g => {
              const fila = jugado ? posiciones(src.id, g.eids)[i - 1] : null;
              out.push({ eid: fila ? fila.id : null, etiqueta: `${i}° ${g.nombre}`, provisorio: !!fila && !terminado(src.id) });
            });
            return;
          }
          const tabla = jugado ? posiciones(src.id) : [];
          for (let i = a; i <= b; i++) {
            const fila = tabla[i - 1];
            out.push({ eid: fila ? fila.id : null, etiqueta: `${i}° ${src ? src.nombre : m[1]}`, provisorio: !!fila && !terminado(src.id) });
          }
          return;
        }
        const K = seg.toUpperCase();
        if (/^CL\d+$/.test(K)) { const e = D.equipos.find(x => x.club_id === K && deCategoria(x)); out.push({ eid: e ? e.id : null, etiqueta: (porId('clubes', K) || {}).nombre || K }); }
        else if (porId('equipos', K)) out.push({ eid: K, etiqueta: nombreEquipo(K) });
      });
    } finally { sembrando.delete(t.id); }
    return out;
  }
  const nombreRonda = equipos => ({ 2: 'Final', 4: 'Semifinal', 8: 'Cuartos de final', 16: 'Octavos de final', 32: '16avos de final' }[equipos] || `Ronda de ${equipos}`);
  const rangoFase = f => { const x = String(f || '').toLowerCase(); return /dieci|16avos/.test(x) ? 0 : /octav/.test(x) ? 1 : /cuart/.test(x) ? 2 : /semi/.test(x) ? 3 : /tercer/.test(x) ? 4 : /final/.test(x) ? 5 : 2.5; };
  // Orden clásico de una llave: 1 contra el último, y los dos mejores solo se cruzan en la final.
  function ordenLlave(P) {
    let o = [1];
    while (o.length < P) { const n = o.length * 2 + 1; o = o.flatMap(x => [x, n - x]); }
    return o;
  }
  // Ganador de un cruce: suma de goles de la ida y la vuelta; si empatan, penales del último partido.
  function definirCruce(a, b, ps) {
    const r = { a, b, ps, ga: 0, gb: 0, ganador: null, pen: '' };
    if (!a || !b || !ps.length) return r;
    ps.forEach(p => {
      if (!tieneMarcador(p)) return;
      if (p.local_id === a) { r.ga += p.goles_local; r.gb += p.goles_visitante; } else { r.ga += p.goles_visitante; r.gb += p.goles_local; }
    });
    if (ps.some(p => p.estado !== 'Finalizado')) return r;
    if (r.ga !== r.gb) { r.ganador = r.ga > r.gb ? a : b; return r; }
    const u = ps[ps.length - 1];
    // Ventaja deportiva o definición cargada a mano: resultado_manual L/V del último partido.
    if (u.resultado_manual === 'L' || u.resultado_manual === 'V') { r.ganador = (u.resultado_manual === 'L') === (u.local_id === a) ? a : b; return r; }
    const m = String(u.penales || '').match(/(\d+)\s*[-a]\s*(\d+)/);
    if (m) { r.pen = u.local_id === a ? `${m[1]}-${m[2]}` : `${m[2]}-${m[1]}`; const pl = Number(m[1]), pv = Number(m[2]); if (pl !== pv) r.ganador = (pl > pv) === (u.local_id === a) ? a : b; return r; }
    const res = resultado(u);
    if (res === 'L' || res === 'V') r.ganador = (res === 'L') === (u.local_id === a) ? a : b;
    return r;
  }
  const entre = (ps, a, b) => ps.filter(p => (p.local_id === a && p.visitante_id === b) || (p.local_id === b && p.visitante_id === a))
    .sort((x, y) => ordenJugado(x).localeCompare(ordenJugado(y)));

  // "Ganador Balonpié / Casariego" mientras el cruce no se define.
  const etiquetaGanador = c => {
    const n = x => x ? (x.eid ? nombreEquipo(x.eid) : x.etiqueta) : '';
    return c.A && c.B && c.A.eid && c.B.eid ? `Ganador ${n(c.A)} / ${n(c.B)}` : 'A definir';
  };
  // Arma la llave completa: rondas → cruces {a, b, etiquetas, partidos, ganador}.
  function armarLlave(t) {
    const ps = partidosDe(t.id);
    const semillas = String(t.clasifica || '').trim() ? sembrados(t) : participantesDe(t).map(eid => ({ eid, etiqueta: nombreEquipo(eid) }));
    const usados = new Set();
    const lado = s => s ? { eid: s.eid, etiqueta: s.etiqueta } : null;
    // 1) Con siembra: la estructura sale de las posiciones y los partidos se ubican por cruce.
    if (semillas.length >= 2 && (String(t.clasifica || '').trim() || !ps.some(p => p.fase))) {
      const n = semillas.length, P = 2 ** Math.ceil(Math.log2(n));
      const orden = ordenLlave(P);
      let ronda = [];
      for (let i = 0; i < P; i += 2) ronda.push({ A: lado(semillas[orden[i] - 1]), B: lado(semillas[orden[i + 1] - 1]), sa: orden[i], sb: orden[i + 1] });
      const rondas = [];
      let equipos = P;
      while (ronda.length) {
        ronda.forEach(c => {
          const a = c.A && c.A.eid, b = c.B && c.B.eid;
          if (!c.A || !c.B) { c.bye = true; c.ganador = a || b || null; c.ps = []; return; }
          const lista = a && b ? entre(ps, a, b) : [];
          lista.forEach(p => usados.add(p.id));
          Object.assign(c, definirCruce(a, b, lista));
        });
        rondas.push({ nombre: (ronda.find(c => c.ps && c.ps.find(p => p.fase)) || { ps: [{}] }).ps.find(p => p.fase)?.fase || nombreRonda(equipos), cruces: ronda });
        if (ronda.length === 1) break;
        const sig = [];
        for (let i = 0; i < ronda.length; i += 2) {
          const x = ronda[i], y = ronda[i + 1];
          const de = c => c.ganador ? { eid: c.ganador, etiqueta: nombreEquipo(c.ganador) } : { eid: null, etiqueta: c.bye ? (c.A || c.B || {}).etiqueta || 'A definir' : etiquetaGanador(c) };
          sig.push({ A: de(x, i + 1), B: de(y, i + 2) });
        }
        ronda = sig; equipos /= 2;
      }
      // Si los partidos cargados no coinciden con la siembra, se muestran tal cual se cargaron.
      if (!ps.length || ps.every(p => usados.has(p.id))) return { rondas, sembrada: true };
    }
    // 2) Sin siembra: rondas según la columna "fase" de cada partido.
    const porFase = {};
    ps.forEach(p => { const f = p.fase || 'Fase final'; (porFase[f] = porFase[f] || []).push(p); });
    const fases = Object.keys(porFase).sort((x, y) => rangoFase(x) - rangoFase(y) || ordenJugado(porFase[x][0]).localeCompare(ordenJugado(porFase[y][0])));
    const rondas = fases.map(f => {
      const grupos = {};
      porFase[f].slice().sort((x, y) => ordenJugado(x).localeCompare(ordenJugado(y))).forEach(p => {
        const k = p.llave != null ? 'n' + p.llave : [p.local_id, p.visitante_id].sort().join('|');
        (grupos[k] = grupos[k] || []).push(p);
      });
      const cruces = Object.keys(grupos).sort((x, y) => (grupos[x][0].llave || 0) - (grupos[y][0].llave || 0)).map(k => {
        const l = grupos[k], a = l[0].local_id, b = l[0].visitante_id;
        return Object.assign({ A: { eid: a, etiqueta: nombreEquipo(a) }, B: { eid: b, etiqueta: nombreEquipo(b) } }, definirCruce(a, b, l));
      });
      return { nombre: f, cruces };
    });
    // Rondas que faltan hasta la final, con "Ganador llave N".
    let ult = rondas[rondas.length - 1];
    while (ult && ult.cruces.length > 1 && !/tercer/i.test(ult.nombre)) {
      const sig = [];
      for (let i = 0; i < ult.cruces.length; i += 2) {
        const de = c => c && c.ganador ? { eid: c.ganador, etiqueta: nombreEquipo(c.ganador) } : { eid: null, etiqueta: c ? etiquetaGanador(c) : 'A definir' };
        sig.push({ A: de(ult.cruces[i], i + 1), B: de(ult.cruces[i + 1], i + 2), ps: [] });
      }
      ult = { nombre: nombreRonda(sig.length * 2), cruces: sig };
      rondas.push(ult);
    }
    return { rondas, sembrada: false };
  }

  // Zonas de la tabla según las fases que toman equipos de ella (columna "clasifica").
  function zonasDe(t) {
    const refs = D.torneos.filter(x => x.id !== t.id && String(x.clasifica || '').toUpperCase().split(/[,;]+/).some(seg => seg.trim().startsWith(t.id.toUpperCase() + ':')));
    const propios = playoffsDe(t);
    if (propios && propios.clasifica) refs.push(propios);
    if (!refs.length) {
      const z = (CFG.ZONAS || {})[t.id];
      return z ? { clase: i => i < z.semis ? 'zona-semi' : i < z.cuartos ? 'zona-cuartos' : '', leyenda: [['ref-semi', 'Semifinales directas'], ['ref-cuartos', 'Cuartos de final']] } : null;
    }
    // Clave "zona|puesto": en una fase de grupos cada zona se marca aparte.
    const mapa = {}, leyenda = [];
    refs.forEach(r => {
      let idx = 0;
      const total = sembrados(r).length;
      const P = 2 ** Math.ceil(Math.log2(Math.max(total, 2)));
      const byes = esLlave(r) ? P - total : 0;
      String(r.clasifica).toUpperCase().split(/[,;]+/).forEach(seg => {
        const m = seg.trim().match(RE_CLASIFICA);
        if (!m) { idx++; return; }
        const src = porId('torneos', m[1]);
        const zonas = esGrupos(src) ? (m[2] ? gruposDe(src).filter(g => g.nombre.toUpperCase() === m[2].trim()) : gruposDe(src)) : [null];
        for (let i = Number(m[3]); i <= Number(m[4] || m[3]); i++) zonas.forEach(g => {
          if (m[1] === t.id.toUpperCase()) { const k = (g ? g.nombre : '') + '|' + (i - 1); mapa[k] = mapa[k] || (byes && idx < byes ? 'zona-semi' : byes ? 'zona-cuartos' : 'zona-semi'); }
          idx++;
        });
      });
      if (byes) leyenda.push(['ref-semi', `Pasan directo a ${nombreRonda(P / 2)}`], ['ref-cuartos', `Juegan ${nombreRonda(P)}`]);
      else leyenda.push(['ref-semi', r._padre ? 'Clasifican a los playoffs' : `Clasifican a ${r.nombre}`]);
    });
    return { clase: (i, grupo) => mapa[(grupo || '') + '|' + i] || '', leyenda };
  }

  function dibujarLlave(t) {
    const { rondas } = armarLlave(t);
    if (!rondas.length) return '<p class="vacio">Todavía no hay cruces definidos.</p>';
    const fav = favorito();
    const provisorio = String(t.clasifica || '').trim() && sembrados(t).some(s => s.provisorio);
    const fase = t._padre ? 'la fase de grupos' : 'la fase regular';
    const fila = (sd, goles, gana, pierde) => {
      const club = sd && sd.eid ? clubDeEquipo(sd.eid) : null;
      const nombre = esc(sd ? (sd.eid ? nombreEquipo(sd.eid) : sd.etiqueta) : 'A definir');
      const cont = sd && sd.eid ? `<a href="${linkClub(sd.eid)}">${escudo(club)}<span>${nombre}</span></a>` : `<span class="llave__pendiente">${nombre}</span>`;
      return `<div class="llave__equipo${gana ? ' gana' : ''}${pierde ? ' pierde' : ''}${sd && fav.equipo && sd.eid === fav.equipo ? ' es-favorito' : ''}">${cont}<b>${goles}</b></div>`;
    };
    const detalle = c => {
      if (c.bye) return '<small>Pasa directo</small>';
      if (!c.ps || !c.ps.length) return '<small>A jugar</small>';
      const partes = c.ps.map((p, i) => {
        const et = c.ps.length > 1 ? (i === 0 ? 'Ida' : i === 1 ? 'Vuelta' : 'Desempate') : '';
        const m = tieneMarcador(p) ? `${p.local_id === c.a ? p.goles_local : p.goles_visitante}-${p.local_id === c.a ? p.goles_visitante : p.goles_local}` : (p.estado === 'Finalizado' ? 'jugado' : fecha(p.fecha_programada) || 'a programar');
        return `${et ? et + ' ' : ''}${esc(m)}`;
      });
      return `<small>${partes.join(' · ')}${c.pen ? ` · Penales ${esc(c.pen)}` : ''}</small>`;
    };
    return `${provisorio ? '<p class="nota" style="margin:0 0 12px">Cruces provisorios según la tabla actual: se confirman cuando termine ' + fase + '.</p>' : ''}
      <div class="llave" style="--rondas:${rondas.length}">${rondas.map(r => `
        <section class="llave__ronda"><h3>${esc(r.nombre)}</h3><div class="llave__cruces">${r.cruces.map(c => {
          const g = c.ganador;
          const ga = c.bye || !c.ps || !c.ps.some(tieneMarcador) ? '' : c.ga, gb = c.bye || !c.ps || !c.ps.some(tieneMarcador) ? '' : c.gb;
          const eA = c.A && c.A.eid, eB = c.B && c.B.eid;
          return `<div class="llave__cruce${c.bye ? ' llave__cruce--bye' : ''}">
            ${c.bye ? fila(c.A || c.B, '', true, false) : fila(c.A, ga, g && g === eA, g && g !== eA) + fila(c.B, gb, g && g === eB, g && g !== eB)}
            ${detalle(c)}</div>`;
        }).join('')}</div></section>`).join('')}
      </div>`;
  }
  // Resumen corto para la portada: la ronda que se está jugando.
  function llaveCompacta(t) {
    const { rondas } = armarLlave(t);
    const r = rondas.find(x => x.cruces.some(c => !c.bye && !c.ganador && c.A && c.B && c.A.eid && c.B.eid)) || rondas[rondas.length - 1];
    if (!r) return '<p class="vacio">Cruces a definir.</p>';
    return `<ul class="partidos llave-mini"><li class="partido" style="padding:8px 16px"><b>${esc(r.nombre)}</b></li>${r.cruces.filter(c => !c.bye).map(c => {
      const n = x => esc(x ? (x.eid ? nombreEquipo(x.eid) : x.etiqueta) : 'A definir');
      const m = c.ps && c.ps.some(tieneMarcador) ? ` <b>${c.ga}-${c.gb}</b> ` : ' vs ';
      return `<li class="partido" style="padding:8px 16px">${c.ganador === (c.A && c.A.eid) ? `<b>${n(c.A)}</b>` : n(c.A)}${m}${c.ganador === (c.B && c.B.eid) ? `<b>${n(c.B)}</b>` : n(c.B)}</li>`;
    }).join('')}</ul>`;
  }

  // ---------- favoritos ----------
  const favorito = () => leer('favorito') || {};
  function setFavorito(f) { guardar('favorito', f); actualizarNav(); dibujarCinta(); iniciarVivo(); }
  function actualizarNav() {
    const f = favorito();
    document.getElementById('nav-favorito').textContent = f.equipo ? nombreEquipo(f.equipo) : 'Mi equipo';
  }

  // ---------- componentes ----------
  const ESCUDO_PATH = 'M16 2l13 4.5v10.2C29 25 23.6 30.4 16 34 8.4 30.4 3 25 3 16.7V6.5z';
  function escudo(club, tam) {
    if (!club) return '';
    const img = urlSegura(club.escudo);
    const cls = `escudo${tam ? ' escudo--' + tam : ''}`;
    if (img) return `<span class="${cls}"><img src="${esc(img)}" alt=""></span>`;
    return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 32 36"><path d="${ESCUDO_PATH}"/></svg><span>${esc(iniciales(club.nombre))}</span></span>`;
  }
  const forma = lista => `<span class="forma" aria-label="Últimos resultados: ${lista.map(x => ({ G: 'ganó', E: 'empató', P: 'perdió' }[x])).join(', ')}">${lista.map(x => `<i class="${x}">${x}</i>`).join('')}</span>`;
  const linkClub = eid => { const c = clubDeEquipo(eid); return c ? `#/club/${esc(c.id)}` : '#/'; };

  function filaCompacta(p) {
    const fav = favorito();
    const r = resultado(p);
    const fila = (eid, goles, gano) => `<a class="compacto__equipo${gano ? ' gana' : ''}" href="${linkClub(eid)}">${escudo(clubDeEquipo(eid))}<span>${esc(nombreEquipo(eid))}</span></a><b>${goles == null ? '' : goles}</b>`;
    const estado = p.estado === 'En juego' ? '<span class="vivo">En juego</span>' : esc(p.estado);
    const esFav = fav.equipo && (fav.equipo === p.local_id || fav.equipo === p.visitante_id);
    return `<li class="partido partido--compacto${esFav ? ' es-favorito' : ''}">
      <div class="compacto__estado">${estado}, ${fecha(p.fecha_jugada || p.fecha_programada)}${p.hora ? `, ${esc(p.hora)}` : ''}</div>
      <div class="compacto__filas">${fila(p.local_id, p.goles_local, r === 'L')}${fila(p.visitante_id, p.goles_visitante, r === 'V')}</div></li>`;
  }

  function filaPartido(p, opciones) {
    if (opciones && opciones.compacto) return filaCompacta(p);
    const fav = favorito();
    const r = resultado(p);
    const vivo = p.estado === 'En juego';
    const lado = (eid, esLocal) => {
      const pierde = (r === 'L' && !esLocal) || (r === 'V' && esLocal);
      const club = clubDeEquipo(eid);
      const nombre = `<span>${esc(nombreEquipo(eid))}</span>`;
      return `<a class="lado ${esLocal ? 'lado--local' : ''} ${pierde ? 'pierde' : ''}" href="${linkClub(eid)}">${esLocal ? nombre + escudo(club) : escudo(club) + nombre}</a>`;
    };
    let marcador;
    if (tieneMarcador(p)) marcador = `<div class="marcador${vivo ? ' marcador--vivo' : ''}" aria-label="Resultado">${p.goles_local}<span aria-hidden="true">-</span>${p.goles_visitante}</div>`;
    else if (p.estado === 'Finalizado' && r) marcador = `<div class="marcador marcador--nada" title="Marcador sin publicar">–</div>`;
    else marcador = `<div class="marcador marcador--nada">${p.hora ? esc(p.hora) : 'vs'}</div>`;
    const estado = vivo ? '<b class="vivo">En juego</b>'
      : p.estado === 'Finalizado' ? '<b>Final</b>' : p.estado === 'Postergado' ? '<b>Postergado</b>' : '<b>Programado</b>';
    const cuando = fecha(p.fecha_jugada || p.fecha_programada);

    // goles agrupados por jugador y asignados al equipo que los suma
    const grupos = [];
    D.eventos.filter(e => e.partido_id === p.id && (e.tipo === 'Gol' || e.tipo === 'Gol en contra')).forEach(e => {
      const k = (e.jugador_id || 'sin-' + e.equipo_id) + e.tipo;
      const g = grupos.find(x => x.k === k);
      if (g) { g.n++; if (e.minuto) g.min.push(e.minuto); }
      else grupos.push({ k, j: porId('jugadores', e.jugador_id), eq: e.equipo_id || (porId('jugadores', e.jugador_id) || {}).equipo_id, contra: e.tipo === 'Gol en contra', n: 1, min: e.minuto ? [e.minuto] : [] });
    });
    const paraLocal = g => g.contra ? g.eq !== p.local_id : g.eq === p.local_id;
    const li = g => `<li>${esc(nombreJugador(g.j))}${g.n > 1 ? ` (${g.n})` : ''}${g.contra ? ', en contra' : ''}${g.min.length ? ` ${g.min.map(m => esc(m) + "'").join(', ')}` : ''}</li>`;
    const gl = grupos.filter(paraLocal).map(li).join(''), gv = grupos.filter(g => !paraLocal(g)).map(li).join('');
    const notas = [];
    if (p.estado === 'Finalizado' && !tieneMarcador(p) && r) notas.push(`Ganó ${esc(nombreEquipo(r === 'L' ? p.local_id : p.visitante_id))}; el marcador no se publicó.`);
    if (p.cancha) notas.push(esc(p.cancha));
    const fuente = !(opciones && opciones.sinFuente) ? urlSegura(p.fuente) : '';
    const esFav = fav.equipo && (fav.equipo === p.local_id || fav.equipo === p.visitante_id);
    return `<li class="partido${esFav ? ' es-favorito' : ''}">
      <div class="partido__fila">
        <div class="partido__estado">${estado}<span>${opciones && opciones.conFecha ? `Fecha ${p.fecha_nro}, ` : ''}${cuando}</span>${fuente ? `<a href="${esc(fuente)}" target="_blank" rel="noopener">Crónica</a>` : ''}</div>
        ${lado(p.local_id, true)}${marcador}${lado(p.visitante_id, false)}
      </div>
      ${(gl || gv) ? `<div class="partido__goles"><ul aria-label="Goles de ${esc(nombreEquipo(p.local_id))}">${gl}</ul><ul aria-label="Goles de ${esc(nombreEquipo(p.visitante_id))}">${gv}</ul></div>` : ''}
      ${notas.length ? `<div class="partido__pie">${notas.join(' ')}</div>` : ''}
    </li>`;
  }

  function tablaPosiciones(t, opciones) {
    const compacta = opciones && opciones.compacta;
    const zonas = zonasDe(t);
    const fav = favorito();
    let filas = (opciones && opciones.filas) || posiciones(t.id);
    if (compacta) filas = filas.slice(0, opciones.limite || 4);
    return `<table class="tabla${compacta ? ' mini-tabla' : ''}">
      <caption class="saltar">Tabla de posiciones de ${esc(t.nombre)}</caption>
      <thead><tr><th scope="col">#</th><th scope="col" class="c-equipo">Equipo</th>
        ${compacta ? '' : '<th scope="col" title="Partidos jugados">PJ</th><th scope="col" title="Ganados">G</th><th scope="col" title="Empatados">E</th><th scope="col" title="Perdidos">P</th><th scope="col" class="ocultar-movil" title="Goles a favor">GF</th><th scope="col" class="ocultar-movil" title="Goles en contra">GC</th>'}
        <th scope="col" title="Diferencia de gol">Dif</th><th scope="col" title="Puntos">Pts</th>
        ${compacta ? '' : '<th scope="col" class="ocultar-movil">Últimos 5</th>'}</tr></thead>
      <tbody>${filas.map((r, i) => {
        const cls = [zonas ? zonas.clase(i, opciones && opciones.grupo) : '', fav.equipo === r.id ? 'es-favorito' : ''].join(' ').trim();
        return `<tr class="${cls}"><td class="c-pos">${i + 1}</td>
          <td class="c-equipo"><a class="equipo-celda" href="${linkClub(r.id)}">${escudo(clubDeEquipo(r.id))}<span>${esc(nombreEquipo(r.id))}</span></a></td>
          ${compacta ? '' : `<td>${r.PJ}</td><td>${r.G}</td><td>${r.E}</td><td>${r.P}</td><td class="ocultar-movil">${r.GF}</td><td class="ocultar-movil">${r.GC}</td>`}
          <td class="c-dif">${r.DIF > 0 ? '+' : ''}${r.DIF}</td><td class="c-pts">${r.PTS}</td>
          ${compacta ? '' : `<td class="ocultar-movil">${forma(r.forma)}</td>`}</tr>`;
      }).join('')}</tbody></table>`;
  }

  function listaGoleadores(t, limite, compacto) {
    let lista = goleadores(t.id);
    if (!lista.length) return '<p class="vacio">Todavía no hay goles cargados.</p>';
    const max = lista[0].goles;
    let puesto = 0, ant = null;
    lista = lista.map((x, i) => { if (x.goles !== ant) { puesto = i + 1; ant = x.goles; } return Object.assign({ puesto }, x); });
    if (limite) lista = lista.slice(0, limite);
    return `<ol class="goleadores${compacto ? ' goleadores--compacto' : ''}">${lista.map(x => {
      const club = clubDeEquipo(x.j.equipo_id);
      return `<li><span class="num">${x.puesto}</span>
        <span class="quien"><b>${esc(nombreJugador(x.j))}</b><small>${esc(club ? club.nombre : '')}</small></span>
        <span class="barra" aria-hidden="true"><i style="width:${Math.round(x.goles / max * 100)}%"></i></span>
        <span class="goles">${x.goles}</span></li>`;
    }).join('')}</ol>`;
  }

  // ---------- cinta de resultados ----------
  function dibujarCinta() {
    const $c = document.getElementById('cinta');
    const f = favorito();
    const liga = porId('ligas', f.liga) || D.ligas[0];
    const t = liga && torneoActual(liga.id);
    if (!t) { $c.innerHTML = ''; return; }
    const n = ultimaJugada(t.id);
    const partidos = partidosDe(t.id).filter(p => p.fecha_nro === n && p.estado === 'Finalizado');
    if (!partidos.length) { $c.innerHTML = ''; return; }
    $c.innerHTML = `<div class="cinta__dentro"><span class="cinta__titulo">${esc(liga.ciudad || liga.nombre)}, fecha ${n}</span>${partidos.map(p => {
      const r = resultado(p);
      const fila = (eid, goles, gano) => `<span class="${gano ? 'gana' : r && r !== 'E' ? 'pierde' : ''}">${esc(nombreEquipo(eid))}</span><b>${goles == null ? (gano ? 'G' : r === 'E' ? 'E' : '') : goles}</b>`;
      return `<a class="cinta__item" href="${urlLiga(liga, 'fechas/' + n)}">${fila(p.local_id, p.goles_local, r === 'L')}${fila(p.visitante_id, p.goles_visitante, r === 'V')}</a>`;
    }).join('')}</div>`;
  }

  // ---------- vistas ----------
  function vistaInicio() {
    const fav = favorito();
    $main.innerHTML = `
      <section class="portada">
        <div class="contenedor portada__grilla">
          <div>
            <h1>El fútbol de las ligas regionales</h1>
            <p>Tablas, fixture, goleadores y noticias de cada liga amateur del país, cargados por los propios clubes.</p>
            <div class="acciones">
              <a class="boton boton--primario" href="#/ligas">Ver ligas</a>
              <a class="boton boton--claro" href="#/mi-equipo">Seguir a mi equipo</a>
            </div>
          </div>
          <div id="mapa" class="mapa" role="region" aria-label="Mapa de ligas adheridas"></div>
        </div>
      </section>
      <div class="contenedor pagina">
        <div class="grilla">
          <div>${D.ligas.map(l => {
            const t0 = torneoActual(l.id);
            // Con los playoffs en juego, la portada muestra los cruces en vez de las zonas.
            const t = (t0 && !parcial(l.id) && playoffsEnJuego(t0)) || t0;
            const n = t && ultimaJugada(t.id);
            const ultimos = t ? partidosDe(t.id).filter(p => p.fecha_nro === n && p.estado === 'Finalizado') : [];
            return `<section class="panel liga-resumen">
              <div class="panel__cabeza"><div class="liga-resumen__titulo">${escudo({ nombre: l.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''), escudo: l.logo }, 'm')}
                <div><h2>${esc(l.nombre)}</h2><p>${esc(l.ciudad)}, ${esc(l.provincia)}${t0 ? `. ${esc(t0.nombre)}${t !== t0 ? ', playoffs' : ''}` : ''}</p></div></div>
                <a href="${urlLiga(l)}">Ver liga</a></div>
              ${t && esLlave(t) ? llaveCompacta(t) : t && esGrupos(t) && !parcial(l.id) ? gruposDe(t).map(g => `<p class="mini-zona">${esc(g.nombre)}</p>${tablaPosiciones(t, { compacta: true, limite: 2, filas: posiciones(t.id, g.eids), grupo: g.nombre })}`).join('') : t ? tablaPosiciones(t, { compacta: true, limite: 4, filas: parcial(l.id) && resumenDe(l.id) && resumenDe(l.id).torneo === t.id ? resumenDe(l.id).tabla : null }) : '<p class="vacio">Sin torneo cargado.</p>'}
              ${ultimos.length ? `<div class="panel__cabeza" style="border-top:1px solid var(--linea)"><h3>Fecha ${n}</h3><a href="${urlLiga(l, t !== t0 ? 'playoffs' : 'fechas/' + n)}">${t !== t0 ? 'Ver cuadro' : 'Todas las fechas'}</a></div>
                <ul class="partidos">${ultimos.map(p => filaPartido(p, { sinFuente: true })).join('')}</ul>` : ''}
            </section>`;
          }).join('')}</div>
          <aside>${torneosInterliga().length ? `<section class="panel"><div class="panel__cabeza"><h2>Torneos entre ligas</h2><a href="#/torneos">Ver todos</a></div>
            <ul class="partidos">${torneosInterliga().map(t => `<li class="partido" style="padding:12px 16px"><a href="${urlTorneo(t)}" style="font-weight:650">${esc(t.nombre)} ${esc(t.temporada)}</a><small style="display:block;color:var(--tinta-3)">${resumenTorneo(t)}</small></li>`).join('')}</ul></section>` : ''}
            ${noticiasMini(null, 5)}</aside>
        </div>
      </div>`;
    dibujarMapa();
  }

  let geoArgentina = null;
  async function dibujarMapa() {
    const el = document.getElementById('mapa');
    try {
      if (!geoArgentina) geoArgentina = await (await fetch('data/argentina.json')).json();
    } catch (e) { el.innerHTML = '<p class="vacio">No se pudo cargar el mapa.</p>'; return; }
    if (!document.body.contains(el)) return;
    const fav = favorito();
    mapa = window.MapaArgentina.crear(el, {
      geo: geoArgentina,
      ligas: D.ligas,
      favorita: fav.liga,
      resumenLiga: l => {
        const t = torneoActual(l.id);
        const clubes = D.clubes.filter(c => c.liga_id === l.id).length;
        const r = resumenDe(l.id);
        const lider = t && (parcial(l.id) ? (r && r.torneo === t.id ? r.lider : null) : posiciones(t.id)[0]);
        return `<dl class="mapa-ar__datos"><div><dt>Clubes</dt><dd>${clubes}</dd></div>${t ? `<div><dt>Torneo</dt><dd>${esc(t.nombre)}</dd></div>` : ''}${lider ? `<div><dt>Puntero</dt><dd>${esc(nombreEquipo(lider.id))}, ${lider.PTS} pts</dd></div>` : ''}</dl>`;
      }
    });
  }

  const SECCIONES = [['posiciones', 'Tabla'], ['fechas', 'Fixture'], ['goleadores', 'Goleadores'], ['noticias', 'Noticias'], ['clubes', 'Clubes']];

  function vistaLiga(lid, seccion, extra) {
    const liga = porId('ligas', lid);
    if (!liga) return vistaNoEncontrada('Esa liga no existe o ya no está adherida.');
    const t = torneoActual(lid);
    const fp = t && playoffsDe(t);
    seccion = SECCIONES.some(s => s[0] === seccion) || (fp && seccion === 'playoffs') ? seccion : 'posiciones';
    const fav = favorito();
    const esFav = fav.liga === lid;
    const hayVivo = t && partidosDe(t.id).some(p => p.estado === 'En juego');
    const visibles = torneosConPartidos(lid);
    if (t && !visibles.includes(t)) visibles.unshift(t);
    const SECC = SECCIONES.map(([k, n]) => [k, k === 'posiciones' && esLlave(t) ? 'Llave' : n]);
    if (fp) SECC.splice(1, 0, ['playoffs', 'Playoffs']);
    $main.innerHTML = `
      <section class="banda"><div class="contenedor">
        <div class="banda__fila">
          <div class="banda__id">${escudo({ nombre: liga.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''), escudo: liga.logo }, 'l')}
            <div><h1>${esc(liga.nombre)}</h1>
              <p>${t ? `${esc(t.nombre)}, ${esc(t.categoria)} ${esc(t.temporada)}` : 'Sin torneo cargado'}</p>
              <div class="chips">${hayVivo ? '<span class="chip chip--vivo">Partidos en juego</span>' : ''}${t && t.estado ? `<span class="chip">${esc(t.estado)}</span>` : ''}<span class="chip">${D.clubes.filter(c => c.liga_id === lid).length} clubes</span></div>
            </div></div>
          <div class="acciones">
            <button class="boton boton--claro" id="btn-liga-fav" aria-pressed="${esFav}">${esFav ? 'Es tu liga' : 'Elegir como mi liga'}</button>
            <a class="boton boton--primario" href="#/mi-equipo">Seguir a mi equipo</a>
          </div>
        </div>
        ${visibles.length > 1 ? `<div class="chips torneos" role="group" aria-label="Elegir torneo">${visibles.map(x => `<button class="chip${t && x.id === t.id ? ' chip--activo' : ''}" data-torneo="${esc(x.id)}" aria-pressed="${t && x.id === t.id}">${esc(x.nombre)}</button>`).join('')}</div>` : ''}
        <nav class="pestanas" aria-label="Secciones de la liga">
          ${SECC.map(([k, n]) => `<a href="${urlLiga(liga, k)}" ${k === seccion ? 'aria-current="page"' : ''}>${n}</a>`).join('')}
        </nav>
      </div></section>
      <div class="contenedor pagina" id="seccion"></div>`;
    document.getElementById('btn-liga-fav').addEventListener('click', () => {
      if (favorito().liga === lid) { setFavorito({}); aviso('Quitaste esta liga de tus favoritas.'); }
      else { setFavorito({ liga: lid }); aviso('Guardamos esta liga como tu favorita.'); }
      vistaLiga(lid, seccion, extra);
    });
    $main.querySelectorAll('[data-torneo]').forEach(b => b.addEventListener('click', () => {
      torneoElegido[lid] = b.dataset.torneo;
      vistaLiga(lid, seccion === 'fechas' ? 'fechas' : seccion);
    }));
    const $s = document.getElementById('seccion');
    if (!t && seccion !== 'noticias' && seccion !== 'clubes') { $s.innerHTML = '<p class="vacio">Esta liga todavía no cargó su torneo.</p>'; return; }
    ({ posiciones: secTabla, playoffs: secPlayoffs, fechas: secFixture, goleadores: secGoleadores, noticias: secNoticias, clubes: secClubes }[seccion])($s, liga, t, extra);
  }

  function secTabla($s, liga, t) {
    if (esLlave(t)) {
      $s.innerHTML = `<section class="panel"><div class="panel__cabeza"><h2>${esc(t.nombre)}</h2></div><div class="llave-caja">${dibujarLlave(t)}</div></section>
        ${t.formato ? `<p class="nota" style="margin-left:0">${esc(t.formato)}</p>` : ''}`;
      return;
    }
    if (String(t.clasifica || '').trim() && !participantesDe(t).length) {
      const s = sembrados(t);
      $s.innerHTML = `<section class="panel"><div class="panel__cabeza"><h2>${esc(t.nombre)}</h2></div>
        <p class="vacio">Los equipos se definen al terminar la fase anterior.${s.length ? ` Clasifican: ${s.map(x => esc(x.etiqueta)).join(', ')}.` : ''}</p></section>
        ${t.formato ? `<p class="nota" style="margin-left:0">${esc(t.formato)}</p>` : ''}`;
      return;
    }
    const zonas = zonasDe(t);
    const pend = fechaPendiente(t.id);
    const proximos = pend != null ? partidosDe(t.id).filter(p => p.fecha_nro === pend && p.estado !== 'Finalizado') : [];
    const sinMarcador = partidosDe(t.id).some(p => p.estado === 'Finalizado' && !tieneMarcador(p));
    $s.innerHTML = `<div class="grilla">
      <div>
        ${esGrupos(t) ? gruposDe(t).map(g => `<section class="panel panel--zona">
          <div class="panel__cabeza"><h2>${esc(g.nombre)}</h2><span class="zona-cuenta">${g.eids.length} equipos</span></div>
          <div style="overflow-x:auto">${tablaPosiciones(t, { filas: posiciones(t.id, g.eids), grupo: g.nombre })}</div>
        </section>`).join('') + (zonas ? `<div class="referencias referencias--suelta">${zonas.leyenda.map(([c, x]) => `<span class="${c}">${esc(x)}</span>`).join('')}</div>` : '')
        : `<section class="panel">
          <div class="panel__cabeza"><h2>Tabla de posiciones</h2></div>
          <div style="overflow-x:auto">${tablaPosiciones(t)}</div>
          ${zonas ? `<div class="referencias">${zonas.leyenda.map(([c, x]) => `<span class="${c}">${esc(x)}</span>`).join('')}</div>` : ''}
        </section>`}
        ${t.formato ? `<p class="nota" style="margin-left:0">${esc(t.formato)}${sinMarcador ? ' Los partidos sin marcador publicado suman puntos pero no goles.' : ''}</p>` : ''}
      </div>
      <aside>
        ${playoffsEnJuego(t) ? `<section class="panel"><div class="panel__cabeza"><h2>Playoffs</h2><a href="${urlLiga(liga, 'playoffs')}">Ver cuadro</a></div>${llaveCompacta(playoffsDe(t))}</section>` : ''}
        ${proximos.length ? `<section class="panel"><div class="panel__cabeza"><h2>Fecha ${pend}</h2><a href="${urlLiga(liga, 'fechas/' + pend)}">Ver fecha</a></div>
          <ul class="partidos">${proximos.map(p => filaPartido(p, { compacto: true })).join('')}</ul></section>` : ''}
        <section class="panel"><div class="panel__cabeza"><h2>Goleadores</h2><a href="${urlLiga(liga, 'goleadores')}">Ver todos</a></div>
          ${listaGoleadores(t, 5, true)}</section>
        ${liga.id ? noticiasMini(liga.id, 3) : ''}
      </aside></div>`;
  }

  // Cuadro de los playoffs de una fase de grupos.
  function secPlayoffs($s, liga, t) {
    const f = playoffsDe(t);
    if (!f) { $s.innerHTML = '<p class="vacio">Este torneo no tiene playoffs.</p>'; return; }
    const n = clasificanPorZona(t);
    $s.innerHTML = `<section class="panel"><div class="panel__cabeza"><h2>Playoffs</h2>${n ? `<span class="zona-cuenta">${n === 1 ? 'Pasa el 1°' : `Pasan del 1° al ${n}°`} de cada zona</span>` : ''}</div>
      <div class="llave-caja">${dibujarLlave(f)}</div></section>`;
  }

  function secFixture($s, liga, t, extra) {
    // En una fase de grupos con playoffs, el fixture muestra también las fechas de los cruces.
    const todos = partidosDe(t.id).concat(esGrupos(t) ? partidosDe(t.id + PO) : []);
    const fechas = [...new Set(todos.map(p => p.fecha_nro))].filter(x => x != null).sort((a, b) => a - b);
    if (!fechas.length) { $s.innerHTML = '<p class="vacio">Todavía no hay fixture cargado.</p>'; return; }
    let n = num(extra);
    if (n == null || !fechas.includes(n)) { const pend = fechas.find(f => todos.some(p => p.fecha_nro === f && p.estado !== 'Finalizado')); n = pend != null ? pend : fechas[fechas.length - 1]; }
    const partidos = todos.filter(p => p.fecha_nro === n);
    const pendientes = new Set(fechas.filter(f => todos.some(p => p.fecha_nro === f && p.estado !== 'Finalizado')));
    $s.innerHTML = `<section class="panel panel--fixture">
      <div class="panel__cabeza"><h2>Fecha ${n}</h2><span style="color:var(--tinta-2);font-size:.88rem">Programada para el ${fecha(partidos[0] && partidos[0].fecha_programada)}</span></div>
      <nav class="fechas" aria-label="Elegir fecha">${fechas.map(f => `<a href="${urlLiga(liga, 'fechas/' + f)}" class="${pendientes.has(f) ? 'pendiente' : ''}" ${f === n ? 'aria-current="page"' : ''} title="${pendientes.has(f) ? 'Fecha con partidos pendientes' : 'Fecha jugada'}">F${f}</a>`).join('')}</nav>
      ${esGrupos(t) ? porZona(t, partidos).map(([nombre, ps]) => `<h3 class="fixture-zona">${esc(nombre)}</h3><ul class="partidos">${ps.map(p => filaPartido(p)).join('')}</ul>`).join('')
        : `<ul class="partidos">${partidos.map(p => filaPartido(p)).join('')}</ul>`}
    </section>`;
    const actual = $s.querySelector('.fechas [aria-current]');
    if (actual) actual.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // Partidos de una fecha separados por zona (los que cruzan zonas van al final).
  function porZona(t, partidos) {
    const deGrupos = partidos.filter(p => !esDePlayoff(p));
    const out = gruposDe(t).map(g => [g.nombre, deGrupos.filter(p => (grupoDePartido(t, p) || {}).nombre === g.nombre)]).filter(x => x[1].length);
    [...new Set(partidos.filter(esDePlayoff).map(p => p.fase.trim()))].forEach(f => out.push([f, partidos.filter(p => esDePlayoff(p) && p.fase.trim() === f)]));
    const resto = deGrupos.filter(p => !grupoDePartido(t, p));
    if (resto.length) out.push(['Otros partidos', resto]);
    return out;
  }

  function secGoleadores($s, liga, t) {
    $s.innerHTML = `<section class="panel" style="max-width:760px">
      <div class="panel__cabeza"><h2>Goleadores</h2></div>
      ${listaGoleadores(t)}
      <p class="nota">Cuenta los goles con autor publicado en las crónicas. Los goles en contra no suman al jugador.</p>
    </section>`;
  }

  function noticiasMini(lid, cuantas) {
    const n = D.noticias.filter(x => !lid || x.liga_id === lid).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, cuantas);
    if (!n.length) return '';
    return `<section class="panel"><div class="panel__cabeza"><h2>Noticias</h2>${lid ? `<a href="${urlLiga(lid, 'noticias')}">Ver todas</a>` : ''}</div>
      <ul class="partidos">${n.map(x => `<li class="partido" style="padding:12px 16px"><div class="noticia-mini"><small style="color:var(--tinta-3)">${fecha(x.fecha)}</small>
        <h3 style="margin-top:2px"><a href="${urlLiga(x.liga_id, 'noticias')}" style="color:inherit;text-decoration:none">${esc(x.titulo)}</a></h3></div></li>`).join('')}</ul></section>`;
  }

  function secNoticias($s, liga) {
    const n = D.noticias.filter(x => x.liga_id === liga.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    if (!n.length) { $s.innerHTML = '<p class="vacio">Esta liga todavía no publicó noticias.</p>'; return; }
    $s.innerHTML = `<div class="noticias">${n.map(x => `
      <article class="noticia">
        <div class="meta"><time datetime="${esc(x.fecha)}">${fecha(x.fecha)}</time>${x.fuente ? `, ${esc(x.fuente)}` : ''}</div>
        <h3>${esc(x.titulo)}</h3>
        <p>${esc(x.resumen)}</p>
        ${urlSegura(x.url) ? `<a href="${esc(urlSegura(x.url))}" target="_blank" rel="noopener">Leer la nota completa</a>` : ''}
      </article>`).join('')}</div>`;
  }

  function secClubes($s, liga, t) {
    const tabla = t ? posiciones(t.id) : [];
    const c = D.clubes.filter(x => x.liga_id === liga.id).sort((a, b) => a.nombre.localeCompare(b.nombre));
    $s.innerHTML = `<div class="clubes">${c.map(club => {
      const eq = D.equipos.find(e => e.club_id === club.id);
      const i = eq ? tabla.findIndex(r => r.id === eq.id) : -1;
      return `<a class="club-ficha" href="#/club/${esc(club.id)}">${escudo(club, 'm')}
        <span><h3>${esc(club.nombre)}</h3><p>${esc(club.ciudad)}${i >= 0 ? `. ${tabla[i].puesto || i + 1}° ${tabla[i].grupo ? 'en ' + esc(tabla[i].grupo) + ' ' : ''}con ${tabla[i].PTS} puntos` : ''}</p></span></a>`;
    }).join('')}</div>`;
  }

  // ---------- torneos entre ligas ----------
  function resumenTorneo(t) {
    const ligas = ligasDeTorneo(t).map(id => porId('ligas', id)).filter(Boolean);
    return `${participantesDe(t).length} equipos de ${ligas.map(l => esc(l.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''))).join(', ')}`;
  }

  // Listado de todas las ligas, con buscador por nombre o ciudad.
  function vistaLigas() {
    const sinAcentos = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const fav = favorito().liga;
    const ligas = D.ligas.slice().sort((a, b) => (b.id === fav) - (a.id === fav) || String(a.ciudad).localeCompare(String(b.ciudad), 'es'));
    $main.innerHTML = `
      <section class="banda"><div class="contenedor"><div class="banda__fila"><div>
        <h1>Ligas</h1><p>${ligas.length} ${ligas.length === 1 ? 'liga adherida' : 'ligas adheridas'}. Elegí una para ver su tabla, fixture, goleadores y clubes.</p></div></div>
        <div class="buscador"><label for="buscar-liga" class="visualmente-oculto">Buscar liga o ciudad</label>
          <input id="buscar-liga" type="search" placeholder="Buscar por liga o ciudad" autocomplete="off"></div></div></section>
      <div class="contenedor pagina">
        <div class="clubes" id="lista-ligas">${ligas.map(l => {
          const t = torneoActual(l.id);
          const n = D.clubes.filter(c => c.liga_id === l.id).length;
          return `<a class="club-ficha" href="${urlLiga(l)}" data-buscar="${esc(sinAcentos(l.nombre + ' ' + l.ciudad))}">${escudo({ nombre: l.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''), escudo: l.logo }, 'm')}
            <span><h3>${esc(l.nombre)}${l.id === fav ? ' <small class="liga-fav">Tu liga</small>' : ''}</h3><p>${esc(l.ciudad)}. ${n} ${n === 1 ? 'club' : 'clubes'}${t ? '. ' + esc(t.nombre) : ''}</p></span></a>`;
        }).join('')}</div>
        <p class="vacio" id="ligas-nada" hidden>No hay ligas con ese nombre o ciudad.</p>
      </div>`;
    const $b = document.getElementById('buscar-liga');
    $b.addEventListener('input', () => {
      const q = sinAcentos($b.value.trim());
      let vis = 0;
      document.querySelectorAll('#lista-ligas .club-ficha').forEach(a => { const ok = !q || a.dataset.buscar.includes(q); a.hidden = !ok; if (ok) vis++; });
      document.getElementById('ligas-nada').hidden = vis > 0;
    });
  }

  function vistaTorneos() {
    const ts = torneosInterliga().slice().sort((a, b) => String(actividad(b.id)).localeCompare(String(actividad(a.id))));
    $main.innerHTML = `
      <section class="banda"><div class="contenedor"><div class="banda__fila"><div>
        <h1>Torneos entre ligas</h1><p>Copas y torneos regionales que juntan clubes de distintas ligas.</p></div></div>
        <div style="height:24px"></div></div></section>
      <div class="contenedor pagina">${ts.length ? `<div class="clubes">${ts.map(t => `
        <a class="club-ficha" href="${urlTorneo(t)}">${escudo({ nombre: t.nombre, escudo: '' }, 'm')}
          <span><h3>${esc(t.nombre)} ${esc(t.temporada)}</h3><p>${resumenTorneo(t)}${t.estado ? '. ' + esc(t.estado) : ''}</p></span></a>`).join('')}</div>`
        : '<p class="vacio">Todavía no hay torneos entre ligas cargados.</p>'}</div>`;
  }

  const SECCIONES_TORNEO = [['posiciones', 'Tabla'], ['fechas', 'Fixture'], ['goleadores', 'Goleadores'], ['equipos', 'Equipos']];
  function vistaTorneo(t, seccion, extra) {
    if (!t) return vistaNoEncontrada('Ese torneo no existe.');
    const fp = playoffsDe(t);
    const SECC_T = SECCIONES_TORNEO.slice();
    if (fp) SECC_T.splice(1, 0, ['playoffs', 'Playoffs']);
    seccion = SECC_T.some(x => x[0] === seccion) ? seccion : 'posiciones';
    const base = { _base: urlTorneo(t), id: '', nombre: t.nombre };
    const hayVivo = partidosDe(t.id).some(p => p.estado === 'En juego');
    $main.innerHTML = `
      <section class="banda"><div class="contenedor">
        <div class="banda__fila"><div class="banda__id">${escudo({ nombre: t.nombre, escudo: '' }, 'l')}
          <div><h1>${esc(t.nombre)}</h1>
            <p>${esc([t.categoria, t.temporada].filter(Boolean).join(' '))}. ${resumenTorneo(t)}</p>
            <div class="chips">${hayVivo ? '<span class="chip chip--vivo">Partidos en juego</span>' : ''}${t.estado ? `<span class="chip">${esc(t.estado)}</span>` : ''}<a class="chip" href="#/torneos" style="text-decoration:none">Torneos entre ligas</a></div>
          </div></div></div>
        <nav class="pestanas" aria-label="Secciones del torneo">
          ${SECC_T.map(([k, n]) => `<a href="${urlTorneo(t, k)}" ${k === seccion ? 'aria-current="page"' : ''}>${n}</a>`).join('')}
        </nav>
      </div></section>
      <div class="contenedor pagina" id="seccion"></div>`;
    const $s = document.getElementById('seccion');
    if (seccion === 'equipos') return secEquiposTorneo($s, t);
    ({ posiciones: secTabla, playoffs: secPlayoffs, fechas: secFixture, goleadores: secGoleadores }[seccion])($s, base, t, extra);
  }

  function secEquiposTorneo($s, t) {
    const porLiga = {};
    participantesDe(t).forEach(eid => { const c = clubDeEquipo(eid); if (c) (porLiga[c.liga_id] = porLiga[c.liga_id] || []).push(c); });
    $s.innerHTML = Object.keys(porLiga).map(lid => {
      const l = porId('ligas', lid);
      return `<section style="margin-bottom:28px"><h2 style="margin:0 0 12px">${l ? `<a href="${urlLiga(l)}" style="color:inherit">${esc(l.nombre)}</a>` : esc(lid)}</h2>
        <div class="clubes">${porLiga[lid].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => `<a class="club-ficha" href="#/club/${esc(c.id)}">${escudo(c, 'm')}<span><h3>${esc(c.nombre)}</h3><p>${esc(c.ciudad)}</p></span></a>`).join('')}</div></section>`;
    }).join('') || '<p class="vacio">Este torneo todavía no tiene equipos cargados.</p>';
  }

  function vistaClub(cid) {
    const club = porId('clubes', cid);
    if (!club) return vistaNoEncontrada('Ese club no existe.');
    const liga = porId('ligas', club.liga_id);
    const equipos = D.equipos.filter(e => e.club_id === cid);
    const eids = new Set(equipos.map(e => e.id));
    const principal = equipos[0];
    const t = liga ? torneoActual(liga.id) : null;
    const fav = favorito();
    const esFav = principal && fav.equipo === principal.id;
    const tabla = t ? posiciones(t.id) : [];
    const pos = principal ? tabla.findIndex(r => r.id === principal.id) : -1;
    const fila = pos >= 0 ? tabla[pos] : null;

    const golesDe = {};
    D.eventos.filter(e => e.tipo === 'Gol').forEach(e => { golesDe[e.jugador_id] = (golesDe[e.jugador_id] || 0) + 1; });
    const plantel = D.jugadores.filter(j => eids.has(j.equipo_id))
      .sort((a, b) => (golesDe[b.id] || 0) - (golesDe[a.id] || 0) || a.apellido.localeCompare(b.apellido));
    const partidos = D.partidos.filter(p => (eids.has(p.local_id) || eids.has(p.visitante_id)) && (!t || p.torneo_id === t.id)).sort((a, b) => a.fecha_nro - b.fecha_nro);
    // Otros torneos en los que juega el club (de su liga o entre ligas).
    const otros = D.torneos.filter(x => (!t || x.id !== t.id) && participantesDe(x).some(e => eids.has(e)) && partidosDe(x.id).length);

    const web = urlSegura(club.web);
    const contacto = String(club.contacto || '').trim();
    const contactoHtml = urlSegura(contacto) ? `<a href="${esc(contacto)}" target="_blank" rel="noopener">${esc(contacto.replace(/^https?:\/\//, ''))}</a>`
      : /@/.test(contacto) ? `<a href="mailto:${esc(contacto)}">${esc(contacto)}</a>` : esc(contacto);
    const sinDato = '<span class="sin-dato">El club todavía no lo cargó</span>';

    $main.innerHTML = `
      <section class="banda"><div class="contenedor">
        <div class="banda__fila">
          <div class="banda__id">${escudo(club, 'l')}
            <div><h1>${esc(club.nombre)}</h1>
              <p>${esc(club.ciudad)}${liga ? `. <a href="${urlLiga(liga)}">${esc(liga.nombre)}</a>` : ''}</p></div></div>
          ${principal ? `<div class="acciones"><button class="boton ${esFav ? '' : 'boton--primario'}" id="btn-equipo-fav" aria-pressed="${esFav}">${esFav ? 'Siguiendo' : 'Seguir a este equipo'}</button></div>` : ''}
        </div>
        ${fila ? `<div class="stats">
          <div class="stat"><b>${fila.puesto || pos + 1}°</b><small>${fila.grupo ? 'Posición en ' + esc(fila.grupo) : 'Posición'}</small></div>
          <div class="stat"><b>${fila.PTS}</b><small>Puntos</small></div>
          <div class="stat"><b>${fila.G}-${fila.E}-${fila.P}</b><small>Ganados, empatados, perdidos</small></div>
          <div class="stat"><b>${fila.GF}:${fila.GC}</b><small>Goles a favor y en contra</small></div>
          <div class="stat"><b style="padding-top:6px">${forma(fila.forma)}</b><small>Últimos 5</small></div>
        </div>` : '<div style="height:24px"></div>'}
      </div></section>
      <div class="contenedor pagina"><div class="grilla">
        <section class="panel">
          <div class="panel__cabeza"><h2>Partidos</h2>${t ? `<span style="color:var(--tinta-2);font-size:.88rem">${esc(t.nombre)}</span>` : ''}</div>
          ${partidos.length ? `<ul class="partidos">${partidos.map(p => filaPartido(p, { conFecha: true, sinFuente: true })).join('')}</ul>` : '<p class="vacio">Sin partidos cargados.</p>'}
        </section>
        <aside>
          ${otros.length ? `<section class="panel"><div class="panel__cabeza"><h2>Otros torneos</h2></div>
            <ul class="partidos">${otros.map(x => `<li class="partido" style="padding:12px 16px"><a href="${esInterliga(x) ? urlTorneo(x) : urlLiga(x.liga_id)}" style="font-weight:650">${esc(x.nombre)} ${esc(x.temporada)}</a>
              <small style="display:block;color:var(--tinta-3)">${esInterliga(x) ? 'Torneo entre ligas' : esc((porId('ligas', x.liga_id) || {}).nombre || '')}</small></li>`).join('')}</ul></section>` : ''}
          <section class="panel datos"><div class="panel__cabeza"><h2>El club</h2></div><div class="panel__cuerpo"><dl>
            <dt>Cancha</dt><dd>${club.cancha ? esc(club.cancha) + (club.direccion ? `, ${esc(club.direccion)}` : '') : sinDato}</dd>
            <dt>Sitio web</dt><dd>${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">${esc(web.replace(/^https?:\/\//, ''))}</a>` : sinDato}</dd>
            <dt>Contacto</dt><dd>${contactoHtml || sinDato}</dd>
          </dl></div></section>
          <section class="panel"><div class="panel__cabeza"><h2>Plantel</h2><span style="color:var(--tinta-2);font-size:.88rem">${plantel.length} jugadores</span></div>
            ${plantel.length ? `<ul class="plantel">${plantel.map(j => `<li><span style="color:var(--tinta)">${j.numero ? `<b>${esc(j.numero)}</b> ` : ''}${esc(nombreJugador(j))}</span>
              <span>${golesDe[j.id] ? `${golesDe[j.id]} ${golesDe[j.id] === 1 ? 'gol' : 'goles'}` : esc(j.posicion || '')}</span></li>`).join('')}</ul>
              <p class="nota">Por ahora figuran los jugadores con goles publicados. El plantel oficial lo carga el club.</p>`
              : '<p class="vacio">El club todavía no cargó su plantel.</p>'}
          </section>
        </aside>
      </div></div>`;
    const b = document.getElementById('btn-equipo-fav');
    if (b) b.addEventListener('click', () => {
      if (esFav) { setFavorito({ liga: club.liga_id }); aviso(`Dejaste de seguir a ${club.nombre}.`); }
      else { setFavorito({ liga: club.liga_id, equipo: principal.id }); aviso(`Ahora seguís a ${club.nombre}.`); pedirPermisoAvisos(); }
      vistaClub(cid);
    });
  }

  function vistaMiEquipo() {
    const fav = favorito();
    const ligaSel = fav.liga || (D.ligas[0] && D.ligas[0].id) || '';
    const opcionesEquipos = lid => D.equipos.filter(e => ligaDeEquipo(e.id) === lid)
      .map(e => ({ id: e.id, n: `${nombreEquipo(e.id)}${e.categoria && e.categoria !== 'Primera' ? ` (${e.categoria})` : ''}` }))
      .sort((a, b) => a.n.localeCompare(b.n));
    const permiso = ('Notification' in window) ? Notification.permission : 'no-soportado';
    $main.innerHTML = `
      <section class="banda"><div class="contenedor" style="padding-bottom:28px">
        <h1>Mi equipo</h1>
        <p>Elegí tu liga y tu equipo. Te avisamos cuando empieza el partido, en cada gol y al final.</p>
      </div></section>
      <div class="contenedor pagina"><div class="grilla">
        <section class="panel"><div class="panel__cuerpo">
          <form class="formulario" id="form-fav">
            <label for="sel-liga">Liga</label>
            <select id="sel-liga">${D.ligas.map(l => `<option value="${esc(l.id)}" ${l.id === ligaSel ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select>
            <label for="sel-equipo">Equipo</label>
            <select id="sel-equipo"></select>
            <div class="acciones">
              <button class="boton boton--primario" type="submit">Guardar y activar avisos</button>
              ${fav.equipo ? '<button class="boton" type="button" id="btn-quitar">Dejar de seguir</button>' : ''}
            </div>
          </form>
        </div></section>
        <aside><section class="panel"><div class="panel__cabeza"><h2>Sobre los avisos</h2></div><div class="panel__cuerpo" id="estado-avisos" style="color:var(--tinta-2);font-size:.92rem"></div></section></aside>
      </div></div>`;
    const $l = document.getElementById('sel-liga'), $e = document.getElementById('sel-equipo');
    const llenar = () => { $e.innerHTML = opcionesEquipos($l.value).map(o => `<option value="${esc(o.id)}" ${o.id === fav.equipo ? 'selected' : ''}>${esc(o.n)}</option>`).join(''); };
    $l.addEventListener('change', llenar); llenar();
    const lineas = [];
    if (permiso === 'granted') lineas.push('Los avisos están activados en este navegador.');
    if (permiso === 'denied') lineas.push('Bloqueaste los avisos para este sitio. Podés habilitarlos desde el candado de la barra de direcciones.');
    if (permiso === 'no-soportado') lineas.push('Este navegador no permite avisos. En iPhone, agregá el sitio a la pantalla de inicio y abrilo desde ahí.');
    lineas.push(CFG.API_URL ? 'Por ahora llegan mientras tengas el sitio abierto, aunque sea en otra pestaña.' : 'Los avisos en vivo se activan cuando la liga conecta su planilla.');
    document.getElementById('estado-avisos').innerHTML = lineas.map(x => `<p>${esc(x)}</p>`).join('');
    document.getElementById('form-fav').addEventListener('submit', async ev => {
      ev.preventDefault();
      setFavorito({ liga: $l.value, equipo: $e.value });
      await pedirPermisoAvisos();
      suscribirEnServidor();
      aviso(`Ahora seguís a ${nombreEquipo($e.value)}.`);
      vistaMiEquipo();
    });
    const q = document.getElementById('btn-quitar');
    if (q) q.addEventListener('click', () => { setFavorito({ liga: fav.liga }); aviso('Dejaste de seguir a tu equipo.'); vistaMiEquipo(); });
  }

  function vistaNoEncontrada(msg) {
    $main.innerHTML = `<section class="banda"><div class="contenedor" style="padding-bottom:28px"><h1>No encontramos esa página</h1><p>${esc(msg)}</p></div></section>
      <div class="contenedor pagina"><a class="boton" href="#/">Ver todas las ligas</a></div>`;
  }

  // ---------- avisos en vivo ----------
  async function pedirPermisoAvisos() {
    if (!('Notification' in window)) return 'no-soportado';
    if (Notification.permission === 'default') {
      try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
    }
    return Notification.permission;
  }

  function suscribirEnServidor() {
    // Guarda la suscripción en la pestaña Suscripciones. El token push real se agrega
    // cuando se integre Firebase Cloud Messaging; mientras tanto se usa un id del navegador.
    const f = favorito();
    if (!CFG.API_URL || !f.equipo) return;
    let id = leer('id_navegador');
    if (!id) { id = 'web-' + Math.random().toString(36).slice(2, 10); guardar('id_navegador', id); }
    fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'suscribir', token_push: id, liga_id: f.liga, equipo_id: f.equipo }) }).catch(() => {});
  }

  function notificar(titulo, cuerpo) {
    aviso(`${titulo}. ${cuerpo}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(titulo, { body: cuerpo, tag: titulo + cuerpo }); } catch (e) {}
    }
  }

  let timerVivo = null;
  function iniciarVivo() {
    clearInterval(timerVivo);
    const f = favorito();
    if (!CFG.API_URL || !f.equipo) return;
    const t = torneoActual(f.liga);
    if (!t) return;
    const huella = p => `${p.estado}|${p.goles_local}|${p.goles_visitante}`;
    const previo = {};
    D.partidos.filter(p => p.local_id === f.equipo || p.visitante_id === f.equipo).forEach(p => { previo[p.id] = huella(p); });
    timerVivo = setInterval(async () => {
      try {
        const nuevos = await api('partidos', { torneo: t.id, equipo: f.equipo });
        nuevos.forEach(p => {
          p.goles_local = num(p.goles_local); p.goles_visitante = num(p.goles_visitante); p.fecha_nro = num(p.fecha_nro);
          const h = huella(p);
          if (previo[p.id] && previo[p.id] !== h) {
            const marcador = `${nombreEquipo(p.local_id)} ${p.goles_local ?? 0} - ${p.goles_visitante ?? 0} ${nombreEquipo(p.visitante_id)}`;
            const estAnt = previo[p.id].split('|')[0];
            if (p.estado === 'En juego' && estAnt !== 'En juego') notificar('Empezó el partido', marcador);
            else if (p.estado === 'Finalizado' && estAnt !== 'Finalizado') notificar('Final del partido', marcador);
            else notificar('Gol', marcador);
          }
          previo[p.id] = h;
          const i = D.partidos.findIndex(x => x.id === p.id);
          if (i >= 0) Object.assign(D.partidos[i], p);
        });
      } catch (e) { console.warn('Sin conexión con la planilla', e); }
    }, Math.max(30, CFG.REFRESCO_EN_VIVO_SEG || 60) * 1000);
  }

  // ---------- rutas ----------
  function ruta(opciones) {
    const quieto = opciones && opciones.quieto;
    const y = window.scrollY;
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const necesarias = ligasNecesarias(partes);
    const faltan = necesarias.filter(l => !CARGA[l]);
    const viejas = necesarias.filter(l => CARGA[l] && !FRESCAS.has(l));
    if (faltan.length || viejas.length) {
      const hash = location.hash;
      const listo = () => { if (location.hash === hash) ruta({ quieto: !faltan.length || quieto }); };
      cargarLigas(faltan.concat(viejas)).then(listo).catch(e => {
        console.warn(e);
        if (faltan.length && location.hash === hash) $main.innerHTML = '<section class="banda"><div class="contenedor" style="padding-bottom:28px"><h1>No pudimos cargar esta liga</h1><p>Revisá tu conexión y volvé a intentar.</p></div></section><div class="contenedor pagina"><a class="boton" href="#/">Ver todas las ligas</a></div>';
      });
      // Si falta algo, se muestra "Cargando…"; si solo estaba vieja, se dibuja ya con la copia.
      if (faltan.length) { if (!quieto) $main.innerHTML = '<div class="contenedor pagina"><p class="vacio">Cargando…</p></div>'; return; }
    }
    document.querySelectorAll('.cabeza__nav a').forEach(a => a.removeAttribute('aria-current'));
    if (partes[0] === 'liga') {
      const liga = ligaPorRuta(partes[1]);
      // Los links viejos con el id (#/liga/L01) pasan a la dirección con nombre.
      if (liga && partes[1] !== liga.slug) history.replaceState(null, '', urlLiga(liga, partes.slice(2).join('/')));
      vistaLiga(liga ? liga.id : partes[1], partes[2], partes[3]);
    }
    else if (partes[0] === 'club') vistaClub(partes[1]);
    else if (partes[0] === 'torneos') { vistaTorneos(); const a = document.querySelector('[data-nav="torneos"]'); if (a) a.setAttribute('aria-current', 'page'); }
    else if (partes[0] === 'torneo') {
      const k = String(partes[1] || '').toLowerCase();
      const t = D.torneos.find(x => x.slug.toLowerCase() === k) || D.torneos.find(x => x.id.toLowerCase() === k);
      if (t && partes[1] !== t.slug) history.replaceState(null, '', urlTorneo(t, partes.slice(2).join('/')));
      vistaTorneo(t, partes[2], partes[3]);
    }
    else if (partes[0] === 'admin') { window.Admin.mostrar($main, partes.slice(1)); document.title = 'Panel de clubes | Pitazo Final'; window.scrollTo(0, 0); return; }
    else if (partes[0] === 'ligas') { vistaLigas(); document.querySelector('[data-nav="ligas"]').setAttribute('aria-current', 'page'); }
    else if (partes[0] === 'mi-equipo') { vistaMiEquipo(); document.querySelector('[data-nav="mi-equipo"]').setAttribute('aria-current', 'page'); }
    else vistaInicio();
    const titulo = $main.querySelector('h1');
    document.title = titulo && partes.length ? `${titulo.textContent} | Pitazo Final` : 'Pitazo Final';
    if (quieto) { window.scrollTo(0, y); return; }
    window.scrollTo(0, 0);
    $main.focus({ preventScroll: true });
  }

  // Para el panel: avisos y recarga de datos después de guardar cambios.
  window.LF = {
    aviso,
    // Para el panel: la próxima ronda de playoffs de una fase de grupos con sus cruces ya definidos
    // y todavía sin partidos cargados.
    crucesPendientes: async tid => {
      const t = porId('torneos', tid);
      if (!t) return null;
      // Siempre con los resultados al día (la copia del navegador puede estar vieja).
      if (!COMPLETO) await cargarLigas([t.liga_id]);
      const f = playoffsDe(porId('torneos', tid));
      if (!f) return null;
      const { rondas } = armarLlave(f);
      for (const r of rondas) {
        const libres = r.cruces.filter(c => !c.bye && (!c.ps || !c.ps.length));
        const listos = libres.filter(c => c.A && c.B && c.A.eid && c.B.eid);
        if (!libres.length) continue;
        if (!listos.length) return { ronda: r.nombre, cruces: [], falta: true };
        return { ronda: r.nombre, provisorio: sembrados(f).some(x => x.provisorio) && r === rondas[0], cruces: listos.map(c => ({ a: c.A.eid, b: c.B.eid, na: nombreEquipo(c.A.eid), nb: nombreEquipo(c.B.eid) })), faltan: libres.length - listos.length };
      }
      return { ronda: '', cruces: [], terminado: true };
    },
    recargar: async () => {
      try { await cargarBase(); await cargarLigas(Object.keys(CARGA).filter(l => l !== '*')); actualizarNav(); dibujarCinta(); } catch (e) { console.warn(e); }
    },
    // Aplica solo las filas que cambió el panel, sin volver a pedir todos los datos.
    aplicar: cambios => {
      try {
        if (!BASE) return;
        const tocadas = new Set();
        const aplicarEn = (lista, c) => {
          const id = c.op === 'borrar' ? c.id : c.fila.id;
          const i = lista.findIndex(x => String(x.id) === String(id));
          if (c.op === 'borrar') { if (i >= 0) lista.splice(i, 1); return; }
          const fila = Object.assign({}, i >= 0 ? lista[i] : {}, c.fila);
          if ((c.tabla === 'Jugadores' && fila.activo !== 'SI') || (c.tabla === 'Ligas' && fila.activa !== 'SI')) { if (i >= 0) lista.splice(i, 1); return; }
          if (i >= 0) lista[i] = fila; else lista.push(fila);
        };
        cambios.forEach(c => {
          const k = c.tabla.toLowerCase();
          if (['ligas', 'clubes', 'equipos', 'torneos'].includes(k)) { if (BASE[k]) aplicarEn(BASE[k], c); return; }
          const destino = COMPLETO ? CARGA['*'] : CARGA[c.liga];
          if (destino && destino[k]) { aplicarEn(destino[k], c); if (!COMPLETO) tocadas.add(c.liga); }
          if (k === 'noticias' && BASE.noticias) aplicarEn(BASE.noticias, c);
        });
        unir();
        guardar(COPIA_BASE, { fecha: Date.now(), datos: BASE });
        tocadas.forEach(lid => guardarCopiaLiga(lid, CARGA[lid]));
        actualizarNav(); dibujarCinta();
      } catch (e) { console.warn(e); window.LF.recargar(); }
    }
  };

  // Arranque: si el navegador tiene una copia de la última visita, la muestra al instante
  // y actualiza en segundo plano. Si no, espera los datos de la planilla.
  (async function iniciar() {
    try { localStorage.removeItem('lf_datos_v1'); } catch (e) {} // copia del formato anterior
    let mostrado = false;
    if (CFG.API_URL) {
      try {
        if (restaurarCopias()) {
          origen = 'Actualizando datos…';
          actualizarNav(); dibujarCinta(); ruta();
          mostrado = true;
        }
      } catch (e) { console.warn('Copia guardada inválida', e); }
    }
    window.addEventListener('hashchange', () => ruta());
    try { await cargarBase(); }
    catch (e) {
      if (!mostrado) $main.innerHTML = '<p class="contenedor vacio">No se pudieron cargar los datos. Revisá tu conexión y recargá la página.</p>';
      console.error(e); return;
    }
    actualizarNav();
    dibujarCinta();
    // Con la copia ya en pantalla, se vuelve a dibujar sin mover el scroll ni tocar el panel.
    if (!mostrado) ruta();
    else if (!/^#\/?admin/.test(location.hash)) ruta({ quieto: true });
    // La liga del visitante se trae completa en segundo plano (cinta y avisos en vivo).
    const fav = favorito();
    if (fav.liga && !COMPLETO && D.ligas.some(l => l.id === fav.liga) && !FRESCAS.has(fav.liga)) {
      cargarLigas([fav.liga]).then(() => { dibujarCinta(); iniciarVivo(); }).catch(e => console.warn(e));
    }
    iniciarVivo();
  })();
})();
