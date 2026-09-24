// =====================================================================
//  Vistas comerciales: Panel · Leads (CRM) · Cotizador · Cotizaciones
// =====================================================================
import { html, montar, usd, usd2, n2, pct, fecha, hoyISO } from './html.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, barra, nombreSocio } from './estado.js';
import { formulario, confirmar, toast } from './ui.js';

const ESTADOS_LEAD = ['Nuevo', 'Calificado', 'En Cotización', 'Cerrado', 'Perdido'];
const ORIGENES = ['Meta Ads', 'Google Ads', 'Instagram orgánico', 'TikTok', 'Referido', 'Influencer', 'Web directa'];
const TIPOS_CONTACTO = ['Llamada', 'WhatsApp', 'Email', 'Reunión', 'Visita a obra', 'Nota'];
const PATRON_TEL = '[0-9 +()\\-]{0,30}';

const clsEstadoLead = e => e === 'Cerrado' ? 'p-ok' : e === 'Perdido' ? 'p-neutral' : e === 'En Cotización' ? 'p-warn' : 'p-info';
const clsCobro = e => e === 'Cobrado' ? 'p-ok' : e === 'Vencido' ? 'p-bad' : 'p-warn';

// ---------------------------------------------------------------------
//  PANEL
// ---------------------------------------------------------------------
export function vPanel() {
  const D = S.datos, p = D.params, hoy = hoyISO();
  const vs = D.ventas;
  const sum = k => vs.reduce((a, v) => a + (Number(v[k]) || 0), 0);
  const fact = sum('pvp'), gan = sum('ganancia'), reserva = sum('reserva'), divA = sum('div_a'), divB = sum('div_b'), mkt = sum('mkt');
  const deb = E.debitosPorRol(D.gastos);
  const control = Math.round((reserva + divA + divB - gan) * 100) / 100;
  const cobrado = vs.filter(v => v.estado_cobro === 'Cobrado').reduce((a, v) => a + Number(v.pvp), 0);
  const m2 = vs.reduce((a, v) => a + (E.M2[v.chasis] || 0), 0);

  const cerrados = D.leads.filter(l => l.estado === 'Cerrado').length;
  const conv = D.leads.length ? cerrados / D.leads.length : 0;
  const conTerreno = D.leads.filter(l => l.terreno);
  const convTerreno = conTerreno.length ? conTerreno.filter(l => l.estado === 'Cerrado').length / conTerreno.length : 0;
  const frios = D.leads.filter(l => E.ACTIVO(l) && E.diasDesde(l.ult_contacto, hoy) > 7).length;

  // ---- alertas ----
  const alertas = [];
  if (control !== 0) alertas.push(['bad', `El reparto de ganancias no cierra por ${usd2(Math.abs(control))}.`]);
  const bajos = D.insumos.filter(E.stockBajo);
  if (bajos.length) alertas.push(['warn', `${bajos.length} insumo${bajos.length === 1 ? '' : 's'} por debajo del stock para un Chasis M.`, 'stock']);
  const miCol = S.perfil.rol === 'A' ? 'aprob_a' : 'aprob_b';
  const porFirmar = D.gastos.filter(g => g.estado === 'Pendiente' && Number(g.monto) > E.UMBRAL_GASTO && !g[miCol]);
  if (porFirmar.length) alertas.push(['warn', `${porFirmar.length} gasto${porFirmar.length === 1 ? '' : 's'} extraordinario${porFirmar.length === 1 ? '' : 's'} esperando tu firma.`, 'gastos']);
  const varBom = E.variacionBom(D.insumos, D.refs[0]);
  if (varBom?.supera) alertas.push(['warn', `El costo directo varió más de 10 % desde la última referencia (S ${pct(varBom.vs)} · M ${pct(varBom.vm)}). El Pacto exige avisar al ${nombreSocio('B')} para recalibrar precios.`, 'computo']);
  if (!D.refs.length) alertas.push(['info', 'Todavía no hay una referencia de cómputo registrada: sin ella no se puede medir la variación del 10 %.', 'computo']);
  const vencidos = D.leads.filter(l => E.seguimientoVencido(l, hoy));
  if (vencidos.length) alertas.push(['warn', `${vencidos.length} lead${vencidos.length === 1 ? '' : 's'} con seguimiento vencido.`, 'leads']);
  if (deb.A || deb.B) alertas.push(['bad', `Hay gastos ejecutados sin aprobación que se descuentan de dividendos.`, 'gastos']);

  const porGama = D.gamas.map(g => {
    const f = vs.filter(v => v.gama === g.nombre);
    return { gama: g.nombre, u: f.length, fact: f.reduce((a, v) => a + Number(v.pvp), 0) };
  });
  const maxFact = Math.max(1, ...porGama.map(x => x.fact));
  const maxLead = Math.max(1, ...ESTADOS_LEAD.map(e => D.leads.filter(l => l.estado === e).length));
  const conReal = vs.filter(v => v.costo_real !== null).slice(0, 8);
  const maxReal = Math.max(1, ...conReal.flatMap(v => [Number(v.cd_pres), Number(v.costo_real)]));
  const pend = D.leads.filter(l => l.proximo_contacto && E.ACTIVO(l)).sort((a, b) => a.proximo_contacto < b.proximo_contacto ? -1 : 1).slice(0, 8);

  return html`
    ${head('Panel de gestión', `${p.nombre_empresa} · línea de módulos en seco. Montos en dólares; el reparto usa el costo real cuando está cargado.`,
      html`<button class="btn primary" data-action="ir" data-v="cotizador">Nueva cotización</button>`)}

    ${alertas.length ? html`<div class="panel"><h3>Atención</h3><div class="body alerts">
      ${alertas.map(([t, m, v]) => html`<div class="alert a-${t}"><span>${m}</span>${v ? html`<button class="btn sm" data-action="ir" data-v="${v}">Ver</button>` : ''}</div>`)}
    </div></div>` : ''}

    <div class="kpis">
      ${kpi('Facturación total', usd(fact), `${vs.length} módulo${vs.length === 1 ? '' : 's'} · ${m2} m²`)}
      ${kpi('Margen neto consolidado', usd(gan), fact ? pct(gan / fact) + ' sobre venta' : '—', gan > 0 ? 'good' : '')}
      ${kpi('Ticket promedio', vs.length ? usd(fact / vs.length) : '—', 'Cobrado: ' + usd(cobrado))}
      ${kpi('Conversión de leads', pct(conv), `${cerrados} de ${D.leads.length} · con terreno ${conTerreno.length ? pct(convTerreno) : '—'}`, conv >= .05 ? 'good' : 'warn')}
    </div>

    <div class="row r2">
      <div class="panel"><h3>Reparto de la ganancia neta ${control === 0 ? pill('Consistente', 'p-ok') : pill('Revisar', 'p-bad')}</h3><div class="body">
        ${gan > 0 ? html`<div class="stack">
          <div class="seg s1" data-w="${(reserva / gan * 100).toFixed(1)}"></div>
          <div class="seg s2" data-w="${(divA / gan * 100).toFixed(1)}"></div>
          <div class="seg s3" data-w="${(divB / gan * 100).toFixed(1)}"></div></div>
          <div class="legend"><span class="k s1"></span>Fondo de reserva <span class="k s2"></span>${nombreSocio('A')} <span class="k s3"></span>${nombreSocio('B')}</div>` : ''}
        <table class="breakdown">
          <tr><td>Ganancia neta acumulada</td><td class="num"><b>${usd(gan)}</b></td></tr>
          <tr><td>Fondo de reserva operativo (${pct(p.p_reserva)})</td><td class="num">${usd(reserva)}</td></tr>
          <tr class="sub"><td>Dividendo · ${nombreSocio('A')}</td><td class="num">${usd(divA)}</td></tr>
          ${deb.A ? html`<tr class="sub bad"><td>Débito por gastos no autorizados</td><td class="num">− ${usd(deb.A)}</td></tr>` : ''}
          <tr class="sub"><td>Dividendo · ${nombreSocio('B')}</td><td class="num">${usd(divB)}</td></tr>
          ${deb.B ? html`<tr class="sub bad"><td>Débito por gastos no autorizados</td><td class="num">− ${usd(deb.B)}</td></tr>` : ''}
          <tr><td>Pendiente de cobro</td><td class="num">${usd(fact - cobrado)}</td></tr>
        </table>
      </div></div>

      <div class="panel"><h3>Ventas por gama</h3><div class="body">
        ${vs.length ? html`<div class="bars">${porGama.map(g => html`
          <div class="bar-row"><span>${g.gama} <span class="mute">(${g.u})</span></span>${barra(g.fact / maxFact * 100)}<span class="num">${usd(g.fact)}</span></div>`)}</div>`
        : vacio('Todavía no hay ventas', 'Se registran desde Cotizaciones o desde Ventas.')}
      </div></div>
    </div>

    <div class="row r2">
      <div class="panel"><h3>Costo presupuestado vs. real</h3><div class="body">
        ${conReal.length ? html`<div class="pvr">${conReal.map(v => html`
          <div class="pvr-row"><span class="pvr-l">${v.cliente}</span>
            <div class="pvr-bars">${barra(Number(v.cd_pres) / maxReal * 100, 'soft')}${barra(Number(v.costo_real) / maxReal * 100, Number(v.desvio) > 0 ? 'r' : 'g')}</div>
            <span class="num ${Number(v.desvio) > 0 ? 'bad' : 'ok'}">${Number(v.desvio) > 0 ? '+' : ''}${usd(v.desvio)}</span></div>`)}</div>
          <div class="legend"><span class="k soft"></span>Presupuestado <span class="k g"></span>Real bajo presupuesto <span class="k r"></span>Real sobre presupuesto</div>`
        : vacio('Sin costos reales cargados', 'Se cargan al cerrar cada obra, en Ventas o desde Fabricación.')}
      </div></div>

      <div class="panel"><h3>Embudo comercial</h3><div class="body">
        ${D.leads.length ? html`<div class="funnel">${ESTADOS_LEAD.map(e => {
          const c = D.leads.filter(l => l.estado === e).length;
          const cl = e === 'Cerrado' ? 'g' : e === 'Perdido' ? 'r' : e === 'En Cotización' ? 'y' : '';
          return html`<div class="fstep"><span>${e}</span>${barra(c / maxLead * 100, cl)}<span class="num">${c}</span><span class="num mute">${pct(c / D.leads.length)}</span></div>`;
        })}</div>
        <table class="breakdown mt">
          <tr><td>Leads fríos (más de 7 días sin contacto)</td><td class="num">${frios ? pill(frios, 'p-warn') : pill('0', 'p-ok')}</td></tr>
          <tr><td>Costo por lead</td><td class="num">${D.leads.length ? usd(mkt / D.leads.length) : '—'}</td></tr>
          <tr><td>Costo de adquisición por venta (CAC)</td><td class="num">${vs.length ? usd(mkt / vs.length) : '—'}</td></tr>
        </table>` : vacio('Sin leads', 'Cargalos en Leads.')}
      </div></div>
    </div>

    ${pend.length ? html`<div class="panel"><h3>Próximos seguimientos</h3><div class="body">
      ${pend.map(l => html`<div class="rem-row">
        ${pill(fecha(l.proximo_contacto), E.seguimientoVencido(l, hoy) ? 'p-bad' : 'p-neutral')}
        <span class="rem-name">${l.nombre}</span><span class="mute">${l.gama} · ${l.estado}</span>
        <button class="btn sm" data-action="abrir-lead" data-id="${l.id}">Ver</button></div>`)}
    </div></div>` : ''}`;
}

// ---------------------------------------------------------------------
//  LEADS · CRM
// ---------------------------------------------------------------------
const camposLead = () => [
  { k: 'nombre', l: 'Nombre', req: true, max: 80 },
  { k: 'fecha', l: 'Fecha de ingreso', t: 'date', req: true },
  { k: 'telefono', l: 'Teléfono', t: 'tel', max: 30, pattern: PATRON_TEL, errorPatron: 'El teléfono solo admite números, espacios y + ( ) -.' },
  { k: 'email', l: 'Email', t: 'email', max: 120, pattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+', errorPatron: 'El email no es válido.' },
  { k: 'terreno', l: '¿Tiene terreno?', t: 'select', opts: [['true', 'Sí'], ['false', 'No']] },
  { k: 'ubicacion', l: 'Ubicación', max: 80 },
  { k: 'gama', l: 'Gama de interés', t: 'select', opts: [...S.datos.gamas.map(g => g.nombre), 'Indefinido'] },
  { k: 'origen', l: 'Origen', t: 'select', opts: ORIGENES },
  { k: 'estado', l: 'Estado', t: 'select', opts: ESTADOS_LEAD },
  { k: 'proximo_contacto', l: 'Próximo seguimiento', t: 'date' },
  { k: 'notas', l: 'Notas generales', t: 'textarea', ancho: true, max: 1000 }
];

export function vLeads() {
  const D = S.datos, hoy = hoyISO();
  const ls = [...D.leads].sort((a, b) => E.scoreLead(b) - E.scoreLead(a));
  const vencidos = D.leads.filter(l => E.seguimientoVencido(l, hoy));
  return html`
    ${head('Leads', 'Ordenados por prioridad. Hacé clic en un lead para ver su historial y registrar contactos.',
      html`<button class="btn primary" data-action="lead-nuevo">Cargar lead</button>`)}
    ${vencidos.length ? html`<div class="warnbox"><b>${vencidos.length} seguimiento${vencidos.length === 1 ? '' : 's'} vencido${vencidos.length === 1 ? '' : 's'}:</b> ${vencidos.map(l => l.nombre).join(', ')}.</div>` : ''}
    <div class="panel"><div class="body tight">
      ${ls.length ? html`<div class="scroll"><table>
        <thead><tr><th class="num">Score</th><th>Nombre</th><th>Contacto</th><th>Terreno</th><th>Ubicación</th><th>Gama</th>
          <th>Origen</th><th>Estado</th><th class="num">Sin contacto</th><th>Seguimiento</th><th></th></tr></thead>
        <tbody>${ls.map(l => filaLead(l, hoy))}</tbody></table></div>`
      : vacio('Sin leads', 'Cargá el primer contacto para empezar a medir la conversión.')}
    </div></div>`;
}

function filaLead(l, hoy) {
  const d = E.ACTIVO(l) ? E.diasDesde(l.ult_contacto, hoy) : null;
  const sc = E.scoreLead(l), abierto = S.leadAbierto === l.id, venc = E.seguimientoVencido(l, hoy);
  return html`
    <tr class="clic ${abierto ? 'open' : ''}" data-action="toggle-lead" data-id="${l.id}">
      <td class="num">${pill(sc, sc >= 80 ? 'p-ok' : sc >= 50 ? 'p-info' : 'p-neutral')}</td>
      <td><b>${l.nombre}</b></td>
      <td class="small mute">${l.telefono || ''}${l.telefono && l.email ? html`<br>` : ''}${l.email || ''}</td>
      <td>${l.terreno ? pill('Sí', 'p-ok') : pill('No')}</td>
      <td>${l.ubicacion || '—'}</td><td>${l.gama}</td><td>${l.origen}</td>
      <td>${pill(l.estado, clsEstadoLead(l.estado))}</td>
      <td class="num">${d === null ? '—' : d > 7 ? pill(d, 'p-bad') : d}</td>
      <td>${l.proximo_contacto ? pill(fecha(l.proximo_contacto), venc ? 'p-bad' : 'p-neutral') : '—'}</td>
      <td class="num nowrap">
        <button class="btn sm" data-action="lead-editar" data-id="${l.id}">Editar</button>
        <button class="btn sm ghost" data-action="lead-borrar" data-id="${l.id}">Borrar</button></td>
    </tr>
    ${abierto ? detalleLead(l, venc) : ''}`;
}

function detalleLead(l, venc) {
  const tl = S.datos.interacciones.filter(i => i.lead_id === l.id);
  return html`<tr class="detail-wrap"><td colspan="11"><div class="detail"><div class="detail-grid">
    <div>
      <h4>Historial de contacto</h4>
      ${tl.length ? html`<div class="timeline">${tl.map(it => html`
        <div class="tl-item"><div class="tl-dot"></div><div>
          <div class="tl-head"><span class="tl-type">${it.tipo}</span><span>${fecha(it.fecha)}</span></div>
          <div class="tl-body">${it.nota}</div></div></div>`)}</div>`
      : html`<p class="mute small">Todavía no hay contactos registrados.</p>`}
      <div class="addform">
        <select id="ntTipo" aria-label="Tipo de contacto">${TIPOS_CONTACTO.map(t => html`<option>${t}</option>`)}</select>
        <input id="ntNota" maxlength="1000" placeholder="Qué se habló o qué pasó…" aria-label="Nota">
        <button class="btn sm primary" data-action="lead-contacto" data-id="${l.id}">Registrar</button>
      </div>
    </div>
    <div>
      <div class="next-box ${venc ? 'due' : ''}">
        <div class="l">Próximo seguimiento</div>
        <div class="v">${l.proximo_contacto ? fecha(l.proximo_contacto) + (venc ? ' · vencido' : '') : 'Sin definir'}</div>
        <div class="inline mt">
          <input type="date" id="fProx" value="${l.proximo_contacto || ''}" aria-label="Fecha de seguimiento">
          <button class="btn sm" data-action="lead-proximo" data-id="${l.id}">Guardar</button>
        </div>
      </div>
      <button class="btn primary full" data-action="lead-cotizar" data-id="${l.id}">Cotizar a este lead</button>
      ${l.notas ? html`<p class="mute small mt">${l.notas}</p>` : ''}
    </div>
  </div></div></td></tr>`;
}

// ---------------------------------------------------------------------
//  COTIZADOR
// ---------------------------------------------------------------------
export function vCotizador() {
  const D = S.datos, Q = S.Q;
  if (!D.gamas.find(g => g.nombre === Q.gama)) Q.gama = D.gamas[0]?.nombre || '';
  const r = E.cotizar(Q, D);
  const activos = D.leads.filter(E.ACTIVO);
  return html`
    ${head('Cotizador', 'Vista previa instantánea. Al guardar, el precio lo vuelve a calcular el servidor con el catálogo vigente.',
      html`<button class="btn primary" data-action="cot-guardar">Guardar cotización</button>`)}
    <div class="quote">
      <div class="panel"><h3>Configuración</h3><div class="body">
        <div class="row r2">
          <label class="f"><span>Chasis</span><select data-change="q-chasis">
            ${Object.keys(E.M2).map(k => html`<option value="${k}" ${Q.chasis === k ? html`selected` : ''}>Chasis ${k} · ${E.M2[k]} m²</option>`)}</select></label>
          <label class="f"><span>Gama</span><select data-change="q-gama">
            ${D.gamas.map(g => html`<option ${Q.gama === g.nombre ? html`selected` : ''}>${g.nombre}</option>`)}</select></label>
        </div>
        <label class="f"><span>Vincular a un lead (opcional)</span><select data-change="q-lead">
          <option value="">— Sin vincular —</option>
          ${activos.map(l => html`<option value="${l.id}" ${Q.lead === l.id ? html`selected` : ''}>${l.nombre}</option>`)}</select></label>
        <label class="f"><span>Cliente o referencia</span><input data-change="q-cliente" maxlength="80" value="${Q.cliente}" placeholder="Nombre del interesado"></label>
        <div class="mt"><span class="lbl">Adicionales</span>
          ${D.addons.map(a => html`<label class="chk"><input type="checkbox" data-change="q-addon" data-id="${a.id}" ${Q.addons.includes(a.id) ? html`checked` : ''}>
            ${a.nombre} <span class="mute">· ${usd(Q.chasis === 'S' ? a.costo_s : a.costo_m)} de costo</span></label>`)}
        </div>
        ${exclusiones()}
      </div></div>

      <div class="panel"><h3>Precio de venta</h3><div class="body">
        <table class="breakdown">
          <tr><td>Costo directo del chasis base</td><td class="num">${usd(r.base)}</td></tr>
          <tr class="sub"><td>Coeficiente de gama ×${n2(r.coef)}</td><td class="num">${usd(r.cdGama)}</td></tr>
          ${r.cdAddons ? html`<tr class="sub"><td>Adicionales</td><td class="num">${usd(r.cdAddons)}</td></tr>` : ''}
          <tr><td><b>Costo directo total</b></td><td class="num"><b>${usd(r.cd)}</b></td></tr>
          <tr class="big"><td>PVP</td><td class="num">${usd(r.pvp)}</td></tr>
          <tr class="sub"><td>Honorarios de arquitectura</td><td class="num">${usd(r.hon)}</td></tr>
          <tr class="sub"><td>Presupuesto digital y comercial</td><td class="num">${usd(r.mkt)}</td></tr>
          <tr class="sub"><td>Ganancia neta de la sociedad</td><td class="num">${usd(r.ganancia)}</td></tr>
          <tr><td>Precio por m² (${r.m2} m²)</td><td class="num"><b>${usd(r.pvpM2)}</b></td></tr>
          <tr><td>Rango de la gama</td><td class="num">${r.rangoOk ? pill('Dentro de rango', 'p-ok') : pill(`Fuera de ${usd(r.rangoMin)}–${usd(r.rangoMax)}`, 'p-warn')}</td></tr>
        </table>
        ${!r.rangoOk ? html`<p class="hint">No es un error de cálculo: con este cómputo y este coeficiente el precio por m² queda fuera del rango comercial. Revisá el cómputo, el coeficiente o el rango.</p>` : ''}
        <table class="breakdown mt">
          <tr><td>Fondo de reserva</td><td class="num">${usd(r.reserva)}</td></tr>
          <tr><td>Dividendo · ${nombreSocio('A')}</td><td class="num">${usd(r.divA)}</td></tr>
          <tr><td>Dividendo · ${nombreSocio('B')}</td><td class="num">${usd(r.divB)}</td></tr>
        </table>
      </div></div>
    </div>`;
}

export const exclusiones = () => html`<div class="excl">
  <b>No incluido en este precio — cláusula "paredes afuera"</b>
  <ul><li>Fundaciones: platea de hormigón o pilotes</li><li>Flete: camión semi o carretón, permisos y seguro de traslado</li>
  <li>Grúa, izaje y maniobra de posicionamiento</li><li>Acometidas de agua, electricidad, gas y cloaca o biodigestor</li>
  <li>Permisos municipales, tasas y planos de obra</li><li>Acceso apto para camión y espacio de maniobra para grúa</li></ul></div>`;

// ---------------------------------------------------------------------
//  COTIZACIONES
// ---------------------------------------------------------------------
export function vCotizaciones() {
  const D = S.datos;
  const nombresAddon = ids => (ids || []).map(id => D.addons.find(a => a.id === id)?.nombre).filter(Boolean).join(', ') || '—';
  return html`
    ${head('Cotizaciones', 'Precios calculados y guardados por el servidor. Convertí en venta cuando el cliente firma.',
      html`<button class="btn primary" data-action="ir" data-v="cotizador">Nueva cotización</button>`)}
    <div class="panel"><div class="body tight">
      ${D.cotizaciones.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Chasis</th><th>Gama</th><th>Adicionales</th><th class="num">PVP</th><th>Estado</th><th></th></tr></thead>
        <tbody>${D.cotizaciones.map(c => html`<tr>
          <td>${c.numero}</td><td>${fecha(c.fecha)}</td><td>${c.cliente}</td><td>${c.chasis}</td><td>${c.gama}</td>
          <td class="small mute">${nombresAddon(c.addons)}</td><td class="num">${usd(c.pvp)}</td>
          <td>${pill(c.estado, c.estado === 'Ganada' ? 'p-ok' : c.estado === 'Perdida' ? 'p-bad' : 'p-info')}</td>
          <td class="num nowrap">
            <button class="btn sm" data-action="cot-imprimir" data-id="${c.id}">Imprimir</button>
            ${c.estado === 'Enviada' ? html`
              <button class="btn sm primary" data-action="cot-convertir" data-id="${c.id}">Convertir en venta</button>
              <button class="btn sm" data-action="cot-perdida" data-id="${c.id}">Perdida</button>` : ''}
            <button class="btn sm ghost" data-action="cot-borrar" data-id="${c.id}">Borrar</button></td></tr>`)}</tbody>
      </table></div>` : vacio('Sin cotizaciones', 'Armá una en el Cotizador y guardala.')}
    </div></div>`;
}

function imprimirCotizacion(c) {
  const D = S.datos;
  const r = E.cotizar({ chasis: c.chasis, gama: c.gama, addons: c.addons || [] }, D);
  const ads = (c.addons || []).map(id => D.addons.find(a => a.id === id)?.nombre).filter(Boolean);
  const g = D.gamas.find(x => x.nombre === c.gama);
  montar(document.getElementById('print'), html`
    <div class="doc">
      <div class="doc-head"><img src="assets/logo.png" alt=""><div><h1>${D.params.nombre_empresa}</h1><p>Línea de módulos en seco</p></div>
        <div class="doc-num">Cotización N.º ${c.numero}<br>${fecha(c.fecha)}</div></div>
      <h2>Presupuesto para ${c.cliente}</h2>
      <table class="doc-t">
        <tr><td>Módulo</td><td>Chasis ${c.chasis} · ${E.M2[c.chasis]} m² cubiertos</td></tr>
        <tr><td>Línea comercial</td><td>${c.gama}</td></tr>
        <tr><td>Adicionales</td><td>${ads.length ? ads.join(', ') : 'Ninguno'}</td></tr>
        <tr class="tot"><td>Precio total</td><td>${usd(c.pvp)}</td></tr>
        <tr><td>Precio por m²</td><td>${usd(Number(c.pvp) / E.M2[c.chasis])}</td></tr>
      </table>
      ${g && Math.abs(r.pvp - Number(c.pvp)) > 1 ? html`<p class="doc-note">Valor calculado con el catálogo vigente a la fecha de emisión.</p>` : ''}
      <h3>Condiciones de pago</h3>
      <table class="doc-t"><tr><td>Seña y orden de fabricación</td><td>40 % a la firma del contrato</td></tr>
        <tr><td>Avance de obra</td><td>40 % con estructura y cerramiento ejecutados</td></tr>
        <tr><td>Saldo</td><td>20 % previo al retiro del taller</td></tr></table>
      <h3>Anexo — Cláusula "Paredes Afuera"</h3>
      <p>El precio comprende exclusivamente la fabricación de la unidad modular terminada en taller, conforme a la gama contratada. Quedan expresamente excluidos del precio y a cargo del cliente: fundaciones (platea de hormigón o pilotes) y estudio de suelos; flete y traslado hasta la obra, con permisos y seguros; grúa, izaje y maniobra de posicionamiento; acometidas y conexiones de agua, electricidad, gas y cloaca o biodigestor; permisos municipales, tasas, derechos y planos de obra; obras exteriores; y la provisión de un acceso apto para camión de gran porte con espacio de maniobra para grúa.</p>
      <p class="doc-foot">Precio en dólares estadounidenses, válido por 15 días desde la fecha de emisión.</p>
    </div>`);
  window.print();
}

// ---------------------------------------------------------------------
//  ACCIONES
// ---------------------------------------------------------------------
const lead = id => S.datos.leads.find(x => x.id === id);
const aBool = v => v === true || v === 'true';

export const acciones = {
  'abrir-lead': d => { S.leadAbierto = d.id; bus.ir('leads'); },
  'toggle-lead': d => { S.leadAbierto = S.leadAbierto === d.id ? null : d.id; bus.render(); },
  'lead-nuevo': () => formulario('Cargar lead', camposLead(),
    { fecha: hoyISO(), terreno: 'false', gama: 'Indefinido', origen: ORIGENES[0], estado: 'Nuevo' },
    async v => { await db.insertar('leads', { ...v, terreno: aBool(v.terreno) }); toast('Lead cargado'); await bus.refrescar(); }),
  'lead-editar': d => {
    const l = lead(d.id); if (!l) return;
    formulario('Editar lead', camposLead(), { ...l, terreno: String(l.terreno) },
      async v => { await db.actualizar('leads', 'id', l.id, { ...v, terreno: aBool(v.terreno) }); toast('Lead actualizado'); await bus.refrescar(); });
  },
  'lead-borrar': d => confirmar('Se elimina el lead y todo su historial de contactos.', async () => {
    await db.borrar('leads', 'id', d.id); toast('Lead eliminado'); await bus.refrescar();
  }, 'Eliminar'),
  'lead-contacto': async d => {
    const nota = document.getElementById('ntNota').value.trim();
    const tipo = document.getElementById('ntTipo').value;
    if (!nota) { toast('Escribí qué se habló antes de registrar', 'warn'); return; }
    try { await db.insertar('interacciones', { lead_id: d.id, tipo, nota: nota.slice(0, 1000), fecha: hoyISO() }); toast('Contacto registrado'); await bus.refrescar(); }
    catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'lead-proximo': async d => {
    const f = document.getElementById('fProx').value || null;
    try { await db.actualizar('leads', 'id', d.id, { proximo_contacto: f }); toast('Seguimiento actualizado'); await bus.refrescar(); }
    catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'lead-cotizar': d => {
    const l = lead(d.id); if (!l) return;
    S.Q = { ...S.Q, lead: l.id, cliente: l.nombre, gama: S.datos.gamas.some(g => g.nombre === l.gama) ? l.gama : S.Q.gama };
    bus.ir('cotizador');
  },
  'cot-guardar': async () => {
    const Q = S.Q;
    const cliente = (Q.cliente || '').trim() || (lead(Q.lead)?.nombre ?? '');
    if (!cliente) { toast('Indicá el cliente o vinculá un lead', 'warn'); return; }
    const previa = E.cotizar(Q, S.datos).pvp;
    try {
      const id = await db.rpc.crearCotizacion(cliente.slice(0, 80), Q.chasis, Q.gama, Q.addons, Q.lead || null);
      await bus.refrescar();
      const c = S.datos.cotizaciones.find(x => x.id === id);
      if (c && Math.abs(Number(c.pvp) - previa) > 1) toast(`Guardada. El catálogo cambió: el servidor calculó ${usd(c.pvp)}.`, 'warn');
      else toast('Cotización guardada');
      S.Q = { chasis: Q.chasis, gama: Q.gama, addons: [], cliente: '', lead: '' };
      bus.ir('cotizaciones');
    } catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'cot-convertir': d => confirmar('Se crea una venta con el precio de esta cotización y el lead vinculado pasa a Cerrado.', async () => {
    await db.rpc.convertirCotizacion(d.id); toast('Venta creada'); await bus.refrescar(); bus.ir('ventas');
  }, 'Convertir'),
  'cot-perdida': async d => {
    try { await db.actualizar('cotizaciones', 'id', d.id, { estado: 'Perdida' }); await bus.refrescar(); }
    catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'cot-borrar': d => confirmar('Se elimina la cotización.', async () => {
    await db.borrar('cotizaciones', 'id', d.id); toast('Cotización eliminada'); await bus.refrescar();
  }, 'Eliminar'),
  'cot-imprimir': d => { const c = S.datos.cotizaciones.find(x => x.id === d.id); if (c) imprimirCotizacion(c); }
};

export const cambios = {
  'q-chasis': el => { S.Q.chasis = el.value === 'M' ? 'M' : 'S'; bus.render(); },
  'q-gama': el => { S.Q.gama = el.value; bus.render(); },
  'q-lead': el => {
    S.Q.lead = el.value;
    const l = lead(el.value);
    if (l && !S.Q.cliente) S.Q.cliente = l.nombre;
    bus.render();
  },
  'q-cliente': el => { S.Q.cliente = el.value.slice(0, 80); },
  'q-addon': el => {
    const id = el.dataset.id;
    S.Q.addons = el.checked ? [...new Set([...S.Q.addons, id])] : S.Q.addons.filter(x => x !== id);
    bus.render();
  }
};
