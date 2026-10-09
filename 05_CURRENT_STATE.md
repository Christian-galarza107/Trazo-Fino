# 05 · Estado actual real

Fecha de la auditoría: 08/10/2026. Etiquetas: ver `01_PROJECT_OVERVIEW.md`. **Regla de esta sección: nada se declara "funcionando" sin evidencia; lo que no se pudo comprobar figura como tal.**

## Línea de tiempo (reconstruida)

| Fecha | Hito | Evidencia |
|---|---|---|
| 21–23/09/2026 | Especificación, Excel (1.529 fórmulas), Documento Marco, ERP/CRM single-file, y luego sistema Supabase + GitHub Pages con 59 tests. Paquete `TrazoFino_ERP.zip`. | Archivos en salidas [CÓDIGO]; resumen de sesión |
| 24/09 | El usuario crea proyecto Supabase (Free, São Paulo), ejecuta `schema.sql`, crea usuarios y los vincula como socios. Publica en GitHub Pages tras varios intentos de subida fallidos. Diagnóstico del login: la clave en `config.js` estaba corrupta (`Invalid API key`). Corregida. | Capturas y mensajes [CONVERSACIÓN] |
| 24–25/09 | **Login confirmado funcionando** ("quedó de diez"). Se reemplaza el email del socio B; también funciona. | [CONVERSACIÓN] |
| 25/09 | Aviso de "secret scanning" de GitHub sobre `config.js` (falso positivo). Se entregan documento de contexto (MD/DOCX/PDF) y prompts del visualizador 3D. | [CONVERSACIÓN] |
| 08/10 | El usuario no puede entrar. El panel de Supabase muestra el proyecto **reanudándose** ("Coming up…": Database y Edge Functions *Healthy*; Auth, PostgREST, Realtime y Storage aún no). El login mostraba "Sin conexión con el servidor". Causa más probable: **pausa por inactividad del plan Free** (7 días sin actividad; última actividad conocida ~25/09). | Capturas [CONVERSACIÓN]; docs de Supabase |

## Último punto verificable

- **Producción OK al 25/09/2026** (confirmado por el usuario).
- **08/10/2026:** reanudación en curso. **No hay confirmación de que Auth haya vuelto a quedar saludable ni de que el login funcione de nuevo.** Esto es lo primero a verificar (ver P0-1 en `06_ROADMAP.md`).

## Qué está validado y cómo

| Elemento | Resultado | Cómo | Vigencia |
|---|---|---|---|
| Suite de tests | 59/59 (engine 9, schema 16, views 20, e2e 14) | `npm test` en sesión, 24–25/09 | **No re-ejecutada hoy** (regla: no instalar dependencias). El ZIP se empaquetó justo después de esa corrida; el código no cambió desde entonces salvo `config.js` en GitHub [CONVERSACIÓN]. |
| Sintaxis de los 15 archivos JS/MJS | OK | `node --check`, hoy | Hoy [CÓDIGO] |
| SRI de `vendor/supabase.js` | Coincide con `index.html` y `VERSION.txt` | `openssl dgst -sha384`, hoy | Hoy [CÓDIGO] |
| Sin `eval`/`new Function` en la librería vendorizada | OK | `grep`, hoy | Hoy [CÓDIGO] |
| `index.html` sin handlers ni estilos en línea | OK | `grep`, hoy | Hoy [CÓDIGO] |
| `innerHTML` solo en `html.js:36` | OK | `grep`, hoy | Hoy [CÓDIGO] |
| `npm audit --omit=dev` | 0 vulnerabilidades | 25/09 | Puede haber cambiado; el CI lo revisa semanalmente (si corre) |
| Login real con el SDK de Supabase | OK | Confirmación del usuario, 24–25/09 | Antes de la pausa |

**Limitación importante de los tests:** nunca ejercitan el SDK real de Supabase ni un Supabase real (usan un cliente falso sobre PGlite). Por eso no detectaron el problema de clave inválida ni detectarían problemas de configuración del proyecto Supabase.

## No verificado (afirmado en docs o conversación, sin comprobación)

1. **Registro público deshabilitado en Supabase** (README paso 3). Se le indicó al usuario dónde desactivarlo; **nunca confirmó haberlo hecho**. Mitigante: un usuario nuevo no figura en `socios`, así que RLS le devuelve cero filas.
2. **Longitud mínima de contraseña 12 / protección de contraseñas filtradas** en Supabase: no confirmado. (La app valida 12 solo al *cambiar* contraseña desde la interfaz.)
3. **Límites de intentos de login del lado de Supabase** (afirmado en `SECURITY.md` §2): depende de la configuración del proyecto; no verificado.
4. **Respaldos automáticos:** el README y la pantalla Exportar dicen que "Supabase guarda respaldos automáticos". En el panel del usuario "LAST BACKUP" aparece vacío y una fuente de terceros indica que el plan Free no incluye retención de respaldos (Pro: 7 días). **Tratarlo como probablemente falso hasta confirmarlo en la documentación oficial.**
5. **Contenido real del repositorio en GitHub** (¿están `.github/` y `package-lock.json`? ¿hay archivos sobrantes?). El usuario subió carpeta por carpeta y excluyó la carpeta `{js` (artefacto de su PC).
6. **Que el CI de GitHub Actions haya corrido y pasado** y que Dependabot esté activo.
7. **Que el aviso "secret scanning" se haya marcado como falso positivo** (se le indicó cómo).
8. **Site URL** de Supabase: el email de recuperación llevó a la URL de GitHub Pages, lo que sugiere que está bien configurado [INFERIDO].
9. **Si existe una referencia de cómputo calibrada** (`bom_referencias`): solo hay la que registre el usuario; sin ella la alerta del 10 % no opera.

## Problemas conocidos

| # | Problema | Tipo | Detalle |
|---|---|---|---|
| K1 | **Proyecto Supabase Free se pausa tras 7 días sin actividad** | Disponibilidad | Ocurrió. Se restaura desde el panel (ventana de restauración documentada de 90 días; otra versión de la documentación dice 1 año — confirmar). Sin plan para evitarlo (ver P0-3). |
| K2 | El mensaje de error del login engaña en dos casos | UX/diagnóstico | `Failed to fetch` → "Sin conexión con el servidor. Revisá internet." aunque el problema sea que Supabase está pausado/arrancando. `Invalid API key` no está mapeado → "No se pudo completar la operación". (`db.js: mensajeError`) |
| K3 | La app **no procesa links de recuperación de contraseña** | Funcional | `detectSessionInUrl: false`; no hay pantalla `type=recovery`. Hay procedimiento SQL de emergencia (P2 en `04`), pero no está en el repo. |
| K4 | Descuento de stock no varía por gama | Funcional (conocido) | Ver `03`. |
| K5 | Chasis S Básico ≈ 862 USD/m² con insumos de referencia (fuera del rango 650–800) | Datos | Efecto de los insumos de ejemplo, no un bug de cálculo. |
| K6 | **Deriva entre el ZIP y GitHub** | Mantenimiento | `config.js` real solo existe en GitHub; README con procedimiento de emergencia y `docs/` solo fuera del repo. |
| K7 | Sin historial Git en el entorno de trabajo | Mantenimiento | No hay forma de ver commits ni ramas desde aquí. En GitHub, el panel de Supabase mostraba "No branches". |

## Riesgos técnicos y de seguridad

- **Cualquier socio puede borrar cualquier registro** (política `socios_todo FOR ALL`). La auditoría cubre solo 11 de 18 tablas; **no audita** `leads`, `interacciones`, `oc_items`, `horas`, `bom_referencias`, `socios`. [CÓDIGO]
- Sesión en `sessionStorage` (legible por JavaScript): la defensa depende de que no exista XSS (hoy cubierto por escape + CSP + tests).
- El repo es **público**: expone código y la clave pública de Supabase (intencional). No expone datos.
- Dos implementaciones del cálculo de precio (cliente `engine.js` y servidor `calcular_cotizacion`) deben mantenerse equivalentes; solo las cubren tests con valores conocidos.
- El test e2e reescribe `js/config.js`; si se interrumpe puede dejar valores de prueba.

## Rendimiento

`cargarTodo()` hace 17 consultas en paralelo en cada refresco, y cada cambio de Realtime dispara otro refresco completo (el propio actor recibe además su evento). Sin paginación en `leads`, `cotizaciones`, `ventas`, `interacciones`. Es adecuado para 2 usuarios y volumen chico; degradará con crecimiento. No hay mediciones. [CÓDIGO]

## Oportunidades de optimización

Mensajes de error más precisos (K2); verificación de salud de Supabase antes del login; paginación; parametrizar condiciones de pago/validez de la cotización y `PLAZO_MAX`; ampliar auditoría; BOM por gama.

## Actualización 09/10/2026 · Trazo Fino 2.0 (local, no desplegado)

- Rama local `trazo-fino-2.0` sobre `TrazoFino_ERP_1.zip`: migraciones 01–05, frontend 2.0, documentación. **100/100 pruebas** (antes 59/59), `npm audit` 0, SRI sin cambios.
- **No aplicado en Supabase ni publicado en GitHub.** No verificado contra Supabase real, SDK real, Realtime real ni móviles.
- Bloqueantes para producción: P0-1 (salud de Supabase tras la pausa), P0-4 (respaldo verificable), comparar con el repo publicado sin pisar `js/config.js`.
- K4 (descuento de stock sin BOM por gama) **resuelto en 2.0** para las órdenes 2.0; las 1.0 conservan su comportamiento.
