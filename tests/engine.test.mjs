import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

const params = { p_costo: .52, p_hon: .09, p_mkt: .09, p_margen: .30, p_reserva: .5, p_div_socio: .5 };
const gamas = [
  { nombre: 'Básico', coef: 1, usd_m2_min: 650, usd_m2_max: 800 },
  { nombre: 'Premium', coef: 1.48, usd_m2_min: 850, usd_m2_max: 1100 },
  { nombre: 'Enterprise', coef: 2.1, usd_m2_min: 1200, usd_m2_max: 1600 }
];
const addons = [{ id: 'd', nombre: 'Deck', costo_s: 1450, costo_m: 2300 }];
const I = (codigo, categoria, costo, merma, cant_s, cant_m, stock = 0) => ({ codigo, categoria, costo, merma, cant_s, cant_m, stock });
const insumos = [
  I('HIE-001','Hierro',9.8,.07,62,118), I('HIE-002','Hierro',5.4,.07,95,180), I('HIE-003','Hierro',12.5,.08,74,136),
  I('CON-001','Consumibles',480,0,1,1.6), I('AIS-001','Aislación',4.2,.1,82,150), I('ABE-001','Aberturas',210,0,2,4),
  I('ABE-002','Aberturas',260,0,1,1), I('TER-001','Terminaciones',5.9,.12,88,162), I('TER-002','Terminaciones',16,.08,18,36),
  I('TER-003','Terminaciones',720,0,1,1), I('TER-004','Terminaciones',640,0,1,1.7),
  I('MDO-001','Mano de Obra',55,0,22,38), I('MDO-002','Mano de Obra',48,0,18,32)
];
const cat = { insumos, gamas, addons, params };

test('costo base coincide con el Excel y con el servidor', () => {
  assert.equal(E.costoBase(insumos, 'S').toFixed(2), '8063.43');
  assert.equal(E.costoBase(insumos, 'M').toFixed(2), '13800.96');
});
test('PVP por división, no por recargo', () => {
  const r = E.cotizar({ chasis: 'S', gama: 'Premium' }, cat);
  assert.equal(r.pvp.toFixed(2), '22949.75');
  assert.equal(r.cierre, 0);
  assert.notEqual(r.pvp.toFixed(2), (r.cd * 1.52).toFixed(2));
});
test('reparto consistente a cero', () => {
  const r = E.cotizar({ chasis: 'M', gama: 'Enterprise', addons: ['d'] }, cat);
  assert.ok(Math.abs(r.reserva + r.divA + r.divB - r.ganancia) < 1e-9);
});
test('venta usa costo real cuando existe', () => {
  const v = E.ventaCalc({ pvp: 26500, costo_real: 13980 }, params);
  assert.equal(v.ganancia.toFixed(2), '7750.00');
  assert.equal(v.desvio.toFixed(2), '200.00');
  assert.equal(E.ventaCalc({ pvp: 26500, costo_real: null }, params).desvio, null);
});
test('score de leads', () => {
  assert.equal(E.scoreLead({ terreno: true, gama: 'Enterprise', estado: 'En Cotización' }), 100);
  assert.equal(E.scoreLead({ terreno: false, gama: 'Indefinido', estado: 'Nuevo' }), 10);
});
test('params que no suman 100 % se detectan', () => {
  assert.equal(E.paramsCierran(params), true);
  assert.equal(E.paramsCierran({ ...params, p_margen: .35 }), false);
});
test('stock bajo contra punto de reorden de 1 chasis M', () => {
  assert.equal(E.stockBajo(I('X','Hierro',1,.07,1,100,50)), true);
  assert.equal(E.stockBajo(I('X','Hierro',1,.07,1,100,200)), false);
  assert.equal(E.stockBajo(I('X','Mano de Obra',1,0,1,100,0)), false);
});
test('alerta de variación de BOM mayor al 10 %', () => {
  const s = E.costoBase(insumos, 'S'), m = E.costoBase(insumos, 'M');
  assert.equal(E.variacionBom(insumos, { costo_s: s, costo_m: m }).supera, false);
  assert.equal(E.variacionBom(insumos, { costo_s: s / 1.2, costo_m: m }).supera, true);
});
test('débitos por gastos imputados', () => {
  const d = E.debitosPorRol([{ imputado: true, rol_solicitante: 'A', monto: 800 }, { imputado: false, rol_solicitante: 'B', monto: 900 }]);
  assert.deepEqual(d, { A: 800, B: 0 });
});
