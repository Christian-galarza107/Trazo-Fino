# 08 · UI/UX

Etiquetas: ver `01_PROJECT_OVERVIEW.md`. Fuente principal: `index.html`, `css/app.css` (246 líneas), `js/ui.js`, `js/estado.js`, vistas.

## Identidad visual

- **Paleta corporativa** (variables CSS en `:root`): `--navy #12253F`, `--navy-2 #1B3557`, `--steel #2E5496`, `--steel-soft #E4EAF4`, `--gold #E8C300`. Estados: verde (ok), ámbar (warn), rojo (bad), azul suave (info). [CÓDIGO]
- **Logo:** `assets/logo.png` (edificio gris/amarillo, aprox. 189×199 px). Aparece en login, barra lateral, pantalla de configuración y cotización impresa. [CÓDIGO + CONVERSACIÓN]
- **Tipografía:** Calibri / Segoe UI / system-ui (sin fuentes externas, por la CSP). Números con `tabular-nums`.
- **Modo claro/oscuro automático** con `prefers-color-scheme` (no hay interruptor manual). [CÓDIGO]

## Estructura de la interfaz

- **Barra lateral** (240 px) con grupos: General · Comercial · Producto · Abastecimiento · Taller · Finanzas · Cuenta. 16 secciones (ver `03`). Insignias numéricas: leads activos, cotizaciones enviadas, stock bajo (resaltada), órdenes abiertas, fabricaciones en curso, gastos pendientes (resaltada).
- Pie de la barra: estado de sincronización (punto verde/ámbar/rojo + texto), nombre y rol del socio, "Cambiar contraseña" y "Salir".
- **Contenido** en `<main id="view">`: cabecera (`.head`) con título, subtítulo y acciones; paneles (`.panel`), tablas con scroll, tarjetas KPI (`.kpis`), pastillas de estado (`.pill`).
- **Modales** (`#veil` / `#modal`) para altas/ediciones y confirmaciones; se cierran con Escape o clic fuera.
- **Toasts** (`#toast`) para confirmaciones y errores.
- **Gráficos:** barras y apilados hechos con `div` (`.track/.fill`, `.stack/.seg`); anchos aplicados por CSSOM desde `data-w` (la CSP prohíbe `style=""`).

## Responsive

- Punto de quiebre único: `@media (max-width: 1000px)`. La barra lateral pasa a panel deslizable y aparece el botón "Menú"; las grillas de 2 columnas pasan a 1. [CÓDIGO]
- No hay pruebas de usabilidad móvil documentadas. **No se verificó visualmente en dispositivos reales.** [NO VERIFICADO]

## Convenciones de interfaz

- **Idioma:** español rioplatense (voseo): "Revisá", "Esperá", "Completá". Montos en USD formateados `es-AR` (`usd()`, `usd2()`); fechas dd/mm/aaaa.
- **Formularios declarativos** (`ui.js: formulario(titulo, campos, valores, onSave)`): cada campo define clave, tipo, límites, patrón y ayuda. Validación de cliente solo como comodidad (la regla real está en la base). Doble envío bloqueado.
- **Confirmaciones** antes de acciones destructivas o irreversibles (recibir orden, borrar, descontar materiales, ejecutar gasto sin firmas).
- **Alertas** en el Panel con botón "Ver" que navega a la sección relevante.
- **Accesibilidad:** `aria-current`, `role="alert"`, `role="status"`, `aria-live`, `:focus-visible`, etiquetas asociadas a campos. No hay auditoría formal de accesibilidad. [CÓDIGO]
- **Impresión:** `@media print` oculta todo salvo `#print`; la cotización incluye encabezado con logo, tabla de precio, condiciones de pago, cláusula "Paredes Afuera" y pie con validez.

## Reglas para modificar la interfaz (obligatorias por la CSP y la política anti-XSS)

1. Todo HTML se arma con la plantilla `html\`...\``; **nunca** concatenar strings ni usar `innerHTML` fuera de `montar()`.
2. **Prohibido** `onclick=""`, `style=""` y `<script>` en línea. Eventos: `data-action` (clic/envío) y `data-change` (cambio), registrados en los objetos `acciones` / `cambios` de cada vista.
3. Estilos solo en `css/app.css`. Anchos dinámicos: `data-w` + `montar()`.
4. No agregar CDNs ni fuentes externas (la CSP las bloquearía).
5. Cualquier texto de usuario que llegue al DOM debe pasar por la plantilla (se escapa solo).
6. Si se agrega una vista: registrarla en el arreglo `VISTAS` de `app.js`, exportar su función y sus `acciones`, y sumarla a `tests/views.test.mjs`.

## Inconsistencias/observaciones de diseño

- Sin interruptor de tema; solo sigue al sistema.
- Un único punto de quiebre responsive; tablas anchas dependen del scroll horizontal.
- El panel de control de Supabase y el ERP usan terminología distinta para claves ("anon" vs "publishable"); en el sitio se habla de "clave pública".
