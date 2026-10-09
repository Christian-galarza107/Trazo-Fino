// Trazo Fino 2.0 · Migración y backend sobre PostgreSQL real (PGlite).
// 1) Instala el esquema 1.0 y carga datos históricos (chasis 18/36, Enterprise).
// 2) Aplica las migraciones 2.0 y verifica que no se perdió ni cambió nada.
// 3) Ejercita el flujo 2.0 completo y las reglas de seguridad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNueva, aplicarMigraciones, como as comoEn, falla as fallaEn, normalizar, leerMigracion, MIGRACIONES, leerSql } from './_base.mjs';
import * as E from '../js/engine.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const INTRUSO = '33333333-3333-3333-3333-333333333333';
let db;
const como = (uid, fn) => comoEn(db, uid, fn);
const falla = (p, re) => fallaEn(assert, p, re);
const q1 = async (sql, p) => (await db.query(sql, p)).rows[0];
const filas = async (sql, p) => normalizar(await db.query(sql, p));

// Tablas 1.0 y su clave para comparar antes/después
const TABLAS_1 = { socios: 'user_id', params: 'id', gamas: 'nombre', addons: 'id', proveedores: 'id', insumos: 'codigo',
  bom_referencias: 'id', leads: 'id', interacciones: 'id', cotizaciones: 'id', ventas: 'id', ordenes_compra: 'id',
  oc_items: 'id', gastos: 'id', operarios: 'id', fabricacion: 'id', horas: 'id', auditoria: 'id' };
let antes = {}, claves = {}, columnas1 = {}, vVentasAntes, vFabAntes;
const num = v => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v) : v;
const canon = rows => JSON.stringify(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]))));

test('1.0: esquema base con datos históricos (18/36 m², Enterprise)', async () => {
  db = await baseNueva({ migrar: false });
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${INTRUSO}');
                 insert into public.socios values ('${A}','Sebastián González','A'),('${B}','Christian Galarza','B');`);
  await como(B, async () => {
    const lead = (await q1(`insert into public.leads(nombre,origen,terreno,gama) values ('Cliente Histórico','Referido',true,'Enterprise') returning id`)).id;
    await db.query(`insert into public.interacciones(lead_id,tipo,nota) values ($1,'Llamada','Primer contacto')`, [lead]);
    await db.query(`select public.crear_cotizacion('Cliente S Premium','S','Premium','{}')`);
    const c = (await q1(`select public.crear_cotizacion('Cliente Histórico','M','Enterprise','{}',$1) id`, [lead])).id;
    const v = (await q1(`select public.convertir_cotizacion($1) id`, [c])).id;
    await db.query(`update public.ventas set costo_real = 30000 where id = $1`, [v]);
    await db.query(`insert into public.ventas(cliente,chasis,gama,pvp,costo_real) values ('Pérez','S','Premium',26500,13980)`);
    await db.query(`insert into public.gastos(concepto,categoria,monto) values ('Soldadora','Herramientas',1200)`);
    const prov = (await q1(`insert into public.proveedores(nombre) values ('Hierros SA') returning id`)).id;
    const oc = (await q1(`insert into public.ordenes_compra(proveedor_id) values ($1) returning id`, [prov])).id;
    await db.query(`insert into public.oc_items(oc_id,insumo_codigo,cantidad,costo_unit) values ($1,'HIE-001',150,9.8)`, [oc]);
    await db.query(`update public.ordenes_compra set estado='Recibida' where id=$1`, [oc]);
    const op = (await q1(`insert into public.operarios(nombre,oficio,costo_hora) values ('Juan','Herrero',7) returning id`)).id;
    const f = (await q1(`insert into public.fabricacion(venta_id,chasis,gama) values ($1,'M','Enterprise') returning id`, [v])).id;
    await db.query(`insert into public.horas(operario_id,fabricacion_id,horas) values ($1,$2,8)`, [op, f]);
    await db.query(`select public.registrar_referencia_bom('Referencia 1.0')`);
  });
  for (const [t, k] of Object.entries(TABLAS_1)) {
    columnas1[t] = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows.map(r => r.column_name);
    antes[t] = canon((await db.query(`select ${columnas1[t].join(',')} from public.${t} order by ${k}`)).rows);
    claves[t] = (await db.query(`select ${k}::text k from public.${t}`)).rows.map(r => r.k);
  }
  vVentasAntes = canon((await db.query(`select * from public.v_ventas order by id`)).rows);
  vFabAntes = canon((await db.query(`select * from public.v_fabricacion order by id`)).rows);
});

test('una migración que falla a mitad de camino no deja nada aplicado', async () => {
  const roto = leerMigracion(MIGRACIONES[0]).replace('create table public.boms', 'create table public.boms_ERROR (x int); select 1/0; create table public.boms');
  await falla(db.exec(roto), /division by zero/);
  await db.exec('rollback');
  const r = await q1(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('tipos_cambio','productos','schema_migraciones','boms_error')`);
  assert.equal(r.n, 0, 'la transacción revirtió todo');
});

test('las migraciones 2.0 se aplican en orden y no se pueden repetir', async () => {
  await aplicarMigraciones(db);
  const v = (await db.query(`select version from public.schema_migraciones order by 1`)).rows.map(r => r.version);
  assert.deepEqual(v, ['2026.10.08-01', '2026.10.08-02', '2026.10.08-03', '2026.10.08-04', '2026.10.08-05']);
  await falla(db.exec(leerMigracion(MIGRACIONES[2])), /ya fue aplicada/);
  await db.exec('rollback');
});

test('migración sin pérdida: todas las filas y columnas 1.0 quedan idénticas', async () => {
  for (const [t, k] of Object.entries(TABLAS_1)) {
    if (t === 'auditoria') continue;
    // filas que existían antes (las tablas pueden ganar filas nuevas, por ejemplo la gama Signature)
    const despues = canon((await db.query(`select ${columnas1[t].join(',')} from public.${t} where ${k}::text = any($1) order by ${k}`, [claves[t]])).rows);
    assert.equal(despues, antes[t], `cambió la tabla ${t}`);
  }
  // la auditoría conserva todo lo anterior (solo se le agregan filas)
  const aud = canon((await db.query(`select ${columnas1.auditoria.join(',')} from public.auditoria order by id limit ${JSON.parse(antes.auditoria).length}`)).rows);
  assert.equal(aud, antes.auditoria);
});

test('vistas 1.0: las columnas y los valores históricos no cambian', async () => {
  const n = JSON.parse(vVentasAntes)[0] ? Object.keys(JSON.parse(vVentasAntes)[0]) : [];
  const ahora = canon((await db.query(`select ${n.join(',')} from public.v_ventas order by id`)).rows);
  assert.equal(ahora, vVentasAntes, 'v_ventas conserva valores de ventas 1.0');
  const nf = Object.keys(JSON.parse(vFabAntes)[0]);
  assert.equal(canon((await db.query(`select ${nf.join(',')} from public.v_fabricacion order by id`)).rows), vFabAntes);
});

test('compatibilidad 1.0: motor, cotizaciones Enterprise y gamas históricas', async () => {
  await como(A, async () => {
    const r = await q1(`select * from public.calcular_cotizacion('S','Premium','{}')`);
    assert.equal(Number(r.pvp).toFixed(2), '22949.75');
    const c = await q1(`select chasis, gama, generacion, producto_id from public.cotizaciones where gama='Enterprise'`);
    assert.deepEqual([c.chasis, c.gama, c.generacion, c.producto_id], ['M', 'Enterprise', '1.0', null], 'no se convirtió a Signature ni a 48 m²');
    await falla(db.query(`select * from public.calcular_cotizacion('S','Signature','{}')`), /catálogo 2.0/);
    await falla(db.query(`update public.gamas set nombre='Signature X' where nombre='Enterprise'`), /no se puede cambiar/);
    const g = await q1(`select vigente, generacion from public.gamas where nombre='Enterprise'`);
    assert.deepEqual([g.vigente, g.generacion], [false, '1.0']);
  });
});

test('catálogo 2.0: 12 combinaciones únicas con códigos estables', async () => {
  await como(A, async () => {
    const p = await filas(`select codigo, tecnologia, tamano, gama, superficie_m2, estado_comercial from public.productos order by codigo`);
    assert.equal(p.length, 12);
    for (const x of p) assert.equal(x.superficie_m2, x.tamano === 'S' ? 24 : 48);
    assert.ok(p.filter(x => x.gama === 'Signature').every(x => x.estado_comercial === 'Inactivo'), 'Signature no se publica sola');
    await falla(db.query(`update public.productos set estado_comercial='Activo' where codigo='TF-WOD-M-SIG'`), /signature_bajo_pedido/);
    await falla(db.query(`update public.productos set codigo='TF-WOD-M-XXX' where codigo='TF-WOD-M-SIG'`), /permission denied/);
    await falla(db.query(`insert into public.productos(codigo,tecnologia,tamano,gama,largo_m,ancho_m,superficie_m2,nombre_comercial) values ('TF-WOD-M-BAS','WOOD','M','Básico',12,4,48,'dup')`), /permission denied/);
    await db.query(`update public.productos set estado_comercial='A pedido' where codigo='TF-WOD-M-SIG'`);
  });
});

// ------------------------- materiales y tipos de cambio -------------------------
let tc1, tc2;
test('tipos de cambio manuales y materiales en ARS/USD con conversión del servidor', async () => {
  await como(B, async () => {
    tc1 = (await q1(`insert into public.tipos_cambio(fecha,tipo,valor,fuente) values (current_date,'MEP',1250,'Carga manual de prueba') returning id`)).id;
    await falla(db.query(`update public.tipos_cambio set valor=1 where id=$1`, [tc1]), /permission denied/);
    // material en pesos
    await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original,moneda,tc_id,merma) values ('MAD-001','Madera','Pino estructural 2x6','m',2500,'ARS',$1,0.1)`, [tc1]);
    const m = await q1(`select costo, costo_ars, tc_valor, moneda from public.insumos where codigo='MAD-001'`);
    assert.equal(Number(m.costo), 2);           // 2500 / 1250
    assert.equal(Number(m.costo_ars), 2500);
    // en pesos sin tipo de cambio: rechazado
    await falla(db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original,moneda) values ('MAD-X','Madera','x x','m',10,'ARS')`), /tipo de cambio/);
    // el navegador no puede imponer el costo en USD de un material en pesos
    await db.query(`update public.insumos set costo_ars = 1 where codigo='MAD-001'`);
    assert.equal(Number((await q1(`select costo_ars from public.insumos where codigo='MAD-001'`)).costo_ars), 2500);
    // material sin precio confirmado: queda vacío, nunca cero
    await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad) values ('MAD-002','Madera','OSB 15 mm','m²')`);
    assert.equal((await q1(`select costo from public.insumos where codigo='MAD-002'`)).costo, null);
    await falla(db.query(`update public.insumos set cant_s = 1 where codigo='MAD-002'`), /pendiente_fuera_de_computo_1_0/);
    // resto de materiales Wood M en USD
    await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original,moneda,merma) values
      ('MAD-003','Revestimientos','Siding cementicio','m²',18,'USD',0.08),
      ('TER-101','Terminaciones','Porcelanato premium 60x60','m²',32,'USD',0.1),
      ('TER-102','Terminaciones','Piso vinílico económico','m²',12,'USD',0.08),
      ('MDO-101','Mano de Obra','Jornal carpintero','jornal',60,'USD',0)`);
  });
});

test('historial de precios con motivo; la cotización ARS del TC no se reescribe', async () => {
  await como(A, async () => {
    tc2 = (await q1(`insert into public.tipos_cambio(fecha,tipo,valor,fuente) values (current_date,'MEP',1500,'Carga manual 2') returning id`)).id;
    await falla(db.query(`select public.actualizar_precio_material('TER-101', 34, 'USD', null, '')`), /motivo/);
    await db.query(`select public.actualizar_precio_material('TER-101', 34, 'USD', $1, 'Aumento del proveedor')`, [tc2]);
    const h = await filas(`select costo_usd_ant, costo_usd_nuevo, motivo from public.precios_historial where insumo_codigo='TER-101' order by id`);
    assert.equal(h.length, 2);
    assert.deepEqual([h[1].costo_usd_ant, h[1].costo_usd_nuevo, h[1].motivo], [32, 34, 'Aumento del proveedor']);
    await falla(db.query(`delete from public.precios_historial`), /permission denied/);
    // el material en pesos conserva su tipo de cambio original hasta que se lo cambie explícitamente
    assert.equal(Number((await q1(`select costo from public.insumos where codigo='MAD-001'`)).costo), 2);
  });
});

// ------------------------------------- BOM -------------------------------------
let bomPrm, bomBas, bomIst;
test('BOM: importación del presupuesto (Wood M Premium), flujo de aprobación y bloqueo', async () => {
  await como(A, async () => {
    bomPrm = (await q1(`select public.bom_crear('TF-WOD-M-PRM','Presupuesto de Sebastián') id`)).id;
    const r = (await q1(`select public.bom_importar($1, $2::jsonb, $3) r`, [bomPrm, JSON.stringify([
      { codigo: 'MAD-001', cantidad: 420, precio: 9999 },
      { codigo: 'MAD-003', cantidad: 110 },
      { codigo: 'TER-101', cantidad: 48, pendiente_sustitucion: true },
      { codigo: 'MDO-101', cantidad: 45 },
      { descripcion: 'Tornillería estructural', categoria: 'Herrajes y fijaciones', unidad: 'kit', cantidad: 1, precio: 350000, moneda: 'ARS' }
    ]), tc1])).r;
    assert.equal(r.creados, 1); assert.equal(r.reutilizados, 4);
    assert.ok(r.avisos.some(a => /MAD-001.*no se cambió el catálogo/.test(a)), 'avisa diferencia de precio sin pisar el catálogo');
    assert.ok((await q1(`select 1 x from public.insumos where codigo='MAT-0001'`)), 'código automático');
    // no se puede aprobar con materiales pendientes de sustitución
    await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bomPrm]);
    await falla(db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bomPrm]), /pendientes de sustitución/);
    await db.query(`select public.bom_cambiar_estado($1,'Borrador')`, [bomPrm]);
    await db.query(`update public.bom_items set pendiente_sustitucion=false where bom_id=$1`, [bomPrm]);
    // con un material sin precio, tampoco
    await db.query(`insert into public.bom_items(bom_id,insumo_codigo,cantidad) values ($1,'MAD-002',30)`, [bomPrm]);
    await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bomPrm]);
    await falla(db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bomPrm]), /sin precio confirmado/);
    await db.query(`select public.bom_cambiar_estado($1,'Borrador')`, [bomPrm]);
    await db.query(`delete from public.bom_items where bom_id=$1 and insumo_codigo='MAD-002'`, [bomPrm]);
    await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bomPrm]);
    await db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bomPrm]);
    const b = await q1(`select estado, vigente from public.boms where id=$1`, [bomPrm]);
    assert.deepEqual([b.estado, b.vigente], ['Aprobado', true]);
    // un BOM aprobado no se modifica ni se borra
    await falla(db.query(`update public.bom_items set cantidad=1 where bom_id=$1`, [bomPrm]), /duplicalo/);
    await falla(db.query(`delete from public.boms where id=$1`, [bomPrm]), /Solo se puede borrar/);
    await falla(db.query(`update public.boms set estado='Borrador' where id=$1`, [bomPrm]), /permission denied/);
  });
});

test('BOM: duplicar Premium como base de Básico no comparte registros', async () => {
  await como(A, async () => {
    bomBas = (await q1(`select public.bom_duplicar($1,'TF-WOD-M-BAS','Base para Wood M Básico') id`, [bomPrm])).id;
    await db.query(`update public.bom_items set cantidad = cantidad + 1 where bom_id=$1 and insumo_codigo='MAD-003'`, [bomBas]);
    const [p, b] = [await q1(`select cantidad from public.bom_items where bom_id=$1 and insumo_codigo='MAD-003'`, [bomPrm]),
                    await q1(`select cantidad from public.bom_items where bom_id=$1 and insumo_codigo='MAD-003'`, [bomBas])];
    assert.equal(Number(p.cantidad), 110); assert.equal(Number(b.cantidad), 111);
    assert.equal((await q1(`select origen_id from public.boms where id=$1`, [bomBas])).origen_id, bomPrm);
  });
});

test('optimizador: proponer, aprobar y aplicar una sustitución a un borrador', async () => {
  await como(B, async () => {
    await falla(db.query(`insert into public.sustituciones(bom_id,insumo_original,insumo_alternativa,motivo,estado) values ($1,'TER-101','TER-102','x x x','Aplicada')`, [bomBas]), /permission denied/);
    const s = (await q1(`insert into public.sustituciones(bom_id,insumo_original,insumo_alternativa,motivo) values ($1,'TER-101','TER-102','Piso económico para Básico') returning id, estado`, [bomBas]));
    assert.equal(s.estado, 'Propuesta', 'el estado lo fija el servidor');
    await falla(db.query(`select public.sustitucion_aplicar($1)`, [s.id]), /aprobada/);
    await db.query(`select public.sustitucion_decidir($1, true, 'Validado técnicamente')`, [s.id]);
    await falla(db.query(`delete from public.sustituciones where id=$1`, [s.id]), /historial/);
    await db.query(`select public.sustitucion_aplicar($1)`, [s.id]);
    const it = await filas(`select insumo_codigo, cantidad from public.bom_items where bom_id=$1 order by insumo_codigo`, [bomBas]);
    assert.ok(!it.some(x => x.insumo_codigo === 'TER-101') && it.some(x => x.insumo_codigo === 'TER-102' && x.cantidad === 48));
    assert.equal((await q1(`select estado from public.sustituciones where id=$1`, [s.id])).estado, 'Aplicada');
    // el BOM Premium aprobado no cambió
    assert.ok((await q1(`select 1 x from public.bom_items where bom_id=$1 and insumo_codigo='TER-101'`, [bomPrm])));
    await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bomBas]);
    await db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bomBas]);
  });
});

// --------------------------------- cotización 2.0 ---------------------------------
async function datosApp() {
  const Q = sql => filas(sql);
  return { params: (await Q(`select * from public.params`))[0], addons: await Q(`select * from public.addons`),
    insumos: await Q(`select * from public.insumos`), productos: await Q(`select * from public.productos`),
    addon_costos: await Q(`select * from public.addon_costos`), boms: await Q(`select * from public.boms`),
    bom_items: await Q(`select * from public.bom_items`), presupuestos: await Q(`select * from public.presupuestos`),
    presupuesto_items: await Q(`select * from public.presupuesto_items`) };
}

test('sin aprobación técnica del producto no hay cotización definitiva', async () => {
  await como(B, async () => {
    const r = await q1(`select * from public.calcular_cotizacion_v2('TF-WOD-M-PRM')`);
    assert.equal(r.definitivo, false); assert.match(r.observacion, /aprobación técnica/);
    await falla(db.query(`select public.crear_cotizacion_v2('Ana','TF-WOD-M-PRM')`), /definitiva/);
    await falla(db.query(`select public.crear_cotizacion_v2('Ana','TF-IST-S-BAS')`), /Sin BOM aprobado/);
    await db.query(`update public.productos set aprobacion_tecnica='Aprobado' where codigo in ('TF-WOD-M-PRM','TF-WOD-M-BAS','TF-WOD-M-SIG')`);
  });
});

test('motor 2.0: servidor y navegador coinciden; PVP por división, reparto a cero', async () => {
  await como(B, async () => {
    const deck = (await q1(`select id from public.addons where nombre='Deck exterior'`)).id;
    await db.query(`update public.addon_costos set costo=3100, disponible=true where addon_id=$1 and tecnologia='WOOD' and tamano='M'`, [deck]);
    for (const [cod, ad] of [['TF-WOD-M-PRM', []], ['TF-WOD-M-BAS', [deck]]]) {
      const s = await q1(`select * from public.calcular_cotizacion_v2($1,$2)`, [cod, ad]);
      const j = E.cotizarV2({ producto: cod, addons: ad }, await datosApp());
      for (const [ks, kj] of [['costo_materiales', 'materiales'], ['costo_mdo', 'mdo'], ['costo_addons', 'costoAddons'], ['costo_directo', 'cd'],
        ['pvp', 'pvp'], ['honorarios', 'hon'], ['marketing', 'mkt'], ['ganancia', 'ganancia'], ['reserva', 'reserva'], ['div_a', 'divA'], ['div_b', 'divB'], ['pvp_m2', 'pvpM2']])
        assert.ok(Math.abs(Number(s[ks]) - j[kj]) < 0.01, `${cod} ${ks}: servidor ${s[ks]} vs navegador ${j[kj]}`);
      assert.equal(s.definitivo, j.definitivo); assert.equal(s.observacion, j.observacion);
      const cd = Number(s.costo_directo), pvp = Number(s.pvp);
      assert.ok(Math.abs(pvp - cd / 0.52) < 1e-6, 'PVP = CD / p_costo');
      assert.ok(Math.abs(cd + Number(s.honorarios) + Number(s.marketing) + Number(s.ganancia) - pvp) < 1e-6);
      assert.ok(Math.abs(Number(s.reserva) + Number(s.div_a) + Number(s.div_b) - Number(s.ganancia)) < 1e-9);
    }
    const p = await q1(`select costo_directo from public.calcular_cotizacion_v2('TF-WOD-M-PRM')`), b = await q1(`select costo_directo from public.calcular_cotizacion_v2('TF-WOD-M-BAS')`);
    assert.ok(Number(b.costo_directo) < Number(p.costo_directo), 'el BOM Básico difiere del Premium');
    // adicional incompatible con Iron Steel
    await falla(db.query(`select * from public.calcular_cotizacion_v2('TF-IST-M-BAS',$1)`, [[deck]]), /no está disponible/);
  });
});

let cotPrm, cotSig, lead2;
test('cotización 2.0: instantánea completa e inalterable ante cambios del catálogo', async () => {
  await como(B, async () => {
    lead2 = (await q1(`insert into public.leads(nombre,origen,tecnologia_interes,tamano_interes,gama) values ('Lucía','Instagram orgánico','WOOD','M','Premium') returning id`)).id;
    const idem = '44444444-4444-4444-4444-444444444444';
    cotPrm = (await q1(`select public.crear_cotizacion_v2('Lucía','TF-WOD-M-PRM','{}',$1,null,15,$2) id`, [lead2, idem])).id;
    const again = (await q1(`select public.crear_cotizacion_v2('Lucía','TF-WOD-M-PRM','{}',$1,null,15,$2) id`, [lead2, idem])).id;
    assert.equal(again, cotPrm, 'un reintento no duplica');
    const c = await q1(`select * from public.cotizaciones where id=$1`, [cotPrm]);
    assert.equal(c.generacion, '2.0'); assert.equal(c.producto_codigo, 'TF-WOD-M-PRM'); assert.equal(Number(c.superficie_m2), 48);
    assert.equal(c.aprobacion, 'Aprobada'); assert.ok(c.items_snapshot.length >= 5); assert.equal(Number(c.params_snapshot.p_costo), 0.52);
    const pvp = Number(c.pvp);
    await db.query(`select public.actualizar_precio_material('MAD-003', 25, 'USD', null, 'Suba del siding')`);
    assert.equal(Number((await q1(`select pvp from public.cotizaciones where id=$1`, [cotPrm])).pvp), pvp, 'la cotización conserva su precio');
    await falla(db.query(`update public.cotizaciones set pvp=1 where id=$1`, [cotPrm]), /permission denied/);
    assert.equal((await q1(`select estado from public.leads where id=$1`, [lead2])).estado, 'En Cotización');
  });
});

test('Signature: solo a pedido y con validación antes de convertirse en venta', async () => {
  await como(A, async () => {
    const bs = (await q1(`select public.bom_duplicar($1,'TF-WOD-M-SIG') id`, [bomPrm])).id;
    await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bs]);
    await db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bs]);
    await db.query(`update public.productos set estado_comercial='Inactivo' where codigo='TF-WOD-M-SIG'`);
    await falla(db.query(`select public.crear_cotizacion_v2('VIP','TF-WOD-M-SIG')`), /inactivo/);
    await db.query(`update public.productos set estado_comercial='A pedido' where codigo='TF-WOD-M-SIG'`);
    cotSig = (await q1(`select public.crear_cotizacion_v2('VIP','TF-WOD-M-SIG') id`)).id;
    assert.equal((await q1(`select aprobacion from public.cotizaciones where id=$1`, [cotSig])).aprobacion, 'Pendiente de validación');
    await falla(db.query(`select public.convertir_cotizacion($1)`, [cotSig]), /validación Signature/);
    await db.query(`select public.validar_cotizacion($1, true, 'Diseño validado')`, [cotSig]);
    await db.query(`select public.convertir_cotizacion($1)`, [cotSig]);
  });
});

// --------------------------------- presupuestos ---------------------------------
let pres;
test('presupuesto por proyecto: copia del BOM, opción A (solo proyecto) y B (catálogo)', async () => {
  await como(B, async () => {
    pres = (await q1(`select public.presupuesto_crear('TF-WOD-M-BAS','Lucía',$1,$2) id`, [lead2, tc2])).id;
    const nBom = (await q1(`select count(*)::int n from public.bom_items where bom_id=$1`, [bomBas])).n;
    assert.equal((await q1(`select count(*)::int n from public.presupuesto_items where presupuesto_id=$1`, [pres])).n, nBom);
    // el ítem en pesos se convierte con el tipo de cambio del presupuesto (1500), no con el del catálogo (1250)
    assert.equal(Number((await q1(`select costo_unit_usd from public.presupuesto_items where presupuesto_id=$1 and insumo_codigo='MAD-001'`, [pres])).costo_unit_usd), Number((2500 / 1500).toFixed(6)));
    const nCat = (await q1(`select count(*)::int n from public.insumos`)).n;
    // Opción A
    const a = (await q1(`select public.presupuesto_agregar_material($1,'proyecto',null,'Pérgola a medida','Otros','global',1,0,1800,'USD','Pedido del cliente') r`, [pres])).r;
    assert.equal(a.insumo_codigo, null);
    assert.equal((await q1(`select count(*)::int n from public.insumos`)).n, nCat, 'A no toca el catálogo');
    assert.equal((await q1(`select count(*)::int n from public.bom_items where bom_id=$1`, [bomBas])).n, nBom, 'A no toca el BOM');
    // Opción B, con reintento idempotente
    const idem = '55555555-5555-5555-5555-555555555555';
    const b1 = (await q1(`select public.presupuesto_agregar_material($1,'catalogo','EQP-001','Termotanque solar 200 l','Equipamiento','un',1,0,950000,'ARS','Lo pidió el cliente',null,false,$2) r`, [pres, idem])).r;
    const b2 = (await q1(`select public.presupuesto_agregar_material($1,'catalogo','EQP-001','Termotanque solar 200 l','Equipamiento','un',1,0,950000,'ARS','Lo pidió el cliente',null,false,$2) r`, [pres, idem])).r;
    assert.equal(b1.creado_en_catalogo, true); assert.equal(b2.repetido, true);
    assert.equal((await q1(`select count(*)::int n from public.presupuesto_items where presupuesto_id=$1 and insumo_codigo='EQP-001'`, [pres])).n, 1);
    assert.equal((await q1(`select count(*)::int n from public.bom_items where insumo_codigo='EQP-001'`)).n, 0, 'disponible en catálogo, sin entrar a ningún BOM');
    // duplicados: por código y por descripción
    await falla(db.query(`select public.presupuesto_agregar_material($1,'catalogo','EQP-001','Otro','Equipamiento','un',1,0,1,'USD','motivo')`, [pres]), /reutilizalo/);
    await falla(db.query(`select public.presupuesto_agregar_material($1,'catalogo','EQP-999','termotanque SOLAR 200 l','Equipamiento','un',1,0,1,'USD','motivo')`, [pres]), /EQP-001/);
    const re = (await q1(`select public.presupuesto_agregar_material($1,'catalogo','EQP-999','termotanque SOLAR 200 l','Equipamiento','un',2,0,null,'USD','Segundo equipo',null,true) r`, [pres])).r;
    assert.equal(re.reutilizado, true); assert.equal(re.insumo_codigo, 'EQP-001');
  });
});

test('Opción B es atómica: si falla el ítem, no queda el material en el catálogo', async () => {
  await como(B, async () => {
    await falla(db.query(`select public.presupuesto_agregar_material($1,'catalogo','EQP-777','Bomba presurizadora','Equipamiento','un',-5,0,100,'USD','motivo válido')`, [pres]), /Cantidad/);
    await falla(db.query(`select public.presupuesto_agregar_material($1,'catalogo','EQP-778','Bomba presurizadora','Categoria inventada','un',1,0,100,'USD','motivo válido')`, [pres]), /categoria/);
    assert.equal((await q1(`select count(*)::int n from public.insumos where codigo in ('EQP-777','EQP-778')`)).n, 0);
  });
});

test('presupuesto emitido: genera la cotización y queda congelado; revisiones numeradas', async () => {
  await como(B, async () => {
    await db.query(`update public.presupuestos set descuento=500, descuento_motivo='Cliente referido' where id=$1`, [pres]);
    const cid = (await q1(`select public.crear_cotizacion_v2('Lucía','TF-WOD-M-BAS','{}',$2,$1) id`, [pres, lead2])).id;
    const c = await q1(`select pvp, pvp_final, descuento, presupuesto_id, tc_valor from public.cotizaciones where id=$1`, [cid]);
    assert.equal(Number(c.pvp_final), Number(c.pvp) - 500); assert.equal(Number(c.tc_valor), 1500);
    await falla(db.query(`update public.presupuesto_items set cantidad=99 where presupuesto_id=$1`, [pres]), /emitido/);
    await falla(db.query(`select public.crear_cotizacion_v2('Lucía','TF-WOD-M-BAS','{}',null,$1)`, [pres]), /ya fue emitido/);
    const r2 = (await q1(`select public.presupuesto_nueva_revision($1) id`, [pres])).id;
    const p2 = await q1(`select revision, estado from public.presupuestos where id=$1`, [r2]);
    assert.deepEqual([p2.revision, p2.estado], [2, 'Borrador']);
    await db.query(`update public.presupuesto_items set cantidad = cantidad * 2 where presupuesto_id=$1 and origen='Solo proyecto'`, [r2]);
    await db.query(`select public.crear_cotizacion_v2('Lucía','TF-WOD-M-BAS','{}',null,$1)`, [r2]);
    assert.equal((await q1(`select estado from public.presupuestos where id=$1`, [pres])).estado, 'Reemplazado');
    // la venta lleva el precio final y el costo presupuestado de la cotización
    const vid = (await q1(`select public.convertir_cotizacion($1) id`, [cid])).id;
    const v = await q1(`select pvp, cd_pres, generacion, tecnologia, superficie_m2 from public.v_ventas where id=$1`, [vid]);
    assert.equal(Number(v.pvp), Number(c.pvp_final)); assert.equal(v.generacion, '2.0'); assert.equal(Number(v.superficie_m2), 48);
  });
});

// --------------------------------- producción ---------------------------------
test('fabricación 2.0: descuenta solo el BOM aprobado (nada de Iron Steel) y una sola vez', async () => {
  await como(A, async () => {
    const venta = await q1(`select public.convertir_cotizacion($1) id`, [cotPrm]);
    const f = await q1(`insert into public.fabricacion(venta_id,chasis,gama,costo_mat_pres) values ($1,'S','Básico',1) returning *`, [venta.id]);
    assert.equal(f.generacion, '2.0'); assert.equal(f.chasis, 'M'); assert.equal(f.gama, 'Premium', 'tamaño y gama salen del producto');
    assert.notEqual(Number(f.costo_mat_pres), 1, 'el costo presupuestado lo fija el servidor');
    await falla(db.query(`select public.descontar_materiales($1)`, [f.id]), /Stock insuficiente/);
    const hie = Number((await q1(`select stock from public.insumos where codigo='HIE-001'`)).stock);
    await db.query(`reset role`);
    await db.exec(`update public.insumos set stock = 10000 where categoria <> 'Mano de Obra'`);
    await db.exec(`set role authenticated`);
    await db.query(`select public.descontar_materiales($1)`, [f.id]);       // la función 1.0 deriva a la 2.0
    assert.equal(Number((await q1(`select stock from public.insumos where codigo='HIE-001'`)).stock), 10000, 'no toca materiales de Iron Steel 1.0');
    assert.ok(hie >= 0);
    assert.equal(Number((await q1(`select stock from public.insumos where codigo='MAD-001'`)).stock), 10000 - 420 * 1.1);
    assert.equal(Number((await q1(`select stock from public.insumos where codigo='TER-102'`)).stock), 10000, 'no descuenta lo que no está en el BOM');
    await falla(db.query(`select public.descontar_materiales_v2($1)`, [f.id]), /ya fueron descontados/);
    await falla(db.query(`update public.fabricacion set gama='Básico' where id=$1`, [f.id]), /salen del producto/);
    // orden para stock sin BOM vigente: rechazada
    const pIst = (await q1(`select id from public.productos where codigo='TF-IST-S-BAS'`)).id;
    await falla(db.query(`insert into public.fabricacion(producto_id,chasis,gama) values ($1,'S','Básico')`, [pIst]), /BOM aprobado vigente/);
  });
});

// --------------------------------- seguridad ---------------------------------
const NUEVAS = ['tipos_cambio', 'productos', 'addon_costos', 'boms', 'bom_items', 'sustituciones', 'presupuestos', 'presupuesto_items', 'precios_historial', 'lead_intereses'];

test('seguridad: anónimo sin acceso a tablas, vistas ni funciones 2.0', async () => {
  await como(null, async () => {
    for (const t of [...NUEVAS, 'schema_migraciones', 'v_fabricacion', 'v_ventas'])
      await falla(db.query(`select * from public.${t}`), /permission denied/);
    await falla(db.query(`select * from public.calcular_cotizacion_v2('TF-WOD-M-PRM')`), /permission denied/);
    await falla(db.query(`select public.bom_crear('TF-WOD-M-PRM')`), /permission denied/);
  });
});

test('seguridad: usuario autenticado no socio no ve nada ni puede operar', async () => {
  await como(INTRUSO, async () => {
    for (const t of NUEVAS) assert.equal((await db.query(`select * from public.${t}`)).rows.length, 0, `RLS debe ocultar ${t}`);
    await falla(db.query(`insert into public.tipos_cambio(tipo,valor,fuente) values ('MEP',1,'xx')`), /row-level security/);
    await falla(db.query(`select * from public.calcular_cotizacion_v2('TF-WOD-M-PRM')`), /No autorizado/);
    await falla(db.query(`select public.presupuesto_crear('TF-WOD-M-BAS','x')`), /No autorizado/);
    await falla(db.query(`select * from public.finanzas_desde_costo(100)`), /No autorizado/);
  });
});

test('seguridad: RLS forzada en todas las tablas y anon sin permisos en el esquema', async () => {
  const sinRls = await filas(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not (relrowsecurity and relforcerowsecurity)`);
  assert.deepEqual(sinRls, []);
  const anon = await filas(`select table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
  assert.deepEqual(anon, []);
  const rt = (await filas(`select tablename from pg_publication_tables where pubname='supabase_realtime'`)).map(r => r.tablename);
  for (const t of NUEVAS) assert.ok(rt.includes(t), `realtime: falta ${t}`);
});

test('seguridad: ambos socios operan; columnas calculadas no se escriben desde la web', async () => {
  await como(A, async () => assert.ok((await db.query(`select * from public.presupuestos`)).rows.length > 0));
  await como(B, async () => {
    assert.ok((await db.query(`select * from public.presupuestos`)).rows.length > 0);
    await falla(db.query(`update public.ventas set cd_presupuestado = 1`), /permission denied/);
    await falla(db.query(`insert into public.ventas(cliente,chasis,gama,pvp,cd_presupuestado) values ('x','S','Básico',1,1)`), /permission denied/);
    await falla(db.query(`update public.presupuesto_items set costo_unit_usd = 0`), /permission denied/);
    await falla(db.query(`insert into public.boms(producto_id,version) select id, 99 from public.productos limit 1`), /permission denied/);
  });
});

test('auditoría registra las tablas nuevas', async () => {
  const t = (await filas(`select distinct tabla from public.auditoria`)).map(r => r.tabla);
  for (const x of ['productos', 'boms', 'bom_items', 'presupuestos', 'presupuesto_items', 'tipos_cambio', 'leads']) assert.ok(t.includes(x), 'falta ' + x);
});

test('script de validación posterior: sin fallas', async () => {
  const r = await filas(leerSql('migrations/validar_2_0.sql'));
  const malos = r.filter(x => x.ok === false);
  assert.deepEqual(malos, [], JSON.stringify(malos));
  assert.ok(r.length >= 10);
});
