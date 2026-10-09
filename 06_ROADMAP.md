# 06 · Hoja de ruta

Prioridades: **P0** crítico (impide el uso seguro) · **P1** alto · **P2** medio · **P3** bajo.
Las tareas son propuestas; las de alcance significativo requieren autorización del usuario. Etiquetas: ver `01_PROJECT_OVERVIEW.md`.

**Última tarea verificable en curso:** reanudación del proyecto Supabase tras la pausa del 08/10/2026.
**Siguiente paso lógico:** P0-1.

---

## P0 — Crítico

### P0-1 · Confirmar que producción volvió a funcionar
- **Objetivo:** que ambos socios puedan iniciar sesión en el sitio publicado.
- **Justificación:** el 08/10 Auth/PostgREST/Realtime seguían "Coming up…" y el login mostraba "Sin conexión". Resultado final desconocido.
- **Archivos:** ninguno (verificación operativa). Panel de Supabase + sitio de GitHub Pages.
- **Dependencias:** acceso del usuario al panel.
- **Riesgos:** que el proyecto no se reanude, o que haya quedado en estado no saludable (en ese caso, soporte de Supabase).
- **Aceptación:** todos los servicios en *Healthy*; login exitoso de los dos socios; Panel carga datos; sin errores en consola.
- **Validación:** captura del panel + login real + `F12 → Console` sin errores rojos.

### P0-2 · Verificar la configuración de seguridad de Supabase
- **Objetivo:** confirmar que el registro público está deshabilitado y la política de contraseñas aplicada.
- **Justificación:** son controles declarados en `README`/`SECURITY.md` cuya aplicación nunca se confirmó (ver `05`).
- **Archivos:** ninguno (panel: Authentication → Sign In/Providers, Email; Attack Protection; URL Configuration).
- **Riesgos:** cuentas basura o intentos masivos de login si está abierto (el acceso a datos igual lo frena RLS).
- **Aceptación:** "Allow new users to sign up" desactivado; mínimo de contraseña ≥ 12 si el plan lo permite; Site URL = URL de GitHub Pages.
- **Validación:** capturas del panel; intento de alta desde la API con la clave pública debe fallar.

### P0-3 · Definir cómo evitar nuevas pausas
- **Objetivo:** que el sistema no vuelva a quedar inaccesible por inactividad.
- **Justificación:** el plan Free pausa proyectos tras 7 días sin actividad suficiente. Opciones: (a) uso semanal de ambos socios; (b) plan Pro (USD 25/mes, sin pausa); (c) tarea programada en GitHub Actions que consulte la base cada ~3 días.
- **Archivos (si se elige c):** nuevo `.github/workflows/keepalive.yml`.
- **Dependencias:** **decisión del usuario** (costo vs automatización).
- **Riesgos:** (c) no está verificado que una consulta sin sesión cuente como actividad; requiere comprobarlo. Usar solo la clave pública, nunca la secreta.
- **Aceptación:** mecanismo elegido y probado durante ≥ 10 días sin pausa.
- **Validación:** historial de ejecuciones de Actions / actividad en el panel.

### P0-4 · Respaldos reales de los datos
- **Objetivo:** tener copia de seguridad que no dependa de una suposición.
- **Justificación:** el plan Free probablemente no incluye respaldos; el README y la pantalla Exportar afirman lo contrario. Hay riesgo de pérdida de datos de negocio.
- **Archivos:** `README.md`, texto de `vExportar` en `views-finanzas.js` (corregir la afirmación); eventualmente procedimiento de `pg_dump`.
- **Riesgos:** falsa sensación de seguridad.
- **Aceptación:** confirmar en la documentación oficial qué respaldo existe; rutina documentada (p. ej., exportación JSON/CSV semanal guardada fuera de Supabase).
- **Validación:** restaurar una copia de prueba en un proyecto vacío.

---

## P1 — Alto

### P1-1 · Sincronizar el repositorio con la documentación y la realidad
- **Objetivo:** que GitHub contenga README con el procedimiento de reseteo de contraseña, `docs/project-memory/` y `docs/CONTEXTO`.
- **Justificación:** hoy esa información existe solo fuera del repo (K6).
- **Archivos:** `README.md`, `docs/`.
- **Aceptación:** `main` contiene esos archivos; `js/config.js` real **no se sobrescribe**.
- **Validación:** diff contra el repo publicado.

### P1-2 · Mensajes de error precisos en el login
- **Objetivo:** distinguir "servidor pausado/iniciando", "clave de API inválida", "credenciales incorrectas" y "sin internet".
- **Justificación:** K2; hizo perder horas de diagnóstico.
- **Archivos:** `js/db.js` (`mensajeError`), posiblemente `js/app.js` (comprobación previa de salud).
- **Riesgos:** no filtrar detalles sensibles (decisión A13). Mensajes técnicos solo para casos de configuración.
- **Aceptación:** cada caso muestra un texto distinto y accionable; tests actualizados.
- **Validación:** pruebas con cliente falso + prueba manual con clave inválida y proyecto pausado.

### P1-3 · Pantalla de recuperación de contraseña (o decisión de no tenerla)
- **Objetivo:** permitir que un socio defina contraseña nueva desde el link de recuperación, o dejar documentado el procedimiento SQL como método oficial.
- **Justificación:** K3. La app ignora `type=recovery`.
- **Archivos:** `js/app.js`, `js/db.js`, `index.html`; si se construye, requiere ajustar `detectSessionInUrl` y PKCE.
- **Dependencias:** decisión del usuario (alcance).
- **Riesgos:** tocar el flujo de autenticación; mantener CSP.
- **Aceptación:** un socio restablece su contraseña sin acceso al SQL Editor.
- **Validación:** prueba manual con email real + test e2e extendido.

### P1-4 · Verificar el estado real del repositorio y de CI
- **Objetivo:** confirmar que `.github/workflows/ci.yml` y Dependabot existen y funcionan.
- **Aceptación:** última ejecución del CI en verde; Dependabot activo.
- **Validación:** pestaña Actions de GitHub.

### P1-5 · Calibrar el cómputo con datos reales
- **Objetivo:** reemplazar los insumos de referencia por costos reales y registrar la referencia (activa la alerta del 10 %).
- **Justificación:** N8, K5.
- **Archivos:** datos (UI Cómputo); sin cambios de código.
- **Dependencias:** costos del primer prototipo (Socio A).
- **Aceptación:** PVP/m² de cada gama dentro de rango o rango/coeficiente revisados por los socios; `bom_referencias` con una fila calibrada.

---

## P2 — Medio

### P2-1 · BOM por gama (descuento de stock fiel)
- **Objetivo:** que las gamas Premium/Enterprise tengan su propia lista de materiales.
- **Archivos:** `schema.sql` (nueva tabla o columnas), `descontar_materiales`, `calcular_cotizacion`, `engine.js`, `views-produccion.js`, tests.
- **Riesgos:** cambia la fórmula de costo; **requiere autorización** (cambio de reglas de negocio); migración sobre datos reales.
- **Aceptación:** costo y descuento de stock coinciden entre cliente, servidor y tests.

### P2-2 · Ampliar la auditoría
- **Objetivo:** cubrir `leads`, `interacciones`, `oc_items`, `horas`, `bom_referencias`.
- **Archivos:** bloque de triggers en `schema.sql` (migración).
- **Aceptación:** cambios en esas tablas aparecen en la vista Auditoría.

### P2-3 · Roles/permisos de borrado
- **Objetivo:** evaluar si ambos socios deben poder borrar cualquier registro (hoy sí).
- **Dependencias:** decisión societaria.

### P2-4 · Parametrizar valores fijos en código
- Condiciones de pago 40/40/20 y validez de 15 días (`imprimirCotizacion`), `PLAZO_MAX` de 60 días, umbrales de `engine.js` → mover a `params` o configuración.

### P2-5 · Paginación y eficiencia de carga
- Solo cuando el volumen lo justifique; evitar el doble refresco del propio actor.

### P2-6 · Activar Turnstile (opcional)
- Crear widget en Cloudflare, configurar el CAPTCHA en Supabase y completar `TURNSTILE_SITE_KEY`.

---

## P3 — Bajo

### P3-1 · Visualizador 3D de módulos (herramienta aparte)
- **Estado:** solo prompts. Fase 1: exterior (módulos S/M editables, apilar/en línea, deck opcional, cámara, color por gama con leyenda). Fase 2: interior (paredes, mobiliario con colisiones, aberturas).
- **Archivos:** proyecto nuevo, independiente del ERP (no tocar este repo).
- **Riesgos:** el interior es un salto grande de complejidad; calidad esquemática, no fotorrealista.

### P3-2 · Importación de datos / carga masiva (no existe hoy).
### P3-3 · Decidir si el sistema abarca la construcción tradicional (pregunta abierta N7). Si la respuesta es sí, pasa a P1 por su impacto en el modelo de datos.
