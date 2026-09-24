// =====================================================================
//  Finanzas y gobernanza: Ventas y dividendos · Gastos extraordinarios
//  Reglas de precio · Auditoría · Exportación
// =====================================================================
import { html, usd, usd2, pct, fecha, fechaHora, hoyISO } from './html.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, nombreSocio, nombreUsuario } from './estado.js';
import { formulario, confirmar, toast } from './ui.js';

const ESTADOS_COBRO = ['Seña recibida', '50% avance', 'Cobrado', 'Vencido'];
const CAT_GASTO = ['Herramientas', 'Materiales', 'Pauta', 'Servicios', 'Otros'];
const conError = fn => async d => { try { await fn(d); } catch (e) { toast(db.mensajeError(e), 'bad'); } };

// ---------------------------------------------------------------------
//  VENTAS Y DIVIDENDOS  (valores calculados por el servidor: v_ventas)
// ---------------------------------------------------------------------
const camposVenta = () => [
  { k: 'cliente', l: 'Cliente', req: true, max: 80 },
  { k: 'fecha', l: 'Fecha', t: 'date', req: true },
  { k: 'chasis', l: 'Chasis', t: 'select', opts: ['S', 'M'] },
  { k: 'gama', l: 'Gama', t: 'select', opts: S.datos.gamas.map(g => g.nombre) },
  { k: 'pvp', l: 'PVP acordado (USD)', t: 'number', req: true, min: 1, maxN: 10000000, step: '0.01' },
  { k: 'costo_real', l: 'Costo directo real (USD, al cierre)', t: 'number', min: 0, step: '0.01', ayuda: 'Dejalo vacío mientras la obra esté en curso.' },
  { k: 'estado_cobro', l: 'Estado de cobro', t: 'select', opts: ESTADOS_COBRO },
  { k: 'fecha_cobro', l: 'Fecha de cobro total', t: 'date' }
];

export function vVentas() {
  const D = S.datos, vs = D.ventas;
  const t = k => vs.reduce((a, v) => a + (Number(v[k]) || 0), 0);
  const gan = t('ganancia'), control = Math.round((t('reserva') + t('div_a') + t('div_b') - gan) * 100) / 100;
  return html`
    ${head('Ventas y dividendos', 'Reparto calculado por el servidor. Usa el costo real cuando está cargado; mientras tanto, el presupuestado.',
      html`<button class="btn primary" data-action="venta-nueva">Registrar venta</button>`)}
    ${vs.length ? (control === 0
      ? html`<div class="okbox">Reparto consistente: fondo de reserva + dividendos = ganancia neta (diferencia ${usd2(0)}).</div>`
      : html`<div class="warnbox">El reparto no cierra por ${usd2(Math.abs(control))}.</div>`) : ''}
    <div class="panel"><div class="body tight">
      ${vs.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Módulo</th><th class="num">PVP</th><th class="num">Costo real</th><th class="num">Desvío</th>
          <th class="num">Ganancia</th><th class="num">Reserva</th><th class="num">${nombreSocio('A')}</th><th class="num">${nombreSocio('B')}</th><th>Cobro</th><th></th></tr></thead>
        <tbody>${vs.map(v => html`<tr>
          <td>${v.numero}</td><td>${fecha(v.fecha)}</td><td>${v.cliente}</td><td>${v.chasis} · ${v.gama}</td><td class="num">${usd(v.pvp)}</td>
          <td class="num">${v.costo_real === null ? html`<span class="mute">pendiente</span>` : usd(v.costo_real)}</td>
          <td class="num">${v.desvio === null ? '—' : pill((Number(v.desvio) > 0 ? '+' : '') + usd(v.desvio), Number(v.desvio) > 0 ? 'p-bad' : 'p-ok')}</td>
          <td class="num">${usd(v.ganancia)}</td><td class="num">${usd(v.reserva)}</td><td class="num">${usd(v.div_a)}</td><td class="num">${usd(v.div_b)}</td>
          <td>${pill(v.estado_cobro, v.estado_cobro === 'Cobrado' ? 'p-ok' : v.estado_cobro === 'Vencido' ? 'p-bad' : 'p-warn')}</td>
          <td class="num nowrap"><button class="btn sm" data-action="venta-editar" data-id="${v.id}">Editar</button>
            <button class="btn sm ghost" data-action="venta-borrar" data-id="${v.id}">Borrar</button></td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4">Totales · ${vs.length} venta${vs.length === 1 ? '' : 's'}</td><td class="num">${usd(t('pvp'))}</td><td></td><td></td>
          <td class="num">${usd(gan)}</td><td class="num">${usd(t('reserva'))}</td><td class="num">${usd(t('div_a'))}</td><td class="num">${usd(t('div_b'))}</td><td colspan="2"></td></tr></tfoot>
      </table></div>` : vacio('Sin ventas', 'Registrá la primera o convertí una cotización.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  GASTOS EXTRAORDINARIOS  (Pacto de Socios, cláusula 3.5)
// ---------------------------------------------------------------------
export function vGastos() {
  const D = S.datos, yo = S.perfil.rol, miCol = yo === 'A' ? 'aprob_a' : 'aprob_b';
  const deb = E.debitosPorRol(D.gastos);
  const pend = D.gastos.filter(g => g.estado === 'Pendiente');
  return html`
    ${head('Gastos extraordinarios', `Todo gasto mayor a USD ${E.UMBRAL_GASTO} necesita la firma de ambos socios. Si se ejecuta sin firmas ni urgencia justificada, se descuenta de los dividendos de quien lo hizo.`,
      html`<button class="btn primary" data-action="gasto-nuevo">Registrar gasto</button>`)}
    <div class="kpis">
      ${kpi('Pendientes de aprobación', pend.length, pend.filter(g => !g[miCol]).length + ' esperan tu firma', pend.length ? 'warn' : 'good')}
      ${kpi('Débito · ' + nombreSocio('A'), usd(deb.A), 'por gastos no autorizados', deb.A ? 'bad' : 'good')}
      ${kpi('Débito · ' + nombreSocio('B'), usd(deb.B), 'por gastos no autorizados', deb.B ? 'bad' : 'good')}
    </div>
    <div class="panel"><div class="body tight">
      ${D.gastos.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th><th>Solicitó</th>
          <th>Firma A</th><th>Firma B</th><th>Estado</th><th></th></tr></thead>
        <tbody>${D.gastos.map(g => {
          const extra = Number(g.monto) > E.UMBRAL_GASTO;
          const firma = f => !extra ? html`<span class="mute">No requiere</span>` : f ? pill('Firmado', 'p-ok') : pill('Falta', 'p-warn');
          return html`<tr>
            <td>${g.numero}</td><td>${fecha(g.fecha)}</td>
            <td>${g.concepto}${g.urgencia ? html`<br><span class="small mute">Urgencia: ${g.justificacion_urgencia}</span>` : ''}</td>
            <td>${g.categoria}</td><td class="num">${usd(g.monto)}</td><td>${g.nombre_solicitante || '—'}</td>
            <td>${firma(g.aprob_a)}</td><td>${firma(g.aprob_b)}</td>
            <td>${pill(g.estado, g.estado === 'Aprobado' ? 'p-ok' : g.estado === 'Ejecutado' ? 'p-info' : g.estado === 'Rechazado' ? 'p-neutral' : 'p-warn')}
              ${g.imputado ? html` ${pill('Imputado a ' + nombreSocio(g.rol_solicitante), 'p-bad')}` : ''}</td>
            <td class="num nowrap">
              ${extra && g.estado === 'Pendiente' ? html`<button class="btn sm ${g[miCol] ? '' : 'primary'}" data-action="gasto-firma" data-id="${g.id}">${g[miCol] ? 'Retirar mi firma' : 'Firmar'}</button>` : ''}
              ${['Pendiente', 'Aprobado'].includes(g.estado) ? html`<button class="btn sm" data-action="gasto-ejecutar" data-id="${g.id}">Ejecutado</button>` : ''}
              ${g.estado === 'Pendiente' ? html`<button class="btn sm ghost" data-action="gasto-rechazar" data-id="${g.id}">Rechazar</button>` : ''}
            </td></tr>`;
        })}</tbody></table></div>` : vacio('Sin gastos registrados', 'Registrá cada desembolso fuera de presupuesto.')}
    </div></div>`;
}

// ---------------------------------------------------------------------
//  REGLAS DE PRECIO
// ---------------------------------------------------------------------
export function vReglas() {
  const p = S.datos.params, suma = E.sumaParams(p);
  const fila = (k, lbl) => {
    const [a, b] = E.RANGOS_PACTO[k], v = Number(p[k]), dentro = v >= a && v <= b;
    return html`<tr><td>${lbl}</td><td class="num"><b>${pct(v)}</b></td><td class="num mute">pactado ${pct(a)} – ${pct(b)}</td>
      <td>${dentro ? pill('En rango', 'p-ok') : pill('Fuera del rango pactado', 'p-warn')}</td></tr>`;
  };
  return html`
    ${head('Reglas de precio', 'Los cuatro componentes se aplican sobre el PVP y deben sumar 100 %: la base rechaza cualquier combinación que no cierre.',
      html`<button class="btn primary" data-action="reglas-editar">Modificar reglas</button>`)}
    ${E.paramsCierran(p) ? html`<div class="okbox">Los componentes suman ${pct(suma)}. El PVP cierra contra la suma de sus partes.</div>` : ''}
    <div class="panel"><h3>Composición del precio de venta</h3><div class="body tight"><table><tbody>
      ${fila('p_costo', 'Costo directo')}${fila('p_hon', 'Honorarios de arquitectura')}${fila('p_mkt', 'Presupuesto digital y comercial')}${fila('p_margen', 'Ganancia neta de la sociedad')}
    </tbody><tfoot><tr><td>Suma</td><td class="num">${pct(suma)}</td><td colspan="2"></td></tr></tfoot></table></div></div>
    <div class="panel"><h3>Reparto de la ganancia neta</h3><div class="body tight"><table><tbody>
      <tr><td>Fondo de reserva operativo (no distribuible)</td><td class="num"><b>${pct(p.p_reserva)}</b></td></tr>
      <tr><td>Masa de dividendos</td><td class="num">${pct(1 - p.p_reserva)}</td></tr>
      <tr class="sub"><td>${nombreSocio('A')}</td><td class="num">${pct(p.p_div_socio)} de la masa</td></tr>
      <tr class="sub"><td>${nombreSocio('B')}</td><td class="num">${pct(1 - p.p_div_socio)} de la masa</td></tr>
    </tbody></table></div></div>
    <div class="panel"><div class="body"><p class="hint nomargin">El PVP se obtiene dividiendo el costo directo por su porcentaje. Con un costo de USD 15.000 y un 52 %, el precio es USD 28.846; sumarle un 52 % al costo daría USD 22.800 y se perderían más de USD 6.000 de margen por módulo. Última modificación: ${fechaHora(p.updated_at)}.</p></div></div>`;
}

// ---------------------------------------------------------------------
//  AUDITORÍA
// ---------------------------------------------------------------------
const TABLAS_ES = { params: 'Reglas de precio', gamas: 'Gamas', addons: 'Adicionales', insumos: 'Insumos', ventas: 'Ventas', cotizaciones: 'Cotizaciones',
  gastos: 'Gastos', ordenes_compra: 'Órdenes de compra', fabricacion: 'Fabricación', proveedores: 'Proveedores', operarios: 'Operarios' };
const ACC_ES = { INSERT: 'Alta', UPDATE: 'Modificación', DELETE: 'Baja' };

export function vAuditoria() {
  const a = S.auditoria;
  return html`
    ${head('Auditoría', 'Registro inalterable de cambios en precios, costos, ventas y gastos. Lo escribe el servidor; nadie puede editarlo ni borrarlo desde la web.',
      html`<button class="btn" data-action="auditoria-cargar">Actualizar</button>`)}
    <div class="panel"><div class="body tight">
      ${a === null ? html`<div class="empty">Cargando…</div>` : a.length ? html`<div class="scroll"><table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th></tr></thead>
        <tbody>${a.map(r => html`<tr><td class="nowrap">${fechaHora(r.fecha)}</td><td>${r.usuario ? nombreUsuario(r.usuario) : html`<span class="mute">Sistema</span>`}</td>
          <td>${TABLAS_ES[r.tabla] || r.tabla}</td><td>${pill(ACC_ES[r.accion] || r.accion, r.accion === 'DELETE' ? 'p-bad' : r.accion === 'INSERT' ? 'p-ok' : 'p-info')}</td>
          <td class="small mute">${resumen(r)}</td></tr>`)}</tbody></table></div>` : vacio('Sin registros', 'Los cambios aparecerán acá.')}
    </div></div>`;
}
function resumen(r) {
  const d = r.datos || {};
  return String(d.cliente || d.concepto || d.descripcion || d.nombre || d.codigo || r.registro || '').slice(0, 80);
}

// ---------------------------------------------------------------------
//  EXPORTAR
// ---------------------------------------------------------------------
export function vExportar() {
  return html`
    ${head('Exportar datos', 'Copias para Excel o para archivo. Supabase además guarda respaldos automáticos de la base.')}
    <div class="panel"><h3>Planillas (CSV para Excel)</h3><div class="body"><div class="actions">
      <button class="btn" data-action="csv" data-t="leads">Leads</button>
      <button class="btn" data-action="csv" data-t="ventas">Ventas y dividendos</button>
      <button class="btn" data-action="csv" data-t="insumos">Cómputo y stock</button>
      <button class="btn" data-action="csv" data-t="gastos">Gastos</button>
      <button class="btn" data-action="csv" data-t="horas">Horas de taller</button>
    </div></div></div>
    <div class="panel"><h3>Copia completa</h3><div class="body">
      <p class="nomargin">Un archivo JSON con todos los datos visibles del sistema, para archivo.</p>
      <div class="actions mt"><button class="btn primary" data-action="json">Descargar copia</button></div>
    </div></div>`;
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Evita "inyección de fórmulas": Excel ejecuta celdas que empiezan con = + - @
const celda = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
function csv(nombre, cab, filas) {
  descargar(nombre, '\uFEFF' + [cab, ...filas].map(f => f.map(celda).join(';')).join('\r\n'), 'text/csv');
  toast('Archivo descargado');
}

const EXPORTES = {
  leads: () => csv(`leads_${hoyISO()}.csv`, ['Fecha', 'Nombre', 'Teléfono', 'Email', 'Terreno', 'Ubicación', 'Gama', 'Origen', 'Estado', 'Último contacto', 'Próximo seguimiento', 'Score', 'Notas'],
    S.datos.leads.map(l => [l.fecha, l.nombre, l.telefono, l.email, l.terreno ? 'Sí' : 'No', l.ubicacion, l.gama, l.origen, l.estado, l.ult_contacto, l.proximo_contacto, E.scoreLead(l), l.notas])),
  ventas: () => csv(`ventas_${hoyISO()}.csv`, ['N.º', 'Fecha', 'Cliente', 'Chasis', 'Gama', 'PVP', 'Costo presupuestado', 'Costo real', 'Desvío', 'Honorarios', 'Marketing', 'Ganancia', 'Reserva', 'Div. ' + nombreSocio('A'), 'Div. ' + nombreSocio('B'), 'Cobro'],
    S.datos.ventas.map(v => [v.numero, v.fecha, v.cliente, v.chasis, v.gama, v.pvp, v.cd_pres, v.costo_real, v.desvio, v.hon, v.mkt, v.ganancia, v.reserva, v.div_a, v.div_b, v.estado_cobro])),
  insumos: () => csv(`computo_${hoyISO()}.csv`, ['Código', 'Categoría', 'Descripción', 'Unidad', 'Costo', 'Merma', 'Cant. S', 'Cant. M', 'Costo S', 'Costo M', 'Stock', 'Reorden'],
    S.datos.insumos.map(i => [i.codigo, i.categoria, i.descripcion, i.unidad, i.costo, i.merma, i.cant_s, i.cant_m, E.costoLinea(i, 'S').toFixed(2), E.costoLinea(i, 'M').toFixed(2), i.stock, E.puntoReorden(i).toFixed(2)])),
  gastos: () => csv(`gastos_${hoyISO()}.csv`, ['N.º', 'Fecha', 'Concepto', 'Categoría', 'Monto', 'Solicitó', 'Firma A', 'Firma B', 'Urgencia', 'Estado', 'Imputado'],
    S.datos.gastos.map(g => [g.numero, g.fecha, g.concepto, g.categoria, g.monto, g.nombre_solicitante, g.aprob_a ? 'Sí' : 'No', g.aprob_b ? 'Sí' : 'No', g.urgencia ? 'Sí' : 'No', g.estado, g.imputado ? 'Sí' : 'No'])),
  horas: () => csv(`horas_${hoyISO()}.csv`, ['Fecha', 'Operario', 'Orden', 'Horas', 'Costo/hora', 'Costo'],
    S.datos.horas.map(h => {
      const o = S.datos.operarios.find(x => x.id === h.operario_id), f = S.datos.fabricacion.find(x => x.id === h.fabricacion_id);
      return [h.fecha, o?.nombre, f?.numero, h.horas, h.costo_hora_aplicado, (h.horas * h.costo_hora_aplicado).toFixed(2)];
    }))
};

// ---------------------------------------------------------------------
//  ACCIONES
// ---------------------------------------------------------------------
const guardar = (msg, fn) => async v => { await fn(v); toast(msg); await bus.refrescar(); };
const soloVenta = v => ({ cliente: v.cliente, fecha: v.fecha, chasis: v.chasis, gama: v.gama, pvp: v.pvp,
  costo_real: v.costo_real, estado_cobro: v.estado_cobro, fecha_cobro: v.fecha_cobro || null });

export const acciones = {
  'venta-nueva': () => formulario('Registrar venta', camposVenta(), { fecha: hoyISO(), chasis: 'S', gama: S.datos.gamas[0]?.nombre, estado_cobro: 'Seña recibida' },
    guardar('Venta registrada', v => db.insertar('ventas', soloVenta(v)))),
  'venta-editar': d => {
    const v = S.datos.ventas.find(x => x.id === d.id); if (!v) return;
    formulario(`Editar venta N.º ${v.numero}`, camposVenta(), v, guardar('Venta actualizada', x => db.actualizar('ventas', 'id', v.id, soloVenta(x))));
  },
  'venta-borrar': d => confirmar('Se elimina la venta. Queda registrada en la auditoría.', async () => {
    await db.borrar('ventas', 'id', d.id); toast('Venta eliminada'); await bus.refrescar();
  }, 'Eliminar'),

  'gasto-nuevo': () => formulario('Registrar gasto', [
    { k: 'concepto', l: 'Concepto', req: true, max: 200, ancho: true },
    { k: 'categoria', l: 'Categoría', t: 'select', opts: CAT_GASTO },
    { k: 'monto', l: 'Monto (USD)', t: 'number', req: true, min: 0.01, maxN: 1000000, step: '0.01', ayuda: `Más de USD ${E.UMBRAL_GASTO} requiere la firma de ambos.` },
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'urgencia', l: 'Urgencia operativa', t: 'checkbox', texto: 'Es una urgencia que no puede esperar la firma' },
    { k: 'justificacion_urgencia', l: 'Justificación de la urgencia', t: 'textarea', max: 500, ancho: true, ayuda: 'Obligatoria si es urgencia (mínimo 10 caracteres). El Pacto exige avisar al otro socio dentro de las 48 h.' }
  ], { fecha: hoyISO(), categoria: 'Herramientas' }, guardar('Gasto registrado', v => db.insertar('gastos', v))),
  'gasto-firma': conError(async d => {
    const g = S.datos.gastos.find(x => x.id === d.id); if (!g) return;
    const col = S.perfil.rol === 'A' ? 'aprob_a' : 'aprob_b';
    await db.actualizar('gastos', 'id', g.id, { [col]: !g[col] });
    toast(g[col] ? 'Firma retirada' : 'Gasto firmado'); await bus.refrescar();
  }),
  'gasto-ejecutar': d => {
    const g = S.datos.gastos.find(x => x.id === d.id); if (!g) return;
    const sinFirmas = Number(g.monto) > E.UMBRAL_GASTO && !(g.aprob_a && g.aprob_b) && !g.urgencia;
    confirmar(sinFirmas
      ? `Este gasto supera USD ${E.UMBRAL_GASTO} y no tiene la firma de ambos socios. Si lo marcás como ejecutado, ${usd(g.monto)} se descuentan de los dividendos de ${g.nombre_solicitante}.`
      : 'Se marca el gasto como ejecutado.', async () => {
      await db.actualizar('gastos', 'id', g.id, { estado: 'Ejecutado' }); toast('Gasto ejecutado'); await bus.refrescar();
    }, sinFirmas ? 'Ejecutar igual' : 'Confirmar');
  },
  'gasto-rechazar': conError(async d => { await db.actualizar('gastos', 'id', d.id, { estado: 'Rechazado' }); toast('Gasto rechazado'); await bus.refrescar(); }),

  'reglas-editar': () => {
    const p = S.datos.params, x100 = v => Math.round(Number(v) * 10000) / 100;
    formulario('Modificar reglas de precio', [
      { k: 'p_costo', l: 'Costo directo (%)', t: 'number', pct: true, req: true, min: 30, maxN: 80, step: '0.1' },
      { k: 'p_hon', l: 'Honorarios de arquitectura (%)', t: 'number', pct: true, req: true, min: 0, maxN: 25, step: '0.1' },
      { k: 'p_mkt', l: 'Presupuesto digital y comercial (%)', t: 'number', pct: true, req: true, min: 0, maxN: 25, step: '0.1' },
      { k: 'p_margen', l: 'Ganancia neta de la sociedad (%)', t: 'number', pct: true, req: true, min: 0, maxN: 50, step: '0.1', ayuda: 'Los cuatro deben sumar exactamente 100 %.' },
      { k: 'p_reserva', l: 'Fondo de reserva (% de la ganancia)', t: 'number', pct: true, req: true, min: 0, maxN: 100, step: '0.1' },
      { k: 'p_div_socio', l: `Dividendo para ${nombreSocio('A')} (% de la masa)`, t: 'number', pct: true, req: true, min: 0, maxN: 100, step: '0.1' },
      { k: 'nombre_empresa', l: 'Nombre de la empresa', req: true, max: 60, ancho: true }
    ], { p_costo: x100(p.p_costo), p_hon: x100(p.p_hon), p_mkt: x100(p.p_mkt), p_margen: x100(p.p_margen),
         p_reserva: x100(p.p_reserva), p_div_socio: x100(p.p_div_socio), nombre_empresa: p.nombre_empresa },
    async v => {
      if (!E.paramsCierran(v)) throw Object.assign(new Error(`Los cuatro componentes suman ${pct(E.sumaParams(v))}: deben sumar 100 %.`), { code: 'P0001' });
      await db.actualizar('params', 'id', 1, { ...v, updated_at: new Date().toISOString() });
      toast('Reglas actualizadas'); await bus.refrescar();
    });
  },

  'auditoria-cargar': conError(async () => { S.auditoria = null; bus.render(); S.auditoria = await db.cargarAuditoria(); bus.render(); }),
  'csv': d => { const f = EXPORTES[d.t]; if (f) f(); },
  'json': () => { descargar(`trazofino_${hoyISO()}.json`, JSON.stringify(S.datos, null, 2), 'application/json'); toast('Copia descargada'); }
};
