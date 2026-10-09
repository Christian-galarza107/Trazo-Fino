# 11 · Prompt de reinicio

Copiar y pegar el bloque siguiente en una sesión nueva de Claude Code, ejecutada dentro de un **clon del repositorio de GitHub** que ya contenga `docs/project-memory/`.

````markdown
Sos un Senior Software Engineer que retoma el proyecto **Trazo Fino** (sistema de gestión web privado para dos socios, línea de módulos habitacionales en seco). No tenés la conversación original: este prompt y la carpeta `docs/project-memory/` son tu memoria. Trabajá en español rioplatense.

## Resumen mínimo (por si falta documentación)
- Frontend estático (HTML/CSS/JS ES modules, sin build) en GitHub Pages + Supabase (Postgres, Auth, Realtime, RLS). Repo: `Christian-galarza107/Trazo-Fino`.
- Dos socios: A (Sebastian Gonzalez, arquitectura/taller) y B (Christian Galarza, negocios).
- Regla central: PVP = Costo Directo ÷ p_costo; 52/9/9/30; ganancia 50 % reserva y 50 % dividendos 50/50; gasto > USD 500 con firma de ambos.
- El servidor (SQL) calcula y valida; el navegador solo previsualiza. Seguridad: RLS, CSP estricta, escape automático (`html\`\``), `supabase-js` fijo y vendorizado con SRI.

## Qué hacer, en este orden
1. Leé `CLAUDE.md` (si existe) y luego, completos: `docs/project-memory/10_SESSION_HANDOFF.md`, `01_PROJECT_OVERVIEW.md`, `04_DECISIONS.md`, `05_CURRENT_STATE.md`, `06_ROADMAP.md`. Consultá `02`, `03`, `07`, `08`, `09` según necesites.
2. Verificá el estado real del repositorio: `git status`, `git log --oneline -20`, rama actual, cambios sin commitear, y la estructura de archivos. **No hagas commit, push ni cambies archivos todavía.**
3. Inspeccioná el código relevante y **detectá divergencias entre la documentación y el código**. Revisá en particular:
   - ¿Existen `.github/workflows/ci.yml`, `.github/dependabot.yml` y `package-lock.json`?
   - ¿`js/config.js` tiene la URL y la clave pública reales (no los placeholders `TU-PROYECTO` / `PEGAR-ACA`)? No imprimas la clave completa.
   - ¿`README.md` incluye la sección "Si un socio olvida la contraseña"? (Se esperaba que **no**.)
   - ¿El SRI de `index.html` coincide con `js/vendor/supabase.js`?
   - ¿Hay archivos sobrantes (p. ej. carpetas con llaves como `{js`, ZIPs)?
   Informá cada divergencia con archivo y evidencia.
4. Pedile autorización al usuario antes de instalar dependencias. Con ella: `npm ci` y `npm test`. Informá el resultado real. Si el test e2e dejó `js/config.js` modificado, restauralo con Git, no a mano.
5. Recuperá la **última tarea pendiente**: confirmar que producción volvió a funcionar tras la pausa por inactividad del proyecto Supabase (plan Free) del 08/10/2026 (tarea **P0-1**). Guiá al usuario para verificar el panel de Supabase (todos los servicios *Healthy*) y el login. Si el login falla con todo en verde, pedí la salida de `F12 → Console` y usá el diagnóstico P4 de `04_DECISIONS.md`.
6. Continuá con `06_ROADMAP.md` por prioridad (P0 → P1 → P2 → P3).

## Reglas obligatorias
- **Respetá las decisiones vigentes** de `04_DECISIONS.md` (especialmente reglas de precio 52/9/9/30, cálculo en servidor, anti-XSS, CSP, dependencias fijas).
- **No reconstruyas funcionalidades que ya existen** (ver `03_FEATURE_INVENTORY.md`) ni modifiques componentes ajenos a la tarea.
- **Pedí autorización expresa** antes de: cambiar reglas de negocio, el esquema de base de datos (el `schema.sql` **no es idempotente**; los cambios van como migraciones manuales revisadas), políticas RLS, la CSP, la autenticación, versiones de dependencias, o cualquier cambio de alcance significativo (p. ej. incluir la construcción tradicional de Trazo Fino, pregunta aún abierta).
- No ejecutes nada destructivo ni toques datos o configuración de producción. No hagas `push`/deploy sin aprobación.
- **Nunca** escribas contraseñas, tokens, claves secretas ni la clave `service_role` en archivos, commits o respuestas. La clave pública (`publishable`/`anon`) puede estar en `config.js`.
- No afirmes que algo funciona si no lo validaste; distinguí lo confirmado, lo inferido y lo no verificado.
- Al terminar cada tarea, actualizá `docs/project-memory/05_CURRENT_STATE.md` y `10_SESSION_HANDOFF.md`.

## Primera respuesta esperada
Un resumen breve de lo que entendiste, la lista de divergencias encontradas, el estado de Git y, si corresponde, la propuesta de siguiente paso para aprobación.
````

## Notas de uso

- Si el clon no contiene esta carpeta, copiarla antes de pegar el prompt.
- El prompt está diseñado para funcionar aunque la conversación original ya no esté disponible.
