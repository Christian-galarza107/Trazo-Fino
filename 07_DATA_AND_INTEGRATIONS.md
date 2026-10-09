# 07 · Datos e integraciones

Fuente: `supabase/schema.sql` (684 líneas), leído en esta auditoría. Etiquetas: ver `01_PROJECT_OVERVIEW.md`. **No se incluyen claves, URLs con credenciales ni datos personales.**

## Integraciones externas

| Servicio | Uso | Estado |
|---|---|---|
| **Supabase** (proyecto en región São Paulo, plan Free) | Postgres, Auth (email+contraseña), Realtime | Activo; pausado y en reanudación el 08/10 |
| **GitHub Pages** | Hosting del sitio | Activo (confirmado por el usuario) |
| **GitHub Actions / Dependabot** | CI y actualizaciones | Archivos presentes en el ZIP; funcionamiento no verificado |
| **Cloudflare Turnstile** | Anti-bots en login | Opcional, desactivado |
| Instagram | Referencia visual del 3D | El enlace no pudo leerse (bloquea acceso automatizado) |

Las claves/URL reales están **solo** en `js/config.js` del repo de GitHub (clave pública). Los secretos (contraseña de la base, clave secreta/`service_role`) no están ni deben estar en ningún archivo.

## Modelo de datos (18 tablas, esquema `public`)

| Tabla | Propósito y reglas clave |
|---|---|
| `socios` | `user_id` (FK a `auth.users`), `nombre`, `rol` **único** `A`/`B`. Se escribe solo por SQL (el navegador no puede). |
| `params` | **Una sola fila** (`id=1`): `p_costo`, `p_hon`, `p_mkt`, `p_margen` (CHECK `suma_100` = 1), `p_reserva`, `p_div_socio`, `nombre_empresa`. Se puede actualizar, no insertar ni borrar. |
| `gamas` | PK `nombre`; `coef` (0–5), `usd_m2_min/max`, `orden`. |
| `addons` | `nombre`, `costo_s`, `costo_m`. |
| `proveedores` | Datos de contacto con validación de email/teléfono. |
| `insumos` | PK `codigo` (regex `^[A-Z0-9\-]{2,20}$`); `categoria` ∈ {Hierro, Aislación, Aberturas, Terminaciones, Revestimientos, Consumibles, Mano de Obra}; `unidad` enumerada; `costo`, `merma` (0–0,5), `cant_s`, `cant_m`, `stock`, `proveedor_id`. |
| `bom_referencias` | Foto del costo base S/M para la alerta del 10 %. Solo se escribe por función. |
| `leads` | `estado` ∈ {Nuevo, Calificado, En Cotización, Cerrado, Perdido}; `origen` ∈ {Meta Ads, Google Ads, Instagram orgánico, TikTok, Referido, Influencer, Web directa}; `terreno`, `ult_contacto`, `proximo_contacto`. |
| `interacciones` | Historial por lead (`tipo` enumerado, nota ≤ 1000). `autor` lo fija el servidor. |
| `cotizaciones` | `numero` identidad; `addons uuid[]`; `pvp`, `costo_directo` (calculados por el servidor); `estado` ∈ {Enviada, Ganada, Perdida}. |
| `ventas` | `pvp`, `costo_real` (nullable), `estado_cobro` ∈ {Seña recibida, 50% avance, Cobrado, Vencido}. |
| `ordenes_compra`, `oc_items` | Estados Borrador/Enviada/Recibida/Cancelada. Ítems bloqueados si la orden está Recibida/Cancelada. |
| `gastos` | `monto` (0–1.000.000), `urgencia` + `justificacion_urgencia` (≥ 10 caracteres si urgencia), `aprob_a`, `aprob_b`, `estado` ∈ {Pendiente, Aprobado, Ejecutado, Rechazado}. |
| `operarios` | `oficio` enumerado, `costo_hora` (≤ 1000), `activo`. |
| `fabricacion` | `estado` ∈ {Planificada, En curso, Terminada}, `materiales_descontados`, fechas coherentes. |
| `horas` | `horas` (0–16], `costo_hora_aplicado` **congelado por trigger** al cargar. |
| `auditoria` | Registro de cambios (INSERT/UPDATE/DELETE) con `datos jsonb`. Solo lectura desde el navegador. |

**Auditoría automática** (trigger `t_auditoria`): `params, gamas, addons, insumos, ventas, cotizaciones, gastos, ordenes_compra, fabricacion, proveedores, operarios`.

## Vistas (`security_invoker = true`)

- `v_ventas`: añade costo presupuestado/real, honorarios, marketing, ganancia, reserva, dividendos A/B y desvío. Si no hay costo real, usa el presupuestado.
- `v_gastos`: añade rol/nombre del solicitante y `imputado` = monto > 500 ∧ Ejecutado ∧ sin ambas firmas ∧ sin urgencia.
- `v_fabricacion`: añade horas totales, mano de obra real y mano de obra presupuestada (insumos de categoría "Mano de Obra" por chasis).

## Funciones y triggers

| Objeto | Qué hace |
|---|---|
| `es_socio()`, `mi_rol()` | Base de todas las políticas RLS. |
| `calcular_cotizacion(chasis, gama, addons)` | Motor de precio del servidor (`stable`, exige socio). Devuelve costo base, coeficiente, PVP, honorarios, marketing, ganancia, reserva, dividendos, m², PVP/m², rango. |
| `crear_cotizacion(...)` | Calcula y guarda la cotización; pasa el lead a "En Cotización". |
| `convertir_cotizacion(id)` | Crea la venta con el PVP guardado; marca la cotización Ganada y el lead Cerrado; rechaza reconversión. |
| `descontar_materiales(fab)` | Atómica; falla con la lista de faltantes si no alcanza el stock; usa BOM del chasis base. |
| `registrar_referencia_bom(nota)` | Guarda el costo base actual S/M. |
| `tg_gastos` | Fija autor y estado inicial (≤ 500 → Aprobado), controla quién firma, invalida firmas si cambia el monto, impide aprobar > 500 sin ambas firmas. |
| `tg_oc_estado`, `tg_oc_items_bloqueo` | Recibir orden suma stock (irreversible, exige ítems); bloquea edición de ítems. |
| `tg_horas_costo` | Congela costo/hora del operario. |
| `tg_set_autor`, `tg_interaccion_ultcontacto` | Autoría y último contacto del lead. |

## Seguridad de datos

- `revoke all ... from anon` sobre tablas, secuencias y funciones. `grant execute` solo a `authenticated` en las 7 funciones públicas (`es_socio`, `mi_rol`, `calcular_cotizacion`, `crear_cotizacion`, `convertir_cotizacion`, `descontar_materiales`, `registrar_referencia_bom`).
- RLS `enable` + `force` en las 18 tablas. Políticas: `socios_todo` (ALL) en 13 tablas de trabajo; solo lectura en `socios`, `auditoria`, `bom_referencias`; `params` lectura+update; `cotizaciones` lectura, update **solo de `estado`** y borrado. 21 políticas en total (13 por bucle + 8 explícitas).
- Permisos por columna en `cotizaciones`, `ordenes_compra`, `fabricacion`, `horas` (el navegador no puede tocar columnas calculadas por el servidor).
- **Realtime:** las 16 tablas operativas se agregan a la publicación `supabase_realtime`.

## Datos iniciales (seed)

`params` 52/9/9/30 + reserva 50 % + 50/50; 3 gamas; 4 adicionales (Deck exterior, Domótica, Solar off-grid, Aislación especial); 13 insumos de referencia (HIE-001..003, CON-001, AIS-001, ABE-001/002, TER-001..004, MDO-001/002). **Los costos de insumos son referenciales, no reales.**

## Transformaciones y exportaciones

- Cálculo de costo: `costo × cantidad × (1+merma)`; PVP; reparto. Réplica en `engine.js` y en SQL.
- Exportar: CSV (`;`, UTF-8 con BOM, neutraliza `= + - @`) de leads, ventas, insumos, gastos, horas; JSON completo del estado cargado. **No hay importación.**
- Impresión de cotización: HTML → `window.print()` con CSS `@media print`.

## Procesos de actualización de datos

Manual vía la interfaz; Realtime entre socios. No hay cargas masivas ni ETL. Cambios de esquema: pegar SQL en el SQL Editor de Supabase (**no existe sistema de migraciones**; ver `09`).
