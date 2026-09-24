# Seguridad

Cómo cumple el sistema cada una de las nueve reglas de seguridad pedidas, y dónde se puede verificar. Cuando una regla se cumple por mitigación y no de forma literal, se aclara.

## 1. Sin claves de API ni contraseñas expuestas

- El repositorio no contiene contraseñas, claves secretas ni la contraseña de la base.
- `js/config.js` tiene solo dos valores públicos por diseño: la URL del proyecto y la clave pública de Supabase. Esa clave identifica el proyecto pero no da permisos: sin iniciar sesión como socio, la base responde vacío (ver regla 3).
- La *secret key* o *service_role key*, que saltea la seguridad, no se usa en ningún lugar del código.
- La clave secreta de Cloudflare Turnstile, si se usa, se carga solo en el panel de Supabase.
- `.gitignore` excluye archivos `.env` por si en el futuro se agregan secretos locales.
- GitHub escanea automáticamente los repositorios públicos en busca de claves filtradas.

## 2. Formularios protegidos contra spam y ataques

- **Solo existe un formulario público: el de inicio de sesión.** Todos los demás requieren una sesión de socio válida, y la base rechaza cualquier escritura sin ella.
- El registro público está deshabilitado en Supabase: no se pueden crear cuentas desde la web.
- **Límites de intentos en el servidor:** Supabase limita los intentos de autenticación por dirección IP.
- **Límites de intentos en el navegador:** después de 5 intentos fallidos, el formulario se bloquea con espera creciente (1, 2, 4 y hasta 8 minutos).
- **Anti-bots opcional:** Cloudflare Turnstile, verificado por Supabase del lado del servidor (README, paso 8).
- **Doble envío:** los botones se deshabilitan mientras se guarda.
- **Mensajes de error:** no revelan si un email existe o no ("Email o contraseña incorrectos").

## 3. Validación en el servidor

El navegador no es de confianza. Toda regla que importa vive en PostgreSQL (`supabase/schema.sql`):

- **Seguridad por fila (RLS)** forzada en las 18 tablas. Solo los usuarios registrados en `socios` leen o escriben. El rol anónimo no tiene ningún permiso.
- **Restricciones de datos:** longitudes máximas, formatos de email y teléfono, valores permitidos (estados, categorías, orígenes), rangos numéricos, fechas coherentes y códigos con patrón fijo.
- **Precios calculados en el servidor:** las cotizaciones solo se crean con la función `crear_cotizacion`, que calcula el PVP. El navegador no puede insertarlas ni cambiarles el precio (permisos por columna).
- **Reglas de precio:** la restricción `suma_100` impide guardar porcentajes que no sumen 100 %.
- **Gastos extraordinarios:** el servidor fija quién pidió el gasto, cada socio solo puede firmar su propia aprobación, cambiar el monto invalida las firmas y un gasto mayor a USD 500 no puede quedar aprobado sin las dos firmas.
- **Stock:** recibir una orden de compra suma stock y no se puede revertir. El descuento de materiales es atómico: si falta un insumo, no se descuenta nada.
- **Horas de taller:** el costo por hora lo toma el servidor del operario, no del navegador.
- **Reparto de ganancias:** las vistas `v_ventas`, `v_gastos` y `v_fabricacion` calculan ganancia, reserva, dividendos, desvíos y débitos en la base.
- **Auditoría:** la escriben *triggers* del servidor. El navegador solo puede leerla.

La validación de los formularios en el navegador existe solo por comodidad: si alguien la saltea, la base rechaza igual.

*Verificación:* `tests/schema.test.mjs` ejecuta el esquema sobre PostgreSQL real e intenta cada una de estas violaciones como anónimo, como usuario no socio y como socio.

## 4. Protección contra inyección de código

- **SQL:** el navegador nunca arma consultas con texto. La librería de Supabase envía parámetros a la API, y las funciones del servidor usan variables tipadas. Una prueba inserta `Robert'); drop table leads; --` y verifica que se guarda como texto.
- **Funciones del servidor:** todas usan `set search_path = public` para evitar el secuestro de funciones, y verifican `es_socio()` antes de operar.
- **Lista blanca de tablas** en `js/db.js`: el código solo puede escribir en tablas conocidas.
- **Planillas exportadas:** las celdas que empiezan con `= + - @` se neutralizan para que Excel no las ejecute como fórmulas (inyección CSV).
- **Nada de `eval`:** ni el código propio ni la librería lo usan (se verifica al copiar la librería).

## 5. Sin vulnerabilidades de XSS

Hay tres capas de defensa:

1. **Escape automático:** todo el HTML se genera con la plantilla `html` de `js/html.js`, que escapa cualquier valor interpolado. Solo se puede insertar HTML anidando otra plantilla, nunca un texto suelto, así que olvidarse de escapar es imposible por construcción. `innerHTML` se usa en un único lugar (`montar()`), que rechaza cualquier cosa que no venga de la plantilla.
2. **Sin JavaScript en línea:** no hay `onclick=""` ni `<script>` en línea. Los eventos se manejan por delegación con atributos `data-action`.
3. **Política de Seguridad de Contenido (CSP)** en `index.html`: el navegador solo ejecuta scripts del propio sitio (y de Cloudflare, si se activa Turnstile). No admite scripts ni estilos en línea, plugins, cambios de `<base>` ni conexiones a sitios que no sean Supabase. Aunque un atacante lograra colar un `<script>` en un dato, el navegador no lo ejecutaría.

*Verificación:* `tests/views.test.mjs` carga en la base datos maliciosos (`<script>`, `<img onerror>`, `<svg onload>`, comillas, `javascript:`) y renderiza las 16 pantallas con ellos. `tests/e2e.test.mjs` carga un lead malicioso desde la interfaz real y revisa que el DOM no tenga ningún manejador de eventos.

**Protección contra *clickjacking*:** la página se niega a funcionar dentro de un iframe ajeno. GitHub Pages no permite configurar el encabezado `X-Frame-Options`, así que esta protección se hace por código.

## 6. Contraseñas correctamente encriptadas

- Las contraseñas las gestiona Supabase Auth y se guardan con **bcrypt**, un algoritmo de hash lento y con *salt*. Nadie puede leerlas, ni siquiera el administrador del proyecto.
- El código de este proyecto nunca guarda contraseñas. El campo se vacía después de cada intento.
- Longitud mínima de 12 caracteres, con letras y números, exigida en Supabase (README, paso 3) y en el cambio de contraseña.
- La recuperación se hace reseteando la contraseña desde el panel de Supabase. No existe forma de "ver" la anterior.

## 7. Sesiones y cookies seguras — *cumplida por mitigación*

**La limitación, explicada sin vueltas:** la protección más fuerte para una sesión es una cookie `httpOnly`, que el JavaScript de la página no puede leer. Para emitirla hace falta un servidor propio, y GitHub Pages solo sirve archivos estáticos. Por eso la sesión (un token JWT firmado por Supabase) se guarda en el `sessionStorage` del navegador.

El riesgo de esa decisión es que un ataque XSS podría leer el token. Por eso se compensa con estas medidas:

- **La barrera principal es que no haya XSS** (regla 5: escape automático más una CSP estricta que bloquea scripts ajenos).
- **`sessionStorage` y no `localStorage`:** la sesión desaparece al cerrar la pestaña o el navegador.
- **Cierre automático por inactividad** a los 30 minutos (se configura en `js/config.js`).
- **Tokens de corta duración:** Supabase emite tokens que vencen a la hora y los renueva con *refresh tokens* que rotan en cada uso. Un token robado reutilizado se detecta y se invalida.
- **Flujo PKCE** para la autenticación.
- **Cierre de sesión completo:** se revoca la sesión en Supabase, se borra el almacenamiento y se limpia la pantalla.
- **Sin cookies de terceros ni de seguimiento.**

**Si en el futuro necesitan cookies `httpOnly`**, se puede migrar el frontend a un hosting con funciones de servidor (Cloudflare Pages, Vercel o Netlify) usando el paquete `@supabase/ssr`. La base de datos y sus reglas no cambian.

## 8. HTTPS y certificado SSL

- **GitHub Pages** emite y renueva automáticamente un certificado TLS. La opción **Enforce HTTPS** (README, paso 6) redirige todo el tráfico HTTP a HTTPS.
- **Supabase** solo acepta conexiones HTTPS y WSS (para el tiempo real).
- La CSP incluye `upgrade-insecure-requests` y solo permite conexiones `https://` y `wss://` a Supabase.
- Si se usa un dominio propio, GitHub también emite el certificado. Hay que volver a marcar **Enforce HTTPS**.

## 9. Dependencias actualizadas y seguras

- **Una sola dependencia llega al navegador:** `@supabase/supabase-js`, la librería oficial, en su última versión estable (2.117.1 al momento de la entrega), con **0 vulnerabilidades** según `npm audit`.
- **Se quitaron dependencias a propósito:** el prompt original pedía Tailwind, Chart.js y Lucide. Se reemplazaron por CSS propio y gráficos en CSS puro. Cada dependencia menos es una superficie de ataque menos.
- **Sin CDN de terceros:** la librería se sirve desde el propio sitio, con versión fija y **huella de integridad SRI** en `index.html`. Si el archivo se altera, el navegador se niega a ejecutarlo.
- **Dependabot** (`.github/dependabot.yml`) revisa semanalmente npm y GitHub Actions y abre *pull requests* con las actualizaciones.
- **Integración continua** (`.github/workflows/ci.yml`): en cada cambio corre `npm audit` (falla ante vulnerabilidades de severidad moderada o mayor), verifica que la copia local de la librería coincida con la versión declarada y corre las 59 pruebas.
- Las dependencias de desarrollo (PGlite y jsdom, usadas solo para las pruebas) nunca llegan al sitio publicado.

---

## Reportar un problema

Si detectás un comportamiento sospechoso: cambiá tu contraseña, cerrá todas las sesiones desde Supabase (**Authentication → Users → tu usuario**) y revisá la sección **Auditoría** del sistema.
