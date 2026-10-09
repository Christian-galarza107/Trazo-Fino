# Trazo Fino 2.0 · Informe de cambios

Rama: `trazo-fino-2.0` (sobre la línea base `TrazoFino_ERP_1.zip`). **No se publicó nada ni se tocó Supabase de producción.**

## 1. Qué se modificó

**Catálogo 2.0.** Tecnología (`WOOD`, `IRON_STEEL`) × Tamaño (`S` 6×4 = 24 m², `M` 12×4 = 48 m²) × Gama (Básico, Premium, Signature) = 12 productos con código estable `TF-WOD|IST-S|M-BAS|PRM|SIG`. Unicidad por código y por combinación; código, dimensiones, tecnología y gama inmutables (trigger). Signature nunca puede estar "Activo": se habilita modelo por modelo como "A pedido".

**Cotizador por pasos** Tecnología → Tamaño → Gama → Adicionales → Resultado (producto, código, superficie, descripción, precio, precio/m², adicionales, fecha, vigencia, estado de aprobación, condiciones). Solo emite si el producto tiene aprobación técnica, BOM aprobado vigente, todos los precios confirmados y adicionales compatibles. Signature queda "Pendiente de validación" y no se convierte en venta hasta validarse. Cláusula "Paredes Afuera" con el texto obligatorio y las 5 exclusiones en pantalla, impresión y aunque haya adicionales.

**Ingeniería de Costos y Materiales** (sección nueva): catálogo de materiales (reutiliza `insumos`) con precio original ARS/USD, tipo de cambio manual con fuente y fecha, equivalentes en USD y ARS, precio pendiente (nunca cero), búsqueda y aviso de duplicados · BOM por modelo versionado (Borrador → Pendiente de validación → Aprobado → Obsoleto, una sola versión vigente), duplicación sin registros compartidos, importación del presupuesto de Sebastián (texto `;`), comparación de versiones · presupuestos por proyecto (copia del BOM aprobado, opción A "solo este proyecto" y B "también en catálogo" en una transacción, descuentos autorizados, revisiones numeradas, emisión congelada) · comparador de costos / optimizador de sustituciones (análisis; aprobar no cambia nada, aplicar solo sobre borradores) · historial de precios con motivo, los cuatro niveles de precio y alerta de margen comprometido.

**CRM:** tecnología, tamaño y gama de interés, presupuesto orientativo, plazo; varias configuraciones por lead (`lead_intereses`) sin pisar las anteriores. **Análisis por línea:** filtros por tecnología, tamaño, gama, origen, estado, fechas y ubicación; leads y conversión por tecnología, interés en M, oportunidades por modelo, margen estimado por gama, facturación/margen/reserva/dividendos por línea, producción y faltantes.

**Producción:** la orden 2.0 toma producto y BOM aprobado (de la venta o elegido para stock), con costo presupuestado congelado por el servidor; necesidades por orden, stock comprometido, orden de compra con faltantes. El descuento usa solo el BOM aprobado de la orden, es atómico y no se repite.

**Finanzas:** ventas con modelo, costo presupuestado, desvío absoluto y %, masa distribuible. Rótulos "ganancia neta" → "margen societario (antes de impuestos)", porque el sistema no modela impuestos ni gastos indirectos. Exportaciones nuevas (catálogo, BOM, presupuestos, historial). Se corrigió la afirmación de respaldos automáticos.

## 2. Qué se mantuvo intacto

`PVP = Costo Directo ÷ p_costo` (servidor y navegador), 52/9/9/30, reserva 50 %, dividendos 50/50, gasto > USD 500 con doble firma. Todas las filas y columnas 1.0 (verificado fila por fila en `tests/migracion.test.mjs`). Cotizaciones 18/36 m² y Enterprise **no se convierten**: quedan como generación 1.0 y se reimprimen con su texto original. `schema.sql`, `js/config.js`, `js/vendor/supabase.js`, SRI, CSP, `index.html`, `html.js`, dependencias y versiones: sin cambios.

## 3. Base de datos

**Tablas nuevas (10):** `tipos_cambio`, `productos`, `addon_costos`, `boms`, `bom_items`, `sustituciones`, `presupuestos`, `presupuesto_items`, `precios_historial`, `lead_intereses` (+ `schema_migraciones`).

**Columnas nuevas:** `gamas` (generacion, vigente) · `insumos` (costo_original, moneda, tc_id, tc_valor, costo_ars, fecha_cotizacion, activo, observaciones, updated_at, updated_by; `costo` admite vacío y pasa a 4 decimales; categorías y unidades ampliadas) · `leads` (tecnologia_interes, tamano_interes, presupuesto_cliente, plazo_estimado) · `cotizaciones` (generacion, producto, superficie, BOM, presupuesto, desglose completo, descuento, precio final, tipo de cambio, `params_snapshot`, `items_snapshot`, vigencia, aprobación, validación, clave de idempotencia) · `ventas` (generacion, producto, tecnología, superficie, BOM, `cd_presupuestado`) · `fabricacion` (generacion, producto, BOM, costos presupuestados).

**Funciones nuevas:** `costo_bom`, `costo_presupuesto`, `finanzas_desde_costo`, `costo_addons_v2`, `calcular_cotizacion_v2`, `crear_cotizacion_v2`, `validar_cotizacion`, `bom_crear`, `bom_duplicar`, `bom_cambiar_estado`, `bom_importar`, `actualizar_precio_material`, `sustitucion_decidir`, `sustitucion_aplicar`, `presupuesto_crear`, `presupuesto_agregar_material`, `presupuesto_nueva_revision`, `presupuesto_cambiar_tc`, `presupuesto_actualizar_precios`, `presupuesto_anular`, `descontar_materiales_v2` y 10 funciones de trigger.

**Funciones 1.0 reemplazadas con la misma firma:** `calcular_cotizacion` (rechaza gamas exclusivas de 2.0), `convertir_cotizacion` (2.0: exige aprobación, lleva producto y costo presupuestado), `descontar_materiales` (2.0: deriva al BOM). Para registros 1.0, idénticas. **Vistas:** `v_ventas` (mismas columnas y orden + 10 al final; usa `cd_presupuestado` si existe), `v_fabricacion` (recreada por el cambio de precisión; mismas columnas + 9).

**Seguridad:** RLS forzada y políticas explícitas en todas las tablas nuevas; anónimo sin permisos; permisos por columna (lo calculado por el servidor no se escribe desde la web, incluido `ventas.cd_presupuestado`); auditoría en las tablas nuevas y además en `leads`, `oc_items`, `horas`; Realtime en las 10 tablas nuevas.

## 4. Decisiones técnicas (a validar por los socios)

| # | Decisión | Por qué |
|---|---|---|
| D1 | Enterprise **no se renombró**; Signature es una gama nueva y Enterprise queda "histórica". | Renombrar se propaga en cascada a cotizaciones y ventas históricas. Además se bloqueó renombrar cualquier gama. |
| D2 | El BOM, la sustitución y la validación Signature los puede aprobar **cualquiera de los dos socios**; queda registrado quién y cuándo. | No había regla definida. **Pendiente:** ¿la aprobación técnica debe ser solo de Sebastián, o exigir al otro socio (como los gastos > USD 500)? |
| D3 | El descuento se registra aparte: el PVP sigue saliendo de la regla; el descuento reduce el margen realizado. | No modificar la fórmula societaria. |
| D4 | Los materiales con historial de precios no se borran; se desactivan. | Conservar historial. |
| D5 | Al crearse, Básico/Premium quedan "Activo" y Signature "Inactivo"; ninguno es cotizable sin aprobación técnica y BOM aprobado. | "No cotizaciones definitivas sin costos aprobados." |
| D6 | Un precio en pesos se convierte con el tipo de cambio del material (catálogo) o del presupuesto (proyecto); las cotizaciones guardan el valor usado. | Un cambio de TC no altera nada comprometido. |
| D7 | El cotizador 1.0 sigue existiendo en la base (no se usa desde la interfaz). | No eliminar firmas con dependencias históricas. Retirarlo es una decisión posterior. |
| D8 | Los costos de adicionales por tecnología y tamaño quedan vacíos y no disponibles. | No suponer que cuestan lo mismo en Wood y en Iron Steel. |

## 5. Pruebas (resultados reales, `npm test`, Node 22)

| Grupo | Antes | Ahora | Contenido |
|---|---|---|---|
| engine | 9 | 9 | Motor 1.0 sin cambios |
| schema | 16 | 16 | Esquema 1.0 sin cambios |
| migracion (nuevo) | — | 26 | Migración sin pérdidas, falla a mitad, 12 combinaciones, ARS/USD, historial, BOM, duplicación, sustituciones, motor servidor = navegador, Signature, presupuestos A/B, atomicidad, idempotencia, producción, RLS, anónimo, no socio, Realtime, auditoría, script de validación |
| reversion (nuevo) | — | 2 | Revertir deja el esquema idéntico al 1.0; se niega con datos 2.0 |
| views | 20 | 31 | Las 23 pantallas con datos maliciosos 1.0 y 2.0; cotizador y cláusula; pendientes |
| e2e | 14 | 16 | App completa en jsdom: cotizador por pasos, impresión 2.0, alta de material con aviso de duplicado, presupuesto opción A y emisión |
| **Total** | **59** | **100** | **100/100 en verde.** `npm audit`: 0 vulnerabilidades. SRI coincide. Sin `innerHTML` fuera de `montar()`, sin handlers ni estilos en línea. |

**Errores encontrados y resueltos durante el desarrollo:** clave de idempotencia que pisaba el código del material en `presupuesto_agregar_material`; el cliente falso de los tests no aceptaba nombres de función con dígitos (`_v2`).

**Límites de verificación (no ejecutado):** nada se probó contra Supabase real ni con el SDK real (los tests usan PGlite y un cliente falso); no se probó Realtime real entre dos navegadores; no se probó el frontend 1.0 contra la base migrada; no se verificó la interfaz en dispositivos móviles reales; no se comparó contra el repositorio publicado en GitHub (no hubo acceso).

## 6. Riesgos que subsisten

- El proyecto Supabase se pausó el 08/10/2026: confirmar salud y login antes de migrar.
- Respaldo: el plan Free probablemente no lo incluye. Sin respaldo verificado, no migrar.
- Deriva ZIP ↔ GitHub: aplicar estos cambios sobre un clon del repo real y **no sobrescribir `js/config.js`**.
- `cargarTodo()` pasa de 17 a 27 consultas por refresco: suficiente para dos usuarios, a vigilar con volumen.
- Cualquier socio puede borrar cotizaciones, ventas y leads (política 1.0, sin cambios).
- Las alternativas de materiales requieren validación técnica humana: el sistema no evalúa requisitos estructurales, eléctricos, sanitarios, térmicos ni de seguridad.
