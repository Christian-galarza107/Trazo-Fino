-- =====================================================================
--  TRAZO FINO 2.0 · Validación posterior a la migración (solo lectura)
--  Ejecutar en el SQL Editor después de las migraciones 01–05.
--  Todas las filas deben tener ok = true. Las filas con ok = null son
--  informativas: compararlas con el inventario previo (inventario_previo.sql).
-- =====================================================================
select * from (
  select 1 as n, 'Migraciones 2.0 aplicadas' as control,
         (select string_agg(version, ', ' order by version) from public.schema_migraciones) as detalle,
         (select count(*) from public.schema_migraciones where version like '2026.10.08-0%') = 5 as ok
  union all
  select 2, 'Productos 2.0 (deben ser 12)', (select count(*)::text from public.productos),
         (select count(*) from public.productos) = 12
  union all
  select 3, 'Combinaciones únicas tecnología × tamaño × gama',
         (select count(distinct (tecnologia, tamano, gama))::text from public.productos),
         (select count(distinct (tecnologia, tamano, gama)) from public.productos) = 12
  union all
  select 4, 'Ningún Signature publicado como Activo',
         (select count(*)::text from public.productos where gama = 'Signature' and estado_comercial = 'Activo'),
         not exists (select 1 from public.productos where gama = 'Signature' and estado_comercial = 'Activo')
  union all
  select 5, 'Superficies S = 24 m² y M = 48 m²',
         (select string_agg(distinct tamano || '=' || superficie_m2, ' ') from public.productos),
         not exists (select 1 from public.productos where (tamano = 'S' and superficie_m2 <> 24) or (tamano = 'M' and superficie_m2 <> 48))
  union all
  select 6, 'Cotizaciones 1.0 intactas (sin producto 2.0 asignado)',
         (select count(*)::text from public.cotizaciones where generacion = '1.0'),
         not exists (select 1 from public.cotizaciones where generacion = '1.0' and (producto_id is not null or bom_id is not null))
  union all
  select 7, 'Gama Enterprise conservada como histórica',
         (select coalesce(string_agg(nombre || ' vigente=' || vigente, ', '), 'no existe') from public.gamas where nombre = 'Enterprise'),
         not exists (select 1 from public.gamas where nombre = 'Enterprise' and vigente)
  union all
  select 8, 'Gama Signature disponible', (select coalesce(max(generacion), 'no existe') from public.gamas where nombre = 'Signature'),
         exists (select 1 from public.gamas where nombre = 'Signature')
  union all
  select 9, 'Tablas sin RLS forzada',
         coalesce((select string_agg(relname, ', ') from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
                    and not (relrowsecurity and relforcerowsecurity)), 'ninguna'),
         not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
                      and not (relrowsecurity and relforcerowsecurity))
  union all
  select 10, 'Permisos del rol anónimo sobre tablas y vistas',
         (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
         not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')
  union all
  select 11, 'Funciones ejecutables por el rol anónimo',
         coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace
                    and has_function_privilege('anon', p.oid, 'EXECUTE')), 'ninguna'),
         not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE'))
  union all
  select 12, 'Materiales con precio incoherente (USD vacío ≠ original vacío)',
         (select count(*)::text from public.insumos where (costo is null) <> (costo_original is null)),
         not exists (select 1 from public.insumos where (costo is null) <> (costo_original is null))
  union all
  select 13, 'BOM vigentes que no están aprobados',
         (select count(*)::text from public.boms where vigente and estado <> 'Aprobado'),
         not exists (select 1 from public.boms where vigente and estado <> 'Aprobado')
  union all
  select 14, 'Reglas de precio suman 100 % (52/9/9/30 por defecto)',
         (select round(p_costo*100,2) || '/' || round(p_hon*100,2) || '/' || round(p_mkt*100,2) || '/' || round(p_margen*100,2) from public.params),
         (select round(p_costo + p_hon + p_mkt + p_margen, 4) = 1 from public.params)
  union all
  select 15, 'Tablas 2.0 en tiempo real (Realtime)',
         coalesce((select string_agg(t, ', ') from unnest(array['tipos_cambio','productos','addon_costos','boms','bom_items','sustituciones',
                    'presupuestos','presupuesto_items','precios_historial','lead_intereses']) t
                    where not exists (select 1 from pg_publication_tables x where x.pubname = 'supabase_realtime'
                                       and x.schemaname = 'public' and x.tablename = t)), 'todas publicadas'),
         not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
           or not exists (select 1 from unnest(array['tipos_cambio','productos','addon_costos','boms','bom_items','sustituciones',
                    'presupuestos','presupuesto_items','precios_historial','lead_intereses']) t
                    where not exists (select 1 from pg_publication_tables x where x.pubname = 'supabase_realtime'
                                       and x.schemaname = 'public' and x.tablename = t))
  union all
  select 20, 'Inventario: leads / interacciones', (select count(*) from public.leads) || ' / ' || (select count(*) from public.interacciones), null
  union all
  select 21, 'Inventario: cotizaciones (cantidad · suma PVP)',
         (select count(*) || ' · ' || coalesce(sum(pvp), 0) from public.cotizaciones), null
  union all
  select 22, 'Inventario: ventas (cantidad · suma PVP · suma costo real)',
         (select count(*) || ' · ' || coalesce(sum(pvp), 0) || ' · ' || coalesce(sum(costo_real), 0) from public.ventas), null
  union all
  select 23, 'Inventario: gastos / órdenes de compra / ítems',
         (select count(*) from public.gastos) || ' / ' || (select count(*) from public.ordenes_compra) || ' / ' || (select count(*) from public.oc_items), null
  union all
  select 24, 'Inventario: insumos (cantidad · suma stock)', (select count(*) || ' · ' || coalesce(sum(stock), 0) from public.insumos), null
  union all
  select 25, 'Inventario: fabricación / horas / operarios',
         (select count(*) from public.fabricacion) || ' / ' || (select count(*) from public.horas) || ' / ' || (select count(*) from public.operarios), null
  union all
  select 26, 'Inventario: socios', (select string_agg(rol || '=' || nombre, ', ' order by rol) from public.socios), null
) x order by n;
