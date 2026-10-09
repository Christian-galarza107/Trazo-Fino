// =====================================================================
//  Vistas comerciales: Panel · Leads (CRM) · Cotizador · Cotizaciones
// =====================================================================
import { html, montar, usd, usd2, n2, pct, fecha, hoyISO } from './html.js';
import { etiquetaProducto } from './views-ingenieria.js';
import * as E from './engine.js';
import * as db from './db.js';
import { S, bus, head, vacio, pill, kpi, barra, nombreSocio } from './estado.js';
import { formulario, confirmar, toast } from './ui.js';

const ESTADOS_LEAD = ['Nuevo', 'Calificado', 'En Cotización', 'Cerrado', 'Perdido'];
const ORIGENES = ['Meta Ads', 'Google Ads', 'Instagram orgánico', 'TikTok', 'Referido', 'Influencer', 'Web directa'];
const TIPOS_CONTACTO = ['Llamada', 'WhatsApp', 'Email', 'Reunión', 'Visita a obra', 'Nota'];
const PATRON_TEL = '[0-9 +()\\-]{0,30}';
const PLAZOS = ['Inmediato', '1 a 3 meses', '3 a 6 meses', '6 a 12 meses', 'Más de 12 meses', 'Sin definir'];
const m2Venta = v => v.superficie_m2 !== null && v.superficie_m2 !== undefined ? Number(v.superficie_m2) : (v.generacion === '1.0' ? E.M2_LEGADO[v.chasis] || 0 : 0);
const interes = l => [l.tecnologia_interes ? E.etiquetaTec(l.tecnologia_interes) : null, l.tamano_interes, l.gama && l.gama !== 'Indefinido' ? l.gama : null].filter(Boolean).join(' · ') || 'Sin definir';

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
  const m2 = vs.reduce((a, v) => a + m2Venta(v), 0);

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
  // ---- 2.0 ----
  const bomsPend = (D.boms || []).filter(b => b.estado === 'Pendiente de validación');
  if (bomsPend.length) alertas.push(['warn', `${bomsPend.length} BOM esperando aprobación.`, 'bom']);
  const sigPend = D.cotizaciones.filter(c => c.aprobacion === 'Pendiente de validación');
  if (sigPend.length) alertas.push(['warn', `${sigPend.length} cotización${sigPend.length === 1 ? '' : 'es'} Signature esperando validación técnica y comercial.`, 'cotizaciones']);
  const erosion = D.cotizaciones.filter(c => c.generacion === '2.0' && c.estado === 'Enviada').map(c => E.erosionMargen(c, D)).filter(e => e?.alerta);
  if (erosion.length) alertas.push(['bad', `Subas de precios comprometen el margen de ${erosion.length} cotización${erosion.length === 1 ? '' : 'es'} abierta${erosion.length === 1 ? '' : 's'}.`, 'precios']);
  const sinBom = (D.productos || []).filter(p => p.estado_comercial !== 'Inactivo' && !E.vigenteDe(p.id, D));
  if (sinBom.length) alertas.push(['info', `${sinBom.length} modelo${sinBom.length === 1 ? '' : 's'} activo${sinBom.length === 1 ? '' : 's'} sin BOM aprobado: todavía no se pueden cotizar.`, 'catalogo']);
  const faltan = E.stockComprometido(D).filter(x => x.faltante > 0);
  if (faltan.length) alertas.push(['warn', `${faltan.length} material${faltan.length === 1 ? '' : 'es'} faltante${faltan.length === 1 ? '' : 's'} para órdenes de fabricación 2.0 abiertas.`, 'lineas']);

  const porTec = [...Object.entries(E.TECNOLOGIAS).map(([k, l]) => ({ l, f: vs.filter(v => v.tecnologia === k) })), { l: 'Catálogo 1.0', f: vs.filter(v => !v.tecnologia) }]
    .map(x => ({ l: x.l, u: x.f.length, fact: x.f.reduce((a, v) => a + Number(v.pvp), 0) }));
  const porGama = D.gamas.map(g => {
    const f = vs.filter(v => v.gama === g.nombre);
    return { gama: g.nombre, u: f.length, fact: f.reduce((a, v) => a + Number(v.pvp), 0) };
  });
  const maxFact = Math.max(1, ...porGama.map(x => x.fact), ...porTec.map(x => x.fact));
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
      ${kpi('Margen societario', usd(gan), (fact ? pct(gan / fact) + ' sobre venta · ' : '') + 'antes de impuestos', gan > 0 ? 'good' : '')}
      ${kpi('Ticket promedio', vs.length ? usd(fact / vs.length) : '—', 'Cobrado: ' + usd(cobrado))}
      ${kpi('Conversión de leads', pct(conv), `${cerrados} de ${D.leads.length} · con terreno ${conTerreno.length ? pct(convTerreno) : '—'}`, conv >= .05 ? 'good' : 'warn')}
    </div>

    <div class="row r2">
      <div class="panel"><h3>Reparto del margen societario ${control === 0 ? pill('Consistente', 'p-ok') : pill('Revisar', 'p-bad')}</h3><div class="body">
        ${gan > 0 ? html`<div class="stack">
          <div class="seg s1" data-w="${(reserva / gan * 100).toFixed(1)}"></div>
          <div class="seg s2" data-w="${(divA / gan * 100).toFixed(1)}"></div>
          <div class="seg s3" data-w="${(divB / gan * 100).toFixed(1)}"></div></div>
          <div class="legend"><span class="k s1"></span>Fondo de reserva <span class="k s2"></span>${nombreSocio('A')} <span class="k s3"></span>${nombreSocio('B')}</div>` : ''}
        <table class="breakdown">
          <tr><td>Margen societario acumulado (antes de impuestos)</td><td class="num"><b>${usd(gan)}</b></td></tr>
          <tr><td>Fondo de reserva operativo (${pct(p.p_reserva)})</td><td class="num">${usd(reserva)}</td></tr>
          <tr class="sub"><td>Dividendo · ${nombreSocio('A')}</td><td class="num">${usd(divA)}</td></tr>
          ${deb.A ? html`<tr class="sub bad"><td>Débito por gastos no autorizados</td><td class="num">− ${usd(deb.A)}</td></tr>` : ''}
          <tr class="sub"><td>Dividendo · ${nombreSocio('B')}</td><td class="num">${usd(divB)}</td></tr>
          ${deb.B ? html`<tr class="sub bad"><td>Débito por gastos no autorizados</td><td class="num">− ${usd(deb.B)}</td></tr>` : ''}
          <tr><td>Pendiente de cobro</td><td class="num">${usd(fact - cobrado)}</td></tr>
        </table>
      </div></div>

      <div class="panel"><h3>Ventas por tecnología y por gama</h3><div class="body">
        ${vs.length ? html`<div class="bars">${porTec.filter(t => t.u).map(t => html`
          <div class="bar-row"><span>${t.l} <span class="mute">(${t.u})</span></span>${barra(t.fact / maxFact * 100, 'soft')}<span class="num">${usd(t.fact)}</span></div>`)}</div>
          <div class="bars mt">${porGama.filter(g => g.u || g.gama !== 'Enterprise').map(g => html`
          <div class="bar-row"><span>${g.gama} <span class="mute">(${g.u})</span></span>${barra(g.fact / maxFact * 100)}<span class="num">${usd(g.fact)}</span></div>`)}</div>
          <button class="btn sm mt" data-action="ir" data-v="lineas">Análisis por línea</button>`
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
        <span class="rem-name">${l.nombre}</span><span class="mute">${interes(l)} · ${l.estado}</span>
        <button class="btn sm" data-action="abrir-lead" data-id="${l.id}">Ver</button></div>`)}
    </div></div>` : ''}`;
}

// ---------------------------------------------------------------------
//  LEADS · CRM
// ---------------------------------------------------------------------
const camposLead = (gamaActual = '') => [
  { k: 'nombre', l: 'Nombre', req: true, max: 80 },
  { k: 'fecha', l: 'Fecha de ingreso', t: 'date', req: true },
  { k: 'telefono', l: 'Teléfono', t: 'tel', max: 30, pattern: PATRON_TEL, errorPatron: 'El teléfono solo admite números, espacios y + ( ) -.' },
  { k: 'email', l: 'Email', t: 'email', max: 120, pattern: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+', errorPatron: 'El email no es válido.' },
  { k: 'terreno', l: '¿Tiene terreno?', t: 'select', opts: [['true', 'Sí'], ['false', 'No']] },
  { k: 'ubicacion', l: 'Ubicación', max: 80 },
  { k: 'tecnologia_interes', l: 'Tecnología de interés', t: 'select', opts: [['', 'Sin definir'], ...Object.entries(E.TECNOLOGIAS)] },
  { k: 'tamano_interes', l: 'Tamaño de interés', t: 'select', opts: [['', 'Sin definir'], ...Object.entries(E.TAMANOS).map(([k, d]) => [k, `${k} · ${d.m2} m²`])] },
  { k: 'gama', l: 'Gama de interés', t: 'select', opts: [...new Set([...E.GAMAS_2, 'Indefinido', ...(gamaActual && !E.GAMAS_2.includes(gamaActual) ? [gamaActual] : [])])] },
  { k: 'presupuesto_cliente', l: 'Presupuesto orientativo del cliente (USD)', t: 'number', min: 0, step: '1' },
  { k: 'plazo_estimado', l: 'Plazo estimado', t: 'select', opts: [['', 'Sin definir'], ...PLAZOS] },
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
        <thead><tr><th class="num">Score</th><th>Nombre</th><th>Contacto</th><th>Terreno</th><th>Ubicación</th><th>Interés</th>
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
      <td>${l.ubicacion || '—'}</td><td>${interes(l)}${l.presupuesto_cliente ? html`<br><span class="small mute">${usd(l.presupuesto_cliente)}${l.plazo_estimado ? ' · ' + l.plazo_estimado : ''}</span>` : ''}</td><td>${l.origen}</td>
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
  const intereses = (S.datos.lead_intereses || []).filter(i => i.lead_id === l.id);
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
      <h4 class="mt">Configuraciones de interés</h4>
      ${intereses.length ? html`<table class="inner"><tbody>${intereses.map(i => html`<tr>
        <td>${i.producto_id ? (S.datos.productos.find(p => p.id === i.producto_id)?.codigo || '—') : [i.tecnologia && E.etiquetaTec(i.tecnologia), i.tamano, i.gama].filter(Boolean).join(' · ') || 'Sin definir'}
          ${i.nota ? html`<br><span class="small mute">${i.nota}</span>` : ''}</td>
        <td>${pill(i.estado, i.estado === 'Ganado' ? 'p-ok' : i.estado === 'Descartado' ? 'p-neutral' : i.estado === 'Cotizado' ? 'p-warn' : 'p-info')}</td>
        <td class="num nowrap"><button class="btn sm" data-action="interes-cotizar" data-id="${i.id}">Cotizar</button>
          ${i.estado === 'Abierto' || i.estado === 'Cotizado' ? html`<button class="btn sm ghost" data-action="interes-descartar" data-id="${i.id}">Descartar</button>` : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="mute small">Sin configuraciones registradas. Un lead puede interesarse por varias sin pisar las anteriores.</p>`}
      <button class="btn sm mt" data-action="interes-nuevo" data-id="${l.id}">Agregar configuración de interés</button>
      ${l.notas ? html`<p class="mute small mt">${l.notas}</p>` : ''}
    </div>
  </div></div></td></tr>`;
}

// ---------------------------------------------------------------------
//  COTIZADOR 2.0 · Tecnología → Tamaño → Gama → Adicionales → Resultado
// ---------------------------------------------------------------------
const productoQ = Q => (S.datos.productos || []).find(p => p.tecnologia === Q.tecnologia && p.tamano === Q.tamano && p.gama === Q.gama) || null;
const opcion = (k, v, actual, titulo, detalle, extra = '') => html`<button type="button" class="opt ${actual === v ? 'on' : ''}" data-action="q2-set" data-k="${k}" data-v="${v}"
  ${actual === v ? html`aria-pressed="true"` : html`aria-pressed="false"`}><b>${titulo}</b><span>${detalle}</span>${extra}</button>`;

export function vCotizador() {
  const D = S.datos, Q = S.Q2, pr = productoQ(Q);
  const disp = E.addonsDisponibles(pr, D);
  Q.addons = Q.addons.filter(id => disp.some(a => a.addon_id === id));
  let r = null; try { r = pr ? E.cotizarV2({ producto: pr.codigo, addons: Q.addons }, D) : null; } catch (_) { r = null; }
  const activos = D.leads.filter(E.ACTIVO);
  const hoy = hoyISO(), vence = new Date(Date.parse(hoy) + Q.vigencia * 86400000).toISOString().slice(0, 10);
  const paso = (n, t, ok, cont) => html`<div class="paso ${ok ? 'hecho' : ''}"><div class="paso-n">${n}</div><div class="paso-c"><h4>${t}</h4>${cont}</div></div>`;
  return html`
    ${head('Cotizador', 'Elegí tecnología, tamaño y gama. La vista previa usa el BOM aprobado vigente; al guardar, el precio lo vuelve a calcular el servidor y queda congelado con su instantánea de costos.',
      html`<button class="btn primary" data-action="cot-guardar" ${r?.definitivo ? '' : html`disabled`}>Guardar cotización</button>`)}
    <div class="quote">
      <div class="panel"><h3>Configuración</h3><div class="body">
        ${paso(1, 'Tecnología', !!Q.tecnologia, html`<div class="opts">
          ${opcion('tecnologia', 'WOOD', Q.tecnologia, 'Wood', 'Estructura de madera')}
          ${opcion('tecnologia', 'IRON_STEEL', Q.tecnologia, 'Iron Steel', 'Estructura metálica')}</div>`)}
        ${paso(2, 'Tamaño', !!Q.tamano, html`<div class="opts">
          ${Object.entries(E.TAMANOS).map(([k, d]) => opcion('tamano', k, Q.tamano, `${k} · ${d.m2} m²`, `${n2(d.largo)} × ${n2(d.ancho)} m`))}</div>`)}
        ${paso(3, 'Gama', !!Q.gama, html`<div class="opts">
          ${opcion('gama', 'Básico', Q.gama, 'Básico', 'Funcional, accesible y estandarizada')}
          ${opcion('gama', 'Premium', Q.gama, 'Premium', 'Mejores terminaciones y confort')}
          ${opcion('gama', 'Signature', Q.gama, 'Signature', 'Diseño exclusivo · Cotización a pedido', html`<em class="tagsig">A pedido</em>`)}</div>`)}
        ${paso(4, 'Adicionales', false, pr ? (disp.length ? html`${disp.map(a => html`<label class="chk"><input type="checkbox" data-change="q2-addon" data-id="${a.addon_id}" ${Q.addons.includes(a.addon_id) ? html`checked` : ''}>
            ${a.nombre} <span class="mute">· ${usd(a.costo)} de costo para ${E.etiquetaTec(pr.tecnologia)} ${pr.tamano}</span></label>`)}`
          : html`<p class="hint nomargin">Ningún adicional tiene costo cargado y está disponible para ${pr.codigo}. Se definen en Catálogo de productos.</p>`)
          : html`<p class="hint nomargin">Completá los pasos anteriores.</p>`)}
        <div class="row r2 mt">
          <label class="f"><span>Vincular a un lead (opcional)</span><select data-change="q2-lead">
            <option value="">— Sin vincular —</option>
            ${activos.map(l => html`<option value="${l.id}" ${Q.lead === l.id ? html`selected` : ''}>${l.nombre}</option>`)}</select></label>
          <label class="f"><span>Cliente o referencia</span><input data-change="q2-cliente" maxlength="80" value="${Q.cliente}" placeholder="Nombre del interesado"></label>
        </div>
        <label class="f"><span>Vigencia de la oferta (días)</span><input type="number" min="1" max="180" step="1" data-change="q2-vigencia" value="${Q.vigencia}"></label>
        ${exclusiones()}
      </div></div>

      <div class="panel"><h3>Resultado</h3><div class="body">
        ${!pr ? vacio('Elegí tecnología, tamaño y gama', 'El resultado aparece cuando la configuración está completa.') : html`
        <table class="breakdown">
          <tr><td>Producto</td><td class="num"><b>${E.etiquetaTec(pr.tecnologia)} ${pr.tamano} ${pr.gama}</b></td></tr>
          <tr><td>Código</td><td class="num"><code>${pr.codigo}</code></td></tr>
          <tr><td>Superficie</td><td class="num">${n2(pr.largo_m)} × ${n2(pr.ancho_m)} m = ${n2(pr.superficie_m2)} m²</td></tr>
          ${r ? html`
          <tr><td>Costo de materiales</td><td class="num">${usd(r.materiales)}</td></tr>
          <tr><td>Mano de obra</td><td class="num">${usd(r.mdo)}</td></tr>
          ${r.costoAddons ? html`<tr><td>Adicionales</td><td class="num">${usd(r.costoAddons)}</td></tr>` : ''}
          <tr><td><b>Costo directo total</b></td><td class="num"><b>${usd(r.cd)}</b></td></tr>
          <tr class="big"><td>PVP</td><td class="num">${usd(r.pvp)}</td></tr>
          <tr><td>Precio por m²</td><td class="num"><b>${usd(r.pvpM2)}</b></td></tr>
          <tr class="sub"><td>Honorarios de arquitectura</td><td class="num">${usd(r.hon)}</td></tr>
          <tr class="sub"><td>Presupuesto comercial y marketing</td><td class="num">${usd(r.mkt)}</td></tr>
          <tr class="sub"><td>Margen societario objetivo</td><td class="num">${usd(r.ganancia)}</td></tr>
          <tr class="sub"><td>Reserva · Dividendos ${nombreSocio('A')} / ${nombreSocio('B')}</td><td class="num">${usd(r.reserva)} · ${usd(r.divA)} / ${usd(r.divB)}</td></tr>
          <tr><td>Fecha · vigencia</td><td class="num">${fecha(hoy)} · hasta ${fecha(vence)}</td></tr>
          <tr><td>Estado de aprobación</td><td class="num">${!r.definitivo ? pill('No cotizable', 'p-bad') : r.signature ? pill('Requiere validación Signature', 'p-warn') : pill('Aprobada al emitir', 'p-ok')}</td></tr>` : ''}
        </table>
        ${r && !r.definitivo ? html`<div class="warnbox mt"><b>No se puede emitir una cotización definitiva:</b> ${r.observacion}. Los valores mostrados son solo una referencia.</div>` : ''}
        ${pr.condiciones_venta ? html`<p class="hint">${pr.condiciones_venta}</p>` : ''}
        ${pr.descripcion ? html`<p class="hint">${pr.descripcion}</p>` : ''}`}
      </div></div>
    </div>`;
}

/** Cláusula obligatoria: en pantalla, en la impresión y en todo documento comercial 2.0. */
export const TEXTO_PAREDES_AFUERA = 'El precio comprende exclusivamente la unidad habitacional terminada en fábrica.';
export const EXCLUSIONES = Object.freeze(['Fundaciones y preparación del terreno.', 'Flete y transporte.', 'Grúa e izaje.',
  'Acometidas de servicios.', 'Tramitaciones y permisos municipales.']);
export const exclusiones = () => html`<div class="excl">
  <b>Cláusula "Paredes Afuera"</b>
  <p class="nomargin">${TEXTO_PAREDES_AFUERA} Se excluyen:</p>
  <ol>${EXCLUSIONES.map(x => html`<li>${x}</li>`)}</ol>
  <p class="nomargin small">La unidad no se entrega instalada en el terreno: esos trabajos no están incluidos en el precio, con o sin adicionales.</p></div>`;

// ---------------------------------------------------------------------
//  COTIZACIONES
// ---------------------------------------------------------------------
const descModelo = c => c.generacion === '2.0' ? `${c.producto_codigo}` : `Chasis ${c.chasis} · ${c.gama} (1.0)`;
const m2Cot = c => c.generacion === '2.0' ? Number(c.superficie_m2) : E.M2_LEGADO[c.chasis];
const clsAprob = a => a === 'Aprobada' ? 'p-ok' : a === 'Rechazada' ? 'p-bad' : 'p-warn';

export function vCotizaciones() {
  const D = S.datos, hoy = hoyISO();
  const nombresAddon = ids => (ids || []).map(id => D.addons.find(a => a.id === id)?.nombre).filter(Boolean).join(', ') || '—';
  return html`
    ${head('Cotizaciones', 'Precios calculados y guardados por el servidor, con su instantánea de costos. Las de catálogo 1.0 (chasis 18/36 m²) se conservan tal como se emitieron.',
      html`<button class="btn primary" data-action="ir" data-v="cotizador">Nueva cotización</button>`)}
    <div class="panel"><div class="body tight">
      ${D.cotizaciones.length ? html`<div class="scroll"><table>
        <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Modelo</th><th class="num">m²</th><th>Adicionales</th><th class="num">Precio</th>
          <th>Vigencia</th><th>Aprobación</th><th>Estado</th><th></th></tr></thead>
        <tbody>${D.cotizaciones.map(c => {
          const v2 = c.generacion === '2.0', vencida = v2 && c.estado === 'Enviada' && c.valida_hasta && c.valida_hasta < hoy;
          const convertible = c.estado === 'Enviada' && (!v2 || c.aprobacion === 'Aprobada');
          return html`<tr>
          <td>${c.numero}</td><td>${fecha(c.fecha)}</td><td>${c.cliente}</td>
          <td>${descModelo(c)}${v2 ? '' : html` ${pill('1.0', 'p-neutral')}`}</td><td class="num">${n2(m2Cot(c))}</td>
          <td class="small mute">${nombresAddon(c.addons)}</td>
          <td class="num">${usd(v2 ? c.pvp_final ?? c.pvp : c.pvp)}${v2 && Number(c.descuento) ? html`<br><span class="small mute">PVP ${usd(c.pvp)} − ${usd(c.descuento)}</span>` : ''}</td>
          <td>${v2 ? (vencida ? pill('Vencida ' + fecha(c.valida_hasta), 'p-bad') : fecha(c.valida_hasta)) : '—'}</td>
          <td>${v2 ? pill(c.aprobacion, clsAprob(c.aprobacion)) : '—'}</td>
          <td>${pill(c.estado, c.estado === 'Ganada' ? 'p-ok' : c.estado === 'Perdida' ? 'p-bad' : 'p-info')}</td>
          <td class="num nowrap">
            <button class="btn sm" data-action="cot-imprimir" data-id="${c.id}">Imprimir</button>
            ${c.aprobacion === 'Pendiente de validación' ? html`<button class="btn sm primary" data-action="cot-validar" data-id="${c.id}">Validar Signature</button>` : ''}
            ${convertible ? html`<button class="btn sm primary" data-action="cot-convertir" data-id="${c.id}">Convertir en venta</button>` : ''}
            ${c.estado === 'Enviada' ? html`<button class="btn sm" data-action="cot-perdida" data-id="${c.id}">Perdida</button>` : ''}
            <button class="btn sm ghost" data-action="cot-borrar" data-id="${c.id}">Borrar</button></td></tr>`;
        })}</tbody>
      </table></div>` : vacio('Sin cotizaciones', 'Armá una en el Cotizador y guardala.')}
    </div></div>`;
}

function imprimirCotizacion(c) {
  const D = S.datos;
  const ads = (c.addons || []).map(id => D.addons.find(a => a.id === id)?.nombre).filter(Boolean);
  if (c.generacion !== '2.0') return imprimirCotizacion1(c, ads);
  const pr = D.productos.find(p => p.id === c.producto_id);
  montar(document.getElementById('print'), html`
    <div class="doc">
      <div class="doc-head"><img src="assets/logo.png" alt=""><div><h1>${D.params.nombre_empresa}</h1><p>Unidades habitacionales modulares industrializadas en seco</p></div>
        <div class="doc-num">Cotización N.º ${c.numero}<br>${fecha(c.fecha)}</div></div>
      <h2>Presupuesto para ${c.cliente}</h2>
      <table class="doc-t">
        <tr><td>Producto</td><td>${pr ? `${E.etiquetaTec(pr.tecnologia)} ${pr.tamano} · ${pr.gama}` : c.producto_codigo}</td></tr>
        <tr><td>Código</td><td>${c.producto_codigo}</td></tr>
        <tr><td>Superficie</td><td>${pr ? `${n2(pr.largo_m)} × ${n2(pr.ancho_m)} m = ` : ''}${n2(c.superficie_m2)} m²</td></tr>
        ${pr?.descripcion ? html`<tr><td>Descripción</td><td>${pr.descripcion}</td></tr>` : ''}
        <tr><td>Adicionales</td><td>${ads.length ? ads.join(', ') : 'Ninguno'}</td></tr>
        ${Number(c.descuento) ? html`<tr><td>Precio de lista</td><td>${usd(c.pvp)}</td></tr><tr><td>Descuento</td><td>− ${usd(c.descuento)}</td></tr>` : ''}
        <tr class="tot"><td>Precio total</td><td>${usd(c.pvp_final ?? c.pvp)}</td></tr>
        <tr><td>Precio por m²</td><td>${usd(Number(c.pvp_final ?? c.pvp) / Number(c.superficie_m2))}</td></tr>
        <tr><td>Fecha de emisión · vigencia</td><td>${fecha(c.fecha)} · válida hasta el ${fecha(c.valida_hasta)} (${c.vigencia_dias} días)</td></tr>
        <tr><td>Estado de aprobación</td><td>${c.aprobacion}${c.gama === 'Signature' ? ' · Diseño exclusivo, cotización a pedido' : ''}</td></tr>
      </table>
      <h3>Condiciones de la oferta</h3>
      ${pr?.condiciones_venta ? html`<p>${pr.condiciones_venta}</p>` : ''}
      <table class="doc-t"><tr><td>Seña y orden de fabricación</td><td>40 % a la firma del contrato</td></tr>
        <tr><td>Avance de obra</td><td>40 % con estructura y cerramiento ejecutados</td></tr>
        <tr><td>Saldo</td><td>20 % previo al retiro de fábrica</td></tr></table>
      <h3>Cláusula "Paredes Afuera"</h3>
      <p><b>${TEXTO_PAREDES_AFUERA}</b> Se excluyen:</p>
      <ol>${EXCLUSIONES.map(x => html`<li>${x}</li>`)}</ol>
      <p>La unidad no se entrega instalada en el terreno. Estos conceptos quedan a cargo del cliente aun cuando se contraten adicionales.</p>
      <p class="doc-foot">Precio en dólares estadounidenses${c.tc_valor ? `, calculado con tipo de cambio ${c.tc_tipo} ${n2(c.tc_valor)} del ${fecha(c.tc_fecha)}` : ''}. Valores fijados al emitir: los cambios posteriores de costos no modifican esta cotización.</p>
    </div>`);
  window.print();
}

function imprimirCotizacion1(c, ads) {
  const D = S.datos;
  montar(document.getElementById('print'), html`
    <div class="doc">
      <div class="doc-head"><img src="assets/logo.png" alt=""><div><h1>${D.params.nombre_empresa}</h1><p>Línea de módulos en seco</p></div>
        <div class="doc-num">Cotización N.º ${c.numero}<br>${fecha(c.fecha)}</div></div>
      <h2>Presupuesto para ${c.cliente}</h2>
      <table class="doc-t">
        <tr><td>Módulo</td><td>Chasis ${c.chasis} · ${E.M2_LEGADO[c.chasis]} m² cubiertos (catálogo 1.0)</td></tr>
        <tr><td>Línea comercial</td><td>${c.gama}</td></tr>
        <tr><td>Adicionales</td><td>${ads.length ? ads.join(', ') : 'Ninguno'}</td></tr>
        <tr class="tot"><td>Precio total</td><td>${usd(c.pvp)}</td></tr>
        <tr><td>Precio por m²</td><td>${usd(Number(c.pvp) / E.M2_LEGADO[c.chasis])}</td></tr>
      </table>
      <p class="doc-note">Reimpresión de una cotización del catálogo 1.0 con los valores originales de su emisión.</p>
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
const limpiarLead = v => ({ ...v, terreno: aBool(v.terreno), tecnologia_interes: v.tecnologia_interes || null,
  tamano_interes: v.tamano_interes || null, plazo_estimado: v.plazo_estimado || null });

export const acciones = {
  'abrir-lead': d => { S.leadAbierto = d.id; bus.ir('leads'); },
  'toggle-lead': d => { S.leadAbierto = S.leadAbierto === d.id ? null : d.id; bus.render(); },
  'lead-nuevo': () => formulario('Cargar lead', camposLead(),
    { fecha: hoyISO(), terreno: 'false', gama: 'Indefinido', origen: ORIGENES[0], estado: 'Nuevo' },
    async v => { await db.insertar('leads', limpiarLead(v)); toast('Lead cargado'); await bus.refrescar(); }),
  'lead-editar': d => {
    const l = lead(d.id); if (!l) return;
    formulario('Editar lead', camposLead(l.gama), { ...l, terreno: String(l.terreno) },
      async v => { await db.actualizar('leads', 'id', l.id, limpiarLead(v)); toast('Lead actualizado'); await bus.refrescar(); });
  },
  'interes-nuevo': d => formulario('Configuración de interés', [
    { k: 'producto_id', l: 'Modelo específico (opcional)', t: 'select', ancho: true, opts: [['', '— Sin modelo definido —'], ...S.datos.productos.map(p => [p.id, etiquetaProducto(p)])] },
    { k: 'tecnologia', l: 'Tecnología', t: 'select', opts: [['', 'Sin definir'], ...Object.entries(E.TECNOLOGIAS)] },
    { k: 'tamano', l: 'Tamaño', t: 'select', opts: [['', 'Sin definir'], 'S', 'M'] },
    { k: 'gama', l: 'Gama', t: 'select', opts: [['', 'Sin definir'], ...E.GAMAS_2] },
    { k: 'nota', l: 'Nota', max: 300, ancho: true }
  ], {}, async v => {
    const pr = S.datos.productos.find(p => p.id === v.producto_id);
    await db.insertar('lead_intereses', { lead_id: d.id, producto_id: pr?.id || null, tecnologia: pr?.tecnologia || v.tecnologia || null,
      tamano: pr?.tamano || v.tamano || null, gama: pr?.gama || v.gama || null, nota: v.nota });
    toast('Configuración agregada'); await bus.refrescar();
  }),
  'interes-descartar': async d => {
    try { await db.actualizar('lead_intereses', 'id', d.id, { estado: 'Descartado' }); await bus.refrescar(); }
    catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'interes-cotizar': d => {
    const i = (S.datos.lead_intereses || []).find(x => x.id === d.id), l = i && lead(i.lead_id); if (!l) return;
    S.Q2 = { ...S.Q2, tecnologia: i.tecnologia || '', tamano: i.tamano || '', gama: i.gama || '', addons: [], lead: l.id, cliente: l.nombre, idem: null };
    bus.ir('cotizador');
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
    S.Q2 = { ...S.Q2, lead: l.id, cliente: l.nombre, tecnologia: l.tecnologia_interes || S.Q2.tecnologia, tamano: l.tamano_interes || S.Q2.tamano,
      gama: E.GAMAS_2.includes(l.gama) ? l.gama : S.Q2.gama, addons: [], idem: null };
    bus.ir('cotizador');
  },
  'q2-set': d => {
    if (!['tecnologia', 'tamano', 'gama'].includes(d.k)) return;
    S.Q2[d.k] = d.v; S.Q2.idem = null; bus.render();
  },
  'cot-guardar': async () => {
    const Q = S.Q2, pr = productoQ(Q);
    const cliente = (Q.cliente || '').trim() || (lead(Q.lead)?.nombre ?? '');
    if (!pr) { toast('Completá tecnología, tamaño y gama', 'warn'); return; }
    if (!cliente) { toast('Indicá el cliente o vinculá un lead', 'warn'); return; }
    const previa = E.cotizarV2({ producto: pr.codigo, addons: Q.addons }, S.datos);
    if (!previa?.definitivo) { toast('No se puede emitir: ' + (previa?.observacion || 'configuración incompleta'), 'warn'); return; }
    Q.idem = Q.idem || db.nuevaClave();                     // un reintento no duplica la cotización
    try {
      const id = await db.rpc.crearCotizacionV2({ cliente: cliente.slice(0, 80), producto: pr.codigo, addons: Q.addons, lead: Q.lead || null, vigencia: Q.vigencia, idem: Q.idem });
      await bus.refrescar();
      const c = S.datos.cotizaciones.find(x => x.id === id);
      if (c && Math.abs(Number(c.pvp) - previa.pvp) > 1) toast(`Guardada. El catálogo cambió: el servidor calculó ${usd(c.pvp)}.`, 'warn');
      else toast(pr.gama === 'Signature' ? 'Cotización guardada: pendiente de validación Signature' : 'Cotización guardada');
      S.Q2 = { ...S.Q2, addons: [], cliente: '', lead: '', idem: null };
      bus.ir('cotizaciones');
    } catch (e) { toast(db.mensajeError(e), 'bad'); }
  },
  'cot-validar': d => formulario('Validación técnica y comercial (Signature)', [
    { k: 'decision', l: 'Decisión', t: 'select', opts: [['1', 'Aprobar la cotización'], ['0', 'Rechazarla']] },
    { k: 'nota', l: 'Nota', t: 'textarea', req: true, max: 300, ancho: true }
  ], { decision: '1' }, async v => {
    await db.rpc.validarCotizacion(d.id, v.decision === '1', v.nota); toast(v.decision === '1' ? 'Cotización validada' : 'Cotización rechazada'); await bus.refrescar();
  }, 'Registrar'),
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
  'q2-lead': el => {
    S.Q2.lead = el.value;
    const l = lead(el.value);
    if (l && !S.Q2.cliente) S.Q2.cliente = l.nombre;
    bus.render();
  },
  'q2-cliente': el => { S.Q2.cliente = el.value.slice(0, 80); },
  'q2-vigencia': el => { const v = Math.round(Number(el.value)); S.Q2.vigencia = v >= 1 && v <= 180 ? v : 15; S.Q2.idem = null; bus.render(); },
  'q2-addon': el => {
    const id = el.dataset.id;
    S.Q2.addons = el.checked ? [...new Set([...S.Q2.addons, id])] : S.Q2.addons.filter(x => x !== id);
    S.Q2.idem = null; bus.render();
  }
};
