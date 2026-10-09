# 02 · Arquitectura

Etiquetas de evidencia: ver `01_PROJECT_OVERVIEW.md`.

## Vista general

```
Navegador ──HTTPS──> GitHub Pages (index.html + css + js, estático, sin secretos)
    │
    └──HTTPS/WSS──> Supabase (Postgres + Auth + Realtime)
                     · RLS forzada en 18 tablas
                     · reglas de negocio en funciones/triggers
```

- **Frontend:** HTML + CSS + JavaScript ES modules, **sin frameworks ni build**. Se sirve tal cual (no hay bundler). [CÓDIGO]
- **Backend:** no hay servidor propio. Toda la lógica que importa vive en PostgreSQL (`supabase/schema.sql`, 684 líneas). [CÓDIGO]
- **Hosting:** GitHub Pages, rama `main`, carpeta raíz. Repo público `Christian-galarza107/Trazo-Fino`. Sitio: `https://christian-galarza107.github.io/Trazo-Fino/`. [CONVERSACIÓN]
- **Restricción técnica clave:** el sitio solo funciona servido por HTTP(S). Abrir `index.html` con doble clic (`file://`) deja pantalla negra: los navegadores bloquean `type="module"` en `file://`. [CONVERSACIÓN, causa explicada y aceptada]

## Frontend: módulos (`js/`)

| Archivo | Líneas | Responsabilidad |
|---|---|---|
| `app.js` | 268 | Arranque, login (bloqueo tras 5 fallos), cierre por inactividad, navegación de 16 vistas, delegación de eventos (`data-action`, `data-change`), Realtime con amortiguación (600 ms), anti-iframe. |
| `db.js` | 168 | Cliente Supabase (sessionStorage, PKCE), `cargarTodo()` (17 consultas en paralelo), escritura genérica con **lista blanca de tablas**, wrappers RPC, `mensajeError()`. |
| `engine.js` | 116 | Cálculo puro (sin red/DOM): PVP, reparto, score de leads, stock bajo, variación de BOM, débitos por rol. Vista previa del cotizador. |
| `html.js` | 63 | Plantilla `html\`...\`` con **escape automático**; `montar()` es el **único** `innerHTML`; formato es-AR; anchos de barras vía CSSOM (`data-w`). |
| `ui.js` | 149 | Formularios modales declarativos con validación de cliente, confirmaciones, toasts. |
| `estado.js` | 39 | Estado en memoria `S`, bus de callbacks (`render`, `refrescar`, `ir`), helpers de vista. |
| `views-comercial.js` | 413 | Panel, Leads (CRM), Cotizador, Cotizaciones, impresión de cotización. |
| `views-produccion.js` | 417 | Cómputo (BOM), Gamas/Adicionales, Stock, Compras, Proveedores, Fabricación, Operarios. |
| `views-finanzas.js` | 265 | Ventas/dividendos, Gastos, Reglas de precio, Auditoría, Exportar (CSV/JSON). |
| `config.js` | 23 | **Único archivo a editar por despliegue**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (clave pública/publishable), `TURNSTILE_SITE_KEY` (opcional, vacío), `INACTIVIDAD_MIN: 30`. |
| `vendor/supabase.js` | — | `@supabase/supabase-js` 2.117.1 (UMD), copia local con SRI. Expone `window.supabase`. |

Convenciones de código verificadas: ningún `onclick=""` ni `style=""` en `index.html`; `innerHTML` solo en `html.js:36`; la librería vendorizada no contiene `eval`/`new Function`. [CÓDIGO]

## Flujo de ejecución

1. `index.html` carga `vendor/supabase.js` (script clásico con `integrity`) y luego `js/app.js` (módulo).
2. `init()`: si `db.configurado()` es falso (URL/clave son placeholders) muestra la pantalla "Falta conectar la base de datos". Si hay sesión → `arrancar()`; si no → login.
3. `arrancar()`: `db.perfil()` consulta `socios` por `user_id`. **Si el usuario autenticado no está en `socios`, se desloguea** con "Este usuario no está habilitado como socio". Luego `refrescar()` → `cargarTodo()` → `render()`, y se abre el canal Realtime.
4. Interacción: eventos delegados → acciones → `db.insertar/actualizar/borrar` o RPC → `bus.refrescar()`.
5. Realtime: cualquier cambio `postgres_changes` en `public` dispara un refresco completo (volumen chico, 2 usuarios). [CÓDIGO]

## Sesión y autenticación

- Supabase Auth, email + contraseña (bcrypt, gestionado por Supabase). Registro público debe estar deshabilitado (**ver `05_CURRENT_STATE.md`: no confirmado**).
- Sesión en `sessionStorage`, `persistSession`, `autoRefreshToken`, `flowType: 'pkce'`, `detectSessionInUrl: false`. [CÓDIGO: `db.js:23-28`]
- Consecuencia: **la app ignora los links de recuperación de contraseña** (`#...type=recovery`); no hay pantalla para procesarlos. [CÓDIGO + CONVERSACIÓN]
- Cierre por inactividad (30 min), bloqueo de login tras 5 fallos con espera creciente (1/2/4/8 min), Turnstile opcional. [CÓDIGO: `app.js`]
- Cookies `httpOnly` no son posibles en GitHub Pages; se mitiga con CSP estricta (ver `SECURITY.md`). [CÓDIGO]

## CSP (meta en `index.html`)

`default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests`. Además `referrer: no-referrer` y `robots: noindex, nofollow`. [CÓDIGO]

## Base de datos

Detalle en `07_DATA_AND_INTEGRATIONS.md`. Resumen: 18 tablas, 3 vistas `security_invoker`, 5 funciones de negocio + 2 de rol + 7 de trigger, RLS `enable` + `force` en todas, `anon` sin permisos.

## Dependencias

| Dependencia | Versión | Uso | Llega al navegador |
|---|---|---|---|
| `@supabase/supabase-js` | 2.117.1 (fija) | Cliente de Supabase | **Sí** (copia en `js/vendor/`) |
| `@electric-sql/pglite` | 0.5.8 (fija) | Postgres en WASM para tests | No |
| `jsdom` | 30.1.1 (fija) | DOM simulado para tests e2e | No |

`npm audit --omit=dev`: 0 vulnerabilidades (verificado el 25/09/2026). [CONVERSACIÓN] Node ≥ 20 (`engines`).

## Automatización en el repositorio

- `.github/workflows/ci.yml`: en push a `main`, PR y cron semanal (lunes 09:00): `npm ci` → `npm audit --omit=dev --audit-level=moderate` → regenera `js/vendor` y exige que `git diff` quede limpio → `npm test`. [CÓDIGO] **No consta que haya corrido en GitHub.** [NO VERIFICADO]
- `.github/dependabot.yml`: npm y github-actions, semanal. [CÓDIGO]
- `scripts/vendor.mjs`: copia la librería desde `node_modules`, rechaza código con `eval`, recalcula el SRI y lo reescribe en `index.html`. [CÓDIGO]

## Tests

Cuatro archivos en `tests/` (`node --test "tests/*.test.mjs"`): `engine` (9), `schema` (16), `views` (20), `e2e` (14) = **59**. Usan PGlite con un `auth.uid()` simulado y, en e2e, un **cliente Supabase falso** sobre esa base. **Nunca ejercitan el SDK real contra un Supabase real.** El `e2e` reescribe `js/config.js` temporalmente y lo restaura al terminar (si se interrumpe, puede dejar valores de prueba). [CÓDIGO]

## Artefactos previos (fuera del repo)

Etapas anteriores del proyecto, en la carpeta de salidas: `Gestion_CustomFrame_v1.0.xlsx` (5 hojas: DASHBOARD, BOM, COTIZADOR, FLUJO_CAJA, CRM; 1.529 fórmulas, verificado), `Documento_Marco_CustomFrame.docx` (pacto de socios), `CustomFrame_ERP.html` y `CustomFrame_CRM.html` (versiones single-file con localStorage), `TrazoFino_Demo.zip` (demo con backend simulado en memoria, **no** es producción), `Trazo-Fino-Contexto.docx/.md/.pdf` (contexto para la reunión de socios).
