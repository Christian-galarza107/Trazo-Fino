// =====================================================================
//  Trazo Fino · aplicación principal
//  Sin manejadores en línea (onclick=""): todo por delegación de eventos,
//  lo que permite una Política de Seguridad de Contenido estricta.
// =====================================================================
import { CONFIG } from './config.js';
import { html, montar, hoyISO } from './html.js';
import * as db from './db.js';
import { S, bus } from './estado.js';
import { toast, enviarFormulario, cerrarModal, formulario } from './ui.js';
import * as C from './views-comercial.js';
import * as P from './views-produccion.js';
import * as F from './views-finanzas.js';
import * as E from './engine.js';

// Anti-clickjacking: el sitio no se deja mostrar dentro de un iframe ajeno.
if (window.top !== window.self) { document.documentElement.replaceChildren(); throw new Error('Carga en iframe bloqueada'); }

const $ = s => document.querySelector(s);

const VISTAS = [
  { id: 'panel', g: 'General', l: 'Panel', v: C.vPanel },
  { id: 'leads', g: 'Comercial', l: 'Leads', v: C.vLeads, n: () => S.datos.leads.filter(E.ACTIVO).length },
  { id: 'cotizador', g: 'Comercial', l: 'Cotizador', v: C.vCotizador },
  { id: 'cotizaciones', g: 'Comercial', l: 'Cotizaciones', v: C.vCotizaciones, n: () => S.datos.cotizaciones.filter(c => c.estado === 'Enviada').length },
  { id: 'computo', g: 'Producto', l: 'Cómputo métrico', v: P.vComputo },
  { id: 'gamas', g: 'Producto', l: 'Gamas y adicionales', v: P.vGamas },
  { id: 'stock', g: 'Abastecimiento', l: 'Stock', v: P.vStock, n: () => S.datos.insumos.filter(E.stockBajo).length, alerta: true },
  { id: 'compras', g: 'Abastecimiento', l: 'Órdenes de compra', v: P.vCompras, n: () => S.datos.ocs.filter(o => ['Borrador', 'Enviada'].includes(o.estado)).length },
  { id: 'proveedores', g: 'Abastecimiento', l: 'Proveedores', v: P.vProveedores },
  { id: 'fabricacion', g: 'Taller', l: 'Fabricación', v: P.vFabricacion, n: () => S.datos.fabricacion.filter(f => f.estado !== 'Terminada').length },
  { id: 'operarios', g: 'Taller', l: 'Operarios', v: P.vOperarios },
  { id: 'ventas', g: 'Finanzas', l: 'Ventas y dividendos', v: F.vVentas },
  { id: 'gastos', g: 'Finanzas', l: 'Gastos extraordinarios', v: F.vGastos, n: () => S.datos.gastos.filter(g => g.estado === 'Pendiente').length, alerta: true },
  { id: 'reglas', g: 'Finanzas', l: 'Reglas de precio', v: F.vReglas },
  { id: 'auditoria', g: 'Finanzas', l: 'Auditoría', v: F.vAuditoria },
  { id: 'exportar', g: 'Cuenta', l: 'Exportar datos', v: F.vExportar }
];

// ---------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------
function dibujarNav() {
  const grupos = [...new Set(VISTAS.map(v => v.g))];
  montar($('#nav'), html`${grupos.map(g => html`<div class="grp">${g}</div>${VISTAS.filter(v => v.g === g).map(v => {
    const c = v.n ? v.n() : 0;
    return html`<button type="button" data-action="ir" data-v="${v.id}" class="${S.vista === v.id ? 'on' : ''}"
      ${S.vista === v.id ? html`aria-current="page"` : ''}>${v.l}${c ? html`<span class="n ${v.alerta ? 'alerta' : ''}">${c}</span>` : ''}</button>`;
  })}`)}`);
  $('#brandName').textContent = S.datos.params.nombre_empresa || 'Trazo Fino';
  $('#quien').textContent = `${S.perfil.nombre} · Socio ${S.perfil.rol}`;
}

function render() {
  if (!S.datos) return;
  dibujarNav();
  const v = VISTAS.find(x => x.id === S.vista) || VISTAS[0];
  try { montar($('#view'), v.v()); }
  catch (e) { console.error(e); montar($('#view'), html`<div class="warnbox">No se pudo mostrar esta sección.</div>`); }
}

function ir(vista) {
  if (!VISTAS.some(v => v.id === vista)) vista = 'panel';
  S.vista = vista;
  if (vista === 'auditoria' && S.auditoria === null) acciones['auditoria-cargar']();
  render();
  window.scrollTo(0, 0);
  if (window.matchMedia('(max-width: 1000px)').matches) document.body.classList.remove('menu-on');
}

let refrescando = null;
async function refrescar() {
  if (refrescando) return refrescando;
  refrescando = (async () => {
    try {
      S.datos = await db.cargarTodo();
      setEstado('ok', 'Sincronizado');
      render();
    } catch (e) {
      setEstado('err', 'Sin conexión');
      toast(db.mensajeError(e), 'bad');
    } finally { refrescando = null; }
  })();
  return refrescando;
}

bus.render = render;
bus.refrescar = refrescar;
bus.ir = ir;

function setEstado(tipo, txt) {
  const dot = $('#syncDot');
  if (dot) dot.className = tipo;
  const t = $('#syncTxt');
  if (t) t.textContent = txt;
}

// ---------------------------------------------------------------------
//  Acciones globales
// ---------------------------------------------------------------------
const acciones = {
  ...C.acciones, ...P.acciones, ...F.acciones,
  'ir': d => ir(d.v),
  'modal-cerrar': () => cerrarModal(),
  'menu': () => document.body.classList.toggle('menu-on'),
  'salir': () => cerrarSesion('Sesión cerrada'),
  'password': () => formulario('Cambiar contraseña', [
    { k: 'nueva', l: 'Nueva contraseña', t: 'password', req: true, max: 72, ayuda: 'Mínimo 12 caracteres, con letras y números.' },
    { k: 'repetir', l: 'Repetir contraseña', t: 'password', req: true, max: 72 }
  ], {}, async v => {
    const err = m => Object.assign(new Error(m), { code: 'P0001' });
    if (v.nueva !== v.repetir) throw err('Las contraseñas no coinciden.');
    if (v.nueva.length < 12 || !/[A-Za-z]/.test(v.nueva) || !/[0-9]/.test(v.nueva)) throw err('Usá al menos 12 caracteres, con letras y números.');
    await db.cambiarPassword(v.nueva);
    toast('Contraseña actualizada');
  }, 'Cambiar')
};

const cambios = { ...C.cambios };

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const fn = acciones[t.dataset.action];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn({ ...t.dataset }, t, e)).catch(err => toast(db.mensajeError(err), 'bad'));
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-change]');
  if (t && cambios[t.dataset.change]) cambios[t.dataset.change](t);
});
document.addEventListener('submit', e => {
  if (e.target.id === 'modalForm') enviarFormulario(e);
  else if (e.target.id === 'loginForm') ingresar(e);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#veil').classList.contains('on')) cerrarModal(); });
$('#veil').addEventListener('mousedown', e => { if (e.target.id === 'veil') cerrarModal(); });

// ---------------------------------------------------------------------
//  Inicio de sesión
//  Además de los límites del servidor de Supabase, el navegador frena
//  los intentos repetidos: 5 fallos seguidos bloquean el formulario.
// ---------------------------------------------------------------------
const intentos = { fallos: 0, hasta: 0 };
let turnstileId = null;

function mostrarLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginError').textContent = msg || '';
  const f = $('#loginForm');
  if (f) f.reset();
  if (CONFIG.TURNSTILE_SITE_KEY) cargarTurnstile();
}

function cargarTurnstile() {
  if (window.turnstile) { if (turnstileId !== null) window.turnstile.reset(turnstileId); return; }
  if (document.getElementById('ts-script')) return;
  const s = document.createElement('script');
  s.id = 'ts-script';
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  s.onload = () => {
    turnstileId = window.turnstile.render('#captcha', { sitekey: CONFIG.TURNSTILE_SITE_KEY, theme: 'light', language: 'es' });
  };
  document.head.appendChild(s);
}

async function ingresar(e) {
  e.preventDefault();
  const btn = $('#loginBtn'), err = $('#loginError');
  if (btn.disabled) return;
  const ahora = Date.now();
  if (ahora < intentos.hasta) {
    err.textContent = `Demasiados intentos. Esperá ${Math.ceil((intentos.hasta - ahora) / 1000)} segundos.`;
    return;
  }
  const email = $('#loginEmail').value.trim().toLowerCase();
  const password = $('#loginPass').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) { err.textContent = 'Ingresá un email válido.'; return; }
  if (!password || password.length > 72) { err.textContent = 'Ingresá tu contraseña.'; return; }

  let captcha;
  if (CONFIG.TURNSTILE_SITE_KEY) {
    captcha = window.turnstile && turnstileId !== null ? window.turnstile.getResponse(turnstileId) : '';
    if (!captcha) { err.textContent = 'Completá la verificación anti-bots.'; return; }
  }

  btn.disabled = true; btn.textContent = 'Ingresando…'; err.textContent = '';
  try {
    await db.ingresar(email, password, captcha);
    $('#loginPass').value = '';
    intentos.fallos = 0;
    await arrancar();
  } catch (ex) {
    intentos.fallos++;
    if (intentos.fallos >= 5) { intentos.hasta = Date.now() + 60000 * Math.min(8, 2 ** (intentos.fallos - 5)); }
    err.textContent = db.mensajeError(ex);
    $('#loginPass').value = '';
    if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId);
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
}

async function cerrarSesion(msg) {
  try { await db.salir(); } catch (_) { /* nada */ }
  clearTimeout(timerInactividad); clearTimeout(timerCambios);
  S.datos = null; S.perfil = null; S.auditoria = null; S.vista = 'panel';
  $('#view').replaceChildren(); $('#nav').replaceChildren();
  cerrarModal();
  mostrarLogin(msg);
}

// Cierre automático por inactividad
let timerInactividad = null;
function reiniciarInactividad() {
  clearTimeout(timerInactividad);
  if (!S.perfil) return;
  timerInactividad = setTimeout(() => cerrarSesion('Tu sesión se cerró por inactividad.'), CONFIG.INACTIVIDAD_MIN * 60000);
}
['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(ev =>
  document.addEventListener(ev, () => { if (S.perfil) reiniciarInactividad(); }, { passive: true }));

// Tiempo real: cambios del otro socio (con amortiguación)
let timerCambios = null;
function alCambiarRemoto() {
  clearTimeout(timerCambios);
  setEstado('sync', 'Actualizando…');
  timerCambios = setTimeout(refrescar, 600);
}

async function arrancar() {
  S.perfil = await db.perfil();
  if (!S.perfil) {
    await db.salir();
    mostrarLogin('Este usuario no está habilitado como socio.');
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  montar($('#view'), html`<div class="empty">Cargando datos…</div>`);
  await refrescar();
  db.escucharCambios(alCambiarRemoto);
  reiniciarInactividad();
}

// ---------------------------------------------------------------------
//  Arranque
// ---------------------------------------------------------------------
(async function init() {
  if (!db.configurado()) {
    $('#login').hidden = true;
    $('#setup').hidden = false;
    return;
  }
  try {
    db.cliente().auth.onAuthStateChange(evento => {
      if (evento === 'SIGNED_OUT' && S.perfil) cerrarSesion('Sesión finalizada.');
    });
    const s = await db.sesionActual();
    if (s) await arrancar(); else mostrarLogin();
  } catch (e) {
    mostrarLogin(db.mensajeError(e));
  }
  document.getElementById('anio').textContent = hoyISO().slice(0, 4);
})();
