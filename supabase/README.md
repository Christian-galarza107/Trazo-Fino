# Migraciones Trazo Fino 2.0

`supabase/schema.sql` es el esquema **1.0** y **no se vuelve a ejecutar** sobre la base existente (no es idempotente). Los cambios de 2.0 viven acá, en archivos versionados que se aplican **una sola vez, en orden**.

| Archivo | Qué hace | Toca datos existentes |
|---|---|---|
| `20261008_01_estructuras_2_0.sql` | Tablas nuevas: productos, BOM, presupuestos, tipos de cambio, historial de precios, sustituciones, intereses de leads. RLS activada y rol anónimo cerrado en la misma transacción. | No |
| `20261008_02_referencias_2_0.sql` | Columnas opcionales en gamas, insumos, leads, cotizaciones, ventas y fabricación. Lo existente queda marcado como generación `1.0`. | Solo copia `costo` → `costo_original` en insumos (mismo valor, USD) |
| `20261008_03_funciones_vistas_2_0.sql` | Motor 2.0, triggers, vistas. Reemplaza con la **misma firma** `calcular_cotizacion`, `convertir_cotizacion` y `descontar_materiales` (idénticas para registros 1.0). Amplía `insumos.costo` de 2 a 4 decimales. | No cambia valores |
| `20261008_04_seguridad_2_0.sql` | Políticas RLS explícitas, permisos por columna, auditoría y Realtime. | No |
| `20261008_05_seed_catalogo_2_0.sql` | 12 productos (sin costos), gama Signature, Enterprise marcada histórica, matriz de adicionales vacía. | Agrega filas; no modifica las existentes salvo `gamas.generacion/vigente` |
| `inventario_previo.sql` | Cifras de control, **antes** de migrar (solo lectura). | No |
| `validar_2_0.sql` | Controles posteriores (solo lectura). Todas las filas `ok` deben ser `true`. | No |
| `revertir_2_0.sql` | Vuelve exactamente al esquema 1.0 **solo si todavía no hay datos 2.0**. Si los hay, se niega: hay que restaurar el respaldo. | Borra solo estructuras 2.0 vacías |

Cada archivo es una transacción (`begin … commit`) que primero verifica que la anterior esté aplicada y que la propia no lo esté. Si algo falla, no queda nada a medias; si el editor muestra un error, ejecutar `rollback;` antes de seguir.

## Procedimiento (producción)

**0. Antes de tocar nada**
1. Panel de Supabase: todos los servicios en *Healthy* (el proyecto se pausó el 08/10/2026). Login de ambos socios funcionando con el frontend 1.0.
2. **Respaldo verificable.** El plan Free no garantiza respaldos. Opciones: `pg_dump` con la cadena de conexión (*Project Settings → Database*), o el botón *Download backup* si el plan lo ofrece. Además, en la app: *Exportar datos → Descargar copia* (JSON). Guardar fuera de Supabase.
   ```bash
   pg_dump "postgresql://postgres.[ref]:[CONTRASEÑA]@[host]:5432/postgres" --schema=public --no-owner -Fc -f trazofino_pre_2_0.dump
   ```
   La contraseña de la base va solo en la terminal, nunca en un archivo del repositorio.
3. **Ensayo en una copia aislada (recomendado).** Crear un proyecto Supabase de prueba, ejecutar `supabase/schema.sql`, restaurar el respaldo (`pg_restore --data-only --no-owner -d … trazofino_pre_2_0.dump`) y aplicar las migraciones ahí primero. Si no hay staging, como mínimo correr `npm test`, que aplica las migraciones sobre PostgreSQL real (PGlite) con datos 1.0.
4. Ejecutar `inventario_previo.sql` y guardar el resultado.

**1. Aplicar** — SQL Editor → *New query*, pegar y ejecutar **un archivo por vez**, en orden 01 → 05. Cada uno debe terminar sin error.

**2. Validar** — Ejecutar `validar_2_0.sql`. Todas las filas con `ok = true`; las filas 20–26 deben coincidir con el inventario previo.

**3. Publicar el frontend** — Recién ahora (el frontend 2.0 necesita las tablas nuevas). Ver README principal.

**4. Verificar en la app** — Login de los dos socios, Panel sin errores, Cotizaciones 1.0 visibles con sus valores originales, Catálogo de productos con 12 modelos, cambios de un socio visibles para el otro (Realtime).

## Si algo sale mal

| Situación | Qué hacer |
|---|---|
| Error durante una migración | Nada quedó aplicado de ese archivo. `rollback;`, leer el mensaje, corregir la causa y volver a ejecutar **ese** archivo. |
| Migrado, sin uso de 2.0, se quiere volver atrás | Publicar el frontend 1.0 y ejecutar `revertir_2_0.sql`. Deja el esquema idéntico al 1.0 (probado en `tests/reversion.test.mjs`). |
| Ya se cargaron datos 2.0 y hay un problema grave | `revertir_2_0.sql` se niega. Restaurar el respaldo del paso 0 en un proyecto nuevo o sobre el actual, y avisar antes al otro socio. |
| El frontend 2.0 falla pero la base está bien | Volver a publicar el commit anterior (ver README → "Revertir el frontend"). El frontend 1.0 es compatible por diseño con la base migrada (lee las mismas columnas; las funciones 1.0 conservan su firma), pero **esa combinación no tiene prueba automática**: verificarla en staging. |
