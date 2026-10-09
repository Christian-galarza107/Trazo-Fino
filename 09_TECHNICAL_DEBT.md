# 09 · Deuda técnica y riesgos

Impacto: **A** alto · **M** medio · **B** bajo. Etiquetas: ver `01_PROJECT_OVERVIEW.md`. Cada ítem remite a la tarea de `06_ROADMAP.md`.

| # | Ítem | Impacto | Detalle | Tarea |
|---|---|---|---|---|
| T1 | Plan Free se pausa por inactividad | A | Ya ocurrió. Sin mitigación implementada. | P0-3 |
| T2 | Respaldos no garantizados y documentación que dice lo contrario | A | README y pantalla Exportar afirman respaldos automáticos; probablemente no aplican al plan Free. | P0-4 |
| T3 | Controles de seguridad declarados pero no verificados | A | Registro público, política de contraseñas, límites de intentos. | P0-2 |
| T4 | Mensajes de error que ocultan la causa | M | `mensajeError()` mapea poco y mezcla causas (ver K2 en `05`). | P1-2 |
| T5 | Sin pantalla de recuperación de contraseña | M | Workaround SQL no versionado en el repo. | P1-3 |
| T6 | Deriva entre el repo publicado y los archivos locales | M | `config.js` real solo en GitHub; README/`docs` no subidos. Sin Git local. | P1-1 |
| T7 | Tests con cliente Supabase falso | M | No detectan fallos de configuración ni del SDK real. Falta una prueba de humo contra un proyecto real (p. ej., un proyecto de staging). | P1-4 / P2 |
| T8 | **Sin sistema de migraciones** | M | El esquema se aplica pegando `schema.sql`; **no es idempotente** (`create table` sin `if not exists`, seed con `insert`). Re-ejecutarlo sobre producción fallaría o duplicaría datos. Cualquier cambio de esquema exige SQL manual y cuidadoso. | Nueva tarea sugerida |
| T9 | Doble implementación del cálculo de precio | M | `engine.js` y `calcular_cotizacion()`; deben evolucionar juntas. | Al tocar reglas de precio |
| T10 | Auditoría incompleta | M | No cubre `leads`, `interacciones`, `oc_items`, `horas`, `bom_referencias`, `socios`. | P2-2 |
| T11 | Cualquier socio puede borrar cualquier dato | M | Política `socios_todo FOR ALL`. | P2-3 |
| T12 | Descuento de stock sin BOM por gama | M | Limitación funcional conocida. | P2-1 |
| T13 | Valores de negocio fijos en código | B | Condiciones de pago 40/40/20, validez 15 días, `PLAZO_MAX` 60, rango sano 250–550, umbral 10 %. | P2-4 |
| T14 | `e2e.test.mjs` reescribe `js/config.js` | B | Si el test se interrumpe, queda un `config.js` de prueba; riesgo de subirlo por error. Alternativa: inyectar la configuración por otra vía. | Mejora |
| T15 | Carga completa de datos en cada refresco | B | Aceptable con 2 usuarios; no escala. | P2-5 |
| T16 | Sesión en `sessionStorage` | B (aceptado) | Limitación de GitHub Pages; mitigada. Alternativa futura: hosting con funciones de servidor y `@supabase/ssr` para cookies `httpOnly`. | — |
| T17 | Dos fuentes de verdad documental | B | `SECURITY.md`/`README.md` (en el repo) vs documentos de contexto externos. Esta carpeta `docs/project-memory/` debe mantenerse como referencia única de continuidad. | P1-1 |

## Observaciones de mantenimiento

- **CI exige regenerar la copia vendorizada** de `supabase-js` si Dependabot sube la versión (falla a propósito hasta ejecutar `npm run vendor` y subir `js/vendor` + `index.html`). Es el comportamiento diseñado, no un error.
- **No renombrar** `js/vendor/supabase.js` ni modificarlo a mano: el SRI de `index.html` dejaría de coincidir y el navegador se negaría a ejecutarlo.
- **Subida por la web de GitHub:** hacerla por carpetas (ver procedimiento P1 en `04_DECISIONS.md`); arrastrar todo junto rompe la estructura.
- La carpeta `{js` (con llave) que aparece en el equipo del usuario es un artefacto de su PC; **no debe subirse**.
- Dependabot puede subir `jsdom`/`pglite` (solo desarrollo) sin impacto en el sitio; revisar que los tests sigan pasando.
