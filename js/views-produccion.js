// =====================================================================
//  Producción: Cómputo métrico (MRP) · Gamas · Stock y compras (SCM)
//              Fabricación y operarios (taller / RR.HH.)
// =====================================================================
import { html, usd, usd2, n2, pct, fecha, fechaHora, hoyISO } from './html.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, nombreUsuario } from './estado.js';
import { formulario, confirmar, toast } from './ui.js';

const UNIDADES = ['m', 'm²', 'm³', 'kg', 'un', 'lt', 'gl', 'jornal', 'hora', 'global'];
const OFICIOS = ['Herrero', 'Armador', 'Oficial', 'Ayudante', 'Aplicador'];
const PLAZO_MAX = 60;
const sano = v => v >= E.RANGO_COSTO_M2[0] && v <= E.RANGO_COSTO_M2[1];
const provNombre = id => S.datos.proveedores.find(p => p.id === id)?.nombre || '—';

// ---------------------------------------------------------------------
//  CÓMPUTO MÉTRICO (BOM)
// ---------------------------------------------------------------------
const camposInsumo = nuevo => [
  { k: 'codigo', l: 'Código', req: true, max: 20, pattern: '[A-Z0-9\\-]{2,20}', errorPatron: 'Código: mayúsculas, números y guiones (2 a 20).', ph: 'HIE-005', ...(nuevo ? {} : { ayuda: 'Si cambiás el código se actualiza en las órdenes de compra.' }) },
  { k: 'categoria', l: 'Categoría', t: 'select', opts: E.CATEGORIAS },
  { k: 'descripcion', l: 'Descripción', req: true, max: 120, ancho: true },
  { k: 'unidad', l: 'Unidad', t: 'select', opts: UNIDADES },
  { k: 'costo', l: 'Costo unitario (USD)', t: 'number', req: true, min: 0, maxN: 1000000, step: '0.01' },
  { k: 'merma', l: 'Merma (%)', t: 'number', pct: true, min: 0, maxN: 50, step: '0.1' },
  { k: 'proveedor_id', l: 'Proveedor habitual', t: 'select', opts: [['', '— Ninguno —'], ...S.datos.proveedores.map(p => [p.id, p.nombre])] },
  { k: 'cant_s', l: 'Cantidad chasis S (18 m²)', t: 'number', min: 0, step: '0.01' },
  { k: 'cant_m', l: 'Cantidad chasis M (36 m²)', t: 'number', min: 0, step: '0.01' }
];

export function vComputo() {
  const D = S.datos;
  const cS = E.costoBase(D.insumos, 'S'), cM = E.costoBase(D.insumos, 'M');
  const catS = E.costoPorCategoria(D.insumos, 'S'), catM = E.costoPorCategoria(D.insumos, 'M');
  const ref = D.refs[0], v = E.variacionBom(D.insumos, ref);
  return html`
    ${head('Cómputo métrico', 'Cada insumo con su costo, su merma y la cantidad que lleva cada chasis. La mano de obra directa también es parte del costo.',
      html`<button class="btn" data-action="bom-referencia">Registrar como referencia</button>
           <button class="btn primary" data-action="insumo-nuevo">Agregar insumo</button>`)}
    <div class="kpis">
      ${kpi('Costo directo · Chasis S', usd(cS), `${usd(cS / 18)} por m²${sano(cS / 18) ? '' : ' · fuera de 250–550'}`, sano(cS / 18) ? 'good' : 'warn')}
      ${kpi('Costo directo · Chasis M', usd(cM), `${usd(cM / 36)} por m²${sano(cM / 36) ? '' : ' · fuera de 250–550'}`, sano(cM / 36) ? 'good' : 'warn')}
      ${kpi('Variación vs. referencia', v ? `S ${pct(v.vs)} · M ${pct(v.vm)}` : 'Sin referencia',
        ref ? `Referencia del ${fechaHora(ref.fecha)} por ${nombreUsuario(ref.created_by)}` : 'Registrá una para activar la alerta del 10 %',
        v ? (v.supera ? 'bad' : 'good') : 'warn')}
    </div>
    ${v?.supera ? html`<div class="warnbox"><b>El costo directo varió más de 10 %.</b> El Pacto de Socios (cl. 3.2) obliga a notificar al Socio de Negocios para recalibrar las listas de precios. Cuando lo hayan revisado, registrá el cómputo actual como nueva referencia.</div>` : ''}
    <div class="panel"><h3>Resumen por categoría</h3><div class="body tight"><table>
      <thead><tr><th>Categoría</th><th class="num">Chasis S</th><th class="num">% S</th><th class="num">Chasis M</th><th class="num">% M</th></tr></thead>
      <tbody>${catS.filter((c, i) => c.total || catM[i].total).map(c => {
        const m = catM.find(x => x.cat === c.cat).total;
        return html`<tr><td>${c.cat}</td><td class="num">${usd(c.total)}</td><td class="num">${cS ? pct(c.total / cS) : '—'}</td>
          <td class="num">${usd(m)}</td><td class="num">${cM ? pct(m / cM) : '—'}</td></tr>`;
      })}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${usd(cS)}</td><td class="num">100,0 %</td><td class="num">${usd(cM)}</td><td class="num">100,0 %</td></tr></tfoot>
    </table></div></div>
    <div class="panel"><h3>Insumos <span class="tag">el costo de línea incluye la merma</span></h3><div class="body tight">
      ${D.insumos.length ? html`<div class="scroll"><table>
        <thead><tr><th>Código</th><th>Categoría</th><th>Descripción</th><th>Unidad</th><th class="num">Costo unit.</th><th class="num">Merma</th>
          <th class="num">Cant. S</th><th class="num">Cant. M</th><th class="num">Costo S</th><th class="num">Costo M</th><th></th></tr></thead>
        <tbody>${D.insumos.map(i => html`<tr>
          <td><code>${i.codigo}</code></td><td>${i.categoria}</td><td>${i.descripcion}</td><td>${i.unidad}</td>
          <td class="num">${usd2(i.costo)}</td><td class="num">${pct(i.merma)}</td><td class="num">${n2(i.cant_s)}</td><td class="num">${n2(i.cant_m)}</td>
          <td class="num">${usd(E.costoLinea(i, 'S'))}</td><td class="num">${usd(E.costoLinea(i, 'M'))}</td>
          <td class="num nowrap"><button class="btn sm" data-action="insumo-editar" data-id="${i.codigo}">Editar</button>
            <button class="btn sm ghost" data-action="insumo-borrar" data-id="${i.codigo}">Borrar</button></td></tr>`)}</tbody>
        <tfoot><tr><td colspan="8">Costo directo del chasis base</td><td class="num">${usd(cS)}</td><td class="num">${usd(cM)}</td><td></td></tr></tfoot>
      </table></div>` : vacio('Sin insumos', 'Sin cómputo no hay costo, y sin costo no hay precio.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  GAMAS Y ADICIONALES
// ---------------------------------------------------------------------
export function vGamas() {
  const D = S.datos, p = D.params;
  const cS = E.costoBase(D.insumos, 'S'), cM = E.costoBase(D.insumos, 'M');
  return html`
    ${head('Gamas y adicionales', 'El coeficiente multiplica el costo directo del chasis base. Calibralo contra el cómputo real del primer prototipo.',
      html`<button class="btn" data-action="gama-nueva">Agregar gama</button><button class="btn primary" data-action="addon-nuevo">Agregar adicional</button>`)}
    <div class="panel"><h3>Líneas comerciales</h3><div class="body tight"><table>
      <thead><tr><th>Gama</th><th class="num">Coeficiente</th><th class="num">Rango USD/m²</th><th class="num">PVP/m² · S</th><th class="num">PVP/m² · M</th><th></th></tr></thead>
      <tbody>${D.gamas.map(g => {
        const pS = cS * g.coef / p.p_costo / 18, pM = cM * g.coef / p.p_costo / 36;
        const ok = x => x >= g.usd_m2_min && x <= g.usd_m2_max;
        return html`<tr><td><b>${g.nombre}</b></td><td class="num">×${n2(g.coef)}</td><td class="num">${usd(g.usd_m2_min)} – ${usd(g.usd_m2_max)}</td>
          <td class="num">${pill(usd(pS), ok(pS) ? 'p-ok' : 'p-warn')}</td><td class="num">${pill(usd(pM), ok(pM) ? 'p-ok' : 'p-warn')}</td>
          <td class="num nowrap"><button class="btn sm" data-action="gama-editar" data-id="${g.nombre}">Editar</button></td></tr>`;
      })}</tbody></table></div></div>
    <div class="panel"><h3>Adicionales</h3><div class="body tight"><table>
      <thead><tr><th>Adicional</th><th class="num">Costo directo S</th><th class="num">Costo directo M</th><th class="num">Suma al PVP · S</th><th class="num">Suma al PVP · M</th><th></th></tr></thead>
      <tbody>${D.addons.map(a => html`<tr><td>${a.nombre}</td><td class="num">${usd(a.costo_s)}</td><td class="num">${usd(a.costo_m)}</td>
        <td class="num">${usd(a.costo_s / p.p_costo)}</td><td class="num">${usd(a.costo_m / p.p_costo)}</td>
        <td class="num nowrap"><button class="btn sm" data-action="addon-editar" data-id="${a.id}">Editar</button>
          <button class="btn sm ghost" data-action="addon-borrar" data-id="${a.id}">Borrar</button></td></tr>`)}</tbody>
    </table></div></div>`;
}

const camposGama = [
  { k: 'nombre', l: 'Nombre', req: true, max: 30 },
  { k: 'orden', l: 'Orden de aparición', t: 'number', min: 0, step: '1' },
  { k: 'coef', l: 'Coeficiente sobre el costo base', t: 'number', req: true, min: 0.01, maxN: 5, step: '0.01' },
  { k: 'usd_m2_min', l: 'USD/m² mínimo', t: 'number', req: true, min: 0 },
  { k: 'usd_m2_max', l: 'USD/m² máximo', t: 'number', req: true, min: 0 }
];
const camposAddon = [
  { k: 'nombre', l: 'Nombre', req: true, max: 60, ancho: true },
  { k: 'costo_s', l: 'Costo directo chasis S (USD)', t: 'number', req: true, min: 0, step: '0.01' },
  { k: 'costo_m', l: 'Costo directo chasis M (USD)', t: 'number', req: true, min: 0, step: '0.01' }
];

// ---------------------------------------------------------------------
//  STOCK
// ---------------------------------------------------------------------
export function vStock() {
  const D = S.datos;
  const mats = D.insumos.filter(i => i.categoria !== 'Mano de Obra');
  const bajos = mats.filter(E.stockBajo);
  const valor = mats.reduce((a, i) => a + Number(i.stock) * Number(i.costo), 0);
  return html`
    ${head('Stock de taller', 'El punto de reorden es lo necesario para fabricar un Chasis M completo, merma incluida.',
      bajos.length ? html`<button class="btn primary" data-action="oc-faltantes">Crear orden con faltantes</button>` : '')}
    <div class="kpis">
      ${kpi('Valor del stock', usd(valor), `${mats.length} insumos de material`)}
      ${kpi('Bajo punto de reorden', bajos.length, bajos.length ? 'no alcanza para un Chasis M' : 'alcanza para un Chasis M', bajos.length ? 'warn' : 'good')}
    </div>
    <div class="panel"><div class="body tight"><div class="scroll"><table>
      <thead><tr><th>Código</th><th>Descripción</th><th>Proveedor</th><th class="num">Stock</th><th class="num">Reorden (1 M)</th><th class="num">Faltante</th><th>Estado</th><th></th></tr></thead>
      <tbody>${mats.map(i => {
        const ro = E.puntoReorden(i), falta = Math.max(0, ro - Number(i.stock));
        return html`<tr><td><code>${i.codigo}</code></td><td>${i.descripcion}</td><td>${provNombre(i.proveedor_id)}</td>
          <td class="num">${n2(i.stock)} ${i.unidad}</td><td class="num">${n2(ro)}</td><td class="num">${falta ? n2(falta) : '—'}</td>
          <td>${E.stockBajo(i) ? pill('Reponer', 'p-warn') : ro ? pill('OK', 'p-ok') : pill('Sin uso en M')}</td>
          <td class="num"><button class="btn sm" data-action="stock-ajustar" data-id="${i.codigo}">Ajustar</button></td></tr>`;
      })}</tbody></table></div></div></div>`;
}

// ---------------------------------------------------------------------
//  ÓRDENES DE COMPRA
// ---------------------------------------------------------------------
const totalOC = id => S.datos.ocItems.filter(x => x.oc_id === id).reduce((a, x) => a + Number(x.cantidad) * Number(x.costo_unit), 0);
const clsOC = e => e === 'Recibida' ? 'p-ok' : e === 'Cancelada' ? 'p-neutral' : e === 'Enviada' ? 'p-info' : 'p-warn';

export function vCompras() {
  const D = S.datos;
  return html`
    ${head('Órdenes de compra', 'Al marcar una orden como recibida, el servidor suma las cantidades al stock. Es irreversible.',
      html`<button class="btn primary" data-action="oc-nueva">Nueva orden</button>`)}
    <div class="panel"><div class="body tight">
      ${D.ocs.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th class="num">Ítems</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${D.ocs.map(o => {
          const items = D.ocItems.filter(x => x.oc_id === o.id), abierta = S.ocAbierta === o.id, editable = ['Borrador', 'Enviada'].includes(o.estado);
          return html`<tr class="clic ${abierta ? 'open' : ''}" data-action="oc-toggle" data-id="${o.id}">
            <td>${o.numero}</td><td>${fecha(o.fecha)}</td><td>${provNombre(o.proveedor_id)}</td><td class="num">${items.length}</td>
            <td class="num">${usd(totalOC(o.id))}</td><td>${pill(o.estado, clsOC(o.estado))}</td>
            <td class="num nowrap">
              ${o.estado === 'Borrador' ? html`<button class="btn sm" data-action="oc-estado" data-id="${o.id}" data-e="Enviada">Marcar enviada</button>` : ''}
              ${editable ? html`<button class="btn sm primary" data-action="oc-recibir" data-id="${o.id}">Recibir</button>
                <button class="btn sm ghost" data-action="oc-estado" data-id="${o.id}" data-e="Cancelada">Cancelar</button>` : ''}</td></tr>
          ${abierta ? html`<tr class="detail-wrap"><td colspan="7"><div class="detail">
            ${items.length ? html`<table class="inner"><thead><tr><th>Insumo</th><th class="num">Cantidad</th><th class="num">Costo unit.</th><th class="num">Subtotal</th><th></th></tr></thead>
              <tbody>${items.map(it => {
                const ins = D.insumos.find(i => i.codigo === it.insumo_codigo);
                return html`<tr><td><code>${it.insumo_codigo}</code> ${ins?.descripcion || ''}</td><td class="num">${n2(it.cantidad)} ${ins?.unidad || ''}</td>
                  <td class="num">${usd2(it.costo_unit)}</td><td class="num">${usd(it.cantidad * it.costo_unit)}</td>
                  <td class="num">${editable ? html`<button class="btn sm ghost" data-action="oc-item-borrar" data-id="${it.id}">Quitar</button>` : ''}</td></tr>`;
              })}</tbody></table>` : html`<p class="mute small">La orden no tiene ítems todavía.</p>`}
            ${editable ? html`<button class="btn sm mt" data-action="oc-item-nuevo" data-id="${o.id}">Agregar ítem</button>` : ''}
            ${o.notas ? html`<p class="mute small mt">${o.notas}</p>` : ''}
          </div></td></tr>` : ''}`;
        })}</tbody></table></div>` : vacio('Sin órdenes de compra', D.proveedores.length ? 'Creá la primera o generala desde Stock.' : 'Primero cargá un proveedor.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  PROVEEDORES
// ---------------------------------------------------------------------
const camposProveedor = [
  { k: 'nombre', l: 'Razón social', req: true, max: 80, ancho: true },
  { k: 'rubro', l: 'Rubro', max: 60, ph: 'Hierros, aberturas…' },
  { k: 'contacto', l: 'Persona de contacto', max: 80 },
  { k: 'telefono', l: 'Teléfono', t: 'tel', max: 30, pattern: '[0-9 +()\\-]{0,30}', errorPatron: 'El teléfono solo admite números, espacios y + ( ) -.' },
  { k: 'email', l: 'Email', t: 'email', max: 120, pattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+', errorPatron: 'El email no es válido.' }
];
export function vProveedores() {
  const D = S.datos;
  return html`
    ${head('Proveedores', '', html`<button class="btn primary" data-action="prov-nuevo">Agregar proveedor</button>`)}
    <div class="panel"><div class="body tight">
      ${D.proveedores.length ? html`<table><thead><tr><th>Razón social</th><th>Rubro</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th class="num">Insumos</th><th></th></tr></thead>
        <tbody>${D.proveedores.map(p => html`<tr><td><b>${p.nombre}</b></td><td>${p.rubro || '—'}</td><td>${p.contacto || '—'}</td>
          <td>${p.telefono || '—'}</td><td>${p.email || '—'}</td><td class="num">${D.insumos.filter(i => i.proveedor_id === p.id).length}</td>
          <td class="num nowrap"><button class="btn sm" data-action="prov-editar" data-id="${p.id}">Editar</button>
            <button class="btn sm ghost" data-action="prov-borrar" data-id="${p.id}">Borrar</button></td></tr>`)}</tbody></table>`
      : vacio('Sin proveedores', 'Cargalos para poder armar órdenes de compra.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  FABRICACIÓN (taller)
// ---------------------------------------------------------------------
export function vFabricacion() {
  const D = S.datos, hoy = hoyISO();
  const opNombre = id => D.operarios.find(o => o.id === id)?.nombre || '—';
  return html`
    ${head('Fabricación', `Cada módulo en taller: días contra el plazo comprometido, materiales y horas reales de mano de obra.`,
      html`<button class="btn primary" data-action="fab-nueva">Nueva orden de fabricación</button>`)}
    <div class="panel"><div class="body tight">
      ${D.fabricacion.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Venta</th><th>Módulo</th><th>Estado</th><th class="num">Días en taller</th><th class="num">Horas</th>
          <th class="num">M. de obra real</th><th class="num">Presupuestada</th><th>Materiales</th><th></th></tr></thead>
        <tbody>${D.fabricacion.map(f => {
          const venta = D.ventas.find(v => v.id === f.venta_id);
          const dias = f.fecha_inicio ? E.diasDesde(f.fecha_inicio, f.fecha_fin || hoy) : null;
          const abierta = S.fabAbierta === f.id, horas = D.horas.filter(h => h.fabricacion_id === f.id);
          const desv = Number(f.mdo_real) - Number(f.mdo_presupuestada);
          return html`<tr class="clic ${abierta ? 'open' : ''}" data-action="fab-toggle" data-id="${f.id}">
            <td>${f.numero}</td><td>${venta ? venta.cliente : html`<span class="mute">Stock</span>`}</td><td>${f.chasis} · ${f.gama}</td>
            <td>${pill(f.estado, f.estado === 'Terminada' ? 'p-ok' : f.estado === 'En curso' ? 'p-info' : 'p-neutral')}</td>
            <td class="num">${dias === null ? '—' : dias > PLAZO_MAX ? pill(dias, 'p-bad') : dias}</td>
            <td class="num">${n2(f.horas_total)}</td><td class="num">${usd(f.mdo_real)}</td><td class="num">${usd(f.mdo_presupuestada)}</td>
            <td>${f.materiales_descontados ? pill('Descontados', 'p-ok') : pill('Pendientes', 'p-warn')}</td>
            <td class="num nowrap">
              ${f.estado === 'Planificada' ? html`<button class="btn sm" data-action="fab-iniciar" data-id="${f.id}">Iniciar</button>` : ''}
              ${f.estado === 'En curso' ? html`<button class="btn sm" data-action="fab-terminar" data-id="${f.id}">Terminar</button>` : ''}
              <button class="btn sm ghost" data-action="fab-borrar" data-id="${f.id}">Borrar</button></td></tr>
          ${abierta ? html`<tr class="detail-wrap"><td colspan="10"><div class="detail"><div class="detail-grid">
            <div><h4>Horas registradas</h4>
              ${horas.length ? html`<table class="inner"><thead><tr><th>Fecha</th><th>Operario</th><th class="num">Horas</th><th class="num">Costo</th><th></th></tr></thead>
                <tbody>${horas.map(h => html`<tr><td>${fecha(h.fecha)}</td><td>${opNombre(h.operario_id)}</td><td class="num">${n2(h.horas)}</td>
                  <td class="num">${usd(h.horas * h.costo_hora_aplicado)}</td>
                  <td class="num"><button class="btn sm ghost" data-action="horas-borrar" data-id="${h.id}">Quitar</button></td></tr>`)}</tbody></table>`
              : html`<p class="mute small">Sin horas cargadas.</p>`}
              <button class="btn sm mt" data-action="horas-nueva" data-id="${f.id}" ${D.operarios.some(o => o.activo) ? '' : html`disabled`}>Cargar horas</button>
              ${D.operarios.some(o => o.activo) ? '' : html`<p class="hint">Primero cargá operarios.</p>`}
            </div>
            <div>
              <table class="breakdown">
                <tr><td>Mano de obra presupuestada</td><td class="num">${usd(f.mdo_presupuestada)}</td></tr>
                <tr><td>Mano de obra real</td><td class="num">${usd(f.mdo_real)}</td></tr>
                <tr><td>Desvío</td><td class="num ${desv > 0 ? 'bad' : 'ok'}">${desv > 0 ? '+' : ''}${usd(desv)}</td></tr>
                ${venta ? html`<tr><td>Costo real sugerido para la venta</td><td class="num"><b>${usd(E.costoRealSugerido(venta.pvp, D.params, f.mdo_presupuestada, f.mdo_real))}</b></td></tr>` : ''}
              </table>
              ${venta ? html`<button class="btn sm full mt" data-action="fab-aplicar-costo" data-id="${f.id}">Aplicar costo real sugerido a la venta</button>
                <p class="hint">Reemplaza la mano de obra presupuestada por la real. Si hubo desvíos de materiales, cargá el costo real a mano en Ventas.</p>` : ''}
              ${!f.materiales_descontados ? html`<button class="btn sm full mt" data-action="fab-descontar" data-id="${f.id}">Descontar materiales del stock</button>` : ''}
              ${f.notas ? html`<p class="mute small mt">${f.notas}</p>` : ''}
            </div>
          </div></div></td></tr>` : ''}`;
        })}</tbody></table></div>` : vacio('Sin órdenes de fabricación', 'Creá una por cada módulo que entra al taller.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  OPERARIOS
// ---------------------------------------------------------------------
const camposOperario = [
  { k: 'nombre', l: 'Nombre', req: true, max: 80, ancho: true },
  { k: 'oficio', l: 'Oficio', t: 'select', opts: OFICIOS },
  { k: 'costo_hora', l: 'Costo por hora (USD)', t: 'number', req: true, min: 0.01, maxN: 1000, step: '0.01' },
  { k: 'activo', l: 'Estado', t: 'checkbox', texto: 'Activo' }
];
export function vOperarios() {
  const D = S.datos;
  const horasDe = id => D.horas.filter(h => h.operario_id === id).reduce((a, h) => a + Number(h.horas), 0);
  return html`
    ${head('Operarios', 'El costo por hora se congela en cada carga: cambiarlo no altera lo ya registrado.',
      html`<button class="btn primary" data-action="op-nuevo">Agregar operario</button>`)}
    <div class="panel"><div class="body tight">
      ${D.operarios.length ? html`<table><thead><tr><th>Nombre</th><th>Oficio</th><th class="num">Costo/hora</th><th class="num">Horas acumuladas</th><th>Estado</th><th></th></tr></thead>
        <tbody>${D.operarios.map(o => html`<tr><td><b>${o.nombre}</b></td><td>${o.oficio}</td><td class="num">${usd2(o.costo_hora)}</td>
          <td class="num">${n2(horasDe(o.id))}</td><td>${o.activo ? pill('Activo', 'p-ok') : pill('Inactivo')}</td>
          <td class="num nowrap"><button class="btn sm" data-action="op-editar" data-id="${o.id}">Editar</button>
            <button class="btn sm ghost" data-action="op-borrar" data-id="${o.id}">Borrar</button></td></tr>`)}</tbody></table>`
      : vacio('Sin operarios', 'Cargá herreros, armadores y oficiales para registrar horas.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  ACCIONES
// ---------------------------------------------------------------------
const ins = c => S.datos.insumos.find(i => i.codigo === c);
const limpiarInsumo = v => ({ ...v, merma: v.merma ?? 0, cant_s: v.cant_s ?? 0, cant_m: v.cant_m ?? 0, proveedor_id: v.proveedor_id || null });
const guardar = (msg, fn) => async v => { await fn(v); toast(msg); await bus.refrescar(); };
const borrarCon = (msg, t, k) => d => confirmar(msg, async () => { await db.borrar(t, k, d.id); toast('Registro eliminado'); await bus.refrescar(); }, 'Eliminar');
const conError = fn => async d => { try { await fn(d); } catch (e) { toast(db.mensajeError(e), 'bad'); } };

export const acciones = {
  // cómputo
  'insumo-nuevo': () => formulario('Agregar insumo', camposInsumo(true), { categoria: E.CATEGORIAS[0], unidad: 'm', merma: 0, cant_s: 0, cant_m: 0 },
    guardar('Insumo agregado', v => db.insertar('insumos', limpiarInsumo(v)))),
  'insumo-editar': d => {
    const i = ins(d.id); if (!i) return;
    formulario('Editar insumo', camposInsumo(false), { ...i, merma: Number(i.merma) * 100 },
      guardar('Insumo actualizado', v => db.actualizar('insumos', 'codigo', i.codigo, limpiarInsumo(v))));
  },
  'insumo-borrar': borrarCon('Se elimina el insumo y el costo directo se recalcula.', 'insumos', 'codigo'),
  'bom-referencia': () => formulario('Registrar cómputo como referencia',
    [{ k: 'nota', l: 'Motivo o comentario', max: 300, ancho: true, ph: 'Ej.: actualización de precios de hierro, revisado con el socio' }], {},
    guardar('Referencia registrada', v => db.rpc.registrarReferenciaBom(v.nota)), 'Registrar'),
  // gamas y adicionales
  'gama-nueva': () => formulario('Agregar gama', camposGama, { orden: S.datos.gamas.length + 1, coef: 1 },
    guardar('Gama agregada', v => db.insertar('gamas', v))),
  'gama-editar': d => {
    const g = S.datos.gamas.find(x => x.nombre === d.id); if (!g) return;
    formulario('Editar gama', camposGama, g, guardar('Gama actualizada', v => db.actualizar('gamas', 'nombre', g.nombre, v)));
  },
  'addon-nuevo': () => formulario('Agregar adicional', camposAddon, {}, guardar('Adicional agregado', v => db.insertar('addons', v))),
  'addon-editar': d => {
    const a = S.datos.addons.find(x => x.id === d.id); if (!a) return;
    formulario('Editar adicional', camposAddon, a, guardar('Adicional actualizado', v => db.actualizar('addons', 'id', a.id, v)));
  },
  'addon-borrar': borrarCon('Se elimina el adicional. Las cotizaciones ya guardadas conservan su precio.', 'addons', 'id'),
  // stock
  'stock-ajustar': d => {
    const i = ins(d.id); if (!i) return;
    formulario(`Ajustar stock · ${i.codigo}`, [{ k: 'stock', l: `Stock real contado (${i.unidad})`, t: 'number', req: true, min: 0, step: '0.01', ayuda: 'Usalo para inventario físico. El cambio queda en la auditoría.' }],
      { stock: i.stock }, guardar('Stock ajustado', v => db.actualizar('insumos', 'codigo', i.codigo, { stock: v.stock })));
  },
  'oc-faltantes': () => {
    const D = S.datos;
    if (!D.proveedores.length) { toast('Primero cargá un proveedor', 'warn'); return; }
    formulario('Orden de compra con faltantes', [
      { k: 'proveedor_id', l: 'Proveedor', t: 'select', req: true, opts: D.proveedores.map(p => [p.id, p.nombre]), ancho: true },
      { k: 'notas', l: 'Notas', t: 'textarea', max: 500, ancho: true }
    ], {}, guardar('Orden creada en borrador', async v => {
      const oc = await db.insertar('ordenes_compra', v);
      for (const i of D.insumos.filter(E.stockBajo)) {
        await db.insertar('oc_items', { oc_id: oc.id, insumo_codigo: i.codigo, cantidad: Math.ceil((E.puntoReorden(i) - Number(i.stock)) * 100) / 100, costo_unit: i.costo });
      }
      S.ocAbierta = oc.id; bus.ir('compras');
    }), 'Crear orden');
  },
  // compras
  'oc-toggle': d => { S.ocAbierta = S.ocAbierta === d.id ? null : d.id; bus.render(); },
  'oc-nueva': () => {
    const D = S.datos;
    if (!D.proveedores.length) { toast('Primero cargá un proveedor', 'warn'); bus.ir('proveedores'); return; }
    formulario('Nueva orden de compra', [
      { k: 'proveedor_id', l: 'Proveedor', t: 'select', req: true, opts: D.proveedores.map(p => [p.id, p.nombre]), ancho: true },
      { k: 'fecha', l: 'Fecha', t: 'date', req: true },
      { k: 'notas', l: 'Notas', t: 'textarea', max: 500, ancho: true }
    ], { fecha: hoyISO() }, guardar('Orden creada', async v => { const oc = await db.insertar('ordenes_compra', v); S.ocAbierta = oc.id; }));
  },
  'oc-item-nuevo': d => {
    const oc = S.datos.ocs.find(o => o.id === d.id); if (!oc) return;
    const mats = S.datos.insumos.filter(i => i.categoria !== 'Mano de Obra');
    formulario('Agregar ítem', [
      { k: 'insumo_codigo', l: 'Insumo', t: 'select', req: true, opts: mats.map(i => [i.codigo, `${i.codigo} · ${i.descripcion}`]), ancho: true },
      { k: 'cantidad', l: 'Cantidad', t: 'number', req: true, min: 0.01, step: '0.01' },
      { k: 'costo_unit', l: 'Costo unitario (USD)', t: 'number', req: true, min: 0, step: '0.01', ayuda: 'Si lo dejás en blanco no se guarda: completalo con el precio del proveedor.' }
    ], { costo_unit: mats[0]?.costo }, guardar('Ítem agregado', v => db.insertar('oc_items', { ...v, oc_id: oc.id })));
  },
  'oc-item-borrar': conError(async d => { await db.borrar('oc_items', 'id', d.id); await bus.refrescar(); }),
  'oc-estado': conError(async d => {
    if (!['Enviada', 'Cancelada'].includes(d.e)) return;
    await db.actualizar('ordenes_compra', 'id', d.id, { estado: d.e }); toast('Orden ' + d.e.toLowerCase()); await bus.refrescar();
  }),
  'oc-recibir': d => confirmar('Se suman al stock todas las cantidades de la orden. Esta acción no se puede deshacer.', async () => {
    await db.actualizar('ordenes_compra', 'id', d.id, { estado: 'Recibida' }); toast('Orden recibida: stock actualizado'); await bus.refrescar();
  }, 'Recibir'),
  // proveedores
  'prov-nuevo': () => formulario('Agregar proveedor', camposProveedor, {}, guardar('Proveedor agregado', v => db.insertar('proveedores', v))),
  'prov-editar': d => {
    const p = S.datos.proveedores.find(x => x.id === d.id); if (!p) return;
    formulario('Editar proveedor', camposProveedor, p, guardar('Proveedor actualizado', v => db.actualizar('proveedores', 'id', p.id, v)));
  },
  'prov-borrar': borrarCon('Se elimina el proveedor. No se puede si tiene órdenes de compra.', 'proveedores', 'id'),
  // fabricación
  'fab-toggle': d => { S.fabAbierta = S.fabAbierta === d.id ? null : d.id; bus.render(); },
  'fab-nueva': () => {
    const D = S.datos, conOF = new Set(D.fabricacion.map(f => f.venta_id).filter(Boolean));
    const libres = D.ventas.filter(v => !conOF.has(v.id));
    formulario('Nueva orden de fabricación', [
      { k: 'venta_id', l: 'Venta asociada', t: 'select', opts: [['', '— Para stock, sin venta —'], ...libres.map(v => [v.id, `${v.cliente} · ${v.chasis} ${v.gama}`])], ancho: true, ayuda: 'Si elegís una venta, el chasis y la gama se toman de ella.' },
      { k: 'chasis', l: 'Chasis', t: 'select', opts: ['S', 'M'] },
      { k: 'gama', l: 'Gama', t: 'select', opts: D.gamas.map(g => g.nombre) },
      { k: 'notas', l: 'Notas', t: 'textarea', max: 500, ancho: true }
    ], { chasis: 'S', gama: D.gamas[0]?.nombre }, guardar('Orden de fabricación creada', v => {
      const venta = D.ventas.find(x => x.id === v.venta_id);
      return db.insertar('fabricacion', { ...v, venta_id: v.venta_id || null, chasis: venta ? venta.chasis : v.chasis, gama: venta ? venta.gama : v.gama });
    }));
  },
  'fab-iniciar': conError(async d => { await db.actualizar('fabricacion', 'id', d.id, { estado: 'En curso', fecha_inicio: hoyISO() }); toast('Fabricación iniciada'); await bus.refrescar(); }),
  'fab-terminar': conError(async d => { await db.actualizar('fabricacion', 'id', d.id, { estado: 'Terminada', fecha_fin: hoyISO() }); toast('Fabricación terminada'); await bus.refrescar(); }),
  'fab-borrar': borrarCon('Se elimina la orden de fabricación y sus horas. El stock ya descontado no se repone.', 'fabricacion', 'id'),
  'fab-descontar': d => confirmar('Se descuentan del stock los materiales del chasis base, merma incluida. Si falta algún insumo, no se descuenta nada.', async () => {
    await db.rpc.descontarMateriales(d.id); toast('Materiales descontados'); await bus.refrescar();
  }, 'Descontar'),
  'fab-aplicar-costo': d => {
    const D = S.datos, f = D.fabricacion.find(x => x.id === d.id), venta = f && D.ventas.find(v => v.id === f.venta_id);
    if (!venta) return;
    const sug = Math.round(E.costoRealSugerido(venta.pvp, D.params, f.mdo_presupuestada, f.mdo_real) * 100) / 100;
    confirmar(`Se carga ${usd2(sug)} como costo directo real de la venta a ${venta.cliente}. La ganancia y los dividendos se recalculan.`, async () => {
      await db.actualizar('ventas', 'id', venta.id, { costo_real: sug }); toast('Costo real aplicado'); await bus.refrescar();
    }, 'Aplicar');
  },
  'horas-nueva': d => {
    const ops = S.datos.operarios.filter(o => o.activo);
    formulario('Cargar horas', [
      { k: 'operario_id', l: 'Operario', t: 'select', req: true, opts: ops.map(o => [o.id, `${o.nombre} · ${o.oficio}`]), ancho: true },
      { k: 'fecha', l: 'Fecha', t: 'date', req: true },
      { k: 'horas', l: 'Horas', t: 'number', req: true, min: 0.25, maxN: 16, step: '0.25' },
      { k: 'notas', l: 'Tarea', max: 300, ancho: true }
    ], { fecha: hoyISO() }, guardar('Horas registradas', v => db.insertar('horas', { ...v, fabricacion_id: d.id })));
  },
  'horas-borrar': conError(async d => { await db.borrar('horas', 'id', d.id); await bus.refrescar(); }),
  // operarios
  'op-nuevo': () => formulario('Agregar operario', camposOperario, { oficio: 'Herrero', activo: true }, guardar('Operario agregado', v => db.insertar('operarios', v))),
  'op-editar': d => {
    const o = S.datos.operarios.find(x => x.id === d.id); if (!o) return;
    formulario('Editar operario', camposOperario, o, guardar('Operario actualizado', v => db.actualizar('operarios', 'id', o.id, v)));
  },
  'op-borrar': borrarCon('Se elimina el operario. Si tiene horas cargadas, marcalo como inactivo en lugar de borrarlo.', 'operarios', 'id')
};
