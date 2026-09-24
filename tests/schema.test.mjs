// Ejecuta supabase/schema.sql sobre PostgreSQL real (PGlite) y verifica
// que las reglas de negocio y de seguridad se cumplan del lado del servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SOCIO_A = '11111111-1111-1111-1111-111111111111';
const SOCIO_B = '22222222-2222-2222-2222-222222222222';
const INTRUSO = '33333333-3333-3333-3333-333333333333';

// Réplica mínima de lo que Supabase ya trae: esquema auth, auth.uid() y roles.
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create publication supabase_realtime;
`;

let db;
async function como(uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
async function falla(p, patron) {
  await assert.rejects(p, e => { if (patron) assert.match(e.message, patron); return true; });
}

test('schema.sql se instala sin errores', async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${SOCIO_A}'),('${SOCIO_B}'),('${INTRUSO}');
                 insert into public.socios values ('${SOCIO_A}','Socio Arquitecto','A'),('${SOCIO_B}','Socio Negocios','B');`);
});

test('usuario anónimo no ve ni escribe nada', async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role anon;`);
  await falla(db.query('select * from public.leads'), /permission denied/);
  await falla(db.query(`insert into public.leads(nombre, origen) values ('spam','Meta Ads')`), /permission denied/);
  await falla(db.query(`select * from public.calcular_cotizacion('S','Básico','{}')`), /permission denied/);
  await db.exec('reset role;');
});

test('usuario autenticado que NO es socio no ve datos ni puede escribir', async () => {
  await como(INTRUSO, async () => {
    const r = await db.query('select * from public.insumos');
    assert.equal(r.rows.length, 0, 'RLS debe ocultar las filas');
    await falla(db.query(`insert into public.leads(nombre, origen) values ('x','Meta Ads')`), /row-level security/);
    await falla(db.query(`select * from public.calcular_cotizacion('S','Básico','{}')`), /No autorizado/);
  });
});

test('motor de cotización en servidor coincide con el modelo Excel', async () => {
  await como(SOCIO_A, async () => {
    const r = (await db.query(`select * from public.calcular_cotizacion('S','Premium','{}')`)).rows[0];
    assert.equal(Number(r.costo_base).toFixed(2), '8063.43');
    assert.equal(Number(r.pvp).toFixed(2), '22949.75');
    const suma = Number(r.costo_directo) + Number(r.honorarios) + Number(r.marketing) + Number(r.ganancia);
    assert.equal(suma.toFixed(6), Number(r.pvp).toFixed(6), 'PVP = suma de componentes');
    const rep = Number(r.reserva) + Number(r.div_a) + Number(r.div_b) - Number(r.ganancia);
    assert.equal(Math.abs(rep) < 1e-9, true, 'reparto consistente');
    const m = (await db.query(`select * from public.calcular_cotizacion('M','Básico','{}')`)).rows[0];
    assert.equal(Number(m.costo_base).toFixed(2), '13800.96');
  });
});

test('el PVP de una cotización lo fija el servidor, no el navegador', async () => {
  await como(SOCIO_B, async () => {
    await falla(db.query(`insert into public.cotizaciones(cliente,chasis,gama,pvp,costo_directo) values ('x','S','Básico',1,1)`),
                /permission denied/);
    const id = (await db.query(`select public.crear_cotizacion('Cliente Test','S','Premium','{}') id`)).rows[0].id;
    const c = (await db.query(`select pvp from public.cotizaciones where id=$1`, [id])).rows[0];
    assert.equal(Number(c.pvp), 22949.75);
    await falla(db.query(`update public.cotizaciones set pvp = 1 where id=$1`, [id]), /permission denied/);
    await db.query(`update public.cotizaciones set estado='Perdida' where id=$1`, [id]);
  });
});

test('reglas de precio que no suman 100 % son rechazadas', async () => {
  await como(SOCIO_A, async () => {
    await falla(db.query(`update public.params set p_margen = 0.35`), /suma_100/);
    await db.query(`update public.params set p_margen = 0.29, p_hon = 0.10`);
    await db.query(`update public.params set p_margen = 0.30, p_hon = 0.09`);
  });
});

test('validación de datos: longitudes, emails y enumerados', async () => {
  await como(SOCIO_B, async () => {
    await falla(db.query(`insert into public.leads(nombre, origen, email) values ('Ana','Meta Ads','no-es-email')`), /leads_email_check/);
    await falla(db.query(`insert into public.leads(nombre, origen) values ('Ana','Hackeo')`), /leads_origen_check/);
    await falla(db.query(`insert into public.leads(nombre, origen) values ($1,'Meta Ads')`, ['x'.repeat(200)]), /leads_nombre_check/);
    await falla(db.query(`insert into public.leads(nombre, origen, telefono) values ('Ana','Meta Ads','<script>')`), /leads_telefono_check/);
    await falla(db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo) values ('x; drop','Hierro','ok','m',1)`), /insumos_codigo_check/);
  });
});

test('inyección SQL por parámetro se almacena como texto inerte', async () => {
  await como(SOCIO_B, async () => {
    const malicioso = "Robert'); drop table public.leads; --";
    await db.query(`insert into public.leads(nombre, origen) values ($1,'Referido')`, [malicioso]);
    const r = await db.query(`select nombre from public.leads where nombre = $1`, [malicioso]);
    assert.equal(r.rows[0].nombre, malicioso);
    assert.equal((await db.query(`select count(*)::int n from public.leads`)).rows[0].n >= 1, true);
  });
});

test('gastos > USD 500: cada socio firma solo lo suyo y el autor lo fija el servidor', async () => {
  let id;
  await como(SOCIO_B, async () => {
    id = (await db.query(`insert into public.gastos(concepto,categoria,monto,solicitado_por,aprob_a,aprob_b)
                          values ('Soldadora nueva','Herramientas',1200,'${SOCIO_A}',true,true) returning *`)).rows[0];
    assert.equal(id.solicitado_por, SOCIO_B, 'el servidor ignora el autor enviado');
    assert.equal(id.aprob_a, false); assert.equal(id.aprob_b, false);
    assert.equal(id.estado, 'Pendiente');
    await falla(db.query(`update public.gastos set aprob_a = true where id=$1`, [id.id]), /Solo el Socio A/);
    await falla(db.query(`update public.gastos set estado = 'Aprobado' where id=$1`, [id.id]), /ambos socios/);
    await db.query(`update public.gastos set aprob_b = true where id=$1`, [id.id]);
  });
  await como(SOCIO_A, async () => {
    await db.query(`update public.gastos set aprob_a = true where id=$1`, [id.id]);
    const g = (await db.query(`select estado from public.gastos where id=$1`, [id.id])).rows[0];
    assert.equal(g.estado, 'Aprobado');
    await db.query(`update public.gastos set monto = 1500 where id=$1`, [id.id]);
    const g2 = (await db.query(`select aprob_a, aprob_b, estado from public.gastos where id=$1`, [id.id])).rows[0];
    assert.deepEqual([g2.aprob_a, g2.aprob_b, g2.estado], [false, false, 'Pendiente'], 'cambiar el monto invalida las firmas');
  });
});

test('gasto ejecutado sin aprobación se imputa al socio que lo hizo', async () => {
  await como(SOCIO_A, async () => {
    const g = (await db.query(`insert into public.gastos(concepto,categoria,monto) values ('Compra no autorizada','Otros',800) returning id`)).rows[0];
    await db.query(`update public.gastos set estado='Ejecutado' where id=$1`, [g.id]);
    const v = (await db.query(`select imputado, rol_solicitante from public.v_gastos where id=$1`, [g.id])).rows[0];
    assert.equal(v.imputado, true); assert.equal(v.rol_solicitante, 'A');
    await falla(db.query(`insert into public.gastos(concepto,categoria,monto,urgencia) values ('Urgente','Otros',900,true)`), /urgencia_justificada/);
  });
});

test('venta: reparto y desvío calculados en servidor, consistentes a cero', async () => {
  await como(SOCIO_A, async () => {
    const v = (await db.query(`insert into public.ventas(cliente,chasis,gama,pvp,costo_real) values ('Pérez','S','Premium',26500,13980) returning id`)).rows[0];
    const r = (await db.query(`select * from public.v_ventas where id=$1`, [v.id])).rows[0];
    assert.equal(Number(r.ganancia).toFixed(2), '7750.00');
    assert.equal(Number(r.desvio).toFixed(2), '200.00');
    assert.equal(Math.abs(Number(r.reserva) + Number(r.div_a) + Number(r.div_b) - Number(r.ganancia)) < 1e-9, true);
  });
});

test('cotización → venta usa el PVP del servidor y cierra el lead', async () => {
  await como(SOCIO_B, async () => {
    const lead = (await db.query(`insert into public.leads(nombre,origen,terreno) values ('Lead X','Referido',true) returning id`)).rows[0].id;
    const cid = (await db.query(`select public.crear_cotizacion('Lead X','M','Básico','{}',$1) id`, [lead])).rows[0].id;
    assert.equal((await db.query(`select estado from public.leads where id=$1`, [lead])).rows[0].estado, 'En Cotización');
    const vid = (await db.query(`select public.convertir_cotizacion($1) id`, [cid])).rows[0].id;
    const cot = (await db.query(`select pvp from public.cotizaciones where id=$1`, [cid])).rows[0];
    const ven = (await db.query(`select pvp from public.ventas where id=$1`, [vid])).rows[0];
    assert.equal(Number(ven.pvp), Number(cot.pvp));
    assert.equal((await db.query(`select estado from public.leads where id=$1`, [lead])).rows[0].estado, 'Cerrado');
    await falla(db.query(`select public.convertir_cotizacion($1)`, [cid]), /ya fue convertida/);
  });
});

test('orden de compra recibida suma stock y es irreversible', async () => {
  await como(SOCIO_A, async () => {
    const prov = (await db.query(`insert into public.proveedores(nombre) values ('Hierros SA') returning id`)).rows[0].id;
    const oc = (await db.query(`insert into public.ordenes_compra(proveedor_id) values ($1) returning id`, [prov])).rows[0].id;
    await db.query(`insert into public.oc_items(oc_id,insumo_codigo,cantidad,costo_unit) values ($1,'HIE-001',150,9.8)`, [oc]);
    await db.query(`update public.ordenes_compra set estado='Recibida' where id=$1`, [oc]);
    assert.equal(Number((await db.query(`select stock from public.insumos where codigo='HIE-001'`)).rows[0].stock), 150);
    await falla(db.query(`update public.ordenes_compra set estado='Borrador' where id=$1`, [oc]), /no puede volver/);
    await falla(db.query(`insert into public.oc_items(oc_id,insumo_codigo,cantidad,costo_unit) values ($1,'HIE-002',1,1)`, [oc]), /orden recibida/);
  });
});

test('descontar materiales: falla con stock insuficiente, sin descontar nada', async () => {
  await como(SOCIO_A, async () => {
    const f = (await db.query(`insert into public.fabricacion(chasis,gama) values ('S','Básico') returning id`)).rows[0].id;
    await falla(db.query(`select public.descontar_materiales($1)`, [f]), /Stock insuficiente/);
    assert.equal(Number((await db.query(`select stock from public.insumos where codigo='HIE-001'`)).rows[0].stock), 150,
                 'la operación es atómica');
  });
});

test('horas de taller congelan el costo del operario y alimentan la mano de obra real', async () => {
  await como(SOCIO_A, async () => {
    const op = (await db.query(`insert into public.operarios(nombre,oficio,costo_hora) values ('Juan','Herrero',7) returning id`)).rows[0].id;
    const f = (await db.query(`insert into public.fabricacion(chasis,gama) values ('M','Premium') returning id`)).rows[0].id;
    await db.query(`insert into public.horas(operario_id,fabricacion_id,horas,costo_hora_aplicado) values ($1,$2,8,9999)`, [op, f]);
    const v = (await db.query(`select horas_total, mdo_real from public.v_fabricacion where id=$1`, [f])).rows[0];
    assert.equal(Number(v.mdo_real), 56, 'usa el costo del operario, no el enviado');
    await falla(db.query(`insert into public.horas(operario_id,fabricacion_id,horas) values ($1,$2,20)`, [op, f]), /horas_horas_check/);
  });
});

test('auditoría: la escribe el servidor, el navegador no puede alterarla', async () => {
  await como(SOCIO_A, async () => {
    const n = (await db.query(`select count(*)::int n from public.auditoria`)).rows[0].n;
    assert.equal(n > 0, true);
    await falla(db.query(`delete from public.auditoria`), /permission denied/);
    await falla(db.query(`insert into public.auditoria(tabla,accion) values ('x','y')`), /permission denied/);
    await falla(db.query(`insert into public.socios values ('${INTRUSO}','Colado','A')`), /permission denied/);
  });
});
