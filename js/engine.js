// =====================================================================
//  Motor de cálculo · Trazo Fino
//  Funciones puras, sin acceso a la red ni al DOM.
//  El navegador lo usa para la vista previa instantánea; el valor que
//  queda guardado lo calcula siempre el servidor (calcular_cotizacion).
// =====================================================================

// Catálogo 1.0 (histórico): chasis de hierro S = 18 m², M = 36 m². Se conserva para leer los datos 1.0.
export const M2 = Object.freeze({ S: 18, M: 36 });
export const M2_LEGADO = M2;
// Catálogo 2.0: Tecnología × Tamaño × Gama.
export const TECNOLOGIAS = Object.freeze({ WOOD: 'Wood', IRON_STEEL: 'Iron Steel' });
export const TAMANOS = Object.freeze({ S: Object.freeze({ largo: 6, ancho: 4, m2: 24 }), M: Object.freeze({ largo: 12, ancho: 4, m2: 48 }) });
export const GAMAS_2 = Object.freeze(['Básico', 'Premium', 'Signature']);
export const CATEGORIAS = Object.freeze(['Hierro', 'Aislación', 'Aberturas', 'Terminaciones', 'Revestimientos', 'Consumibles', 'Mano de Obra',
  'Madera', 'Estructura', 'Instalación eléctrica', 'Instalación sanitaria', 'Equipamiento', 'Herrajes y fijaciones', 'Pinturas y selladores', 'Otros']);
export const RANGOS_PACTO = Object.freeze({
  p_costo: [0.50, 0.55], p_hon: [0.08, 0.10], p_mkt: [0.07, 0.10], p_margen: [0.25, 0.30]
});
export const UMBRAL_GASTO = 500;
export const UMBRAL_VARIACION_BOM = 0.10;
export const RANGO_COSTO_M2 = Object.freeze([250, 550]);

const n = v => Number(v) || 0;

export const cantidad = (ins, chasis) => n(chasis === 'S' ? ins.cant_s : ins.cant_m);

/** Costo Línea = Costo Unitario × Cantidad × (1 + Merma) */
export const costoLinea = (ins, chasis) => n(ins.costo) * cantidad(ins, chasis) * (1 + n(ins.merma));

export const costoBase = (insumos, chasis) => insumos.reduce((a, i) => a + costoLinea(i, chasis), 0);

export const costoPorCategoria = (insumos, chasis) =>
  CATEGORIAS.map(cat => ({
    cat, total: insumos.filter(i => i.categoria === cat).reduce((a, i) => a + costoLinea(i, chasis), 0)
  }));

export const sumaParams = p => n(p.p_costo) + n(p.p_hon) + n(p.p_mkt) + n(p.p_margen);
export const paramsCierran = p => Math.abs(sumaParams(p) - 1) < 1e-6;

export function reparto(ganancia, p) {
  const reserva = ganancia * n(p.p_reserva);
  const masa = ganancia - reserva;
  const divA = masa * n(p.p_div_socio);
  return { reserva, masa, divA, divB: masa - divA };
}

/** PVP = Costo Directo Total / p_costo  (regla imperativa, cl. 4.1.1 del Documento Marco) */
export function cotizar({ chasis, gama, addons = [] }, { insumos, gamas, addons: catAddons, params }) {
  const g = gamas.find(x => x.nombre === gama) || gamas[0] || { coef: 1, usd_m2_min: 0, usd_m2_max: 0 };
  const m2 = M2[chasis] || 18;
  const base = costoBase(insumos, chasis);
  const cdGama = base * n(g.coef);
  const cdAddons = addons.reduce((a, id) => {
    const ad = catAddons.find(x => x.id === id);
    return ad ? a + n(chasis === 'S' ? ad.costo_s : ad.costo_m) : a;
  }, 0);
  const cd = cdGama + cdAddons;
  const pvp = n(params.p_costo) > 0 ? cd / n(params.p_costo) : 0;
  const hon = pvp * n(params.p_hon);
  const mkt = pvp * n(params.p_mkt);
  const ganancia = pvp * n(params.p_margen);
  const rep = reparto(ganancia, params);
  const pvpM2 = pvp / m2;
  return {
    m2, base, coef: n(g.coef), cdGama, cdAddons, cd, pvp, hon, mkt, ganancia, ...rep, pvpM2,
    cierre: Math.round((cd + hon + mkt + ganancia - pvp) * 100) / 100,
    rangoMin: n(g.usd_m2_min), rangoMax: n(g.usd_m2_max),
    rangoOk: pvpM2 >= n(g.usd_m2_min) && pvpM2 <= n(g.usd_m2_max)
  };
}

/** Réplica de la vista v_ventas: ganancia sobre costo real si existe, si no sobre el presupuestado. */
export function ventaCalc(v, p) {
  const pvp = n(v.pvp);
  const cdPres = pvp * n(p.p_costo);
  const real = v.costo_real === null || v.costo_real === undefined || v.costo_real === '' ? null : n(v.costo_real);
  const cd = real === null ? cdPres : real;
  const hon = pvp * n(p.p_hon);
  const mkt = pvp * n(p.p_mkt);
  const ganancia = pvp - cd - hon - mkt;
  return { cdPres, cd, hon, mkt, ganancia, ...reparto(ganancia, p), desvio: real === null ? null : real - cdPres };
}

/** Score 0–100: terreno +50 · gama Signature (o Enterprise, 1.0) +30 / Premium +20 / otra +10 · En Cotización +20 / Calificado +10 */
export function scoreLead(l) {
  let s = l.terreno ? 50 : 0;
  s += l.gama === 'Signature' || l.gama === 'Enterprise' ? 30 : l.gama === 'Premium' ? 20 : 10;
  s += l.estado === 'En Cotización' ? 20 : l.estado === 'Calificado' ? 10 : 0;
  return s;
}

export const ACTIVO = l => !['Cerrado', 'Perdido'].includes(l.estado);

export function diasDesde(fechaISO, hoyISO) {
  if (!fechaISO) return null;
  return Math.max(0, Math.round((Date.parse(hoyISO) - Date.parse(fechaISO)) / 86400000));
}

export const seguimientoVencido = (l, hoyISO) => ACTIVO(l) && !!l.proximo_contacto && l.proximo_contacto <= hoyISO;

/** Punto de reorden: lo necesario para fabricar 1 Chasis M (con merma). */
export const puntoReorden = ins => n(ins.cant_m) * (1 + n(ins.merma));
export const stockBajo = ins => ins.categoria !== 'Mano de Obra' && puntoReorden(ins) > 0 && n(ins.stock) < puntoReorden(ins);

/** Variación del costo directo contra la última referencia registrada (alerta del 10 %). */
export function variacionBom(insumos, ref) {
  if (!ref) return null;
  const s = costoBase(insumos, 'S'), m = costoBase(insumos, 'M');
  const vs = n(ref.costo_s) ? s / n(ref.costo_s) - 1 : 0;
  const vm = n(ref.costo_m) ? m / n(ref.costo_m) - 1 : 0;
  return { vs, vm, supera: Math.abs(vs) > UMBRAL_VARIACION_BOM || Math.abs(vm) > UMBRAL_VARIACION_BOM };
}

/** Débitos por gastos ejecutados sin aprobación dual ni urgencia (cl. 3.5). */
export function debitosPorRol(gastos) {
  const out = { A: 0, B: 0 };
  for (const g of gastos) if (g.imputado && out[g.rol_solicitante] !== undefined) out[g.rol_solicitante] += n(g.monto);
  return out;
}

/** Costo directo real sugerido: presupuestado − mano de obra presupuestada + mano de obra real. */
export const costoRealSugerido = (pvp, p, mdoPres, mdoReal) => n(pvp) * n(p.p_costo) - n(mdoPres) + n(mdoReal);

// =====================================================================
//  Motor 2.0 · réplica de las funciones del servidor (costo_bom,
//  costo_presupuesto, finanzas_desde_costo, calcular_cotizacion_v2).
//  Solo para vista previa: lo que queda guardado lo calcula el servidor.
// =====================================================================
export const etiquetaTec = t => TECNOLOGIAS[t] || 'Sin definir';
export const sinPrecio = v => v === null || v === undefined || v === '';

/** Suma ítems {cantidad, merma, costo(USD|null), categoria}. Un precio faltante NO suma como cero: se cuenta como pendiente. */
export function costoItems(items) {
  let materiales = 0, mdo = 0, pendientes = 0;
  for (const it of items) {
    if (sinPrecio(it.costo)) { pendientes++; continue; }
    const v = n(it.costo) * n(it.cantidad) * (1 + n(it.merma));
    if (it.categoria === 'Mano de Obra') mdo += v; else materiales += v;
  }
  return { materiales, mdo, total: materiales + mdo, items: items.length, pendientes, completo: items.length > 0 && pendientes === 0 };
}

export function itemsBom(bomId, D) {
  return (D.bom_items || []).filter(x => x.bom_id === bomId).map(x => {
    const i = D.insumos.find(y => y.codigo === x.insumo_codigo) || {};
    return { id: x.id, codigo: x.insumo_codigo, descripcion: i.descripcion || x.insumo_codigo, unidad: i.unidad || '', categoria: i.categoria || '',
      cantidad: x.cantidad, merma: x.merma, costo: sinPrecio(i.costo) ? null : n(i.costo), moneda: i.moneda, costo_original: i.costo_original,
      activo: i.activo !== false, pendiente_sustitucion: !!x.pendiente_sustitucion, nota: x.nota };
  });
}

export function itemsPresupuesto(presId, D) {
  return (D.presupuesto_items || []).filter(x => x.presupuesto_id === presId).map(x => ({
    id: x.id, codigo: x.insumo_codigo, descripcion: x.descripcion, unidad: x.unidad, categoria: x.categoria, cantidad: x.cantidad,
    merma: x.merma, costo: sinPrecio(x.costo_unit_usd) ? null : n(x.costo_unit_usd), moneda: x.moneda, costo_original: x.costo_original,
    origen: x.origen, motivo: x.motivo }));
}

/** Reglas societarias sobre un costo directo: PVP = CD / p_costo. Rechaza costos negativos y reglas que no suman 100 %. */
export function finanzas(cd, p) {
  if (cd === null || cd === undefined || !Number.isFinite(Number(cd)) || Number(cd) < 0) throw new Error('Costo directo inválido');
  if (!paramsCierran(p) || n(p.p_costo) <= 0) throw new Error('Las reglas de precio no suman 100 %');
  const pvp = n(cd) / n(p.p_costo);
  const ganancia = pvp * n(p.p_margen);
  return { cd: n(cd), pvp, hon: pvp * n(p.p_hon), mkt: pvp * n(p.p_mkt), ganancia, ...reparto(ganancia, p) };
}

export const vigenteDe = (productoId, D) => (D.boms || []).find(b => b.producto_id === productoId && b.vigente) || null;

/** Adicionales disponibles para un producto (tecnología, tamaño y gama), con costo definido. */
export function addonsDisponibles(pr, D) {
  if (!pr) return [];
  return (D.addon_costos || []).filter(a => a.tecnologia === pr.tecnologia && a.tamano === pr.tamano && a.disponible &&
    !sinPrecio(a.costo) && (a.gamas || []).includes(pr.gama))
    .map(a => ({ ...a, nombre: D.addons.find(x => x.id === a.addon_id)?.nombre || '—' }));
}

export function costoAddonsV2(pr, ids, D) {
  const disp = addonsDisponibles(pr, D);
  let total = 0, error = null;
  if (new Set(ids).size !== ids.length) error = 'Adicional repetido';
  for (const id of ids) {
    const a = disp.find(x => x.addon_id === id);
    if (!a) error = 'Algún adicional no está disponible, no tiene costo definido o no es compatible con ' + (pr?.codigo || '');
    else total += n(a.costo);
  }
  return { total, error };
}

/** Vista previa de la cotización 2.0. Misma lógica y mismas observaciones que calcular_cotizacion_v2. */
export function cotizarV2({ producto, addons = [], presupuesto = null, bom = null }, D) {
  const pr = (D.productos || []).find(p => p.codigo === producto);
  if (!pr) return null;
  let b = null, items = [], ps = null;
  if (presupuesto) {
    ps = (D.presupuestos || []).find(x => x.id === presupuesto) || null;
    b = ps ? (D.boms || []).find(x => x.id === ps.bom_id) || null : null;
    items = ps ? itemsPresupuesto(ps.id, D) : [];
    addons = ps ? ps.addons || [] : [];
  } else {
    b = bom ? (D.boms || []).find(x => x.id === bom) || null : vigenteDe(pr.id, D);
    items = b ? itemsBom(b.id, D) : [];
  }
  const k = costoItems(items);
  const ad = costoAddonsV2(pr, addons, D);
  const f = finanzas(k.total + ad.total, D.params);
  const obs = [];
  if (pr.estado_comercial === 'Inactivo') obs.push('Producto inactivo');
  if (pr.aprobacion_tecnica !== 'Aprobado') obs.push('Producto sin aprobación técnica');
  if (!b) obs.push('Sin BOM aprobado vigente');
  else if (!(b.estado === 'Aprobado' || (presupuesto && b.estado === 'Obsoleto'))) obs.push(`BOM v${b.version} en estado ${b.estado}`);
  if (k.items === 0) obs.push('Lista de materiales vacía');
  if (k.pendientes > 0) obs.push(`${k.pendientes} material(es) sin precio confirmado`);
  if (ps && ps.estado !== 'Borrador') obs.push('Presupuesto ' + ps.estado.toLowerCase());
  if (ad.error) obs.push(ad.error);
  const m2 = n(pr.superficie_m2);
  return { producto: pr, bom: b, presupuesto: ps, items, ...k, costoAddons: ad.total, ...f, m2, pvpM2: m2 ? f.pvp / m2 : 0,
    definitivo: obs.length === 0, observacion: obs.join(' · '), signature: pr.gama === 'Signature' };
}

/** Optimizador: impacto de reemplazar un material por otro (análisis, no aplica nada). */
export function impactoSustitucion({ cantidad, merma }, costoOrig, costoAlt, mermaAlt, factor, p) {
  if (sinPrecio(costoOrig) || sinPrecio(costoAlt)) return null;
  const orig = n(costoOrig) * n(cantidad) * (1 + n(merma));
  const alt = n(costoAlt) * n(cantidad) * n(factor) * (1 + n(mermaAlt));
  const ahorroTotal = orig - alt;
  return { orig, alt, ahorroUnit: n(costoOrig) - n(costoAlt) * n(factor), ahorroTotal,
    variacion: orig ? alt / orig - 1 : 0, impactoPvp: n(p.p_costo) > 0 ? ahorroTotal / n(p.p_costo) : 0 };
}

/** Necesidades de material de una orden 2.0 todavía no descontada (sin mano de obra). */
export function necesidadesOF(f, D) {
  if (!f.bom_id || f.materiales_descontados) return [];
  return itemsBom(f.bom_id, D).filter(i => i.categoria !== 'Mano de Obra').map(i => {
    const ins = D.insumos.find(x => x.codigo === i.codigo) || {};
    const necesario = n(i.cantidad) * (1 + n(i.merma));
    return { codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, necesario, stock: n(ins.stock), costo: i.costo,
      faltante: Math.max(0, necesario - n(ins.stock)) };
  });
}

/** Stock comprometido por todas las órdenes 2.0 abiertas y faltantes totales por material. */
export function stockComprometido(D) {
  const out = {};
  for (const f of D.fabricacion || []) {
    if (f.estado === 'Terminada') continue;
    for (const x of necesidadesOF(f, D)) {
      const o = out[x.codigo] || (out[x.codigo] = { codigo: x.codigo, descripcion: x.descripcion, unidad: x.unidad, comprometido: 0, stock: x.stock, costo: x.costo, ordenes: 0 });
      o.comprometido += x.necesario; o.ordenes++;
    }
  }
  return Object.values(out).map(o => ({ ...o, faltante: Math.max(0, o.comprometido - o.stock),
    costoFaltante: sinPrecio(o.costo) ? null : Math.max(0, o.comprometido - o.stock) * n(o.costo) }));
}

/** Aumento del costo directo de una cotización 2.0 si se recompra hoy a precios de catálogo. */
export function erosionMargen(c, D) {
  if (c.generacion !== '2.0' || !Array.isArray(c.items_snapshot)) return null;
  let antes = 0, ahora = 0;
  for (const it of c.items_snapshot) {
    const ins = it.codigo ? D.insumos.find(x => x.codigo === it.codigo) : null;
    const base = n(it.cantidad) * (1 + n(it.merma));
    antes += n(it.costo_unit_usd) * base;
    ahora += (ins && !sinPrecio(ins.costo) ? n(ins.costo) : n(it.costo_unit_usd)) * base;
  }
  const aumento = ahora - antes;
  const margen = n(c.ganancia);
  return { antes, ahora, aumento, consumido: margen > 0 ? aumento / margen : 0, alerta: margen > 0 && aumento > margen * UMBRAL_VARIACION_BOM };
}

/** Convierte un importe entre ARS y USD con un tipo de cambio (ARS por USD). */
export function convertir(monto, moneda, tc) {
  if (sinPrecio(monto)) return { usd: null, ars: null };
  const v = n(monto), t = n(tc);
  if (moneda === 'ARS') return { ars: v, usd: t > 0 ? v / t : null };
  return { usd: v, ars: t > 0 ? v * t : null };
}
