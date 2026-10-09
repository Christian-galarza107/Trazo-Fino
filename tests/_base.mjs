// Utilidades compartidas por las pruebas 2.0: crea un PostgreSQL real (PGlite)
// con lo mínimo que trae Supabase, aplica schema.sql (1.0) y, si se pide,
// las migraciones 2.0 en el mismo orden en que se aplicarían en producción.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const SUPABASE_STUB = `
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

const DIR = new URL('../supabase/migrations/', import.meta.url);
export const MIGRACIONES = readdirSync(DIR).filter(f => /^\d{8}_\d{2}_.*\.sql$/.test(f)).sort();
export const leerMigracion = f => readFileSync(new URL(f, DIR), 'utf8');
export const leerSql = f => readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8');

export async function baseNueva({ migrar = true } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(leerSql('schema.sql'));
  if (migrar) await aplicarMigraciones(db);
  return db;
}

export async function aplicarMigraciones(db) {
  for (const f of MIGRACIONES) await db.exec(leerMigracion(f));
}

export async function como(db, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}

export async function falla(assert, p, patron) {
  await assert.rejects(p, e => { if (patron) assert.match(e.message, patron); return true; });
}

// PostgREST devuelve numeric como número y fechas como texto ISO.
export function normalizar(res) {
  const tipos = Object.fromEntries(res.fields.map(f => [f.name, f.dataTypeID]));
  return res.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (v instanceof Date) return [k, tipos[k] === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()];
    if (tipos[k] === 1700 && v !== null) return [k, Number(v)];
    if (typeof v === 'bigint') return [k, Number(v)];
    return [k, v];
  })));
}
