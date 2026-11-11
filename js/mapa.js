/* Mapa interactivo de Argentina en SVG, sin servicios externos.
   Uso: MapaArgentina.crear(elemento, { geo, ligas, alElegirLiga, favorita }) */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v)); return n; };

  // Provincia de cada liga según su campo "provincia" (texto libre de la planilla)
  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function crear(contenedor, opciones) {
    const { geo, ligas = [], favorita } = opciones;
    const P = geo.proy;
    const proyectar = (lng, lat) => [(lng - P.lonMin) * P.k * P.s, (P.latMax - lat) * P.s];
    const completo = { x: -20, y: -20, w: geo.ancho + 40, h: geo.alto + 40 };
    let vista = Object.assign({}, completo);

    const provPorNombre = {};
    geo.provincias.forEach(p => { provPorNombre[normal(p.nombre)] = p; });
    provPorNombre[normal('CABA')] = provPorNombre[normal('Ciudad de Buenos Aires')];
    const ligasPorProv = {};
    ligas.forEach(l => {
      const p = provPorNombre[normal(l.provincia)];
      if (p) (ligasPorProv[p.iso] = ligasPorProv[p.iso] || []).push(l);
    });

    contenedor.innerHTML = '';
    contenedor.classList.add('mapa-ar');
    const svg = el('svg', { role: 'group', 'aria-label': 'Mapa de Argentina con las ligas adheridas', preserveAspectRatio: 'xMidYMid meet' });
    const capaProv = el('g', { class: 'mapa-ar__provincias' });
    const capaPins = el('g', { class: 'mapa-ar__pins' });
    svg.append(capaProv, capaPins);

    const tip = document.createElement('div'); tip.className = 'mapa-ar__tip'; tip.hidden = true;
    const ficha = document.createElement('div'); ficha.className = 'mapa-ar__ficha'; ficha.hidden = true;
    const controles = document.createElement('div'); controles.className = 'mapa-ar__controles';
    controles.innerHTML = `<button type="button" data-z="in" aria-label="Acercar">+</button><button type="button" data-z="out" aria-label="Alejar">−</button><button type="button" data-z="reset" aria-label="Ver todo el país" title="Ver todo el país"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
    const leyenda = document.createElement('div'); leyenda.className = 'mapa-ar__leyenda';
    leyenda.innerHTML = '<span class="ley-prov">Provincia con ligas</span><span class="ley-pin">Liga adherida</span>';
    contenedor.append(svg, tip, ficha, controles, leyenda);

    // Provincias
    const pathPorIso = {};
    geo.provincias.forEach(p => {
      const cant = (ligasPorProv[p.iso] || []).length;
      const path = el('path', { d: p.d, class: 'prov' + (cant ? ' prov--con-liga' : ''), 'data-iso': p.iso });
      path.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') mostrarTip(p); });
      path.addEventListener('pointermove', ev => moverTip(ev));
      path.addEventListener('pointerleave', () => { tip.hidden = true; });
      path.addEventListener('click', ev => { if (arrastro) return; ev.stopPropagation(); enfocarProvincia(p); });
      capaProv.append(path);
      pathPorIso[p.iso] = path;
    });

    // Pines de ligas
    ligas.filter(l => l.lat != null && l.lng != null).forEach(l => {
      const [x, y] = proyectar(l.lng, l.lat);
      const g = el('g', { class: 'pin-ar' + (favorita === l.id ? ' pin-ar--favorita' : ''), transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0', role: 'button', 'aria-label': `${l.nombre}, ${l.ciudad}. Ver detalle` });
      g.append(el('circle', { r: 18, class: 'pin-ar__halo' }), el('circle', { r: 8, class: 'pin-ar__punto' }));
      const abrir = ev => { ev.stopPropagation(); abrirFicha(l, x, y); };
      g.addEventListener('click', ev => { if (!arrastro) abrir(ev); });
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); } });
      capaPins.append(g);
      l._xy = [x, y];
    });

    // ---------- vista ----------
    let anim = null;
    function aplicar() {
      svg.setAttribute('viewBox', `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
      // Los pines mantienen su tamaño en pantalla sin importar el zoom
      const r = svg.getBoundingClientRect();
      const pxPorUnidad = r.width ? Math.min(r.width / vista.w, r.height / vista.h) : 1;
      const k = (1 / pxPorUnidad).toFixed(4);
      capaPins.querySelectorAll('.pin-ar').forEach(p => {
        const t = p.getAttribute('transform').replace(/ scale\([^)]*\)/, '');
        p.setAttribute('transform', `${t} scale(${k})`);
      });
      if (!ficha.hidden && ficha._xy) ubicarFicha(ficha._xy);
    }
    function irA(dest, ms) {
      cancelAnimationFrame(anim);
      tip.hidden = true;
      dest = limitar(dest);
      if (reducido() || !ms) { vista = dest; return aplicar(); }
      const ini = Object.assign({}, vista), t0 = performance.now();
      const paso = t => {
        const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        vista = { x: ini.x + (dest.x - ini.x) * e, y: ini.y + (dest.y - ini.y) * e, w: ini.w + (dest.w - ini.w) * e, h: ini.h + (dest.h - ini.h) * e };
        aplicar();
        if (k < 1) anim = requestAnimationFrame(paso);
      };
      anim = requestAnimationFrame(paso);
    }
    function limitar(v) {
      const proporcion = completo.h / completo.w;
      let w = Math.min(completo.w, Math.max(completo.w / 14, v.w));
      let h = w * proporcion;
      let x = Math.min(completo.x + completo.w - w, Math.max(completo.x, v.x));
      let y = Math.min(completo.y + completo.h - h, Math.max(completo.y, v.y));
      return { x, y, w, h };
    }
    function zoom(factor, cx, cy) {
      cx = cx == null ? vista.x + vista.w / 2 : cx; cy = cy == null ? vista.y + vista.h / 2 : cy;
      const w = vista.w / factor, h = vista.h / factor;
      irA({ x: cx - (cx - vista.x) / factor, y: cy - (cy - vista.y) / factor, w, h }, 260);
    }
    function enfocarProvincia(p) {
      capaProv.querySelectorAll('.prov--activa').forEach(n => n.classList.remove('prov--activa'));
      pathPorIso[p.iso].classList.add('prov--activa');
      const [x1, y1, x2, y2] = p.bbox;
      const m = Math.max(x2 - x1, (y2 - y1) * completo.w / completo.h) * 0.12 + 20;
      const w = Math.max(x2 - x1, (y2 - y1) * completo.w / completo.h) + m * 2;
      irA({ x: (x1 + x2) / 2 - w / 2, y: (y1 + y2) / 2 - (w * completo.h / completo.w) / 2, w, h: w * completo.h / completo.w }, 450);
      const lista = ligasPorProv[p.iso] || [];
      if (lista.length === 1) abrirFicha(lista[0], lista[0]._xy[0], lista[0]._xy[1]);
      else mostrarFichaProvincia(p, lista);
    }
    function restablecer() {
      capaProv.querySelectorAll('.prov--activa').forEach(n => n.classList.remove('prov--activa'));
      ficha.hidden = true; irA(completo, 450);
    }

    // ---------- tooltip y ficha ----------
    function mostrarTip(p) {
      if (!ficha.hidden) return;
      const n = (ligasPorProv[p.iso] || []).length;
      tip.innerHTML = `<b>${esc(p.nombre)}</b><span>${n ? `${n} ${n === 1 ? 'liga adherida' : 'ligas adheridas'}` : 'Sin ligas adheridas todavía'}</span>`;
      tip.hidden = false;
    }
    function moverTip(ev) {
      const r = contenedor.getBoundingClientRect();
      tip.style.left = `${ev.clientX - r.left + 14}px`;
      tip.style.top = `${ev.clientY - r.top + 14}px`;
    }
    function aPantalla([x, y]) {
      const r = svg.getBoundingClientRect(), rc = contenedor.getBoundingClientRect();
      const esc = Math.min(r.width / vista.w, r.height / vista.h);
      const ox = (r.width - vista.w * esc) / 2, oy = (r.height - vista.h * esc) / 2;
      return [r.left - rc.left + ox + (x - vista.x) * esc, r.top - rc.top + oy + (y - vista.y) * esc];
    }
    function ubicarFicha(xy) {
      const [sx, sy] = aPantalla(xy);
      const cw = contenedor.clientWidth, fw = ficha.offsetWidth || 260, fh = ficha.offsetHeight || 140;
      let left = sx + 18, top = sy - fh / 2;
      if (left + fw > cw - 10) left = sx - fw - 18;
      top = Math.max(10, Math.min(contenedor.clientHeight - fh - 10, top));
      ficha.style.left = `${Math.max(10, left)}px`; ficha.style.top = `${top}px`;
    }
    function abrirFicha(l, x, y) {
      const extra = opciones.resumenLiga ? opciones.resumenLiga(l) : '';
      ficha.innerHTML = `<button type="button" class="mapa-ar__cerrar" aria-label="Cerrar">×</button>
        <h3>${esc(l.nombre)}</h3><p>${esc(l.ciudad)}, ${esc(l.provincia)}</p>${extra}
        <a class="boton boton--primario" href="#/liga/${encodeURIComponent(l.slug || l.id)}">Ver la liga</a>`;
      tip.hidden = true; ficha.hidden = false; ficha._xy = [x, y];
      ficha.querySelector('.mapa-ar__cerrar').addEventListener('click', () => { ficha.hidden = true; });
      ubicarFicha(ficha._xy);
      ficha.querySelector('a').focus({ preventScroll: true });
    }
    function mostrarFichaProvincia(p, lista) {
      ficha.innerHTML = `<button type="button" class="mapa-ar__cerrar" aria-label="Cerrar">×</button><h3>${esc(p.nombre)}</h3>
        ${lista.length ? `<ul>${lista.map(l => `<li><a href="#/liga/${encodeURIComponent(l.slug || l.id)}">${esc(l.nombre)}</a></li>`).join('')}</ul>`
          : '<p>Todavía no hay ligas adheridas en esta provincia.</p>'}`;
      tip.hidden = true; ficha.hidden = false; ficha._xy = p.c;
      ficha.querySelector('.mapa-ar__cerrar').addEventListener('click', () => { ficha.hidden = true; });
      ubicarFicha(ficha._xy);
    }

    // ---------- interacción: arrastre, pellizco, doble clic, rueda con Ctrl ----------
    const punteros = new Map();
    let arrastro = false, inicio = null, distIni = 0, vistaIni = null;
    const aSvg = (cx, cy) => {
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / vista.w, r.height / vista.h);
      const ox = (r.width - vista.w * s) / 2, oy = (r.height - vista.h * s) / 2;
      return [vista.x + (cx - r.left - ox) / s, vista.y + (cy - r.top - oy) / s, s];
    };
    svg.addEventListener('pointerdown', ev => {
      punteros.set(ev.pointerId, [ev.clientX, ev.clientY]);
      arrastro = false; inicio = [ev.clientX, ev.clientY]; vistaIni = Object.assign({}, vista);
      if (punteros.size === 2) { const [a, b] = [...punteros.values()]; distIni = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    });
    svg.addEventListener('pointermove', ev => {
      if (!punteros.has(ev.pointerId)) return;
      punteros.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (distIni > 0) {
          const f = d / distIni, [cx, cy] = aSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          vista = limitar({ x: cx - (cx - vistaIni.x) / f, y: cy - (cy - vistaIni.y) / f, w: vistaIni.w / f, h: vistaIni.h / f }); aplicar(); arrastro = true;
        }
        return;
      }
      const dx = ev.clientX - inicio[0], dy = ev.clientY - inicio[1];
      if (!arrastro && Math.hypot(dx, dy) < 6) return;
      if (!arrastro) { arrastro = true; svg.setPointerCapture(ev.pointerId); svg.classList.add('arrastrando'); tip.hidden = true; }
      const s = aSvg(0, 0)[2];
      vista = limitar({ x: vistaIni.x - dx / s, y: vistaIni.y - dy / s, w: vista.w, h: vista.h }); aplicar();
    });
    const soltar = ev => { punteros.delete(ev.pointerId); svg.classList.remove('arrastrando'); if (punteros.size < 2) distIni = 0; setTimeout(() => { arrastro = false; }, 0); };
    svg.addEventListener('pointerup', soltar);
    svg.addEventListener('pointercancel', soltar);
    svg.addEventListener('dblclick', ev => { ev.preventDefault(); const [x, y] = aSvg(ev.clientX, ev.clientY); zoom(2, x, y); });
    svg.addEventListener('wheel', ev => {
      if (!(ev.ctrlKey || ev.metaKey)) { contenedor.classList.add('mapa-ar--aviso-rueda'); clearTimeout(contenedor._t); contenedor._t = setTimeout(() => contenedor.classList.remove('mapa-ar--aviso-rueda'), 1200); return; }
      ev.preventDefault(); const [x, y] = aSvg(ev.clientX, ev.clientY); zoom(ev.deltaY < 0 ? 1.4 : 1 / 1.4, x, y);
    }, { passive: false });
    svg.addEventListener('click', () => { if (!arrastro) ficha.hidden = true; });
    controles.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'in') zoom(1.6); else if (b.dataset.z === 'out') zoom(1 / 1.6); else restablecer();
    });
    contenedor.addEventListener('keydown', ev => { if (ev.key === 'Escape') ficha.hidden = true; });

    window.addEventListener('resize', aplicar);
    aplicar();
    return { restablecer, enfocarLiga: id => { const l = ligas.find(x => x.id === id); if (l && l._xy) abrirFicha(l, l._xy[0], l._xy[1]); } };
  }

  window.MapaArgentina = { crear };
})();
