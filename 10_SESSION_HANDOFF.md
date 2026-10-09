# 10 · Traspaso de sesión (leer primero)

Fecha de corte: 08/10/2026. Etiquetas de evidencia: ver `01_PROJECT_OVERVIEW.md`.

## 1. Qué estamos construyendo

Un **sistema de gestión web privado para dos socios** (Sebastian Gonzalez = Socio A, arquitectura/taller; Christian Galarza = Socio B, negocios/comercial) de la línea de **módulos habitacionales en seco de Trazo Fino**. Cubre CRM, cotizador, cómputo de materiales, stock/compras, taller y finanzas con gobernanza societaria. Frontend estático (HTML/CSS/JS sin build) en **GitHub Pages**; datos, login y reglas en **Supabase** (Postgres + Auth + Realtime, plan Free). Repo público `Christian-galarza107/Trazo-Fino`.

## 2. Qué está terminado

- Las 16 secciones del sistema, el esquema SQL (18 tablas, RLS, funciones, triggers, vistas), el motor de precio, la cotización imprimible con cláusula "Paredes Afuera", exportación CSV/JSON, 59 tests, CI y Dependabot (archivos). Detalle: `03_FEATURE_INVENTORY.md`.
- Despliegue realizado y **login confirmado por el usuario el 24–25/09/2026**; reemplazo del email del socio B realizado el 25/09.
- Documentación de seguridad (`SECURITY.md`) y manual de instalación (`README.md`).

## 3. Qué falta desarrollar o resolver

Ver `06_ROADMAP.md`. Lo más urgente: confirmar que producción volvió tras la pausa de Supabase (P0-1), verificar la configuración de seguridad (P0-2), decidir cómo evitar pausas (P0-3) y respaldos reales (P0-4). Después: sincronizar repo/documentación (P1-1), mensajes de error precisos (P1-2), recuperación de contraseña (P1-3), calibrar el cómputo con costos reales (P1-5). El visualizador 3D es una herramienta aparte y solo tiene prompts.

## 4. Decisiones que deben respetarse

(Detalle y evidencia en `04_DECISIONS.md`.)
- **PVP = Costo Directo ÷ p_costo**; porcentajes **52/9/9/30** (no 54/28); reparto 50 % reserva, 50 % dividendos 50/50.
- Gasto extraordinario **> USD 500** con firma de ambos socios; imputación si se ejecuta sin firmas ni urgencia.
- **El servidor calcula y valida** lo importante; el navegador solo previsualiza.
- **Sin dependencias nuevas sin motivo**; `supabase-js` fijo y vendorizado con SRI; sin CDN.
- **Anti-XSS por construcción:** plantilla `html\`\``, `montar()` único `innerHTML`, sin handlers/estilos en línea, CSP estricta.
- Registro público deshabilitado; socios cargados a mano. La clave pública puede estar en el repo; **la secreta/`service_role` nunca**.
- Reglas de negocio con cambios de alcance: consultar al usuario.

## 5. Archivos importantes

`supabase/schema.sql` (todo el backend) · `js/engine.js` (cálculo cliente) · `js/db.js` (acceso a datos, errores, sesión) · `js/app.js` (arranque, login, navegación) · `js/html.js` (anti-XSS) · `js/config.js` (**única edición por despliegue**) · `js/views-*.js` (pantallas) · `index.html` (CSP, SRI) · `tests/*.test.mjs` · `scripts/vendor.mjs` · `SECURITY.md` / `README.md`.

## 6. Último estado verificable

- **Verificado hoy (08/10):** sintaxis de los 15 archivos JS/MJS, coincidencia del SRI, ausencia de `eval`, de handlers/estilos en línea y de `innerHTML` fuera de `montar()`.
- **Último estado de producción conocido:** el 08/10 el proyecto Supabase se estaba **reanudando tras una pausa por inactividad** (Database y Edge Functions *Healthy*; Auth, PostgREST, Realtime y Storage *Coming up…*). El login mostraba "Sin conexión con el servidor". **No se sabe si se resolvió.**
- Tests: 59/59 el 24–25/09; **no re-ejecutados en esta auditoría**.

## 7. Errores y problemas abiertos

K1–K7 en `05_CURRENT_STATE.md`. Resumen: pausa de Supabase Free; mensajes de error engañosos; sin recuperación de contraseña; descuento de stock sin BOM por gama; deriva entre el ZIP y GitHub; sin historial Git local; controles de seguridad sin verificar; respaldos dudosos.

## 8. Siguiente paso recomendado

**P0-1:** pedir al usuario (o verificar con acceso) que en el panel de Supabase todos los servicios estén *Healthy* y que ambos socios puedan loguearse en `https://christian-galarza107.github.io/Trazo-Fino/` (con `Ctrl+F5`). Si falla con todo en verde: abrir `F12 → Console`, buscar el error real y usar el diagnóstico P4 de `04_DECISIONS.md` (llamada `fetch` directa a `/auth/v1/token`). Luego P0-2, P0-3, P0-4.

## 9. Qué evitar modificar sin autorización expresa

- Reglas de negocio (fórmula, porcentajes, reparto, umbral de USD 500) y `supabase/schema.sql` sobre producción (**no es idempotente**: volver a ejecutarlo falla o duplica datos; los cambios de esquema deben escribirse como migraciones manuales revisadas).
- `js/config.js` real (solo está en GitHub): no sobrescribirlo con el de la copia local.
- `js/vendor/supabase.js` y el `integrity` de `index.html`.
- La CSP, `js/html.js`, y las políticas RLS/permisos por columna.
- Versiones fijadas en `package.json`.
- No hacer `push`, ni cambiar configuración de Supabase/GitHub, ni borrar datos o usuarios sin aprobación. No pegar secretos en archivos ni en chats.

## 10. Instrucciones concretas para continuar

1. Clonar el repositorio de GitHub (la fuente de verdad) y copiar esta carpeta a `docs/project-memory/`.
2. Leer `CLAUDE.md` (si existe) y los documentos `01`–`10`.
3. Comparar el repo clonado con lo descrito aquí (ver lista de divergencias a revisar en `11_RESUME_PROMPT.md`) y reportar diferencias.
4. Con autorización del usuario, instalar dependencias y ejecutar `npm test`; informar el resultado real (si el e2e deja `js/config.js` modificado, restaurarlo con Git).
5. Ejecutar P0-1 junto con el usuario antes de tocar código.
6. Trabajar siguiendo el orden de `06_ROADMAP.md`; pedir autorización para cambios de alcance, reglas de negocio o esquema.
7. Al terminar cada tarea: actualizar `05_CURRENT_STATE.md` y este documento.

## Actualización 09/10/2026 · Trazo Fino 2.0

Siguiente paso: (1) confirmar Supabase *Healthy* y login; (2) respaldo `pg_dump` + JSON; (3) clonar el repo de GitHub, copiar los cambios de la rama `trazo-fino-2.0` **excepto `js/config.js`**, correr `npm test`; (4) ensayar migraciones en un proyecto Supabase de prueba; (5) aplicar 01–05 en producción, `validar_2_0.sql`; (6) publicar el frontend; (7) Sebastián carga materiales, importa su presupuesto Wood M y aprueba BOM + aprobación técnica. Procedimiento completo: `supabase/migrations/README.md`. Informe: `docs/TRAZO_FINO_2_0.md`. Decisión pendiente: N13.
