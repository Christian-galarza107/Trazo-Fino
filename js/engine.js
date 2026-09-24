// =====================================================================
//  Motor de cálculo · Trazo Fino
//  Funciones puras, sin acceso a la red ni al DOM.
//  El navegador lo usa para la vista previa instantánea; el valor que
//  queda guardado lo calcula siempre el servidor (calcular_cotizacion).
// =====================================================================

export const M2 = Object.freeze({ S: 18, M: 36 });
export const CATEGORIAS = Object.freeze(['Hierro', 'Aislación', 'Aberturas', 'Terminaciones', 'Revestimientos', 'Consumibles', 'Mano de Obra']);
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

/** Score 0–100: terreno +50 · gama Enterprise +30 / Premium +20 / otra +10 · En Cotización +20 / Calificado +10 */
export function scoreLead(l) {
  let s = l.terreno ? 50 : 0;
  s += l.gama === 'Enterprise' ? 30 : l.gama === 'Premium' ? 20 : 10;
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
