// Prueba de punta a punta: la app real (index.html + js/) corriendo en un navegador
// simulado (jsdom), con un cliente Supabase de prueba que ejecuta sobre PostgreSQL
// real (PGlite) respetando roles y seguridad por fila.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { aplicarMigraciones } from './_base.mjs';

const A = '11111111-1111-1111-1111-111111111111';
const USUARIOS = { 'arq@trazofino.com': { id: A, pass: 'ClaveSegura2026' } };
let pg, usuarioActual = null;
const BACKUP = join(tmpdir(), 'trazofino-config.backup.js');

async function comoUsuario(fn) {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub','${usuarioActual || ''}',false); set role ${usuarioActual ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await pg.exec('reset role;'); }
}
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identificador inválido ' + s); return '"' + s + '"'; };
function normalizar(res) {
  const tipos = Object.fromEntries(res.fields.map(f => [f.name, f.dataTypeID]));
  return res.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (v instanceof Date) return [k, tipos[k] === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()];
    if (tipos[k] === 1700 && v !== null) return [k, Number(v)];
    return [k, v];
  })));
}

// ---- Cliente Supabase de prueba (misma interfaz que supabase-js) ----
class Consulta {
  constructor(t) { this.t = t; this.op = 'select'; this.w = []; this.ord = []; this.lim = null; this.uno = false; this.ret = false; }
  select() { if (this.op !== 'select') this.ret = true; return this; }
  insert(f) { this.op = 'insert'; this.fila = f; return this; }
  update(f) { this.op = 'update'; this.fila = f; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.w.push([c, v]); return this; }
  order(c, o = {}) { this.ord.push(`${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.uno = true; return this; }
  async ejecutar() {
    const p = []; const ph = v => { p.push(v); return '$' + p.length; };
    const where = this.w.length ? ' where ' + this.w.map(([c, v]) => `${ident(c)} = ${ph(v)}`).join(' and ') : '';
    let sql;
    if (this.op === 'select') sql = `select * from public.${ident(this.t)}${where}${this.ord.length ? ' order by ' + this.ord.join(',') : ''}${this.lim ? ' limit ' + Number(this.lim) : ''}`;
    if (this.op === 'insert') { const ks = Object.keys(this.fila); sql = `insert into public.${ident(this.t)} (${ks.map(ident)}) values (${ks.map(k => ph(this.fila[k]))}) returning *`; }
    if (this.op === 'update') { const ks = Object.keys(this.fila); sql = `update public.${ident(this.t)} set ${ks.map(k => `${ident(k)} = ${ph(this.fila[k])}`)}${where} returning *`; }
    if (this.op === 'delete') sql = `delete from public.${ident(this.t)}${where}`;
    try {
      const r = await comoUsuario(() => pg.query(sql, p));
      const data = normalizar(r);
      return { data: this.uno ? data[0] ?? null : data, error: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  }
  then(res, rej) { return this.ejecutar().then(res, rej); }
}
const fakeSupabase = {
  createClient: () => ({
    auth: {
      async getSession() { return { data: { session: usuarioActual ? { user: { id: usuarioActual, email: 'arq@trazofino.com' } } : null } }; },
      async signInWithPassword({ email, password }) {
        const u = USUARIOS[email];
        if (!u || u.pass !== password) return { data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials' } };
        usuarioActual = u.id; return { data: { user: { id: u.id } }, error: null };
      },
      async signOut() { usuarioActual = null; return { error: null }; },
      async updateUser() { return { data: {}, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },
    from: t => new Consulta(t),
    async rpc(fn, args) {
      const ks = Object.keys(args);
      const sql = `select * from public.${ident(fn)}(${ks.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
      try {
        const r = normalizar(await comoUsuario(() => pg.query(sql, ks.map(k => args[k]))));
        const fila = r[0]; const v = fila ? (Object.keys(fila).length === 1 ? Object.values(fila)[0] : fila) : null;
        return { data: v, error: null };
      } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    async removeChannel() {}
  })
};

// ---- Arranque de la app en jsdom ----
let dom, doc;
const esperar = (ms = 60) => new Promise(r => setTimeout(r, ms));
async function hasta(cond, ms = 4000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout esperando la interfaz · aviso: ' + (doc?.querySelector('#toast')?.textContent || '') + ' · modal: ' + (doc?.querySelector('#modalError')?.textContent || '')); await esperar(25); } }
const click = sel => { const el = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(el, 'no existe ' + sel); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); };
const setVal = (sel, v) => { const el = doc.querySelector(sel); assert.ok(el, 'no existe ' + sel); el.value = v; };
const enviar = sel => doc.querySelector(sel).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const texto = () => doc.querySelector('#view').textContent;

test('instalar base y arrancar la app', async () => {
  pg = new PGlite();
  await pg.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    create publication supabase_realtime;`);
  await pg.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await aplicarMigraciones(pg);
  await pg.exec(`insert into auth.users values ('${A}'); insert into public.socios values ('${A}','Martín','A');`);
  // Catálogo 2.0 listo para cotizar Wood M Premium (lo haría Sebastián desde la interfaz)
  await pg.exec(`select set_config('request.jwt.claim.sub','${A}',false); set role authenticated;`);
  const tc = (await pg.query(`insert into public.tipos_cambio(tipo,valor,fuente) values ('MEP',1250,'Carga de prueba') returning id`)).rows[0].id;
  await pg.query(`insert into public.insumos(codigo,categoria,descripcion,unidad,costo_original,moneda,tc_id,merma) values
    ('MAD-001','Madera','Pino estructural','m',2500,'ARS',$1,0.1), ('MDO-101','Mano de Obra','Jornal carpintero','jornal',60,'USD',null,0)`, [tc]);
  const bom = (await pg.query(`select public.bom_crear('TF-WOD-M-PRM','Presupuesto de Sebastián') id`)).rows[0].id;
  await pg.query(`insert into public.bom_items(bom_id,insumo_codigo,cantidad) values ($1,'MAD-001',420),($1,'MDO-101',45),($1,'TER-002',48)`, [bom]);
  await pg.query(`select public.bom_cambiar_estado($1,'Pendiente de validación')`, [bom]);
  await pg.query(`select public.bom_cambiar_estado($1,'Aprobado')`, [bom]);
  await pg.query(`update public.productos set aprobacion_tecnica='Aprobado' where codigo='TF-WOD-M-PRM'`);
  await pg.exec(`reset role;`);

  // Config de prueba (se restaura al final)
  copyFileSync('js/config.js', BACKUP);
  writeFileSync('js/config.js', readFileSync(BACKUP, 'utf8')
    .replace('https://TU-PROYECTO.supabase.co', 'https://prueba123.supabase.co')
    .replace('PEGAR-ACA-LA-ANON-PUBLIC-KEY', 'eyJ' + 'x'.repeat(60)));

  const html = readFileSync('index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  dom = new JSDOM(html, { url: 'https://usuario.github.io/trazofino/', pretendToBeVisual: true });
  const w = dom.window; doc = w.document;
  w.supabase = fakeSupabase;
  w.scrollTo = () => {}; w.print = () => { w.__impreso = true; };
  w.matchMedia = () => ({ matches: false });
  for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'Blob', 'sessionStorage', 'Node'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
  await import('../js/app.js');
  await hasta(() => !doc.querySelector('#login').hidden);
  assert.equal(doc.querySelector('#app').hidden, true, 'sin sesión no se ve la app');
});

test('login con contraseña incorrecta: rechazado sin revelar detalles', async () => {
  setVal('#loginEmail', 'arq@trazofino.com'); setVal('#loginPass', 'incorrecta');
  enviar('#loginForm');
  await hasta(() => doc.querySelector('#loginError').textContent.length > 0);
  assert.equal(doc.querySelector('#loginError').textContent, 'Email o contraseña incorrectos.');
  assert.equal(doc.querySelector('#loginPass').value, '', 'la contraseña se borra del campo');
});

test('login correcto carga el panel', async () => {
  setVal('#loginEmail', 'arq@trazofino.com'); setVal('#loginPass', 'ClaveSegura2026');
  enviar('#loginForm');
  await hasta(() => !doc.querySelector('#app').hidden && /Panel de gestión/.test(texto()));
  assert.match(doc.querySelector('#quien').textContent, /Martín · Socio A/);
  assert.match(doc.querySelector('#brandName').textContent, /Trazo Fino/);
});

test('navegar por las 23 secciones sin errores', async () => {
  const botones = [...doc.querySelectorAll('#nav button')];
  assert.equal(botones.length, 23);
  for (const b of botones) {
    click(b); await esperar(30);
    assert.doesNotMatch(texto(), /No se pudo mostrar/, 'falló ' + b.textContent);
  }
});

test('cargar un lead con un intento de XSS: se guarda y se muestra como texto', async () => {
  click('[data-v="leads"]'); await esperar();
  click('[data-action="lead-nuevo"]'); await esperar();
  setVal('#f_nombre', '<img src=x onerror=alert(1)>');
  setVal('#f_terreno', 'true'); setVal('#f_gama', 'Premium');
  enviar('#modalForm');
  await hasta(() => !doc.querySelector('#veil').classList.contains('on'));
  await hasta(() => texto().includes('<img src=x onerror=alert(1)>'));
  assert.equal(doc.querySelectorAll('#view img').length, 0, 'no se creó ningún <img>');
});

test('email inválido: lo frena el formulario antes de enviarlo', async () => {
  click('[data-action="lead-nuevo"]'); await esperar();
  setVal('#f_nombre', 'Ana'); setVal('#f_email', 'esto-no-es-email');
  enviar('#modalForm'); await esperar();
  assert.match(doc.querySelector('#modalError').textContent, /email/i);
  click('[data-action="modal-cerrar"]');
});

test('registrar un contacto en el historial del lead', async () => {
  click('tr[data-action="toggle-lead"]'); await esperar();
  setVal('#ntNota', 'Primera llamada, tiene lote en Pilar'); setVal('#ntTipo', 'Llamada');
  click('[data-action="lead-contacto"]');
  await hasta(() => texto().includes('Primera llamada, tiene lote en Pilar'));
});

test('cotizador 2.0: Tecnología → Tamaño → Gama, el servidor fija el precio de la vista previa', async () => {
  click('[data-action="lead-cotizar"]'); await esperar();
  assert.match(texto(), /Cotizador/);
  assert.equal(doc.querySelector('[data-action="cot-guardar"]').disabled, true, 'sin configuración no se guarda');
  click('[data-k="tecnologia"][data-v="WOOD"]'); await esperar();
  click('[data-k="tamano"][data-v="M"]'); await esperar();
  click('[data-k="gama"][data-v="Signature"]'); await esperar();
  assert.match(texto(), /No se puede emitir/);
  assert.match(texto(), /El precio comprende exclusivamente la unidad habitacional terminada en fábrica/);
  click('[data-k="gama"][data-v="Premium"]'); await esperar();
  assert.match(texto(), /TF-WOD-M-PRM/);
  assert.match(texto(), /48,00 m²/);
  const previa = [...doc.querySelectorAll('.breakdown tr.big td.num')].map(x => x.textContent)[0];
  click('[data-action="cot-guardar"]');
  await hasta(() => /Cotizaciones/.test(doc.querySelector('.head h2')?.textContent || ''));
  const c = (await pg.query(`select pvp, generacion, producto_codigo, aprobacion, items_snapshot from public.cotizaciones`)).rows[0];
  assert.deepEqual([c.generacion, c.producto_codigo, c.aprobacion], ['2.0', 'TF-WOD-M-PRM', 'Aprobada']);
  const esperado = (420 * 1.1 * 2 + 45 * 60 + 48 * 16 * 1.08) / 0.52;       // BOM: madera en ARS a 1250, MO y piso en USD
  assert.ok(Math.abs(Number(c.pvp) - esperado) < 0.01, `PVP servidor ${c.pvp} vs ${esperado}`);
  assert.equal(previa, 'USD ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(c.pvp)));
  assert.equal(c.items_snapshot.length, 3);
});

test('imprimir cotización 2.0 con cláusula Paredes Afuera completa', async () => {
  click('[data-action="cot-imprimir"]'); await esperar();
  assert.equal(dom.window.__impreso, true);
  const t = doc.querySelector('#print').textContent;
  assert.match(t, /Paredes Afuera/);
  assert.match(t, /El precio comprende exclusivamente la unidad habitacional terminada en fábrica/);
  for (const x of ['Fundaciones y preparación del terreno', 'Flete y transporte', 'Grúa e izaje', 'Acometidas de servicios', 'Tramitaciones y permisos municipales'])
    assert.ok(t.includes(x), 'falta ' + x);
  assert.match(t, /TF-WOD-M-PRM/);
  assert.match(t, /válida hasta/);
});

test('convertir en venta y ver el reparto consistente', async () => {
  click('[data-action="cot-convertir"]'); await esperar();
  enviar('#modalForm');
  await hasta(() => /Ventas y dividendos/.test(doc.querySelector('.head h2')?.textContent || ''));
  assert.match(texto(), /Reparto consistente/);
});

test('materiales: alta con aviso de duplicado y precio pendiente (nunca cero)', async () => {
  click('[data-v="materiales"]'); await esperar();
  click('[data-action="mat-nuevo"]'); await esperar();
  setVal('#f_codigo', 'MAD-099'); setVal('#f_descripcion', 'pino estructural'); setVal('#f_costo_original', '');
  enviar('#modalForm'); await esperar(100);
  assert.match(doc.querySelector('#modalError').textContent, /Ya existe MAD-001/);
  setVal('#f_descripcion', 'OSB 15 mm'); setVal('#f_categoria', 'Madera'); setVal('#f_unidad', 'm²');
  enviar('#modalForm');
  await hasta(() => !doc.querySelector('#veil').classList.contains('on'));
  const m = (await pg.query(`select costo, costo_original from public.insumos where codigo='MAD-099'`)).rows[0];
  assert.deepEqual([m.costo, m.costo_original], [null, null]);
  await hasta(() => texto().includes('OSB 15 mm'));
});

test('presupuesto por proyecto: opción A sin tocar el catálogo y emisión congelada', async () => {
  click('[data-v="presupuestos"]'); await esperar();
  click('[data-action="pres-nuevo"]'); await esperar();
  setVal('#f_cliente', 'Proyecto Lucía');
  enviar('#modalForm');
  await hasta(() => texto().includes('Partidas del proyecto'));
  const nCat = (await pg.query(`select count(*)::int n from public.insumos`)).rows[0].n;
  click('[data-action="pres-agregar"][data-m="proyecto"]'); await esperar();
  setVal('#f_descripcion', 'Pérgola a medida'); setVal('#f_cantidad', '1'); setVal('#f_costo', '1800'); setVal('#f_motivo', 'Pedido del cliente');
  enviar('#modalForm');
  await hasta(() => texto().includes('Pérgola a medida'));
  assert.equal((await pg.query(`select count(*)::int n from public.insumos`)).rows[0].n, nCat, 'la opción A no crea materiales');
  click('[data-action="pres-emitir"]'); await esperar();
  enviar('#modalForm');
  await hasta(() => /Cotizaciones/.test(doc.querySelector('.head h2')?.textContent || ''));
  assert.equal((await pg.query(`select estado from public.presupuestos`)).rows[0].estado, 'Emitido');
});

test('reglas que no suman 100 %: rechazadas con mensaje claro', async () => {
  click('[data-v="reglas"]'); await esperar();
  click('[data-action="reglas-editar"]'); await esperar();
  setVal('#f_p_margen', '35');
  enviar('#modalForm'); await esperar(100);
  assert.match(doc.querySelector('#modalError').textContent, /100 %/);
  click('[data-action="modal-cerrar"]');
});

test('gasto extraordinario: el socio A firma y queda pendiente de B', async () => {
  click('[data-v="gastos"]'); await esperar();
  click('[data-action="gasto-nuevo"]'); await esperar();
  setVal('#f_concepto', 'Amoladora industrial'); setVal('#f_monto', '850');
  enviar('#modalForm');
  await hasta(() => texto().includes('Amoladora industrial'));
  click('[data-action="gasto-firma"]');
  await hasta(async () => true); await esperar(150);
  const g = (await pg.query(`select aprob_a, aprob_b, estado from public.gastos`)).rows[0];
  assert.deepEqual([g.aprob_a, g.aprob_b, g.estado], [true, false, 'Pendiente']);
});

test('el DOM no contiene manejadores de eventos ni estilos en línea', () => {
  // Se revisan atributos reales, no texto: un dato escapado que dice "onerror=" es texto inofensivo.
  const malos = [];
  for (const el of doc.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) malos.push(`${el.tagName} ${a.name}`);
      // Los anchos de barras se aplican por CSSOM (permitido por la CSP) y solo en elementos data-w.
      if (a.name === 'style' && !el.hasAttribute('data-w')) malos.push(`${el.tagName} style`);
    }
  }
  assert.deepEqual(malos, []);
});

test('cerrar sesión borra los datos de la pantalla', async () => {
  click('[data-action="salir"]');
  await hasta(() => !doc.querySelector('#login').hidden);
  assert.equal(doc.querySelector('#view').textContent, '');
  assert.equal(usuarioActual, null);
  copyFileSync(BACKUP, 'js/config.js');
  dom.window.close();
  await pg.close();
});
