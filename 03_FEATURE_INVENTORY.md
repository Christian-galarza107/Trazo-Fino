# 03 · Inventario de funcionalidades

Estado: **Completa** = implementada según el código · **Parcial** · **Pendiente** · **Descartada** (decisión explícita).
"Validada" significa cubierta por los tests del 24–25/09/2026 (no re-ejecutados en esta auditoría) o confirmada por el usuario. Etiquetas: ver `01_PROJECT_OVERVIEW.md`.

## Acceso y sesión (`app.js`, `db.js`, `index.html`)

| Función | Estado | Notas |
|---|---|---|
| Login email + contraseña | Completa | Confirmado funcionando por el usuario en producción (25/09). Tras la pausa de Supabase del 08/10: sin confirmar. |
| Bloqueo tras 5 fallos (1/2/4/8 min) | Completa | Solo del lado del navegador; el límite real lo pone Supabase. |
| Cierre por inactividad (30 min) | Completa | `config.js: INACTIVIDAD_MIN`. |
| Cambio de contraseña desde la app | Completa | Acción `password` en `app.js` → `updateUser`. Mín. 12 caracteres con letras y números (validado en cliente). |
| Recuperación de contraseña por link de email | **Pendiente** | La app ignora el token `type=recovery`. Workaround SQL documentado (ver `05`/`06`). |
| Cloudflare Turnstile anti-bots | Parcial | Código listo; `TURNSTILE_SITE_KEY` vacío → desactivado. |
| Pantalla "Falta conectar la base de datos" | Completa | Se muestra si `config.js` tiene placeholders. |

## Comercial (`views-comercial.js`)

| Función | Estado | Notas |
|---|---|---|
| Panel: KPIs, alertas, reparto, ventas por gama, presupuestado vs real, embudo, seguimientos | Completa | Gráficos con CSS puro (sin Chart.js). Incluye costo por lead y CAC = marketing acumulado / ventas. |
| Leads (CRM): alta/edición/baja, score 0–100, días sin contacto (rojo > 7), próximo seguimiento | Completa | Score: terreno +50; Enterprise +30 / Premium +20 / otra +10; En Cotización +20 / Calificado +10. |
| Historial de contactos por lead | Completa | Tabla `interacciones`; actualiza `ult_contacto` por trigger. |
| Cotizador con vista previa | Completa | Chasis S/M, gama, adicionales, vincular lead. Marca "fuera de rango" por m². |
| Guardar cotización | Completa | `rpc crear_cotizacion`: **el PVP lo calcula el servidor**. Avisa si difiere de la vista previa. |
| Cotizaciones: convertir en venta / perdida / borrar | Completa | `rpc convertir_cotizacion`; cierra el lead vinculado. |
| Imprimir cotización con cláusula "Paredes Afuera" | Completa | `window.print()` con CSS de impresión; condiciones de pago 40/40/20 y validez 15 días están **escritas en el código** (no parametrizadas). |

## Producto y abastecimiento (`views-produccion.js`)

| Función | Estado | Notas |
|---|---|---|
| Cómputo métrico (BOM) | Completa | Costo línea = costo × cantidad × (1+merma). Resumen por categoría. Alerta > 10 % vs referencia. |
| Registrar referencia de cómputo | Completa | `rpc registrar_referencia_bom`. **Aún no se registró una referencia calibrada con datos reales.** [NO VERIFICADO] |
| Gamas y adicionales (CRUD) | Completa | Muestra PVP/m² por gama y si cae en rango. |
| Stock con punto de reorden (1 Chasis M + merma) | Completa | Ajuste manual de stock (inventario físico). |
| Orden de compra con faltantes | Completa | Genera borrador con lo que falta para un Chasis M. |
| Órdenes de compra (borrador/enviada/recibida/cancelada) | Completa | Recibir suma stock; **irreversible** (trigger). |
| Proveedores (CRUD) | Completa | No se pueden borrar si tienen órdenes (FK `restrict`). |
| Fabricación: estados, horas, desvío de mano de obra | Completa | Alerta si pasa de 60 días en taller (`PLAZO_MAX` fijo en código). |
| Descontar materiales del stock | **Parcial** | Atómico (todo o nada) pero usa el BOM del **chasis base**, sin variar por gama (Premium/Enterprise no tienen su propio listado). |
| Aplicar costo real sugerido a la venta | Completa | Reemplaza mano de obra presupuestada por la real. No contempla desvíos de materiales. |
| Operarios (CRUD; costo/hora congelado al cargar horas) | Completa | |

## Finanzas y gobernanza (`views-finanzas.js`)

| Función | Estado | Notas |
|---|---|---|
| Ventas y dividendos (cálculo en vista SQL) | Completa | Usa costo real si existe, si no el presupuestado. Control de reparto = 0,00. |
| Gastos extraordinarios con firma dual | Completa | Cada socio firma solo lo suyo; cambiar el monto invalida firmas; imputación a dividendos si se ejecuta sin firmas/urgencia. |
| Reglas de precio editables | Completa | La BD rechaza si no suman 100 %. Muestra si cada componente está dentro del rango pactado. |
| Auditoría (solo lectura) | Completa | Cubre 11 tablas (ver `07`). |
| Exportar CSV (5 planillas) y copia JSON | Completa | CSV neutraliza fórmulas (`= + - @`). |

## Seguridad transversal

| Función | Estado |
|---|---|
| Escape automático anti-XSS en todas las vistas | Completa [CÓDIGO + tests] |
| CSP estricta sin scripts/estilos en línea | Completa [CÓDIGO] |
| Anti-clickjacking por código (`window.top !== self`) | Completa |
| RLS forzada + `anon` sin permisos + permisos por columna | Completa [CÓDIGO + tests] |

## Descartado a propósito (respecto del "Master Prompt" ERP/CRM/MRP)

| Pedido original | Decisión |
|---|---|
| Tailwind, Chart.js, Lucide | Reemplazados por CSS propio y gráficos en CSS (menos dependencias). |
| Persistencia `localStorage`/IndexedDB offline | Descartada: datos en Supabase; sesión en `sessionStorage`. |
| Importar/exportar JSON | Solo **exportar** (CSV y JSON). **No hay importación.** |
| "Switcher de roles" | Descartado: la identidad y el rol salen del login real. |
| Exportar a Excel nativo | Se exporta CSV (abre en Excel). |

## Herramientas relacionadas fuera de este repositorio

- **Visualizador 3D de módulos** (configurador exterior + extensión de interior): **solo existen los prompts** entregados al usuario; **no hay código**. Sería una página aparte, no integrada al ERP. [CONVERSACIÓN]
- **Demo** (`TrazoFino_Demo.zip`): backend simulado en memoria; no es producción.
