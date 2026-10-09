// =====================================================================
//  Ingeniería de Costos y Materiales (Trazo Fino 2.0)
//  Catálogo de materiales · BOM por modelo · Presupuestos por proyecto
//  Comparador de costos (optimizador) · Historial de precios
//  Todo cálculo que queda guardado lo hace el servidor; acá solo se muestra.
// =====================================================================
import { html, usd, usd2, n2, pct, fecha, fechaHora, hoyISO } from './html.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, nombreUsuario } from './estado.js';
import { formulario, confirmar, toast } from './ui.js';

const UNIDADES = ['m', 'm²', 'm³', 'kg', 'un', 'lt', 'gl', 'jornal', 'hora', 'global', 'pie²', 'rollo', 'caja', 'par', 'kit', 'bolsa'];
const TIPOS_TC = ['MEP', 'Oficial BNA', 'CCL', 'Mayorista', 'Otro'];
const nf4 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const u4 = v => 'USD ' + nf4.format(Number(v) || 0);
const ars = v => 'ARS ' + n2(v);
const num = v => Number(v) || 0;
const clsBom = e => e === 'Aprobado' ? 'p-ok' : e === 'Pendiente de validación' ? 'p-warn' : e === 'Obsoleto' ? 'p-neutral' : 'p-info';
const clsPres = e => e === 'Emitido' ? 'p-ok' : e === 'Borrador' ? 'p-info' : 'p-neutral';
const clsSust = e => e === 'Aprobada' ? 'p-ok' : e === 'Aplicada' ? 'p-info' : e === 'Rechazada' ? 'p-neutral' : 'p-warn';
const err = m => Object.assign(new Error(m), { code: 'P0001' });

export const etiquetaProducto = pr => pr ? `${pr.codigo} · ${E.etiquetaTec(pr.tecnologia)} ${pr.tamano} ${pr.gama}` : '—';
export const tcVigente = () => (S.datos.tipos_cambio || [])[0] || null;
const tcOpts = () => [['', '— Sin tipo de cambio —'], ...(S.datos.tipos_cambio || []).map(t => [t.id, `${t.tipo} ${n2(t.valor)} · ${fecha(t.fecha)} · ${t.fuente}`])];
const prod = id => (S.datos.productos || []).find(p => p.id === id);
const prodCod = c => (S.datos.productos || []).find(p => p.codigo === c);
const bomDe = id => (S.datos.boms || []).find(b => b.id === id);
const insumo = c => S.datos.insumos.find(i => i.codigo === c);
const provNombre = id => S.datos.proveedores.find(p => p.id === id)?.nombre || '—';
const precioOriginal = i => E.sinPrecio(i.costo_original) ? pill('Pendiente', 'p-warn') : html`${i.moneda} ${n2(i.costo_original)}`;

/** Filtro común Tecnología → Tamaño → Gama (también lo usa el catálogo). */
export function filtroProductos(f, prefijo) {
  return html`<div class="filtros">
    <label class="f"><span>Tecnología</span><select data-change="${prefijo}-tec"><option value="">Todas</option>
      ${Object.entries(E.TECNOLOGIAS).map(([k, l]) => html`<option value="${k}" ${f.tec === k ? html`selected` : ''}>${l}</option>`)}</select></label>
    <label class="f"><span>Tamaño</span><select data-change="${prefijo}-tam"><option value="">Todos</option>
      ${Object.entries(E.TAMANOS).map(([k, d]) => html`<option value="${k}" ${f.tam === k ? html`selected` : ''}>${k} · ${d.m2} m²</option>`)}</select></label>
    <label class="f"><span>Gama</span><select data-change="${prefijo}-gama"><option value="">Todas</option>
      ${E.GAMAS_2.map(g => html`<option ${f.gama === g ? html`selected` : ''}>${g}</option>`)}</select></label>
  </div>`;
}
export const filtrar = (lista, f, campos = { tec: 'tecnologia', tam: 'tamano', gama: 'gama' }) =>
  lista.filter(x => (!f.tec || x[campos.tec] === f.tec) && (!f.tam || x[campos.tam] === f.tam) && (!f.gama || x[campos.gama] === f.gama));

// ---------------------------------------------------------------------
//  CATÁLOGO DE MATERIALES
// ---------------------------------------------------------------------
export function vMateriales() {
  const D = S.datos, f = S.ing, tc = tcVigente();
  const usoBom = c => new Set(D.bom_items.filter(x => x.insumo_codigo === c).map(x => x.bom_id)).size;
  const q = (f.buscar || '').toLowerCase();
  const lista = D.insumos.filter(i => (!f.categoria || i.categoria === f.categoria) &&
    (!q || [i.codigo, i.descripcion, i.categoria, provNombre(i.proveedor_id)].some(x => String(x || '').toLowerCase().includes(q))));
  const pend = D.insumos.filter(i => E.sinPrecio(i.costo)).length;
  return html`
    ${head('Catálogo de materiales', 'Catálogo maestro compartido por los 12 modelos. Cada precio se guarda en su moneda original con el equivalente en USD (moneda de gestión) y en ARS. Un precio vacío es "pendiente", nunca cero.',
      html`<button class="btn" data-action="tc-nuevo">Cargar tipo de cambio</button>
           <button class="btn primary" data-action="mat-nuevo">Agregar material</button>`)}
    <div class="kpis">
      ${kpi('Materiales activos', D.insumos.filter(i => i.activo !== false).length, `${D.insumos.length} en total`)}
      ${kpi('Sin precio confirmado', pend, pend ? 'no se pueden aprobar BOM que los usen' : 'todos con precio', pend ? 'warn' : 'good')}
      ${kpi('Tipo de cambio de referencia', tc ? `${tc.tipo} ${n2(tc.valor)}` : 'Sin cargar', tc ? `${fecha(tc.fecha)} · ${tc.fuente}` : 'Cargalo a mano con su fuente: el sistema no inventa cotizaciones', tc ? '' : 'warn')}
      ${kpi('Materiales en pesos', D.insumos.filter(i => i.moneda === 'ARS').length, 'se convierten con su propio tipo de cambio')}
    </div>
    <div class="panel"><h3>Buscar</h3><div class="body"><div class="filtros">
      <label class="f"><span>Código, nombre, categoría o proveedor</span><input data-change="ing-buscar" value="${f.buscar}" maxlength="60" placeholder="Ej.: pino, MAD-, sanitario"></label>
      <label class="f"><span>Categoría</span><select data-change="ing-categoria"><option value="">Todas</option>
        ${E.CATEGORIAS.map(c => html`<option ${f.categoria === c ? html`selected` : ''}>${c}</option>`)}</select></label>
    </div></div></div>
    <div class="panel"><h3>Materiales <span class="tag">${lista.length} de ${D.insumos.length}</span></h3><div class="body tight">
      ${lista.length ? html`<div class="scroll"><table>
        <thead><tr><th>Código</th><th>Descripción</th><th>Categoría</th><th>Unidad</th><th>Proveedor</th><th class="num">Precio original</th>
          <th class="num">USD</th><th class="num">ARS</th><th class="num">TC</th><th>Cotizado</th><th>Estado</th><th class="num">BOM</th><th></th></tr></thead>
        <tbody>${lista.map(i => html`<tr>
          <td><code>${i.codigo}</code></td><td>${i.descripcion}${i.observaciones ? html`<br><span class="small mute">${i.observaciones}</span>` : ''}</td>
          <td>${i.categoria}</td><td>${i.unidad}</td><td>${provNombre(i.proveedor_id)}</td>
          <td class="num">${precioOriginal(i)}</td>
          <td class="num">${E.sinPrecio(i.costo) ? '—' : u4(i.costo)}</td>
          <td class="num">${E.sinPrecio(i.costo_ars) ? '—' : ars(i.costo_ars)}</td>
          <td class="num">${i.tc_valor ? n2(i.tc_valor) : '—'}</td><td>${fecha(i.fecha_cotizacion)}</td>
          <td>${i.activo === false ? pill('Inactivo') : E.sinPrecio(i.costo) ? pill('Pendiente', 'p-warn') : pill('Confirmado', 'p-ok')}</td>
          <td class="num">${usoBom(i.codigo) || '—'}</td>
          <td class="num nowrap"><button class="btn sm" data-action="mat-precio" data-id="${i.codigo}">Precio</button>
            <button class="btn sm" data-action="mat-editar" data-id="${i.codigo}">Editar</button>
            <button class="btn sm ghost" data-action="mat-historial" data-id="${i.codigo}">Historial</button></td></tr>`)}</tbody></table></div>`
      : vacio('Sin materiales para ese filtro', 'Probá con otra búsqueda o agregá el material.')}
    </div></div>
    <div class="panel"><h3>Tipos de cambio cargados</h3><div class="body tight">
      ${(D.tipos_cambio || []).length ? html`<table><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">ARS por USD</th><th>Fuente</th><th>Cargó</th><th></th></tr></thead>
        <tbody>${D.tipos_cambio.slice(0, 12).map(t => html`<tr><td>${fecha(t.fecha)}</td><td>${t.tipo}</td><td class="num">${n2(t.valor)}</td>
          <td>${t.fuente}</td><td>${nombreUsuario(t.created_by)}</td>
          <td class="num"><button class="btn sm ghost" data-action="tc-borrar" data-id="${t.id}">Borrar</button></td></tr>`)}</tbody></table>`
      : vacio('Sin tipos de cambio', 'Cargá el primero (por ejemplo, el MEP del día) indicando la fuente.')}
    </div></div>`;
}

const camposMaterial = nuevo => [
  ...(nuevo ? [{ k: 'codigo', l: 'Código', req: true, max: 20, pattern: '[A-Z0-9\\-]{2,20}', errorPatron: 'Código: mayúsculas, números y guiones (2 a 20).', ph: 'MAD-010' }] : []),
  { k: 'descripcion', l: 'Descripción', req: true, max: 120, ancho: true },
  { k: 'categoria', l: 'Categoría', t: 'select', opts: E.CATEGORIAS },
  { k: 'unidad', l: 'Unidad', t: 'select', opts: UNIDADES },
  ...(nuevo ? [
    { k: 'moneda', l: 'Moneda del precio', t: 'select', opts: ['USD', 'ARS'] },
    { k: 'costo_original', l: 'Precio unitario (vacío = pendiente)', t: 'number', min: 0, step: '0.0001' },
    { k: 'tc_id', l: 'Tipo de cambio', t: 'select', opts: tcOpts(), ancho: true, ayuda: 'Obligatorio si el precio está en pesos.' }] : []),
  { k: 'merma', l: 'Merma (%)', t: 'number', pct: true, min: 0, maxN: 50, step: '0.1' },
  { k: 'proveedor_id', l: 'Proveedor', t: 'select', opts: [['', '— Ninguno —'], ...S.datos.proveedores.map(p => [p.id, p.nombre])] },
  { k: 'observaciones', l: 'Observaciones', t: 'textarea', max: 500, ancho: true },
  ...(nuevo ? [] : [{ k: 'activo', l: 'Estado', t: 'checkbox', texto: 'Activo (disponible para BOM nuevos)' }])
];

/** Aviso de duplicados antes de crear: mismo código o misma descripción. */
export function duplicadoDe(codigo, descripcion) {
  const d = String(descripcion || '').trim().toLowerCase();
  return S.datos.insumos.find(i => i.codigo === codigo) || S.datos.insumos.find(i => i.descripcion.trim().toLowerCase() === d) || null;
}

// ---------------------------------------------------------------------
//  BOM POR MODELO
// ---------------------------------------------------------------------
function productoSeleccionado() {
  const lista = filtrar(S.datos.productos, S.ing);
  let pr = prodCod(S.ing.producto);
  if (!pr || !lista.includes(pr)) { pr = lista[0] || null; S.ing.producto = pr?.codigo || ''; }
  return { pr, lista };
}

export function vBom() {
  const D = S.datos, { pr, lista } = productoSeleccionado();
  const versiones = pr ? D.boms.filter(b => b.producto_id === pr.id).sort((a, b) => b.version - a.version) : [];
  let bom = bomDe(S.ing.bom);
  if (!bom || bom.producto_id !== pr?.id) { bom = versiones.find(b => b.vigente) || versiones[0] || null; S.ing.bom = bom?.id || ''; }
  return html`
    ${head('BOM por modelo', 'Lista de materiales y cantidades de cada configuración. Solo un BOM aprobado sirve para cotizar; los aprobados no se editan: se duplican como borrador.',
      pr ? html`<button class="btn" data-action="bom-nuevo">Nuevo BOM vacío</button>` : '')}
    <div class="panel"><div class="body">
      ${filtroProductos(S.ing, 'ing')}
      <label class="f"><span>Modelo</span><select data-change="ing-producto">
        ${lista.map(p => html`<option value="${p.codigo}" ${pr?.codigo === p.codigo ? html`selected` : ''}>${etiquetaProducto(p)}</option>`)}</select></label>
      ${pr ? html`<p class="hint nomargin">${pr.descripcion || ''} · Estado comercial: <b>${pr.estado_comercial}</b> · Aprobación técnica: <b>${pr.aprobacion_tecnica}</b></p>` : ''}
    </div></div>
    ${pr ? html`<div class="panel"><h3>Versiones</h3><div class="body tight">
      ${versiones.length ? html`<table><thead><tr><th>Versión</th><th>Estado</th><th class="num">Ítems</th><th class="num">Costo directo</th><th>Creado</th><th>Aprobado</th><th></th></tr></thead>
        <tbody>${versiones.map(b => {
          const k = E.costoItems(E.itemsBom(b.id, D));
          return html`<tr class="${b.id === bom?.id ? 'open' : ''}">
            <td><b>v${b.version}</b> ${b.vigente ? pill('Vigente', 'p-ok') : ''}${b.origen_id ? html` <span class="small mute">copia de v${bomDe(b.origen_id)?.version ?? '?'}</span>` : ''}</td>
            <td>${pill(b.estado, clsBom(b.estado))}</td><td class="num">${k.items}</td>
            <td class="num">${usd(k.total)}${k.pendientes ? html` ${pill(k.pendientes + ' sin precio', 'p-warn')}` : ''}</td>
            <td class="small">${fechaHora(b.created_at)}<br>${nombreUsuario(b.created_by)}</td>
            <td class="small">${b.aprobado_at ? html`${fechaHora(b.aprobado_at)}<br>${nombreUsuario(b.aprobado_por)}` : '—'}</td>
            <td class="num nowrap"><button class="btn sm" data-action="bom-ver" data-id="${b.id}">Ver</button>
              <button class="btn sm" data-action="bom-duplicar" data-id="${b.id}">Duplicar</button>
              ${b.estado === 'Borrador' ? html`<button class="btn sm primary" data-action="bom-estado" data-id="${b.id}" data-e="Pendiente de validación">Enviar a aprobación</button>
                <button class="btn sm ghost" data-action="bom-borrar" data-id="${b.id}">Borrar</button>` : ''}
              ${b.estado === 'Pendiente de validación' ? html`<button class="btn sm primary" data-action="bom-estado" data-id="${b.id}" data-e="Aprobado">Aprobar</button>
                <button class="btn sm" data-action="bom-estado" data-id="${b.id}" data-e="Borrador">Devolver a borrador</button>` : ''}
              ${b.estado === 'Aprobado' ? html`<button class="btn sm ghost" data-action="bom-estado" data-id="${b.id}" data-e="Obsoleto">Marcar obsoleto</button>` : ''}</td></tr>`;
        })}</tbody></table>`
      : vacio('Este modelo todavía no tiene BOM', 'Creá uno vacío, importá el presupuesto de Sebastián o duplicá el de otro modelo.')}
    </div></div>` : vacio('Sin modelos para ese filtro', '')}
    ${bom ? detalleBom(bom, pr, versiones) : ''}`;
}

function detalleBom(bom, pr, versiones) {
  const D = S.datos, items = E.itemsBom(bom.id, D), k = E.costoItems(items), tc = tcVigente(), editable = bom.estado === 'Borrador';
  let fin = null; try { fin = E.finanzas(k.total, D.params); } catch (_) { fin = null; }
  const otra = versiones.find(b => b.id === S.ing.comparar && b.id !== bom.id);
  return html`
    <div class="panel"><h3>BOM v${bom.version} · ${pr.codigo} ${pill(bom.estado, clsBom(bom.estado))}
      ${bom.nota ? html`<span class="tag">${bom.nota}</span>` : ''}</h3><div class="body tight">
      ${editable ? html`<div class="toolbar"><button class="btn sm primary" data-action="bom-item-nuevo" data-id="${bom.id}">Agregar material</button>
        <button class="btn sm" data-action="bom-importar" data-id="${bom.id}">Importar presupuesto</button>
        <span class="small mute">Los cambios quedan en este borrador; el estándar aprobado no se toca.</span></div>` : ''}
      ${items.length ? html`<div class="scroll"><table>
        <thead><tr><th>Código</th><th>Descripción</th><th>Unidad</th><th class="num">Cant. base</th><th class="num">Merma</th><th class="num">Cant. total</th>
          <th class="num">Unit. USD</th><th class="num">Unit. ARS</th><th class="num">Subtotal USD</th><th class="num">Subtotal ARS</th><th></th></tr></thead>
        <tbody>${items.map(i => {
          const tot = num(i.cantidad) * (1 + num(i.merma)), sub = E.sinPrecio(i.costo) ? null : i.costo * tot;
          const unitArs = E.sinPrecio(i.costo) || !tc ? null : i.costo * num(tc.valor);
          return html`<tr><td><code>${i.codigo}</code></td>
            <td>${i.descripcion} ${i.pendiente_sustitucion ? pill('Pendiente de sustitución', 'p-warn') : ''} ${i.activo ? '' : pill('Inactivo', 'p-bad')}
              ${i.nota ? html`<br><span class="small mute">${i.nota}</span>` : ''}</td>
            <td>${i.unidad}</td><td class="num">${n2(i.cantidad)}</td><td class="num">${pct(i.merma)}</td><td class="num">${n2(tot)}</td>
            <td class="num">${sub === null ? pill('Sin precio', 'p-warn') : u4(i.costo)}</td><td class="num">${unitArs === null ? '—' : ars(unitArs)}</td>
            <td class="num">${sub === null ? '—' : usd2(sub)}</td><td class="num">${sub === null || !tc ? '—' : ars(sub * num(tc.valor))}</td>
            <td class="num nowrap">${editable ? html`<button class="btn sm" data-action="bom-item-editar" data-id="${i.id}">Editar</button>
              <button class="btn sm ghost" data-action="bom-item-quitar" data-id="${i.id}">Quitar</button>` : ''}
              <button class="btn sm ghost" data-action="sust-nueva" data-id="${bom.id}" data-c="${i.codigo}">Sustituir</button></td></tr>`;
        })}</tbody>
        <tfoot><tr><td colspan="8">Materiales ${usd2(k.materiales)} · Mano de obra ${usd2(k.mdo)}${k.pendientes ? ` · ${k.pendientes} sin precio (no suman)` : ''}</td>
          <td class="num">${usd2(k.total)}</td><td class="num">${tc ? ars(k.total * num(tc.valor)) : '—'}</td><td></td></tr></tfoot>
      </table></div>` : vacio('BOM vacío', editable ? 'Agregá materiales o importá un presupuesto.' : '')}
    </div></div>
    <div class="row r2">
      <div class="panel"><h3>Estimación con las reglas vigentes <span class="tag">no es una cotización</span></h3><div class="body">
        ${fin ? html`<table class="breakdown">
          <tr><td>Costo directo del módulo</td><td class="num"><b>${usd(k.total)}</b></td></tr>
          <tr class="big"><td>PVP estimado</td><td class="num">${usd(fin.pvp)}</td></tr>
          <tr><td>PVP por m² (${n2(pr.superficie_m2)} m²)</td><td class="num">${usd(fin.pvp / num(pr.superficie_m2))}</td></tr>
          <tr class="sub"><td>Honorarios · Comercial · Margen</td><td class="num">${usd(fin.hon)} · ${usd(fin.mkt)} · ${usd(fin.ganancia)}</td></tr></table>
          ${k.pendientes ? html`<p class="hint">Hay materiales sin precio: el costo está incompleto y el BOM no se puede aprobar.</p>` : ''}
          ${tc ? html`<p class="hint">Equivalentes en ARS al tipo de cambio ${tc.tipo} ${n2(tc.valor)} del ${fecha(tc.fecha)} (referencia, no se guarda).</p>` : ''}`
        : html`<p class="mute">Las reglas de precio no suman 100 %.</p>`}
      </div></div>
      <div class="panel"><h3>Comparar versiones</h3><div class="body">
        <label class="f"><span>Comparar v${bom.version} con</span><select data-change="ing-comparar"><option value="">— Elegí una versión —</option>
          ${versiones.filter(b => b.id !== bom.id).map(b => html`<option value="${b.id}" ${S.ing.comparar === b.id ? html`selected` : ''}>v${b.version} · ${b.estado}</option>`)}</select></label>
        ${otra ? comparacion(bom, otra) : html`<p class="hint nomargin">Muestra materiales agregados, quitados y cambios de cantidad y de costo.</p>`}
      </div></div>
    </div>`;
}

function comparacion(a, b) {
  const D = S.datos, ia = E.itemsBom(a.id, D), ib = E.itemsBom(b.id, D);
  const cods = [...new Set([...ia, ...ib].map(i => i.codigo))].sort();
  const sub = i => i && !E.sinPrecio(i.costo) ? i.costo * num(i.cantidad) * (1 + num(i.merma)) : 0;
  const filas = cods.map(c => { const x = ia.find(i => i.codigo === c), y = ib.find(i => i.codigo === c); return { c, x, y, d: sub(x) - sub(y) }; })
    .filter(r => !r.x || !r.y || num(r.x.cantidad) !== num(r.y.cantidad) || Math.abs(r.d) > 0.005);
  const ta = E.costoItems(ia).total, tb = E.costoItems(ib).total;
  return html`<table class="inner"><thead><tr><th>Material</th><th class="num">v${a.version}</th><th class="num">v${b.version}</th><th class="num">Δ costo</th></tr></thead>
    <tbody>${filas.length ? filas.map(r => html`<tr><td><code>${r.c}</code> ${(r.x || r.y).descripcion}</td>
      <td class="num">${r.x ? n2(r.x.cantidad) : pill('No está')}</td><td class="num">${r.y ? n2(r.y.cantidad) : pill('No está')}</td>
      <td class="num ${r.d > 0 ? 'bad' : 'ok'}">${r.d > 0 ? '+' : ''}${usd2(r.d)}</td></tr>`) : html`<tr><td colspan="4" class="mute">Sin diferencias.</td></tr>`}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${usd(ta)}</td><td class="num">${usd(tb)}</td><td class="num">${ta - tb > 0 ? '+' : ''}${usd(ta - tb)} (${tb ? pct(ta / tb - 1) : '—'})</td></tr></tfoot></table>`;
}

// ---------------------------------------------------------------------
//  PRESUPUESTOS POR PROYECTO
// ---------------------------------------------------------------------
export function vPresupuestos() {
  const D = S.datos, ps = D.presupuestos || [];
  const abierto = ps.find(p => p.id === S.ing.presupuesto);
  return html`
    ${head('Presupuestos por proyecto', 'Cada proyecto parte de una copia del BOM aprobado y se ajusta sin tocar el estándar. Una vez emitido queda congelado: los cambios van en una revisión nueva.',
      html`<button class="btn primary" data-action="pres-nuevo">Nuevo presupuesto</button>`)}
    <div class="panel"><div class="body tight">
      ${ps.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Rev.</th><th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Estado</th><th class="num">TC</th><th class="num">Costo directo</th><th class="num">PVP estimado</th><th></th></tr></thead>
        <tbody>${ps.map(p => {
          const r = calcPres(p);
          return html`<tr class="clic ${abierto?.id === p.id ? 'open' : ''}" data-action="pres-abrir" data-id="${p.id}">
            <td>${p.numero}</td><td>${p.revision}</td><td>${fecha(p.created_at)}</td><td>${p.cliente}</td><td>${prod(p.producto_id)?.codigo || '—'}</td>
            <td>${pill(p.estado, clsPres(p.estado))}</td><td class="num">${p.tc_valor ? `${p.tc_tipo} ${n2(p.tc_valor)}` : '—'}</td>
            <td class="num">${r ? usd(r.cd) : '—'}${r?.pendientes ? html` ${pill(r.pendientes + ' sin precio', 'p-warn')}` : ''}</td>
            <td class="num">${r ? usd(r.pvp) : '—'}</td><td class="num"><button class="btn sm">Abrir</button></td></tr>`;
        })}</tbody></table></div>` : vacio('Sin presupuestos', 'Se crean a partir de un modelo con BOM aprobado vigente.')}
    </div></div>
    ${abierto ? detallePres(abierto) : ''}`;
}

function calcPres(p) {
  const pr = prod(p.producto_id); if (!pr) return null;
  try { return E.cotizarV2({ producto: pr.codigo, presupuesto: p.id }, S.datos); } catch (_) { return null; }
}

function detallePres(p) {
  const D = S.datos, pr = prod(p.producto_id), r = calcPres(p), borr = p.estado === 'Borrador';
  const est = pr ? (() => { try { return E.cotizarV2({ producto: pr.codigo, bom: p.bom_id, addons: p.addons || [] }, D); } catch (_) { return null; } })() : null;
  const disp = E.addonsDisponibles(pr, D);
  const revisiones = D.presupuestos.filter(x => x.grupo === p.grupo).sort((a, b) => a.revision - b.revision);
  return html`
    <div class="panel"><h3>Presupuesto N.º ${p.numero} · revisión ${p.revision} · ${p.cliente} ${pill(p.estado, clsPres(p.estado))}</h3><div class="body">
      <div class="toolbar">
        ${borr ? html`<button class="btn sm primary" data-action="pres-agregar" data-id="${p.id}" data-m="proyecto">Agregar: solo este proyecto</button>
          <button class="btn sm primary" data-action="pres-agregar" data-id="${p.id}" data-m="catalogo">Agregar y guardar también en catálogo</button>
          <button class="btn sm" data-action="pres-precios" data-id="${p.id}">Traer precios actuales del catálogo</button>
          <button class="btn sm" data-action="pres-tc" data-id="${p.id}">Cambiar tipo de cambio</button>
          <button class="btn sm" data-action="pres-descuento" data-id="${p.id}">Descuento autorizado</button>
          <button class="btn sm primary" data-action="pres-emitir" data-id="${p.id}">Emitir cotización</button>
          <button class="btn sm ghost" data-action="pres-borrar" data-id="${p.id}">Borrar</button>`
        : html`${p.estado !== 'Anulado' ? html`<button class="btn sm primary" data-action="pres-revision" data-id="${p.id}">Nueva revisión</button>` : ''}`}
        ${['Borrador', 'Emitido'].includes(p.estado) ? html`<button class="btn sm ghost" data-action="pres-anular" data-id="${p.id}">Anular</button>` : ''}
      </div>
      <p class="hint">Modelo ${etiquetaProducto(pr)} · BOM v${p.bom_version ?? '—'} · Tipo de cambio ${p.tc_valor ? `${p.tc_tipo} ${n2(p.tc_valor)} del ${fecha(p.tc_fecha)} (${p.tc_fuente})` : 'sin definir'}
        · Revisiones: ${revisiones.map(x => `r${x.revision} ${x.estado.toLowerCase()}`).join(', ')}</p>
      ${disp.length ? html`<div class="mt"><span class="lbl">Adicionales compatibles con ${pr.codigo}</span>
        ${disp.map(a => html`<label class="chk"><input type="checkbox" data-change="pres-addon" data-id="${p.id}" data-a="${a.addon_id}"
          ${(p.addons || []).includes(a.addon_id) ? html`checked` : ''} ${borr ? '' : html`disabled`}> ${a.nombre} <span class="mute">· ${usd(a.costo)} de costo</span></label>`)}</div>` : ''}
    </div></div>
    <div class="row r2">
      <div class="panel"><h3>Resultado</h3><div class="body">${r ? html`<table class="breakdown">
        <tr><td>Materiales</td><td class="num">${usd(r.materiales)}</td></tr><tr><td>Mano de obra</td><td class="num">${usd(r.mdo)}</td></tr>
        ${r.costoAddons ? html`<tr><td>Adicionales</td><td class="num">${usd(r.costoAddons)}</td></tr>` : ''}
        <tr><td><b>Costo directo total</b></td><td class="num"><b>${usd(r.cd)}</b></td></tr>
        <tr class="big"><td>PVP</td><td class="num">${usd(r.pvp)}</td></tr>
        ${num(p.descuento) ? html`<tr class="sub bad"><td>Descuento autorizado (${p.descuento_motivo})</td><td class="num">− ${usd(p.descuento)}</td></tr>
          <tr><td><b>Precio final</b></td><td class="num"><b>${usd(r.pvp - num(p.descuento))}</b></td></tr>` : ''}
        <tr><td>PVP por m²</td><td class="num">${usd(r.pvpM2)}</td></tr>
        <tr class="sub"><td>Honorarios · Comercial · Margen</td><td class="num">${usd(r.hon)} · ${usd(r.mkt)} · ${usd(r.ganancia)}</td></tr>
        <tr class="sub"><td>Reserva · Dividendos A / B</td><td class="num">${usd(r.reserva)} · ${usd(r.divA)} / ${usd(r.divB)}</td></tr>
      </table>
      ${r.definitivo ? html`<p class="okbox mt">Listo para emitir una cotización definitiva.</p>` : html`<p class="warnbox mt">No se puede emitir todavía: ${r.observacion}.</p>`}`
        : vacio('Sin cálculo', '')}</div></div>
      <div class="panel"><h3>Contra el estándar</h3><div class="body">${r && est ? html`<table class="breakdown">
        <tr><td>Costo directo estándar (BOM v${p.bom_version} a precios de hoy)</td><td class="num">${usd(est.cd)}</td></tr>
        <tr><td>Costo directo de este proyecto</td><td class="num">${usd(r.cd)}</td></tr>
        <tr><td>Diferencia</td><td class="num ${r.cd - est.cd > 0 ? 'bad' : 'ok'}">${r.cd - est.cd > 0 ? '+' : ''}${usd(r.cd - est.cd)}</td></tr>
        <tr><td>Impacto en el PVP</td><td class="num">${r.pvp - est.pvp > 0 ? '+' : ''}${usd(r.pvp - est.pvp)}</td></tr></table>
        <p class="hint">El impacto en el precio sale de dividir la diferencia de costo por ${pct(D.params.p_costo)}, igual que el PVP.</p>` : ''}</div></div>
    </div>
    <div class="panel"><h3>Partidas del proyecto</h3><div class="body tight">
      <div class="scroll"><table><thead><tr><th>Origen</th><th>Código</th><th>Descripción</th><th>Unidad</th><th class="num">Cant.</th><th class="num">Merma</th>
        <th class="num">Precio original</th><th class="num">Unit. USD</th><th class="num">Subtotal USD</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${E.itemsPresupuesto(p.id, D).map(i => html`<tr>
        <td>${pill(i.origen, i.origen === 'BOM' ? 'p-neutral' : i.origen === 'Solo proyecto' ? 'p-warn' : 'p-info')}</td>
        <td>${i.codigo ? html`<code>${i.codigo}</code>` : '—'}</td><td>${i.descripcion}</td><td>${i.unidad}</td>
        <td class="num">${n2(i.cantidad)}</td><td class="num">${pct(i.merma)}</td>
        <td class="num">${E.sinPrecio(i.costo_original) ? pill('Pendiente', 'p-warn') : `${i.moneda} ${n2(i.costo_original)}`}</td>
        <td class="num">${E.sinPrecio(i.costo) ? '—' : u4(i.costo)}</td>
        <td class="num">${E.sinPrecio(i.costo) ? '—' : usd2(i.costo * num(i.cantidad) * (1 + num(i.merma)))}</td>
        <td class="small mute">${i.motivo || ''}</td>
        <td class="num nowrap">${borr ? html`<button class="btn sm" data-action="pres-item-editar" data-id="${i.id}">Editar</button>
          <button class="btn sm ghost" data-action="pres-item-quitar" data-id="${i.id}">Quitar</button>` : ''}</td></tr>`)}</tbody></table></div>
    </div></div>`;
}

// ---------------------------------------------------------------------
//  COMPARADOR DE COSTOS (optimizador de sustituciones)
// ---------------------------------------------------------------------
export function vComparador() {
  const D = S.datos, p = D.params, f = S.ing;
  const ss = D.sustituciones || [];
  const filas = ss.map(s => {
    const b = bomDe(s.bom_id), it = D.bom_items.find(x => x.bom_id === s.bom_id && x.insumo_codigo === s.insumo_original);
    const o = insumo(s.insumo_original), a = insumo(s.insumo_alternativa);
    const imp = it ? E.impactoSustitucion(it, o?.costo, a?.costo, a?.merma, s.factor_cantidad, p) : null;
    return { s, b, it, o, a, imp };
  });
  const aprob = filas.filter(x => x.s.estado === 'Aprobada' && x.imp);
  const modelos = filtrar(D.productos, f).map(pr => ({ pr, r: (() => { try { return E.cotizarV2({ producto: pr.codigo }, D); } catch (_) { return null; } })(), b: E.vigenteDe(pr.id, D) }));
  return html`
    ${head('Comparador de costos', 'Herramienta de análisis. Aprobar una sustitución no cambia ningún BOM; aplicarla es un paso aparte y solo sobre un borrador. Nunca se reducen requisitos estructurales, eléctricos, sanitarios, térmicos ni de seguridad para llegar a un precio.',
      html`<button class="btn primary" data-action="sust-nueva">Proponer sustitución</button>`)}
    <div class="kpis">
      ${kpi('Propuestas por decidir', ss.filter(s => s.estado === 'Propuesta').length, 'requieren validación técnica')}
      ${kpi('Ahorro de sustituciones aprobadas', usd(aprob.reduce((a, x) => a + x.imp.ahorroTotal, 0)), 'por módulo, todavía no aplicadas', 'good')}
      ${kpi('Impacto en el PVP', usd(aprob.reduce((a, x) => a + x.imp.impactoPvp, 0)), `ahorro ÷ ${pct(p.p_costo)}`)}
    </div>
    <div class="panel"><h3>Sustituciones</h3><div class="body tight">
      ${filas.length ? html`<div class="scroll"><table>
        <thead><tr><th>Modelo · BOM</th><th>Original</th><th>Alternativa</th><th class="num">Factor</th><th class="num">Costo original</th><th class="num">Costo alternativa</th>
          <th class="num">Ahorro unit.</th><th class="num">Ahorro total</th><th class="num">Variación</th><th class="num">Impacto PVP</th><th>Estado técnico</th><th></th></tr></thead>
        <tbody>${filas.map(({ s, b, o, a, imp }) => html`<tr>
          <td>${prod(b?.producto_id)?.codigo || '—'} · v${b?.version ?? '?'}</td>
          <td><code>${s.insumo_original}</code> ${o?.descripcion || ''}</td><td><code>${s.insumo_alternativa}</code> ${a?.descripcion || ''}</td>
          <td class="num">×${n2(s.factor_cantidad)}</td>
          <td class="num">${imp ? usd2(imp.orig) : '—'}</td><td class="num">${imp ? usd2(imp.alt) : pill('Sin precio', 'p-warn')}</td>
          <td class="num">${imp ? usd2(imp.ahorroUnit) : '—'}</td><td class="num ${imp && imp.ahorroTotal > 0 ? 'ok' : 'bad'}">${imp ? usd2(imp.ahorroTotal) : '—'}</td>
          <td class="num">${imp ? pct(imp.variacion) : '—'}</td><td class="num">${imp ? usd(imp.impactoPvp) : '—'}</td>
          <td>${pill(s.estado, clsSust(s.estado))}<br><span class="small mute">${s.motivo}${s.nota_tecnica ? ' · ' + s.nota_tecnica : ''}</span></td>
          <td class="num nowrap">${s.estado === 'Propuesta' ? html`<button class="btn sm primary" data-action="sust-decidir" data-id="${s.id}" data-a="1">Aprobar</button>
            <button class="btn sm" data-action="sust-decidir" data-id="${s.id}" data-a="0">Rechazar</button>` : ''}
            ${s.estado === 'Aprobada' ? html`<button class="btn sm primary" data-action="sust-aplicar" data-id="${s.id}">Aplicar a un borrador</button>` : ''}
            ${['Propuesta', 'Rechazada'].includes(s.estado) ? html`<button class="btn sm ghost" data-action="sust-borrar" data-id="${s.id}">Borrar</button>` : ''}</td></tr>`)}</tbody></table></div>`
      : vacio('Sin sustituciones', 'Proponé una desde aquí o desde un material del BOM (botón "Sustituir").')}
    </div></div>
    <div class="panel"><h3>Costos por modelo (BOM vigente)</h3><div class="body">
      ${filtroProductos(f, 'ing')}
      <div class="scroll"><table><thead><tr><th>Modelo</th><th>BOM</th><th class="num">Materiales</th><th class="num">Mano de obra</th><th class="num">Costo directo</th>
        <th class="num">PVP estimado</th><th class="num">PVP/m²</th><th>Estado</th></tr></thead>
      <tbody>${modelos.map(({ pr, r, b }) => html`<tr><td>${etiquetaProducto(pr)}</td><td>${b ? `v${b.version}` : '—'}</td>
        <td class="num">${b && r ? usd(r.materiales) : '—'}</td><td class="num">${b && r ? usd(r.mdo) : '—'}</td><td class="num">${b && r ? usd(r.cd) : '—'}</td>
        <td class="num">${b && r ? usd(r.pvp) : '—'}</td><td class="num">${b && r ? usd(r.pvpM2) : '—'}</td>
        <td>${r?.definitivo ? pill('Cotizable', 'p-ok') : pill(r?.observacion || 'Sin datos', 'p-neutral')}</td></tr>`)}</tbody></table></div>
      <p class="hint">Sin multiplicadores: cada modelo usa su propio BOM. Un modelo sin BOM aprobado no muestra costo.</p>
    </div></div>`;
}

// ---------------------------------------------------------------------
//  HISTORIAL DE PRECIOS
// ---------------------------------------------------------------------
export function vPrecios() {
  const D = S.datos, q = (S.ing.buscar || '').toUpperCase();
  const hist = (D.precios_historial || []).filter(h => !q || h.insumo_codigo.includes(q));
  const cot = D.cotizaciones.filter(c => c.generacion === '2.0' && (c.estado === 'Enviada' ||
    (c.estado === 'Ganada' && D.ventas.some(v => v.cotizacion_id === c.id && v.costo_real === null))));
  const impactos = cot.map(c => ({ c, e: E.erosionMargen(c, D) })).filter(x => x.e && Math.abs(x.e.aumento) > 0.005);
  const mats = (q ? D.insumos.filter(i => i.codigo.includes(q)) : D.insumos.filter(i => hist.some(h => h.insumo_codigo === i.codigo))).slice(0, 40);
  return html`
    ${head('Historial de precios', 'Cada alta o cambio de precio queda registrado con el usuario, la fecha, el tipo de cambio y el motivo. Las cotizaciones aprobadas conservan sus importes.')}
    <div class="panel"><div class="body"><label class="f"><span>Filtrar por código</span>
      <input data-change="ing-buscar" value="${S.ing.buscar}" maxlength="20" placeholder="Ej.: MAD-001"></label></div></div>
    ${impactos.length ? html`<div class="panel"><h3>Impacto de los cambios en proyectos abiertos</h3><div class="body tight"><table>
      <thead><tr><th>Cotización</th><th>Cliente</th><th>Modelo</th><th class="num">Costo aprobado</th><th class="num">A precios de hoy</th><th class="num">Diferencia</th><th class="num">Margen objetivo consumido</th><th></th></tr></thead>
      <tbody>${impactos.map(({ c, e }) => html`<tr><td>${c.numero}</td><td>${c.cliente}</td><td>${c.producto_codigo}</td>
        <td class="num">${usd(e.antes)}</td><td class="num">${usd(e.ahora)}</td><td class="num ${e.aumento > 0 ? 'bad' : 'ok'}">${e.aumento > 0 ? '+' : ''}${usd(e.aumento)}</td>
        <td class="num">${pct(e.consumido)}</td><td>${e.alerta ? pill('Compromete el margen', 'p-bad') : ''}</td></tr>`)}</tbody></table>
      <p class="hint">Las cotizaciones no cambian: esto mide cuánto costaría hoy recomprar sus materiales.</p></div></div>` : ''}
    <div class="panel"><h3>Los cuatro niveles de precio</h3><div class="body tight">
      ${mats.length ? html`<div class="scroll"><table><thead><tr><th>Material</th><th class="num">1 · Catálogo actual</th><th class="num">2 · Último presupuesto</th>
        <th class="num">3 · Última cotización aprobada</th><th class="num">4 · Última compra real</th></tr></thead>
      <tbody>${mats.map(i => {
        const pi = D.presupuesto_items.filter(x => x.insumo_codigo === i.codigo && !E.sinPrecio(x.costo_unit_usd))
          .sort((a, b) => a.created_at < b.created_at ? 1 : -1)[0];
        const ci = D.cotizaciones.filter(c => c.generacion === '2.0' && c.aprobacion === 'Aprobada' && Array.isArray(c.items_snapshot))
          .flatMap(c => c.items_snapshot.filter(x => x.codigo === i.codigo).map(x => ({ ...x, n: c.numero }))).sort((a, b) => b.n - a.n)[0];
        const oc = D.ocItems.filter(x => x.insumo_codigo === i.codigo && D.ocs.find(o => o.id === x.oc_id)?.estado === 'Recibida')
          .map(x => ({ ...x, o: D.ocs.find(o => o.id === x.oc_id) })).sort((a, b) => b.o.numero - a.o.numero)[0];
        return html`<tr><td><code>${i.codigo}</code> ${i.descripcion}</td>
          <td class="num">${E.sinPrecio(i.costo) ? pill('Pendiente', 'p-warn') : u4(i.costo)}</td>
          <td class="num">${pi ? u4(pi.costo_unit_usd) : '—'}</td><td class="num">${ci ? html`${u4(ci.costo_unit_usd)} <span class="mute small">(N.º ${ci.n})</span>` : '—'}</td>
          <td class="num">${oc ? html`${u4(oc.costo_unit)} <span class="mute small">(OC ${oc.o.numero})</span>` : '—'}</td></tr>`;
      })}</tbody></table></div>` : vacio('Sin materiales para comparar', 'Filtrá por un código o registrá cambios de precio.')}
    </div></div>
    <div class="panel"><h3>Cambios registrados</h3><div class="body tight">
      ${hist.length ? html`<div class="scroll"><table><thead><tr><th>Fecha</th><th>Material</th><th class="num">Antes USD</th><th class="num">Ahora USD</th>
        <th class="num">Variación</th><th class="num">Precio original</th><th class="num">TC</th><th>Usuario</th><th>Motivo</th></tr></thead>
      <tbody>${hist.map(h => {
        const v = num(h.costo_usd_ant) && !E.sinPrecio(h.costo_usd_nuevo) ? num(h.costo_usd_nuevo) / num(h.costo_usd_ant) - 1 : null;
        return html`<tr><td class="nowrap">${fechaHora(h.fecha)}</td><td><code>${h.insumo_codigo}</code></td>
          <td class="num">${E.sinPrecio(h.costo_usd_ant) ? '—' : u4(h.costo_usd_ant)}</td><td class="num">${E.sinPrecio(h.costo_usd_nuevo) ? pill('Pendiente', 'p-warn') : u4(h.costo_usd_nuevo)}</td>
          <td class="num">${v === null ? '—' : pill((v > 0 ? '+' : '') + pct(v), Math.abs(v) > E.UMBRAL_VARIACION_BOM ? 'p-bad' : 'p-neutral')}</td>
          <td class="num">${E.sinPrecio(h.original_nuevo) ? '—' : `${h.moneda_nueva} ${n2(h.original_nuevo)}`}</td><td class="num">${h.tc_valor ? n2(h.tc_valor) : '—'}</td>
          <td>${h.usuario ? nombreUsuario(h.usuario) : html`<span class="mute">Sistema</span>`}</td><td class="small">${h.motivo || ''}</td></tr>`;
      })}</tbody></table></div>` : vacio('Sin cambios registrados', 'Aparecen al dar de alta o cambiar el precio de un material.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  ACCIONES
// ---------------------------------------------------------------------
const guardar = (msg, fn) => async v => { await fn(v); toast(msg); await bus.refrescar(); };
const conError = fn => async d => { try { await fn(d); } catch (e) { toast(db.mensajeError(e), 'bad'); } };
const parsearImportacion = texto => texto.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^c[oó]digo\s*;/i.test(l)).map((l, i) => {
  const c = l.split(';').map(x => x.trim());
  if (c.length < 5) throw err(`Línea ${i + 1}: se esperan al menos 5 columnas separadas por ";"`);
  const nume = x => x === '' || x === undefined ? null : Number(x.replace(/\./g, '').replace(',', '.'));
  const cant = nume(c[4]);
  if (!(cant > 0)) throw err(`Línea ${i + 1}: cantidad inválida`);
  return { codigo: c[0] || null, descripcion: c[1], categoria: c[2], unidad: c[3], cantidad: cant,
    merma: c[5] ? nume(c[5]) / 100 : null, precio: nume(c[6]), moneda: (c[7] || 'USD').toUpperCase(), pendiente_sustitucion: /^s[ií]$/i.test(c[8] || '') };
});

export const acciones = {
  // materiales y tipos de cambio
  'tc-nuevo': () => formulario('Cargar tipo de cambio', [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', opts: TIPOS_TC },
    { k: 'valor', l: 'Pesos por 1 dólar', t: 'number', req: true, min: 0.0001, step: '0.0001' },
    { k: 'fuente', l: 'Fuente', req: true, max: 120, ancho: true, ph: 'Ej.: cotización MEP publicada por el banco, cierre del día' }
  ], { fecha: hoyISO(), tipo: 'MEP' }, guardar('Tipo de cambio cargado', v => db.insertar('tipos_cambio', v))),
  'tc-borrar': d => confirmar('Se borra el tipo de cambio. Si algún material o presupuesto lo usa, la base no lo permite.', async () => {
    await db.borrar('tipos_cambio', 'id', d.id); toast('Tipo de cambio borrado'); await bus.refrescar();
  }, 'Borrar'),
  'mat-nuevo': () => formulario('Agregar material al catálogo', camposMaterial(true),
    { categoria: 'Madera', unidad: 'un', moneda: 'USD', merma: 0, tc_id: tcVigente()?.id || '' },
    guardar('Material agregado al catálogo', async v => {
      const dup = duplicadoDe(v.codigo, v.descripcion);
      if (dup) throw err(`Ya existe ${dup.codigo} · ${dup.descripcion}. Usalo en lugar de crear un duplicado.`);
      if (v.moneda === 'ARS' && v.costo_original !== null && !v.tc_id) throw err('Un precio en pesos necesita un tipo de cambio.');
      await db.insertar('insumos', { codigo: v.codigo, descripcion: v.descripcion, categoria: v.categoria, unidad: v.unidad,
        costo_original: v.costo_original, moneda: v.moneda, tc_id: v.tc_id || null, merma: v.merma ?? 0,
        proveedor_id: v.proveedor_id || null, observaciones: v.observaciones, cant_s: 0, cant_m: 0, stock: 0 });
    })),
  'mat-editar': d => {
    const i = insumo(d.id); if (!i) return;
    formulario(`Editar material · ${i.codigo}`, camposMaterial(false), { ...i, merma: num(i.merma) * 100, activo: i.activo !== false },
      guardar('Material actualizado', v => db.actualizar('insumos', 'codigo', i.codigo, { descripcion: v.descripcion, categoria: v.categoria,
        unidad: v.unidad, merma: v.merma ?? 0, proveedor_id: v.proveedor_id || null, observaciones: v.observaciones, activo: v.activo })));
  },
  'mat-precio': d => {
    const i = insumo(d.id); if (!i) return;
    formulario(`Precio · ${i.codigo} ${i.descripcion}`, [
      { k: 'moneda', l: 'Moneda', t: 'select', opts: ['USD', 'ARS'] },
      { k: 'costo', l: 'Precio unitario (vacío = pendiente)', t: 'number', min: 0, step: '0.0001' },
      { k: 'tc', l: 'Tipo de cambio', t: 'select', opts: tcOpts(), ancho: true, ayuda: 'Obligatorio en pesos. En dólares, sirve para mostrar el equivalente en ARS.' },
      { k: 'motivo', l: 'Motivo del cambio', req: true, max: 300, ancho: true, ph: 'Ej.: nueva lista del proveedor' }
    ], { moneda: i.moneda || 'USD', costo: i.costo_original, tc: i.tc_id || tcVigente()?.id || '' },
    guardar('Precio actualizado', v => {
      if (v.moneda === 'ARS' && v.costo !== null && !v.tc) throw err('Un precio en pesos necesita un tipo de cambio.');
      return db.rpc.precioMaterial(i.codigo, v.costo, v.moneda, v.tc || null, v.motivo);
    }), 'Guardar precio');
  },
  'mat-historial': d => { S.ing.buscar = d.id; bus.ir('precios'); },

  // BOM
  'bom-nuevo': () => formulario(`Nuevo BOM · ${S.ing.producto}`, [{ k: 'nota', l: 'Nota', max: 500, ancho: true, ph: 'Ej.: presupuesto de Sebastián, octubre 2026' }], {},
    guardar('BOM creado en borrador', async v => { S.ing.bom = await db.rpc.bomCrear(S.ing.producto, v.nota); })),
  'bom-ver': d => { S.ing.bom = d.id; S.ing.comparar = ''; bus.render(); },
  'bom-duplicar': d => {
    const b = bomDe(d.id); if (!b) return;
    formulario(`Duplicar BOM v${b.version} de ${prod(b.producto_id)?.codigo}`, [
      { k: 'producto', l: 'Crear la copia para el modelo', t: 'select', opts: S.datos.productos.map(p => [p.codigo, etiquetaProducto(p)]), ancho: true,
        ayuda: 'Ej.: duplicar Wood M Premium como punto de partida de Wood M Básico y reemplazar terminaciones.' },
      { k: 'nota', l: 'Nota', max: 500, ancho: true }
    ], { producto: prod(b.producto_id)?.codigo }, guardar('Copia creada en borrador', async v => {
      const id = await db.rpc.bomDuplicar(b.id, v.producto, v.nota);
      S.ing.producto = v.producto; S.ing.tec = ''; S.ing.tam = ''; S.ing.gama = ''; S.ing.bom = id;
    }), 'Duplicar');
  },
  'bom-estado': d => {
    const txt = { 'Pendiente de validación': 'Se envía a aprobación. Mientras tanto no se puede editar.', 'Aprobado': 'Se aprueba y pasa a ser el BOM vigente del modelo (el anterior queda como histórico). Solo se puede si todos los materiales tienen precio.',
      'Borrador': 'Vuelve a borrador para corregirlo.', 'Obsoleto': 'Queda como histórico y deja de estar vigente. Las cotizaciones que lo usaron no cambian.' }[d.e];
    if (!txt) return;
    confirmar(txt, async () => { await db.rpc.bomEstado(d.id, d.e); toast('BOM ' + d.e.toLowerCase()); await bus.refrescar(); }, 'Confirmar');
  },
  'bom-borrar': d => confirmar('Se borra el borrador y sus materiales. El catálogo no cambia.', async () => {
    await db.borrar('boms', 'id', d.id); S.ing.bom = ''; toast('Borrador eliminado'); await bus.refrescar();
  }, 'Borrar'),
  'bom-item-nuevo': d => {
    const usados = new Set(S.datos.bom_items.filter(x => x.bom_id === d.id).map(x => x.insumo_codigo));
    const mats = S.datos.insumos.filter(i => i.activo !== false && !usados.has(i.codigo));
    if (!mats.length) { toast('No hay materiales activos para agregar: cargalos en el catálogo', 'warn'); return; }
    formulario('Agregar material al BOM', [
      { k: 'insumo_codigo', l: 'Material del catálogo', t: 'select', req: true, ancho: true,
        opts: mats.map(i => [i.codigo, `${i.codigo} · ${i.descripcion} (${i.unidad})${E.sinPrecio(i.costo) ? ' · sin precio' : ''}`]) },
      { k: 'cantidad', l: 'Cantidad base', t: 'number', req: true, min: 0.0001, step: '0.0001' },
      { k: 'merma', l: 'Merma (%) · vacío = la del catálogo', t: 'number', pct: true, min: 0, maxN: 50, step: '0.1' },
      { k: 'pendiente_sustitucion', l: 'Sustitución', t: 'checkbox', texto: 'Pendiente de sustitución por una alternativa' },
      { k: 'nota', l: 'Nota', max: 300, ancho: true }
    ], {}, guardar('Material agregado', v => db.insertar('bom_items', { ...v, bom_id: d.id, merma: v.merma })));
  },
  'bom-item-editar': d => {
    const it = S.datos.bom_items.find(x => x.id === d.id); if (!it) return;
    formulario(`Editar · ${it.insumo_codigo}`, [
      { k: 'cantidad', l: 'Cantidad base', t: 'number', req: true, min: 0.0001, step: '0.0001' },
      { k: 'merma', l: 'Merma (%)', t: 'number', pct: true, req: true, min: 0, maxN: 50, step: '0.1' },
      { k: 'pendiente_sustitucion', l: 'Sustitución', t: 'checkbox', texto: 'Pendiente de sustitución' },
      { k: 'nota', l: 'Nota', max: 300, ancho: true }
    ], { ...it, merma: num(it.merma) * 100 }, guardar('Material actualizado', v => db.actualizar('bom_items', 'id', it.id, v)));
  },
  'bom-item-quitar': conError(async d => { await db.borrar('bom_items', 'id', d.id); toast('Material quitado del borrador'); await bus.refrescar(); }),
  'bom-importar': d => formulario('Importar presupuesto al BOM', [
    { k: 'texto', l: 'Líneas (una por material, separadas por ";")', t: 'textarea', req: true, max: 60000, ancho: true,
      ayuda: 'Formato: código;descripción;categoría;unidad;cantidad;merma %;precio;moneda;pendiente de sustitución (sí/no). Si el código ya existe se reutiliza sin cambiar su precio; si está vacío se genera MAT-0001…; un precio vacío queda pendiente.' },
    { k: 'tc', l: 'Tipo de cambio para precios en pesos', t: 'select', opts: tcOpts(), ancho: true }
  ], { tc: tcVigente()?.id || '' }, async v => {
    const lineas = parsearImportacion(v.texto);
    const r = await db.rpc.bomImportar(d.id, lineas, v.tc || null);
    toast(`Importadas ${r.lineas} líneas: ${r.creados} materiales nuevos, ${r.reutilizados} reutilizados${r.avisos.length ? ` · ${r.avisos.length} avisos` : ''}`, r.avisos.length ? 'warn' : '');
    if (r.avisos.length) console.info('Avisos de importación:', r.avisos);
    await bus.refrescar();
  }, 'Importar'),

  // presupuestos por proyecto
  'pres-nuevo': () => {
    const D = S.datos, aptos = D.productos.filter(p => p.estado_comercial !== 'Inactivo' && E.vigenteDe(p.id, D));
    if (!aptos.length) { toast('Ningún modelo activo tiene un BOM aprobado vigente todavía', 'warn'); return; }
    formulario('Nuevo presupuesto por proyecto', [
      { k: 'producto', l: 'Modelo (con BOM aprobado)', t: 'select', opts: aptos.map(p => [p.codigo, etiquetaProducto(p)]), ancho: true },
      { k: 'cliente', l: 'Cliente o proyecto', req: true, max: 80 },
      { k: 'lead', l: 'Lead (opcional)', t: 'select', opts: [['', '— Sin vincular —'], ...D.leads.filter(E.ACTIVO).map(l => [l.id, l.nombre])] },
      { k: 'tc', l: 'Tipo de cambio del proyecto', t: 'select', opts: tcOpts(), ancho: true, ayuda: 'Obligatorio si el BOM tiene materiales en pesos. Queda guardado con el presupuesto.' },
      { k: 'nota', l: 'Nota', t: 'textarea', max: 500, ancho: true }
    ], { tc: tcVigente()?.id || '' }, guardar('Presupuesto creado', async v => {
      S.ing.presupuesto = await db.rpc.presCrear({ ...v, idem: db.nuevaClave() });
    }));
  },
  'pres-abrir': d => { S.ing.presupuesto = S.ing.presupuesto === d.id ? '' : d.id; bus.render(); },
  'pres-agregar': d => {
    const cat = d.m === 'catalogo';
    formulario(cat ? 'Agregar material y guardarlo en el catálogo' : 'Agregar material solo a este proyecto', [
      { k: 'codigo', l: cat ? 'Código del material' : 'Código del catálogo (opcional)', req: cat, max: 20, pattern: '[A-Za-z0-9\\-]{2,20}',
        ayuda: cat ? 'Si ya existe, el sistema lo avisa para no duplicarlo.' : 'Si indicás uno existente se usa ese material; si no, la partida queda solo en este proyecto.' },
      { k: 'descripcion', l: 'Descripción', req: true, max: 120, ancho: true },
      { k: 'categoria', l: 'Categoría', t: 'select', opts: E.CATEGORIAS },
      { k: 'unidad', l: 'Unidad', t: 'select', opts: UNIDADES },
      { k: 'cantidad', l: 'Cantidad', t: 'number', req: true, min: 0.0001, step: '0.0001' },
      { k: 'merma', l: 'Merma (%)', t: 'number', pct: true, min: 0, maxN: 50, step: '0.1' },
      { k: 'moneda', l: 'Moneda', t: 'select', opts: ['USD', 'ARS'] },
      { k: 'costo', l: 'Precio unitario (vacío = pendiente)', t: 'number', min: 0, step: '0.0001' },
      { k: 'motivo', l: 'Motivo del agregado', req: true, max: 300, ancho: true },
      ...(cat ? [{ k: 'proveedor', l: 'Proveedor', t: 'select', opts: [['', '— Ninguno —'], ...S.datos.proveedores.map(p => [p.id, p.nombre])] },
        { k: 'reutilizar', l: 'Si ya existe', t: 'checkbox', texto: 'Reutilizar el material existente' }] : [])
    ], { categoria: 'Otros', unidad: 'un', moneda: 'USD', merma: 0 }, async v => {
      const r = await db.rpc.presAgregar({ ...v, codigo: v.codigo ? v.codigo.toUpperCase() : null, presupuesto: d.id, modo: d.m, idem: db.nuevaClave() });
      toast(r.creado_en_catalogo ? 'Agregado al proyecto y guardado en el catálogo' : r.reutilizado ? 'Agregado al proyecto con el material existente' : 'Agregado solo a este proyecto');
      await bus.refrescar();
    }, 'Agregar');
  },
  'pres-item-editar': d => {
    const it = S.datos.presupuesto_items.find(x => x.id === d.id); if (!it) return;
    formulario(`Editar partida · ${it.descripcion}`, [
      { k: 'cantidad', l: 'Cantidad', t: 'number', req: true, min: 0.0001, step: '0.0001' },
      { k: 'merma', l: 'Merma (%)', t: 'number', pct: true, req: true, min: 0, maxN: 50, step: '0.1' },
      { k: 'moneda', l: 'Moneda', t: 'select', opts: ['USD', 'ARS'] },
      { k: 'costo_original', l: 'Precio unitario (vacío = pendiente)', t: 'number', min: 0, step: '0.0001' },
      { k: 'motivo', l: 'Motivo', max: 300, ancho: true, req: it.origen !== 'BOM' }
    ], { ...it, merma: num(it.merma) * 100 }, guardar('Partida actualizada', v => db.actualizar('presupuesto_items', 'id', it.id, v)));
  },
  'pres-item-quitar': conError(async d => { await db.borrar('presupuesto_items', 'id', d.id); toast('Partida quitada'); await bus.refrescar(); }),
  'pres-precios': conError(async d => { const n = await db.rpc.presPrecios(d.id); toast(n ? `${n} precio(s) actualizado(s)` : 'Ya tenía los precios del catálogo'); await bus.refrescar(); }),
  'pres-tc': d => formulario('Cambiar tipo de cambio del proyecto', [{ k: 'tc', l: 'Tipo de cambio', t: 'select', req: true, opts: tcOpts().slice(1), ancho: true }],
    { tc: tcVigente()?.id }, guardar('Tipo de cambio actualizado: se recalcularon las partidas en pesos', v => db.rpc.presTc(d.id, v.tc))),
  'pres-descuento': d => {
    const p = S.datos.presupuestos.find(x => x.id === d.id); if (!p) return;
    formulario('Descuento autorizado', [
      { k: 'descuento', l: 'Descuento (USD)', t: 'number', req: true, min: 0, step: '0.01', ayuda: 'Se informa aparte: el PVP sigue saliendo de Costo Directo ÷ % de costo; el descuento reduce el margen realizado.' },
      { k: 'descuento_motivo', l: 'Motivo', max: 300, ancho: true }
    ], p, guardar('Descuento registrado', v => db.actualizar('presupuestos', 'id', p.id, { descuento: v.descuento, descuento_motivo: v.descuento_motivo })));
  },
  'pres-emitir': d => {
    const p = S.datos.presupuestos.find(x => x.id === d.id), pr = p && prod(p.producto_id); if (!pr) return;
    formulario('Emitir cotización desde el presupuesto', [
      { k: 'vigencia', l: 'Vigencia (días)', t: 'number', req: true, min: 1, maxN: 180, step: '1' }
    ], { vigencia: 15 }, async v => {
      await db.rpc.crearCotizacionV2({ cliente: p.cliente, producto: pr.codigo, lead: p.lead_id, presupuesto: p.id, vigencia: v.vigencia, idem: db.nuevaClave() });
      toast(pr.gama === 'Signature' ? 'Cotización emitida: queda pendiente de validación Signature' : 'Cotización emitida'); await bus.refrescar(); bus.ir('cotizaciones');
    }, 'Emitir');
  },
  'pres-revision': conError(async d => { S.ing.presupuesto = await db.rpc.presRevision(d.id); toast('Revisión nueva en borrador'); await bus.refrescar(); }),
  'pres-anular': d => confirmar('El presupuesto queda anulado. Las cotizaciones ya emitidas no cambian.', async () => {
    await db.rpc.presAnular(d.id); toast('Presupuesto anulado'); await bus.refrescar();
  }, 'Anular'),
  'pres-borrar': d => confirmar('Se borra el presupuesto en borrador y sus partidas.', async () => {
    await db.borrar('presupuestos', 'id', d.id); S.ing.presupuesto = ''; toast('Presupuesto borrado'); await bus.refrescar();
  }, 'Borrar'),

  // sustituciones
  'sust-nueva': d => {
    const D = S.datos;
    const pares = d.id ? [[`${d.id}|${d.c}`, `${prod(bomDe(d.id)?.producto_id)?.codigo} v${bomDe(d.id)?.version} · ${d.c}`]]
      : D.bom_items.filter(x => bomDe(x.bom_id)?.estado !== 'Obsoleto').map(x => {
        const b = bomDe(x.bom_id); return [`${x.bom_id}|${x.insumo_codigo}`, `${prod(b?.producto_id)?.codigo} v${b?.version} · ${x.insumo_codigo} ${insumo(x.insumo_codigo)?.descripcion || ''}`];
      });
    if (!pares.length) { toast('Primero cargá un BOM con materiales', 'warn'); return; }
    formulario('Proponer sustitución de material', [
      { k: 'par', l: 'Modelo · BOM · material original', t: 'select', req: true, opts: pares, ancho: true },
      { k: 'insumo_alternativa', l: 'Alternativa (del catálogo)', t: 'select', req: true, ancho: true,
        opts: D.insumos.filter(i => i.activo !== false).map(i => [i.codigo, `${i.codigo} · ${i.descripcion} (${i.unidad})${E.sinPrecio(i.costo) ? ' · sin precio' : ''}`]) },
      { k: 'factor_cantidad', l: 'Factor de cantidad', t: 'number', req: true, min: 0.0001, maxN: 100, step: '0.0001', ayuda: 'Cantidad de alternativa por cada unidad del original (1 si es equivalente).' },
      { k: 'motivo', l: 'Motivo', req: true, max: 500, ancho: true, ph: 'Ej.: alternativa económica para Wood M Básico' },
      { k: 'nota_tecnica', l: 'Nota técnica', t: 'textarea', max: 500, ancho: true, ayuda: 'La sustitución requiere validación técnica: no puede reducir requisitos estructurales, eléctricos, sanitarios, térmicos ni de seguridad.' }
    ], { factor_cantidad: 1 }, guardar('Sustitución propuesta', v => {
      const [bom_id, insumo_original] = String(v.par).split('|');
      return db.insertar('sustituciones', { bom_id, insumo_original, insumo_alternativa: v.insumo_alternativa, factor_cantidad: v.factor_cantidad, motivo: v.motivo, nota_tecnica: v.nota_tecnica });
    }), 'Proponer');
  },
  'sust-decidir': d => formulario(d.a === '1' ? 'Aprobar sustitución (validación técnica)' : 'Rechazar sustitución', [
    { k: 'nota', l: 'Nota técnica', t: 'textarea', max: 500, ancho: true, req: true }
  ], {}, guardar(d.a === '1' ? 'Sustitución aprobada (no se aplicó a ningún BOM)' : 'Sustitución rechazada', v => db.rpc.sustDecidir(d.id, d.a === '1', v.nota)), d.a === '1' ? 'Aprobar' : 'Rechazar'),
  'sust-aplicar': d => {
    const D = S.datos, s = D.sustituciones.find(x => x.id === d.id); if (!s) return;
    const destinos = D.boms.filter(b => b.estado === 'Borrador' && D.bom_items.some(x => x.bom_id === b.id && x.insumo_codigo === s.insumo_original));
    if (!destinos.length) { toast('No hay ningún BOM en borrador con ese material: duplicá el BOM y volvé a intentar', 'warn'); return; }
    formulario('Aplicar sustitución a un BOM en borrador', [
      { k: 'bom', l: 'BOM destino', t: 'select', req: true, ancho: true, opts: destinos.map(b => [b.id, `${prod(b.producto_id)?.codigo} v${b.version}`]) }
    ], {}, guardar('Sustitución aplicada al borrador', v => db.rpc.sustAplicar(s.id, v.bom)), 'Aplicar');
  },
  'sust-borrar': conError(async d => { await db.borrar('sustituciones', 'id', d.id); toast('Sustitución borrada'); await bus.refrescar(); })
};

export const cambios = {
  'ing-buscar': el => { S.ing.buscar = el.value.slice(0, 60); bus.render(); },
  'ing-categoria': el => { S.ing.categoria = el.value; bus.render(); },
  'ing-producto': el => { S.ing.producto = el.value; S.ing.bom = ''; S.ing.comparar = ''; bus.render(); },
  'ing-tec': el => { S.ing.tec = el.value; S.ing.bom = ''; bus.render(); },
  'ing-tam': el => { S.ing.tam = el.value; S.ing.bom = ''; bus.render(); },
  'ing-gama': el => { S.ing.gama = el.value; S.ing.bom = ''; bus.render(); },
  'ing-comparar': el => { S.ing.comparar = el.value; bus.render(); },
  'pres-addon': async el => {
    const p = S.datos.presupuestos.find(x => x.id === el.dataset.id); if (!p) return;
    const a = el.dataset.a, addons = el.checked ? [...new Set([...(p.addons || []), a])] : (p.addons || []).filter(x => x !== a);
    try { await db.actualizar('presupuestos', 'id', p.id, { addons }); await bus.refrescar(); }
    catch (e) { toast(db.mensajeError(e), 'bad'); el.checked = !el.checked; }
  }
};
