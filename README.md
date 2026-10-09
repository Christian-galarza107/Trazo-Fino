# Trazo Fino · Sistema de gestión

Sistema web privado de Trazo Fino para unidades habitacionales modulares en seco: CRM, cotizador, ingeniería de costos y materiales, stock y compras, taller, finanzas y gobernanza societaria. Lo usan solo los dos socios.

**Versión 2.0:** catálogo Wood / Iron Steel × S (24 m²) / M (48 m²) × Básico / Premium / Signature, con BOM por modelo, precios en ARS/USD y presupuestos por proyecto. Detalle en [docs/TRAZO_FINO_2_0.md](docs/TRAZO_FINO_2_0.md).

## Cómo está armado

El sistema tiene dos partes que se conectan entre sí.

La **página** (esta carpeta) se publica en GitHub Pages. Son archivos estáticos: HTML, CSS y JavaScript. GitHub da el dominio y el certificado HTTPS gratis.

La **base de datos** vive en Supabase. Guarda los datos, maneja los usuarios con contraseña encriptada y, sobre todo, **valida todo en el servidor**: precios, reparto de ganancias, firmas de gastos y stock. Si alguien manipula la página desde el navegador, la base rechaza la operación.

```
Navegador ──HTTPS──> GitHub Pages   (la página: sin datos, sin secretos)
    │
    └──HTTPS──> Supabase            (datos + usuarios + reglas de negocio)
```

Cómo se cumple cada regla de seguridad está explicado en [SECURITY.md](SECURITY.md).

---

## Instalación (una sola vez, unos 30 minutos)

### Paso 1 · Crear el proyecto en Supabase

1. Crear una cuenta en https://supabase.com (el plan gratuito alcanza).
2. **New project**. Nombre: `trazofino`. Región: **South America (São Paulo)**, la más cercana a Argentina.
3. Anotar la contraseña de la base en un gestor de contraseñas. **No va en ningún archivo del proyecto.**

### Paso 2 · Crear las tablas y las reglas

1. En Supabase: **SQL Editor → New query**.
2. Copiar y pegar **todo** el contenido de `supabase/schema.sql`.
3. **Run**. Tiene que terminar con *Success. No rows returned*.

Esto crea 18 tablas, las reglas de validación, la seguridad por fila y el catálogo 1.0: reglas de precio 52/9/9/30, las tres gamas, los adicionales y los insumos de referencia.

4. Aplicar, en orden y de a uno, los archivos `supabase/migrations/20261008_01…05_*.sql` (catálogo 2.0). En una base **que ya está en uso** no se vuelve a ejecutar `schema.sql`: se siguen los pasos de [supabase/migrations/README.md](supabase/migrations/README.md), con respaldo previo.

### Paso 3 · Cerrar el registro público

Los nombres exactos de los menús de Supabase pueden cambiar un poco. Lo importante es la configuración:

1. **Authentication → Sign In / Providers**: **desactivar** *Allow new users to sign up*. Nadie puede crearse una cuenta desde la web.
2. En el proveedor **Email**: *Minimum password length* en **12** y exigir letras y números.
3. Si la opción está disponible en tu plan, activar la **protección contra contraseñas filtradas** (*leaked password protection*).

### Paso 4 · Crear los dos usuarios socios

1. **Authentication → Users → Add user → Create new user**. Cargar el email y una contraseña de al menos 12 caracteres. Marcar *Auto Confirm User*.
2. Repetir para el otro socio.
3. En **SQL Editor**, habilitarlos como socios (cambiar emails y nombres):

```sql
insert into public.socios (user_id, nombre, rol)
select id, 'Nombre del Arquitecto', 'A' from auth.users where email = 'arquitecto@ejemplo.com';

insert into public.socios (user_id, nombre, rol)
select id, 'Christian Galarza', 'B' from auth.users where email = 'christian@ejemplo.com';
```

El rol **A** es el Socio Arquitecto (producto y taller) y el **B** el Socio de Negocios (comercial y digital). Cada uno solo puede firmar su propia aprobación en los gastos extraordinarios.

> Un usuario que existe en Authentication pero **no** está en `socios` puede iniciar sesión, pero no ve ni modifica nada: la base le devuelve cero filas.

### Paso 5 · Conectar la página con la base

1. En Supabase: **Project Settings → API Keys**. Copiar la **URL del proyecto** y la clave pública (*publishable key*, o *anon public key* en proyectos anteriores).
2. Abrir `js/config.js` y reemplazar:
   - `https://TU-PROYECTO.supabase.co` por tu URL
   - `PEGAR-ACA-LA-ANON-PUBLIC-KEY` por la clave pública

> ⚠️ **Nunca** pegues la *secret key* ni la *service_role key*. Esas claves saltean toda la seguridad y no deben salir del panel de Supabase. La clave pública sí puede estar en el código: sin usuario y contraseña de socio no abre nada.

### Paso 6 · Publicar en GitHub

1. Crear un repositorio nuevo en GitHub, por ejemplo `trazofino`.
   - En el plan gratuito, GitHub Pages requiere que el repositorio sea **público**. Eso significa que el código se ve, pero **no hay ningún dato ni secreto en él**: los datos están en Supabase, detrás del login.
2. Subir todos los archivos de esta carpeta (menos `node_modules`, que ya está excluido en `.gitignore`).
3. **Settings → Pages**: *Source* = *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. Esperar uno o dos minutos y marcar **Enforce HTTPS**.
5. La página queda en `https://TU-USUARIO.github.io/trazofino/`.

### Paso 7 · Avisarle a Supabase cuál es tu sitio

**Authentication → URL Configuration → Site URL**: pegar la dirección del paso anterior.

### Paso 8 (opcional) · Anti-bots en el login

Para frenar robots que prueben contraseñas:

1. Crear un widget gratuito en **Cloudflare Turnstile** (https://dash.cloudflare.com → Turnstile) con el dominio `TU-USUARIO.github.io`.
2. En Supabase: **Authentication → Attack Protection** (o *Bot and Abuse Protection*), activar CAPTCHA con Turnstile y pegar la **secret key** de Cloudflare. Esa clave queda solo en Supabase.
3. En `js/config.js`, completar `TURNSTILE_SITE_KEY` con la **site key**, que es pública.

---

## Uso diario

- Entrar a la dirección del sitio con tu email y contraseña.
- La sesión se cierra sola a los 30 minutos sin uso y al cerrar la pestaña.
- Los cambios del otro socio aparecen solos, sin recargar.
- Para cambiar la contraseña: **Cambiar contraseña**, abajo a la izquierda.
- Si olvidás la contraseña, el otro socio no puede verla: se resetea desde Supabase, en **Authentication → Users**.

## Respaldos

El plan gratuito de Supabase **no garantiza respaldos automáticos**. Hacer copias propias con regularidad: **Exportar datos** (CSV y JSON completo) y, antes de cualquier migración, un `pg_dump` (ver `supabase/migrations/README.md`). Guardarlas fuera de Supabase.

## Publicar una versión nueva y revertirla

1. Revisar los cambios de la rama (`git diff main...trazo-fino-2.0`) y correr `npm test`.
2. Si hay migraciones, aplicarlas y validarlas **antes** de publicar el frontend.
3. Fusionar la rama en `main` (GitHub Pages publica `main`). **No subir `js/config.js` del ZIP**: el real está solo en GitHub.
4. Revertir el frontend: en GitHub, *Revert* del commit de fusión (o `git revert -m 1 <commit>` y `git push`). Pages vuelve a publicar la versión anterior en uno o dos minutos.

## Mantenimiento de dependencias

El proyecto tiene una sola dependencia que llega al navegador: la librería oficial de Supabase, fijada en `package.json` y copiada en `js/vendor/`.

- **Dependabot** revisa todas las semanas si hay versiones nuevas o problemas de seguridad y abre un *pull request* automático.
- **La integración continua** (`.github/workflows/ci.yml`) corre las 100 pruebas y la auditoría de seguridad en cada cambio.

Cuando Dependabot proponga actualizar `@supabase/supabase-js`, la prueba va a fallar a propósito hasta que se regenere la copia local:

```bash
npm install
npm run vendor     # copia la librería y actualiza su huella de integridad en index.html
npm test
git commit -am "Actualizar supabase-js" && git push
```

## Estructura

```
index.html                  Página única con la política de seguridad de contenido
css/app.css                 Estilos (modo claro y oscuro automático)
assets/logo.png
js/config.js                URL y clave pública de Supabase  ← lo único que se edita
js/app.js                   Inicio de sesión, navegación, eventos, tiempo real
js/db.js                    Acceso a datos
js/engine.js                Motor de cálculo (vista previa del cotizador)
js/html.js                  Plantillas con escape automático (anti-XSS)
js/ui.js                    Formularios y avisos
js/views-*.js               Pantallas por área
js/vendor/supabase.js       Librería oficial, copia local fijada
js/views-ingenieria.js      Ingeniería de costos: materiales, BOM, presupuestos, comparador, precios
js/views-catalogo.js        Catálogo de productos 2.0 y análisis por línea
supabase/schema.sql         Base de datos 1.0 (instalación inicial; no se re-ejecuta)
supabase/migrations/        Migraciones 2.0 versionadas, validación y reversión
docs/                       Informe 2.0 y memoria del proyecto
tests/                      100 pruebas automáticas
scripts/vendor.mjs          Actualiza la copia local de la librería
```

## Pruebas

Requieren Node.js 20 o superior:

```bash
npm install
npm test
```

Hay seis grupos de pruebas:

- **engine**: la fórmula de precio y el reparto coinciden con el modelo Excel.
- **schema**: el esquema 1.0 rechaza 16 ataques y violaciones de reglas.
- **migracion**: las migraciones 2.0 no pierden ni cambian datos 1.0 y cumplen las reglas del catálogo, costos, presupuestos, producción y seguridad.
- **reversion**: revertir deja el esquema idéntico al 1.0.
- **views**: las 23 pantallas muestran datos maliciosos sin ejecutarlos.
- **e2e**: la aplicación completa en un navegador simulado, del login al cierre de sesión.

Las pruebas usan PostgreSQL real en WebAssembly (PGlite) y un cliente Supabase simulado: **no reemplazan una prueba contra un proyecto Supabase real** (staging).
