// Integración: base real (PGlite) → mismas consultas que cargarTodo() → render de cada vista.
// Verifica que ninguna vista falle con datos reales y que los datos maliciosos salgan escapados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { isSafe } from '../js/html.js';
import { S } from '../js/estado.js';
import * as C from '../js/views-comercial.js';
import * as P from '../js/views-produccion.js';
import * as F from '../js/views-finanzas.js';
import * as I from '../js/views-ingenieria.js';
import * as K from '../js/views-catalogo.js';
import { aplicarMigraciones } from './_base.mjs';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const XSS = [`<script>alert(1)</script>`, `<img src=x onerror=alert(2)>`, `"><svg onload=alert(3)>`, `' onmouseover='alert(4)`, `javascript:alert(5)`];

// PostgREST devuelve numeric como número y fechas como texto ISO: se replica acá.
const NUMERICOS = new Set([1700]);
function normalizar(res) {
  const tipos = Object.fromEntries(res.fields.map(f => [f.name, f.dataTypeID]));
  return res.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (v instanceof Date) return [k, tipos[k] === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()];
    if (NUMERICOS.has(tipos[k]) && v !== null) return [k, Number(v)];
    if (typeof v === 'bigint') return [k, Number(v)];
    return [k, v];
  })));
}

let db;
test('preparar base con datos reales y maliciosos', async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    create publication supabase_realtime;`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await aplicarMigraciones(db);
  await db.exec(`insert into auth.users values ('${A}'),('${B}');
    insert into public.socios values ('${A}','Arq. <b>Martín</b>','A'),('${B}','Christian','B');`);
  await db.exec(`select set_config('request.jwt.claim.sub','${A}',false); set role authenticated;`);
  for (const [i, x] of XSS.entries()) {
    const l = (await db.query(`insert into public.leads(nombre,origen,terreno,estado,gama,ubicacion,notas,proximo_contacto,ult_contacto)
      values ($1,'Referido',$2,'En Cotización','Premium',$1,$1,current_date - 2, current_date - 10) returning id`, [x, i % 2 === 0])).rows[0].id;
    await db.query(`insert into public.interacciones(lead_id,tipo,nota) values ($1,'Llamada',$2)`, [l, x]);
    await db.query(`select public.crear_cotizacion($1,'S','Premium','{}',$2)`, [x.slice(0, 80), l]);
    await db.query(`insert into public.gastos(concepto,categoria,monto,urgencia,justificacion_urgencia) values ($1,'Otros',${600 + i},true,$2)`, [x, 'justificación ' + x]);
  }
  const prov = (await db.query(`insert into public.proveedores(nombre,rubro,contacto) values ($1,$1,$1) returning id`, [XSS[1]])).rows[0].id;
  await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo,cant_s,cant_m,stock,proveedor_id) values ('XSS-1','Hierro',$1,'m',1,1,2,0,$2)`, [XSS[2], prov]);
  const oc = (await db.query(`insert into public.ordenes_compra(proveedor_id,notas) values ($1,$2) returning id`, [prov, XSS[0]])).rows[0].id;
  await db.query(`insert into public.oc_items(oc_id,insumo_codigo,cantidad,costo_unit) values ($1,'HIE-001',10,9.8)`, [oc]);
  const cot = (await db.query(`select id from public.cotizaciones limit 1`)).rows[0].id;
  const venta = (await db.query(`select public.convertir_cotizacion($1) id`, [cot])).rows[0].id;
  await db.query(`update public.ventas set costo_real = 12000 where id=$1`, [venta]);
  await db.query(`insert into public.ventas(cliente,chasis,gama,pvp) values ($1,'M','Básico',28000)`, [XSS[3]]);
  const op = (await db.query(`insert into public.operarios(nombre,oficio,costo_hora) values ($1,'Herrero',7) returning id`, [XSS[4]])).rows[0].id;
  const fab = (await db.query(`insert into public.fabricacion(venta_id,chasis,gama,estado,fecha_inicio,notas) values ($1,'S','Premium','En curso',current_date - 70,$2) returning id`, [venta, XSS[1]])).rows[0].id;
  await db.query(`insert into public.horas(operario_id,fabricacion_id,horas,notas) values ($1,$2,8,$3)`, [op, fab, XSS[0]]);
  await db.query(`select public.registrar_referencia_bom($1)`, [XSS[0]]);
  // ---- datos 2.0 con textos maliciosos ----
  const tc = (await db.query(`insert into public.tipos_cambio(tipo,valor,fuente) values ('MEP',1300,$1) returning id`, [XSS[1]])).rows[0].id;
  await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original,moneda,tc_id,observaciones) values ('MAD-001','Madera',$1,'m',2600,'ARS',$2,$1)`, [XSS[0], tc]);
  await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad) values ('MAD-002','Madera',$1,'m²')`, [XSS[2]]);
  await db.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original) values ('MDO-101','Mano de Obra',$1,'jornal',60)`, [XSS[3]]);
  const bom = (await db.query(`select public.bom_crear('TF-WOD-M-PRM',$1) id`, [XSS[4]])).rows[0].id;
  await db.query(`select public.bom_importar($1,$2::jsonb,$3)`, [bom, JSON.stringify([{ codigo: 'MAD-001', cantidad: 300 }, { codigo: 'MDO-101', cantidad: 40 }, { codigo: 'HIE-001', cantidad: 10 }]), tc]);
  await db.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bom]);
  await db.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bom]);
  await db.query(`update public.productos set aprobacion_tecnica='Aprobado', descripcion=$1 where codigo='TF-WOD-M-PRM'`, [XSS[2]]);
  const borr = (await db.query(`select public.bom_duplicar($1,'TF-WOD-M-BAS',$2) id`, [bom, XSS[1]])).rows[0].id;
  await db.query(`insert into public.bom_items(bom_id,insumo_codigo,cantidad,nota) values ($1,'MAD-002',5,$2)`, [borr, XSS[0]]);
  await db.query(`insert into public.sustituciones(bom_id,insumo_original,insumo_alternativa,motivo,nota_tecnica) values ($1,'HIE-001','HIE-002',$2,$2)`, [borr, XSS[3]]);
  const lead = (await db.query(`select id from public.leads limit 1`)).rows[0].id;
  await db.query(`update public.leads set tecnologia_interes='WOOD', tamano_interes='M', presupuesto_cliente=50000, plazo_estimado='3 a 6 meses'`);
  await db.query(`insert into public.lead_intereses(lead_id,tecnologia,tamano,gama,nota) values ($1,'WOOD','M','Premium',$2)`, [lead, XSS[4]]);
  const pres = (await db.query(`select public.presupuesto_crear('TF-WOD-M-PRM',$1,$2,$3) id`, [XSS[0].slice(0, 80), lead, tc])).rows[0].id;
  await db.query(`select public.presupuesto_agregar_material($1,'proyecto',null,$2,'Otros','un',1,0,100,'USD',$2)`, [pres, XSS[1].slice(0, 100)]);
  const c2 = (await db.query(`select public.crear_cotizacion_v2($1,'TF-WOD-M-PRM','{}',$2) id`, [XSS[2].slice(0, 80), lead])).rows[0].id;
  const v2 = (await db.query(`select public.convertir_cotizacion($1) id`, [c2])).rows[0].id;
  await db.query(`insert into public.fabricacion(venta_id,chasis,gama,notas) values ($1,'M','Premium',$2)`, [v2, XSS[3]]);
  await db.query(`select public.actualizar_precio_material('MDO-101', 66, 'USD', null, $1)`, [XSS[4]]);
  await db.query(`update public.insumos set costo = costo * 1.2 where cant_s > 0 or cant_m > 0`);
});

test('cargar con las mismas consultas que la app', async () => {
  const Q = async sql => normalizar(await db.query(sql));
  S.datos = {
    params: (await Q(`select * from public.params where id = 1`))[0],
    gamas: await Q(`select * from public.gamas order by orden`),
    addons: await Q(`select * from public.addons order by nombre`),
    insumos: await Q(`select * from public.insumos order by codigo`),
    proveedores: await Q(`select * from public.proveedores order by nombre`),
    refs: await Q(`select * from public.bom_referencias order by fecha desc limit 10`),
    leads: await Q(`select * from public.leads order by created_at desc`),
    interacciones: await Q(`select * from public.interacciones order by fecha desc`),
    cotizaciones: await Q(`select * from public.cotizaciones order by numero desc`),
    ventas: await Q(`select * from public.v_ventas order by fecha desc`),
    ocs: await Q(`select * from public.ordenes_compra order by numero desc`),
    ocItems: await Q(`select * from public.oc_items`),
    gastos: await Q(`select * from public.v_gastos order by numero desc`),
    operarios: await Q(`select * from public.operarios order by nombre`),
    fabricacion: await Q(`select * from public.v_fabricacion order by numero desc`),
    horas: await Q(`select * from public.horas order by fecha desc`),
    socios: await Q(`select user_id,nombre,rol from public.socios`),
    productos: await Q(`select * from public.productos order by codigo`),
    addon_costos: await Q(`select * from public.addon_costos`),
    tipos_cambio: await Q(`select * from public.tipos_cambio order by created_at desc`),
    boms: await Q(`select * from public.boms order by version desc`),
    bom_items: await Q(`select * from public.bom_items`),
    sustituciones: await Q(`select * from public.sustituciones`),
    presupuestos: await Q(`select * from public.presupuestos order by numero desc`),
    presupuesto_items: await Q(`select * from public.presupuesto_items`),
    lead_intereses: await Q(`select * from public.lead_intereses`),
    precios_historial: await Q(`select * from public.precios_historial order by fecha desc`)
  };
  S.auditoria = await Q(`select * from public.auditoria order by fecha desc limit 200`);
  S.perfil = { user_id: A, nombre: 'Arq', rol: 'A', email: 'a@x.com' };
  assert.ok(S.datos.ventas.length === 3 && S.datos.leads.length === XSS.length);
});

const VISTAS = { vPanel: C.vPanel, vLeads: C.vLeads, vCotizador: C.vCotizador, vCotizaciones: C.vCotizaciones,
  vComputo: P.vComputo, vGamas: P.vGamas, vStock: P.vStock, vCompras: P.vCompras, vProveedores: P.vProveedores,
  vFabricacion: P.vFabricacion, vOperarios: P.vOperarios, vVentas: F.vVentas, vGastos: F.vGastos,
  vReglas: F.vReglas, vAuditoria: F.vAuditoria, vExportar: F.vExportar,
  vMateriales: I.vMateriales, vBom: I.vBom, vPresupuestos: I.vPresupuestos, vComparador: I.vComparador, vPrecios: I.vPrecios,
  vCatalogo: K.vCatalogo, vLineas: K.vLineas };

function sinInyeccion(nombre, salida) {
  assert.ok(isSafe(salida), `${nombre} debe devolver html\`\``);
  const s = salida.toString();
  assert.doesNotMatch(s, /<script/i, `${nombre}: <script> sin escapar`);
  assert.doesNotMatch(s, /<img src=x/i, `${nombre}: <img> sin escapar`);
  assert.doesNotMatch(s, /<svg/i, `${nombre}: <svg> sin escapar`);
  assert.doesNotMatch(s, /\son\w+\s*=\s*['"]?alert/i, `${nombre}: manejador de evento inyectado`);
  assert.doesNotMatch(s, /<b>Martín/, `${nombre}: nombre de socio sin escapar`);
  assert.doesNotMatch(s, /\sonclick=|\sonchange=|\sstyle=/i, `${nombre}: atributo en línea prohibido por la CSP`);
}

for (const [nombre, fn] of Object.entries(VISTAS)) {
  test(`vista ${nombre} renderiza y escapa todo`, () => {
    S.leadAbierto = S.datos.leads[0].id;
    S.ocAbierta = S.datos.ocs[0]?.id;
    S.fabAbierta = S.datos.fabricacion[0]?.id;
    S.ing.presupuesto = S.datos.presupuestos[0]?.id;
    S.ing.producto = 'TF-WOD-M-BAS'; S.ing.bom = ''; S.ing.comparar = S.datos.boms.find(b => b.estado === 'Aprobado')?.id;
    S.Q2 = { ...S.Q2, tecnologia: 'WOOD', tamano: 'M', gama: 'Premium', cliente: XSS[0] };
    sinInyeccion(nombre, fn());
  });
}

test('el panel muestra las alertas esperadas', () => {
  const s = C.vPanel().toString();
  assert.match(s, /varió más de 10 %/);
  assert.match(s, /seguimiento vencido/);
  assert.match(s, /por debajo del stock/);
  assert.match(s, /esperando tu firma/);
  assert.match(s, /Consistente/);
});

test('fabricación marca el exceso de plazo y sugiere costo real', () => {
  const s = P.vFabricacion().toString();
  assert.match(s, /p-bad">70</);
  assert.match(s, /Costo real sugerido/);
});

test('cotizador 2.0: resultado cotizable con la cláusula Paredes Afuera completa', () => {
  S.Q2 = { ...S.Q2, tecnologia: 'WOOD', tamano: 'M', gama: 'Premium', addons: [] };
  const s = C.vCotizador().toString();
  assert.match(s, /TF-WOD-M-PRM/);
  assert.match(s, /Aprobada al emitir/);
  assert.match(s, /El precio comprende exclusivamente la unidad habitacional terminada en fábrica\./);
  for (const x of ['Fundaciones y preparación del terreno', 'Flete y transporte', 'Grúa e izaje', 'Acometidas de servicios', 'Tramitaciones y permisos municipales'])
    assert.ok(s.includes(x), 'falta exclusión: ' + x);
  S.Q2.gama = 'Signature';
  const sig = C.vCotizador().toString();
  assert.match(sig, /Diseño exclusivo · Cotización a pedido/);
  assert.match(sig, /No se puede emitir/);
  assert.match(sig, /Paredes Afuera/, 'la cláusula sigue visible aunque no sea cotizable');
});

test('BOM y comparador muestran pendientes y estados sin presentar precios faltantes como cero', () => {
  S.ing.producto = 'TF-WOD-M-BAS'; S.ing.bom = '';
  const s = I.vBom().toString();
  assert.match(s, /Sin precio/);
  assert.match(s, /Enviar a aprobación/);
  assert.match(I.vMateriales().toString(), /Pendiente/);
  assert.match(I.vComparador().toString(), /Propuesta/);
});

test('cotizaciones: las 1.0 se muestran como históricas y las 2.0 con aprobación y vigencia', () => {
  const s = C.vCotizaciones().toString();
  assert.match(s, /Chasis S · Premium \(1\.0\)/);
  assert.match(s, /TF-WOD-M-PRM/);
  assert.match(s, /Aprobada/);
});

test('fabricación 2.0 muestra el modelo, la versión del BOM y sus necesidades', () => {
  S.fabAbierta = S.datos.fabricacion.find(f => f.bom_id)?.id;
  const s = P.vFabricacion().toString();
  assert.match(s, /BOM v1/);
  assert.match(s, /Materiales del BOM v1/);
});
