// La reversión deja el esquema exactamente como 1.0 y no toca datos 1.0.
// Se niega a ejecutarse si ya hay datos 2.0 (en ese caso: restaurar respaldo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNueva, aplicarMigraciones, como, falla, leerSql } from './_base.mjs';

const A = '11111111-1111-1111-1111-111111111111';
const FIRMA = `
  select 'col' k, table_name || '.' || column_name || ' ' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '') || ' ' || is_nullable || ' ' || coalesce(column_default, '') v
    from information_schema.columns where table_schema = 'public'
  union all select 'con', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'fn', proname || '(' || pg_get_function_identity_arguments(oid) || ') ' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace
  union all select 'tg', tgrelid::regclass || ' ' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'auth.%'
  union all select 'pol', tablename || ' ' || policyname || ' ' || cmd from pg_policies where schemaname = 'public'
  union all select 'vw', viewname || ' ' || md5(definition) from pg_views where schemaname = 'public'
  union all select 'priv', table_name || ' ' || grantee || ' ' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')
  union all select 'cpriv', table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon','authenticated')
  union all select 'exec', p.proname || ' ' || r.rolname || ' ' || has_function_privilege(r.rolname, p.oid, 'EXECUTE') from pg_proc p cross join pg_roles r
    where p.pronamespace = 'public'::regnamespace and r.rolname in ('anon','authenticated')
  union all select 'pub', tablename from pg_publication_tables where pubname = 'supabase_realtime'
  order by 1, 2`;
const firma = async db => (await db.query(FIRMA)).rows.map(r => r.k + ' ' + r.v);
const DATOS = ['params', 'gamas', 'addons', 'insumos', 'leads', 'cotizaciones', 'ventas'];
const datos = async db => { const o = {}; for (const t of DATOS) o[t] = JSON.stringify((await db.query(`select * from public.${t} order by 1`)).rows); return o; };

async function conDatos() {
  const db = await baseNueva({ migrar: false });
  await db.exec(`insert into auth.users values ('${A}'); insert into public.socios values ('${A}','Sebastián','A');`);
  await como(db, A, async () => {
    await db.query(`insert into public.leads(nombre,origen,gama) values ('Histórico','Referido','Enterprise')`);
    const c = (await db.query(`select public.crear_cotizacion('Histórico','M','Enterprise','{}') id`)).rows[0].id;
    await db.query(`select public.convertir_cotizacion($1)`, [c]);
  });
  return db;
}

test('revertir sin datos 2.0 vuelve exactamente al esquema y los datos 1.0', async () => {
  const db = await conDatos();
  const f0 = await firma(db), d0 = await datos(db);
  await aplicarMigraciones(db);
  assert.notDeepEqual(await firma(db), f0);
  await db.exec(leerSql('migrations/revertir_2_0.sql'));
  const f1 = await firma(db);
  assert.deepEqual(f1.filter(x => !f0.includes(x)), [], 'sobra en el esquema revertido');
  assert.deepEqual(f0.filter(x => !f1.includes(x)), [], 'falta en el esquema revertido');
  assert.deepEqual(await datos(db), d0, 'los datos 1.0 no cambiaron');
  await como(db, A, async () => {
    const r = (await db.query(`select * from public.calcular_cotizacion('S','Premium','{}')`)).rows[0];
    assert.equal(Number(r.pvp).toFixed(2), '22949.75');
  });
  // y se puede volver a migrar
  await aplicarMigraciones(db);
});

test('revertir con datos 2.0 se rechaza sin cambiar nada', async () => {
  const db = await conDatos();
  await aplicarMigraciones(db);
  await como(db, A, () => db.query(`insert into public.tipos_cambio(tipo,valor,fuente) values ('MEP',1300,'prueba')`));
  const f = await firma(db);
  await falla(assert, db.exec(leerSql('migrations/revertir_2_0.sql')), /Ya hay datos 2.0 .*tipos de cambio/);
  await db.exec('rollback');
  assert.deepEqual(await firma(db), f);
});
