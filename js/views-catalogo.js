// =====================================================================
//  Catálogo de productos 2.0 · Análisis por línea de producto
//  (Wood / Iron Steel · S / M · Básico / Premium / Signature)
//  Los indicadores salen solo de datos cargados: no se estima nada.
// =====================================================================
import { html, usd, n2, pct } from './html.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, barra } from './estado.js';
import { formulario, toast } from './ui.js';
import { etiquetaProducto, filtroProductos, filtrar } from './views-ingenieria.js';

const num = v => Number(v) || 0;
const clsEstado = e => e === 'Activo' ? 'p-ok' : e === 'A pedido' ? 'p-info' : 'p-neutral';
const clsAprob = e => e === 'Aprobado' ? 'p-ok' : e === 'Rechazado' ? 'p-bad' : 'p-warn';
const ESTADOS_LEAD = ['Nuevo', 'Calificado', 'En Cotización', 'Cerrado', 'Perdido'];
const ORIGENES = ['Meta Ads', 'Google Ads', 'Instagram orgánico', 'TikTok', 'Referido', 'Influencer', 'Web directa'];

// ---------------------------------------------------------------------
//  CATÁLOGO DE PRODUCTOS 2.0
// ---------------------------------------------------------------------
export function vCatalogo() {
  const D = S.datos, lista = filtrar(D.productos, S.ing);
  const combos = [['WOOD', 'S'], ['WOOD', 'M'], ['IRON_STEEL', 'S'], ['IRON_STEEL', 'M']];
  return html`
    ${head('Catálogo de productos', 'Matriz Tecnología × Tamaño × Gama: 12 modelos con código estable. Básico y Premium son estándar; Signature se habilita modelo por modelo, solo a pedido. Ningún modelo se cotiza sin aprobación técnica y BOM aprobado.')}
    <div class="panel"><div class="body">${filtroProductos(S.ing, 'ing')}</div></div>
    <div class="panel"><h3>Modelos <span class="tag">${lista.length} de ${D.productos.length}</span></h3><div class="body tight"><div class="scroll"><table>
      <thead><tr><th>Código</th><th>Tecnología</th><th>Tamaño</th><th>Gama</th><th>Estado comercial</th><th>Aprobación técnica</th><th>BOM vigente</th>
        <th class="num">Costo directo</th><th class="num">PVP estimado</th><th class="num">PVP/m²</th><th></th></tr></thead>
      <tbody>${lista.map(pr => {
        const b = E.vigenteDe(pr.id, D);
        let r = null; try { r = b ? E.cotizarV2({ producto: pr.codigo }, D) : null; } catch (_) { r = null; }
        const fuera = r && pr.usd_m2_min !== null && pr.usd_m2_max !== null && (r.pvpM2 < num(pr.usd_m2_min) || r.pvpM2 > num(pr.usd_m2_max));
        return html`<tr><td><code>${pr.codigo}</code><br><span class="small mute">${pr.nombre_comercial}</span></td>
          <td>${E.etiquetaTec(pr.tecnologia)}</td><td>${pr.tamano} · ${n2(pr.largo_m)} × ${n2(pr.ancho_m)} m = ${n2(pr.superficie_m2)} m²</td>
          <td>${pr.gama}${pr.gama === 'Signature' ? html`<br><span class="small mute">Diseño exclusivo · Cotización a pedido</span>` : ''}</td>
          <td>${pill(pr.estado_comercial, clsEstado(pr.estado_comercial))}</td><td>${pill(pr.aprobacion_tecnica, clsAprob(pr.aprobacion_tecnica))}</td>
          <td>${b ? `v${b.version}` : pill('Sin BOM aprobado', 'p-warn')}</td>
          <td class="num">${r ? usd(r.cd) : '—'}</td><td class="num">${r ? usd(r.pvp) : '—'}</td>
          <td class="num">${r ? (fuera ? pill(usd(r.pvpM2), 'p-warn') : usd(r.pvpM2)) : '—'}</td>
          <td class="num nowrap"><button class="btn sm" data-action="prod-editar" data-id="${pr.id}">Editar</button>
            <button class="btn sm ghost" data-action="prod-bom" data-id="${pr.codigo}">BOM</button></td></tr>`;
      })}</tbody></table></div></div></div>
    <div class="panel"><h3>Adicionales por tecnología y tamaño <span class="tag">no se asume que cuestan lo mismo en Wood y en Iron Steel</span></h3><div class="body tight">
      ${D.addons.length ? html`<div class="scroll"><table><thead><tr><th>Adicional</th>${combos.map(([t, m]) => html`<th class="num">${E.etiquetaTec(t)} ${m}</th>`)}</tr></thead>
        <tbody>${D.addons.map(a => html`<tr><td>${a.nombre}</td>${combos.map(([t, m]) => {
          const c = (D.addon_costos || []).find(x => x.addon_id === a.id && x.tecnologia === t && x.tamano === m);
          return html`<td class="num">${c ? html`${c.disponible ? usd(c.costo) : E.sinPrecio(c.costo) ? pill('Sin costo', 'p-warn') : pill(usd(c.costo) + ' · no disponible')}
            ${c.disponible && (c.gamas || []).length < 3 ? html`<br><span class="small mute">${(c.gamas || []).join(', ')}</span>` : ''}
            <button class="btn sm" data-action="addon-costo" data-id="${c.id}">Editar</button>` : '—'}</td>`;
        })}</tr>`)}</tbody></table></div>` : vacio('Sin adicionales', 'Se cargan en Gamas y adicionales.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  ANÁLISIS POR LÍNEA (CRM segmentado + finanzas + producción)
// ---------------------------------------------------------------------
function leadsFiltrados(D, f) {
  return D.leads.filter(l => (!f.tec || l.tecnologia_interes === f.tec) && (!f.tam || l.tamano_interes === f.tam) && (!f.gama || l.gama === f.gama) &&
    (!f.origen || l.origen === f.origen) && (!f.estado || l.estado === f.estado) && (!f.desde || l.fecha >= f.desde) && (!f.hasta || l.fecha <= f.hasta) &&
    (!f.ubicacion || String(l.ubicacion || '').toLowerCase().includes(f.ubicacion.toLowerCase())));
}
const enFecha = (x, f) => (!f.desde || String(x).slice(0, 10) >= f.desde) && (!f.hasta || String(x).slice(0, 10) <= f.hasta);

function barras(filas, fmt = v => v) {
  const max = Math.max(1, ...filas.map(x => x.v));
  return html`<div class="bars">${filas.map(x => html`<div class="bar-row"><span>${x.l}</span>${barra(x.v / max * 100, x.cls || '')}<span class="num">${fmt(x.v)}</span></div>`)}</div>`;
}

export function vLineas() {
  const D = S.datos, f = S.filtros;
  const ls = leadsFiltrados(D, f);
  const cerr = x => x.filter(l => l.estado === 'Cerrado').length;
  const porTec = Object.entries(E.TECNOLOGIAS).map(([k, l]) => ({ k, l, leads: ls.filter(x => x.tecnologia_interes === k) }));
  const sinTec = ls.filter(x => !x.tecnologia_interes);
  const porTam = ['S', 'M'].map(k => ({ l: `${k} · ${E.TAMANOS[k].m2} m²`, v: ls.filter(x => x.tamano_interes === k).length }));
  const conTam = porTam.reduce((a, x) => a + x.v, 0);
  const porGama = [...E.GAMAS_2, 'Indefinido'].map(g => ({ l: g, v: ls.filter(x => (x.gama || 'Indefinido') === g).length }));
  // cotizaciones y ventas 2.0 con filtros de línea y fecha
  const c2 = filtrar(D.cotizaciones.filter(c => c.generacion === '2.0' && enFecha(c.fecha, f)), { tec: f.tec, tam: f.tam, gama: f.gama }, { tec: 'tecnologia', tam: 'chasis', gama: 'gama' });
  const v2 = filtrar(D.ventas.filter(v => v.generacion === '2.0' && enFecha(v.fecha, f)), { tec: f.tec, tam: f.tam, gama: f.gama }, { tec: 'tecnologia', tam: 'chasis', gama: 'gama' });
  const v1 = D.ventas.filter(v => v.generacion !== '2.0' && enFecha(v.fecha, f));
  const pipeline = c2.filter(c => c.estado === 'Enviada').reduce((a, c) => a + num(c.pvp_final ?? c.pvp), 0);
  const modelos = [...new Set(c2.map(c => c.producto_codigo))].sort().map(cod => {
    const cs = c2.filter(c => c.producto_codigo === cod);
    const perdidasInteres = (D.lead_intereses || []).filter(i => i.estado === 'Descartado' && D.productos.find(p => p.id === i.producto_id)?.codigo === cod).length;
    return { cod, n: cs.length, gan: cs.filter(c => c.estado === 'Ganada').length, perd: cs.filter(c => c.estado === 'Perdida').length + perdidasInteres,
      pvpProm: cs.reduce((a, c) => a + num(c.pvp), 0) / cs.length, margen: cs.reduce((a, c) => a + num(c.ganancia), 0) / cs.length };
  });
  const margenGama = E.GAMAS_2.map(g => { const cs = c2.filter(c => c.gama === g); return { g, n: cs.length, m: cs.length ? cs.reduce((a, c) => a + num(c.ganancia), 0) / cs.length : null,
    p: cs.length ? cs.reduce((a, c) => a + num(c.ganancia) / num(c.pvp || 1), 0) / cs.length : null }; });
  const finTec = [...Object.entries(E.TECNOLOGIAS).map(([k, l]) => ({ l, vs: v2.filter(v => v.tecnologia === k) })), { l: 'Catálogo 1.0 (chasis 18/36 m²)', vs: v1 }];
  const fabs = D.fabricacion;
  const comp = E.stockComprometido(D).filter(x => x.faltante > 0);
  const sum = (vs, k) => vs.reduce((a, v) => a + num(v[k]), 0);
  return html`
    ${head('Análisis por línea', 'Comercial, financiero y producción por tecnología, tamaño y gama. Solo datos cargados en el sistema: si no hay datos, no se muestra ninguna cifra.')}
    <div class="panel"><h3>Filtros</h3><div class="body">
      ${filtroProductos(f, 'fl')}
      <div class="filtros">
        <label class="f"><span>Origen</span><select data-change="fl-origen"><option value="">Todos</option>${ORIGENES.map(o => html`<option ${f.origen === o ? html`selected` : ''}>${o}</option>`)}</select></label>
        <label class="f"><span>Estado del embudo</span><select data-change="fl-estado"><option value="">Todos</option>${ESTADOS_LEAD.map(o => html`<option ${f.estado === o ? html`selected` : ''}>${o}</option>`)}</select></label>
        <label class="f"><span>Desde</span><input type="date" data-change="fl-desde" value="${f.desde}"></label>
        <label class="f"><span>Hasta</span><input type="date" data-change="fl-hasta" value="${f.hasta}"></label>
        <label class="f"><span>Ubicación contiene</span><input data-change="fl-ubicacion" value="${f.ubicacion}" maxlength="60"></label>
      </div>
      <button class="btn sm" data-action="fl-limpiar">Limpiar filtros</button>
    </div></div>

    <div class="kpis">
      ${kpi('Leads en el filtro', ls.length, `${cerr(ls)} cerrados · ${ls.length ? pct(cerr(ls) / ls.length) : '—'} de conversión`)}
      ${kpi('Interés en tamaño M', conTam ? pct(porTam[1].v / conTam) : '—', conTam ? `${conTam} leads con tamaño definido` : 'ningún lead con tamaño definido')}
      ${kpi('Cotizaciones 2.0', c2.length, `${c2.filter(c => c.estado === 'Ganada').length} ganadas · ${c2.filter(c => c.estado === 'Perdida').length} perdidas`)}
      ${kpi('Pipeline abierto', usd(pipeline), 'cotizaciones 2.0 enviadas (precio final)')}
    </div>

    <div class="row r2">
      <div class="panel"><h3>Leads y conversión por tecnología</h3><div class="body">
        ${ls.length ? html`<table class="breakdown">${porTec.map(t => html`<tr><td>${t.l}</td><td class="num">${t.leads.length} leads · ${cerr(t.leads)} cerrados · ${t.leads.length ? pct(cerr(t.leads) / t.leads.length) : '—'}</td></tr>`)}
          <tr class="sub"><td>Sin tecnología definida</td><td class="num">${sinTec.length}</td></tr></table>` : vacio('Sin leads para el filtro', '')}
      </div></div>
      <div class="panel"><h3>Leads por tamaño y por gama</h3><div class="body">
        ${ls.length ? html`${barras(porTam)}<div class="mt">${barras(porGama)}</div>` : vacio('Sin leads para el filtro', '')}
      </div></div>
    </div>

    <div class="panel"><h3>Oportunidades por modelo</h3><div class="body tight">
      ${modelos.length ? html`<table><thead><tr><th>Modelo</th><th class="num">Cotizaciones</th><th class="num">Ganadas</th><th class="num">Perdidas / descartadas</th>
        <th class="num">PVP promedio</th><th class="num">Margen objetivo promedio</th></tr></thead>
        <tbody>${modelos.map(m => html`<tr><td><code>${m.cod}</code></td><td class="num">${m.n}</td><td class="num">${m.gan}</td>
          <td class="num">${m.perd ? pill(m.perd, 'p-bad') : 0}</td><td class="num">${usd(m.pvpProm)}</td><td class="num">${usd(m.margen)}</td></tr>`)}</tbody></table>`
      : vacio('Sin cotizaciones 2.0', 'Aparecen al emitir cotizaciones del catálogo nuevo.')}
    </div></div>

    <div class="row r2">
      <div class="panel"><h3>Margen estimado por gama</h3><div class="body">
        ${c2.length ? html`<table class="breakdown">${margenGama.map(x => html`<tr><td>${x.g} <span class="mute">(${x.n})</span></td>
          <td class="num">${x.m === null ? '—' : `${usd(x.m)} · ${pct(x.p)}`}</td></tr>`)}</table>
          <p class="hint">Margen societario objetivo de las cotizaciones (antes de impuestos y gastos indirectos, que el sistema no modela).</p>` : vacio('Sin cotizaciones 2.0', '')}
      </div></div>
      <div class="panel"><h3>Facturación y margen por línea</h3><div class="body">
        ${D.ventas.length ? html`<table class="breakdown">${finTec.map(t => html`<tr><td>${t.l} <span class="mute">(${t.vs.length})</span></td>
          <td class="num">${usd(sum(t.vs, 'pvp'))} · margen ${usd(sum(t.vs, 'ganancia'))}</td></tr>
          ${t.vs.length ? html`<tr class="sub"><td>Costo presupuestado / real · desvío</td><td class="num">${usd(sum(t.vs, 'cd_pres'))} / ${usd(sum(t.vs.filter(v => v.costo_real !== null), 'costo_real'))} · ${usd(sum(t.vs, 'desvio'))}</td></tr>
          <tr class="sub"><td>Reserva · Dividendos A / B</td><td class="num">${usd(sum(t.vs, 'reserva'))} · ${usd(sum(t.vs, 'div_a'))} / ${usd(sum(t.vs, 'div_b'))}</td></tr>` : ''}`)}</table>`
        : vacio('Sin ventas', '')}
      </div></div>
    </div>

    <div class="row r2">
      <div class="panel"><h3>Producción por línea</h3><div class="body">
        ${fabs.length ? html`<table class="breakdown">
          ${Object.entries(E.TECNOLOGIAS).map(([k, l]) => html`<tr><td>${l}</td><td class="num">${fabs.filter(x => x.tecnologia === k).length} órdenes · ${fabs.filter(x => x.tecnologia === k && x.estado !== 'Terminada').length} abiertas</td></tr>`)}
          <tr class="sub"><td>Órdenes 1.0</td><td class="num">${fabs.filter(x => !x.tecnologia).length}</td></tr>
          ${E.GAMAS_2.map(g => html`<tr class="sub"><td>${g}</td><td class="num">${fabs.filter(x => x.gama === g && x.tecnologia).length}</td></tr>`)}
          <tr><td>Desvío de mano de obra (órdenes 2.0)</td><td class="num">${usd(fabs.filter(x => x.tecnologia).reduce((a, x) => a + num(x.mdo_real) - num(x.mdo_presupuestada), 0))}</td></tr>
        </table>` : vacio('Sin órdenes de fabricación', '')}
      </div></div>
      <div class="panel"><h3>Materiales faltantes para órdenes abiertas</h3><div class="body tight">
        ${comp.length ? html`<table><thead><tr><th>Material</th><th class="num">Comprometido</th><th class="num">Stock</th><th class="num">Faltante</th><th class="num">Costo a abastecer</th></tr></thead>
          <tbody>${comp.map(x => html`<tr><td><code>${x.codigo}</code> ${x.descripcion}</td><td class="num">${n2(x.comprometido)} ${x.unidad}</td><td class="num">${n2(x.stock)}</td>
            <td class="num">${pill(n2(x.faltante), 'p-warn')}</td><td class="num">${x.costoFaltante === null ? pill('Sin precio', 'p-warn') : usd(x.costoFaltante)}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="4">Costo pendiente de abastecimiento</td><td class="num">${usd(comp.reduce((a, x) => a + num(x.costoFaltante), 0))}</td></tr></tfoot></table>`
        : html`<div class="body">${vacio('Sin faltantes', 'Las órdenes 2.0 abiertas tienen stock para su BOM.')}</div>`}
      </div></div>
    </div>`;
}

// ---------------------------------------------------------------------
//  ACCIONES
// ---------------------------------------------------------------------
const guardar = (msg, fn) => async v => { await fn(v); toast(msg); await bus.refrescar(); };

export const acciones = {
  'prod-editar': d => {
    const pr = S.datos.productos.find(p => p.id === d.id); if (!pr) return;
    const estados = pr.gama === 'Signature' ? [['Inactivo', 'Inactivo'], ['A pedido', 'A pedido (habilitado bajo pedido)']] : ['Activo', 'A pedido', 'Inactivo'];
    formulario(`Editar ${pr.codigo}`, [
      { k: 'nombre_comercial', l: 'Nombre comercial', req: true, max: 80, ancho: true, ayuda: 'El código no cambia aunque cambie el nombre.' },
      { k: 'estado_comercial', l: 'Estado comercial', t: 'select', opts: estados },
      { k: 'aprobacion_tecnica', l: 'Aprobación técnica', t: 'select', opts: ['Pendiente', 'Aprobado', 'Rechazado'] },
      { k: 'descripcion', l: 'Descripción', t: 'textarea', max: 500, ancho: true },
      { k: 'condiciones_venta', l: 'Condiciones de venta', t: 'textarea', max: 500, ancho: true },
      { k: 'vigencia_desde', l: 'Vigente desde', t: 'date', req: true },
      { k: 'vigencia_hasta', l: 'Vigente hasta', t: 'date' },
      { k: 'usd_m2_min', l: 'Rango comercial USD/m² mínimo (opcional)', t: 'number', min: 0 },
      { k: 'usd_m2_max', l: 'Rango comercial USD/m² máximo (opcional)', t: 'number', min: 0 }
    ], pr, guardar('Producto actualizado', v => db.actualizar('productos', 'id', pr.id, v)));
  },
  'prod-bom': d => { S.ing.producto = d.id; S.ing.bom = ''; S.ing.tec = ''; S.ing.tam = ''; S.ing.gama = ''; bus.ir('bom'); },
  'addon-costo': d => {
    const c = S.datos.addon_costos.find(x => x.id === d.id); if (!c) return;
    const a = S.datos.addons.find(x => x.id === c.addon_id);
    formulario(`${a?.nombre} · ${E.etiquetaTec(c.tecnologia)} ${c.tamano}`, [
      { k: 'costo', l: 'Costo directo (USD) · vacío = sin definir', t: 'number', min: 0, step: '0.01' },
      { k: 'disponible', l: 'Disponibilidad', t: 'checkbox', texto: 'Disponible para esta tecnología y tamaño' },
      { k: 'g_bas', l: 'Gamas compatibles', t: 'checkbox', texto: 'Básico' },
      { k: 'g_prm', l: '', t: 'checkbox', texto: 'Premium' },
      { k: 'g_sig', l: '', t: 'checkbox', texto: 'Signature' }
    ], { ...c, g_bas: (c.gamas || []).includes('Básico'), g_prm: (c.gamas || []).includes('Premium'), g_sig: (c.gamas || []).includes('Signature') },
    guardar('Adicional actualizado', v => db.actualizar('addon_costos', 'id', c.id, { costo: v.costo, disponible: v.disponible,
      gamas: [v.g_bas && 'Básico', v.g_prm && 'Premium', v.g_sig && 'Signature'].filter(Boolean) })));
  },
  'fl-limpiar': () => { Object.assign(S.filtros, { tec: '', tam: '', gama: '', origen: '', estado: '', desde: '', hasta: '', ubicacion: '' }); bus.render(); }
};

export const cambios = {
  ...Object.fromEntries(['tec', 'tam', 'gama', 'origen', 'estado', 'desde', 'hasta', 'ubicacion']
    .map(k => ['fl-' + k, el => { S.filtros[k] = el.value.slice(0, 60); bus.render(); }]))
};

