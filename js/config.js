// =====================================================================
//  CONFIGURACIÓN PÚBLICA
//
//  Estos dos valores se ven en el navegador y es CORRECTO que así sea:
//  la "anon key" de Supabase es pública por diseño. Lo que protege los
//  datos no es ocultar esta clave, sino la seguridad por fila (RLS) de
//  la base: sin usuario y contraseña de socio, la base no devuelve nada.
//
//  NUNCA pegues acá la "service_role key" ni la contraseña de la base.
//  Esas dan acceso total y no deben salir nunca del panel de Supabase.
// =====================================================================

export const CONFIG = Object.freeze({
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'PEGAR-ACA-LA-ANON-PUBLIC-KEY',

  // Opcional: protección anti-bots en el login con Cloudflare Turnstile.
  // Dejar vacío para no usarla. Ver README, paso 6.
  TURNSTILE_SITE_KEY: '',

  // Cierre de sesión automático por inactividad (minutos).
  INACTIVIDAD_MIN: 30
});
