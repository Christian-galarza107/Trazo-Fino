# 04 · Registro de decisiones

Estado: **Vigente** · **Provisional** (solución de emergencia o supuesto) · **Pendiente** (sin resolver) · **Reemplazada**.
Las decisiones del usuario provienen de la conversación; solo se marcan [CÓDIGO] cuando además se verificó en archivos. Etiquetas: ver `01_PROJECT_OVERVIEW.md`.

## Negocio

| # | Decisión | Motivo | Estado | Evidencia |
|---|---|---|---|---|
| N1 | La empresa se llama **Trazo Fino** (antes "Custom Frame"). | Es el nombre real de la sociedad. | Vigente | Conversación; `params.nombre_empresa` [CÓDIGO] |
| N2 | **PVP = Costo Directo ÷ p_costo** (división). | Regla del pacto ("imperativa"): un recargo del 52 % sobre costo perdería margen. | Vigente | `engine.js`, `calcular_cotizacion()`, Documento Marco cl. 4.1.1 [CÓDIGO] |
| N3 | Porcentajes **52/9/9/30**, aunque el Master Prompt decía 54/28. | Pedido explícito del usuario: "mantener las reglas que teníamos". | Vigente | Conversación; seed `params` [CÓDIGO] |
| N4 | Ganancia: 50 % reserva no distribuible; 50 % dividendos repartidos 50/50. | Pacto de socios. | Vigente | `params`, `v_ventas` [CÓDIGO] |
| N5 | Gasto > USD 500 requiere firma de ambos; sin firma ni urgencia justificada se imputa a quien lo ejecutó. | Gobernanza societaria (cl. 3.5). | Vigente | Trigger `tg_gastos`, vista `v_gastos` [CÓDIGO] |
| N6 | Solo **dos socios** con roles únicos: A (Sebastian Gonzalez, arquitectura/taller) y B (Christian Galarza, negocios). | Estructura de la sociedad. | Vigente | `socios.rol unique` [CÓDIGO]; conversación |
| N7 | El sistema cubre **solo la línea de módulos**. | Supuesto asumido por defecto. | **Pendiente**: el usuario nunca respondió si debe incluir la construcción tradicional de Trazo Fino. | Conversación |
| N8 | Los insumos cargados son **referenciales**; hay que calibrarlos con el primer prototipo y registrar una referencia. | No hay costos reales todavía. | Pendiente | Conversación; seed [CÓDIGO] |
| N9 | Mediador externo a los 14 días ante conflicto; límite de gasto extraordinario USD 500. | Pacto de socios (Documento Marco). | Vigente (el mediador no está en el sistema) | `Documento_Marco_CustomFrame.docx` [resumen de sesión] |

## Arquitectura y seguridad

| # | Decisión | Motivo | Estado | Evidencia |
|---|---|---|---|---|
| A1 | **GitHub Pages (estático) + Supabase** (Postgres, Auth, RLS). | El usuario pidió publicar en GitHub para uso de dos personas y cumplir 9 reglas de seguridad; GitHub Pages no tiene servidor, así que validación y secretos deben vivir en la base. | Vigente | `SECURITY.md` [CÓDIGO] |
| A2 | **Toda regla importante se valida/calcula en el servidor** (funciones `security definer`, triggers, CHECKs). El navegador solo pre-valida y previsualiza. | "El navegador no es de confianza"; el PVP no se puede manipular. | Vigente | `schema.sql`, `tests/schema.test.mjs` [CÓDIGO] |
| A3 | La **clave pública (anon/publishable)** va en `config.js` y en el repo público; la clave secreta/`service_role` **nunca**. | La seguridad la da RLS, no ocultar la clave. | Vigente | Comentario en `config.js` [CÓDIGO]. GitHub marcó un aviso de "secret scanning" por el prefijo `sb_`; se indicó descartarlo como falso positivo (no consta que se haya hecho). |
| A4 | **Registro público deshabilitado**; los socios se crean a mano en Auth y se vinculan por SQL a `socios`. | Solo dos usuarios. | Vigente como decisión; **aplicación en Supabase NO verificada** | README paso 3 |
| A5 | Sesión en **`sessionStorage`** + PKCE; sin cookies `httpOnly`. | GitHub Pages no puede emitirlas. Se mitiga con CSP, cierre por inactividad y tokens de corta vida. | Vigente | `db.js:23-28`, `SECURITY.md` §7 [CÓDIGO] |
| A6 | **CSP estricta**; sin handlers ni estilos en línea; eventos delegados con `data-action`. | Barrera principal contra XSS. | Vigente | `index.html`, `app.js` [CÓDIGO] |
| A7 | **Plantilla `html\`...\`` con escape automático**; `montar()` es el único `innerHTML`. | Hacer imposible olvidarse de escapar. | Vigente | `html.js:33-36` [CÓDIGO] |
| A8 | `supabase-js` **vendorizado** (versión fija 2.117.1) con **SRI**, sin CDN. | Regla 9 (dependencias seguras); evitar terceros. | Vigente | `scripts/vendor.mjs`; SRI coincide [CÓDIGO] |
| A9 | Se reemplazaron Tailwind, Chart.js y Lucide por CSS propio y gráficos en CSS. | Menos dependencias = menos superficie de ataque. | Vigente | `css/app.css` [CÓDIGO] |
| A10 | Sin "switcher de roles", sin `localStorage` offline, sin importación JSON. | La identidad sale del login real; los datos viven en Supabase. | Vigente | Conversación |
| A11 | Turnstile (anti-bots) **opcional**, desactivado. | Complejidad adicional; se puede activar luego. | Pendiente | `config.js: TURNSTILE_SITE_KEY=''` [CÓDIGO] |
| A12 | El esquema **no** crea la extensión `pgcrypto` (usa `gen_random_uuid()` nativo). | PGlite no la trae y Supabase no la necesita para el esquema. | Vigente | `schema.sql` [CÓDIGO]. Para el reseteo de contraseña por SQL sí hay que crearla (ver P2). |
| A13 | Mensajes de error genéricos hacia el usuario ("No se pudo completar la operación"). | No filtrar detalles internos. | Vigente, **con efecto secundario**: dificultó el diagnóstico (ver `09`). | `db.js: mensajeError()` [CÓDIGO] |
| A14 | Plan **Free** de Supabase. | Costo cero para arrancar. | **Pendiente de revisión**: el plan pausa proyectos tras 7 días sin actividad (ocurrió el 08/10). | Conversación; docs de Supabase |

## Procedimientos operativos (aprendidos en el despliegue)

| # | Procedimiento | Estado |
|---|---|---|
| P1 | **Subida a GitHub por la web:** subir **carpeta por carpeta** (`js`, `css`, `assets`, `supabase`, `scripts`, `tests`, `.github`) y los archivos sueltos al final; verificar que `index.html` quede en la raíz. Arrastrar todo junto aplanó la estructura o anidó una carpeta contenedora. | Vigente |
| P2 | **Reseteo de contraseña de emergencia por SQL**, porque el panel no ofrecía fijar contraseña a mano y el link de recuperación no funciona con la app: `create extension if not exists pgcrypto with schema extensions; update auth.users set encrypted_password = crypt('<nueva>', gen_salt('bf')) where email = '<email>';`. | **Provisional**. La sección estaba en un README que no llegó al repo. |
| P3 | **Alta/reemplazo de socio:** crear usuario en Auth (contraseña ≥ 12, confirmación automática), `delete from public.socios where rol = 'X'` si reemplaza, `insert into public.socios ... select id ... from auth.users where email = ...`, verificar con `select * from public.socios`. El cambio es inmediato. Usado el 25/09 para reemplazar el email del socio B. | Vigente |
| P4 | **Diagnóstico de login:** si falla sin razón, llamar a `/auth/v1/token?grant_type=password` con `fetch` desde la consola del navegador para ver el error real (la UI lo oculta). Causa real de la falla del 24/09: `SUPABASE_ANON_KEY` quedó con un texto de ejemplo pegado (`...(el resto de la clave)`) → `Invalid API key`. | Vigente |

## Herramienta 3D (no iniciada)

| # | Decisión | Estado |
|---|---|---|
| V1 | Visualizador 3D como **página aparte** (no integrada al ERP), estilo maqueta/boceto técnico, no fotorrealista. | Vigente |
| V2 | Configurador **exterior primero** (módulos S/M editables, apilar/en línea, deck opcional, cámara, color por gama con leyenda); **interior** como segunda etapa (paredes, mobiliario, aberturas). | Vigente; solo existen los prompts |
| V3 | Referencia visual: render tipo "Concept" de casa con contenedores apilados y deck (imagen provista por el usuario; el post de Instagram no pudo leerse). | Informativo |

## Trazo Fino 2.0 (08–09/10/2026)

| # | Decisión | Estado | Evidencia |
|---|---|---|---|
| N10 | Catálogo definitivo: Wood / Iron Steel × S 24 m² / M 48 m² × Básico / Premium / Signature (12 códigos `TF-…`). Signature solo a pedido. | Vigente | Pedido del usuario; `migrations/05` [CÓDIGO] |
| N11 | Enterprise no se renombra: queda gama histórica; Signature es gama nueva. Nombres de gama inmutables. | Vigente | `migrations/03` (trigger) [CÓDIGO] |
| N12 | Sin costos inventados: ningún modelo se cotiza sin aprobación técnica + BOM aprobado + precios confirmados. Precio faltante = pendiente, nunca cero. | Vigente | `calcular_cotizacion_v2` [CÓDIGO] |
| N13 | Aprobación de BOM, sustituciones y validación Signature: cualquiera de los socios, con registro de quién. | **Pendiente de confirmar** (¿solo Socio A? ¿doble firma?) | `docs/TRAZO_FINO_2_0.md` D2 |
| N14 | Descuentos se informan aparte; no alteran la fórmula del PVP. | Vigente | D3 |
| A15 | Cambios de esquema solo como migraciones versionadas en `supabase/migrations/`, transaccionales, con validación y reversión. | Vigente | [CÓDIGO] |
