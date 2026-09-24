// =====================================================================
//  Capa de datos · Supabase
//  Todas las consultas pasan por la librería oficial, que usa parámetros
//  (nunca SQL armado con texto): no hay forma de inyectar SQL desde acá.
// =====================================================================
import { CONFIG } from './config.js';

let sb = null;
let canal = null;

export function configurado() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CONFIG.SUPABASE_URL) &&
         CONFIG.SUPABASE_ANON_KEY.length > 40 && !CONFIG.SUPABASE_ANON_KEY.includes('PEGAR');
}

export function cliente() {
  if (sb) return sb;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('No se cargó la librería de Supabase');
  }
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      // sessionStorage: la sesión muere al cerrar la pestaña o el navegador.
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce'
    },
    global: { headers: { 'X-Client-Info': 'trazofino-erp' } }
  });
  return sb;
}

// ---------------------------------------------------------------------
//  Errores: mensajes claros sin filtrar detalles internos
// ---------------------------------------------------------------------
export function mensajeError(err) {
  if (!err) return 'Error desconocido';
  const m = String(err.message || err);
  const code = err.code || '';
  if (code === '42501' || /row-level security|permission denied|No autorizado/i.test(m)) return 'No tenés permiso para esta operación.';
  if (code === '23505') return 'Ya existe un registro con ese identificador.';
  if (code === '23503') return 'No se puede: hay otros registros que dependen de este.';
  if (/suma_100/.test(m)) return 'Los cuatro componentes del precio deben sumar exactamente 100 %.';
  if (/email_check/.test(m)) return 'El email no tiene un formato válido.';
  if (/telefono_check/.test(m)) return 'El teléfono solo admite números, espacios y los signos + ( ) -.';
  if (/codigo_check/.test(m)) return 'El código solo admite mayúsculas, números y guiones (2 a 20 caracteres).';
  if (/urgencia_justificada/.test(m)) return 'Una urgencia necesita una justificación de al menos 10 caracteres.';
  if (/fechas_coherentes/.test(m)) return 'La fecha de fin no puede ser anterior a la de inicio.';
  if (/rango_valido/.test(m)) return 'El máximo del rango no puede ser menor que el mínimo.';
  if (code === '23514' || code === '22023' || code === 'P0001') {
    // Mensajes de negocio escritos por nosotros en los triggers: son seguros para mostrar.
    if (/_check$|violates check constraint/.test(m)) return 'Algún dato está fuera del rango permitido.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Revisá internet.';
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Esperá unos minutos.';
  if (/captcha/i.test(m)) return 'La verificación anti-bots falló. Probá de nuevo.';
  return 'No se pudo completar la operación.';
}

async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
//  Sesión
// ---------------------------------------------------------------------
export async function sesionActual() {
  const { data } = await cliente().auth.getSession();
  return data.session;
}

export async function ingresar(email, password, captchaToken) {
  const opts = captchaToken ? { captchaToken } : undefined;
  return q(cliente().auth.signInWithPassword({ email, password, options: opts }));
}

export async function salir() {
  try { if (canal) await cliente().removeChannel(canal); } catch (_) { /* nada */ }
  canal = null;
  await cliente().auth.signOut();
  window.sessionStorage.clear();
}

export async function cambiarPassword(nueva) {
  return q(cliente().auth.updateUser({ password: nueva }));
}

export async function perfil() {
  const s = await sesionActual();
  if (!s) return null;
  const filas = await q(cliente().from('socios').select('user_id,nombre,rol').eq('user_id', s.user.id));
  return filas[0] ? { ...filas[0], email: s.user.email } : null;
}

// ---------------------------------------------------------------------
//  Lectura completa (dos usuarios, volumen chico: se carga todo)
// ---------------------------------------------------------------------
export async function cargarTodo() {
  const c = cliente();
  const [params, gamas, addons, insumos, proveedores, refs, leads, interacciones, cotizaciones,
         ventas, ocs, ocItems, gastos, operarios, fabricacion, horas, socios] = await Promise.all([
    q(c.from('params').select('*').eq('id', 1).single()),
    q(c.from('gamas').select('*').order('orden')),
    q(c.from('addons').select('*').order('nombre')),
    q(c.from('insumos').select('*').order('codigo')),
    q(c.from('proveedores').select('*').order('nombre')),
    q(c.from('bom_referencias').select('*').order('fecha', { ascending: false }).limit(10)),
    q(c.from('leads').select('*').order('created_at', { ascending: false })),
    q(c.from('interacciones').select('*').order('fecha', { ascending: false })),
    q(c.from('cotizaciones').select('*').order('numero', { ascending: false })),
    q(c.from('v_ventas').select('*').order('fecha', { ascending: false })),
    q(c.from('ordenes_compra').select('*').order('numero', { ascending: false })),
    q(c.from('oc_items').select('*')),
    q(c.from('v_gastos').select('*').order('numero', { ascending: false })),
    q(c.from('operarios').select('*').order('nombre')),
    q(c.from('v_fabricacion').select('*').order('numero', { ascending: false })),
    q(c.from('horas').select('*').order('fecha', { ascending: false })),
    q(c.from('socios').select('user_id,nombre,rol'))
  ]);
  return { params, gamas, addons, insumos, proveedores, refs, leads, interacciones, cotizaciones,
           ventas, ocs, ocItems, gastos, operarios, fabricacion, horas, socios };
}

export async function cargarAuditoria(limite = 200) {
  return q(cliente().from('auditoria').select('*').order('fecha', { ascending: false }).limit(limite));
}

// ---------------------------------------------------------------------
//  Escritura genérica (con lista blanca de tablas)
// ---------------------------------------------------------------------
const TABLAS = new Set(['params', 'gamas', 'addons', 'insumos', 'proveedores', 'leads', 'interacciones',
  'cotizaciones', 'ventas', 'ordenes_compra', 'oc_items', 'gastos', 'operarios', 'fabricacion', 'horas']);

function tabla(t) {
  if (!TABLAS.has(t)) throw new Error('Tabla no permitida');
  return cliente().from(t);
}

export const insertar = (t, fila) => q(tabla(t).insert(fila).select().single());
export const actualizar = (t, clave, valor, cambios) => q(tabla(t).update(cambios).eq(clave, valor).select().single());
export const borrar = (t, clave, valor) => q(tabla(t).delete().eq(clave, valor));

// ---------------------------------------------------------------------
//  Funciones de servidor
// ---------------------------------------------------------------------
export const rpc = {
  crearCotizacion: (cliente_, chasis, gama, addons, lead) =>
    q(cliente().rpc('crear_cotizacion', { p_cliente: cliente_, p_chasis: chasis, p_gama: gama, p_addons: addons, p_lead: lead || null })),
  convertirCotizacion: id => q(cliente().rpc('convertir_cotizacion', { p_id: id })),
  descontarMateriales: id => q(cliente().rpc('descontar_materiales', { p_fab: id })),
  registrarReferenciaBom: nota => q(cliente().rpc('registrar_referencia_bom', { p_nota: nota || null }))
};

// ---------------------------------------------------------------------
//  Tiempo real: avisa cuando el otro socio cambia algo
// ---------------------------------------------------------------------
export function escucharCambios(alCambiar) {
  const c = cliente();
  canal = c.channel('trazofino-cambios')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => alCambiar())
    .subscribe();
}
