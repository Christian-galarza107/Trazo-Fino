-- =====================================================================
--  TRAZO FINO 2.0 · Inventario PREVIO a la migración (solo lectura)
--  Ejecutar ANTES de aplicar las migraciones y guardar el resultado
--  (captura o "Export to CSV"). Después de migrar, validar_2_0.sql
--  devuelve las mismas cifras (filas 20–26): deben coincidir.
-- =====================================================================
select * from (
  select 20 as n, 'Inventario: leads / interacciones' as control, (select count(*) from public.leads) || ' / ' || (select count(*) from public.interacciones) as detalle
  union all select 21, 'Inventario: cotizaciones (cantidad · suma PVP)', (select count(*) || ' · ' || coalesce(sum(pvp), 0) from public.cotizaciones)
  union all select 22, 'Inventario: ventas (cantidad · suma PVP · suma costo real)', (select count(*) || ' · ' || coalesce(sum(pvp), 0) || ' · ' || coalesce(sum(costo_real), 0) from public.ventas)
  union all select 23, 'Inventario: gastos / órdenes de compra / ítems', (select count(*) from public.gastos) || ' / ' || (select count(*) from public.ordenes_compra) || ' / ' || (select count(*) from public.oc_items)
  union all select 24, 'Inventario: insumos (cantidad · suma stock)', (select count(*) || ' · ' || coalesce(sum(stock), 0) from public.insumos)
  union all select 25, 'Inventario: fabricación / horas / operarios', (select count(*) from public.fabricacion) || ' / ' || (select count(*) from public.horas) || ' / ' || (select count(*) from public.operarios)
  union all select 26, 'Inventario: socios', (select string_agg(rol || '=' || nombre, ', ' order by rol) from public.socios)
  union all select 27, 'Columnas de gamas existentes (debe incluir Básico y Premium)', (select string_agg(nombre, ', ' order by orden) from public.gamas)
  union all select 28, '¿Ya existe algo de 2.0? (debe decir "no")', case when to_regclass('public.productos') is null then 'no' else 'SÍ: no aplicar 01 de nuevo' end
) x order by n;
