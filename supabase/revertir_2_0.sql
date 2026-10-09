-- =====================================================================
--  TRAZO FINO 2.0 · Reversión de las migraciones 01–05
--
--  SOLO para volver atrás si se detecta un problema ANTES de empezar a usar
--  el catálogo 2.0. Se niega a ejecutarse si existe cualquier dato 2.0
--  (tipos de cambio, BOM, presupuestos, cotizaciones/ventas/órdenes 2.0,
--  materiales en pesos o sin precio, historial de precios, intereses de leads):
--  en ese caso la recuperación es restaurar el respaldo (ver README de migraciones).
--
--  Deja el esquema exactamente como en schema.sql 1.0. No borra ningún dato 1.0.
--  Una única transacción: si algo falla, no cambia nada.
-- =====================================================================
begin;

do $$
declare problemas text[] := '{}';
begin
  if to_regclass('public.schema_migraciones') is null then
    raise exception 'No hay migraciones 2.0 aplicadas. No se hace nada.';
  end if;
  if (select count(*) from public.schema_migraciones) <> 5 then
    raise exception 'Se esperaban las 5 migraciones 2.0 aplicadas; revisar a mano. No se hace nada.';
  end if;
  if exists (select 1 from public.tipos_cambio)        then problemas := problemas || 'tipos de cambio cargados'::text; end if;
  if exists (select 1 from public.boms)                then problemas := problemas || 'BOM creados'::text; end if;
  if exists (select 1 from public.presupuestos)        then problemas := problemas || 'presupuestos'::text; end if;
  if exists (select 1 from public.sustituciones)       then problemas := problemas || 'sustituciones'::text; end if;
  if exists (select 1 from public.lead_intereses)      then problemas := problemas || 'intereses de leads'::text; end if;
  if exists (select 1 from public.precios_historial)   then problemas := problemas || 'historial de precios'::text; end if;
  if exists (select 1 from public.cotizaciones where generacion = '2.0') then problemas := problemas || 'cotizaciones 2.0'::text; end if;
  if exists (select 1 from public.ventas where producto_id is not null or generacion = '2.0') then problemas := problemas || 'ventas 2.0'::text; end if;
  if exists (select 1 from public.fabricacion where producto_id is not null or generacion = '2.0') then problemas := problemas || 'órdenes 2.0'::text; end if;
  if exists (select 1 from public.insumos where costo is null or moneda <> 'USD' or costo <> round(costo, 2)) then
    problemas := problemas || 'materiales sin precio, en pesos o con más de 2 decimales'::text; end if;
  if exists (select 1 from public.insumos where categoria not in
      ('Hierro','Aislación','Aberturas','Terminaciones','Revestimientos','Consumibles','Mano de Obra')
      or unidad not in ('m','m²','m³','kg','un','lt','gl','jornal','hora','global')) then
    problemas := problemas || 'materiales con categorías o unidades 2.0'::text; end if;
  if exists (select 1 from public.leads where tecnologia_interes is not null or tamano_interes is not null
              or presupuesto_cliente is not null or plazo_estimado is not null) then
    problemas := problemas || 'leads con datos 2.0'::text; end if;
  if exists (select 1 from public.ventas where gama = 'Signature') or exists (select 1 from public.fabricacion where gama = 'Signature')
     or exists (select 1 from public.cotizaciones where gama = 'Signature') or exists (select 1 from public.leads where gama = 'Signature') then
    problemas := problemas || 'registros con gama Signature'::text; end if;
  if cardinality(problemas) > 0 then
    raise exception 'Ya hay datos 2.0 (%): no se revierte. Restaurar el respaldo.', array_to_string(problemas, ', ');
  end if;
end $$;

-- 1. Funciones 1.0 originales (idénticas a schema.sql)
create or replace function public.calcular_cotizacion(p_chasis text, p_gama text, p_addons uuid[] default '{}')
returns table (
  costo_base numeric, coef numeric, cd_gama numeric, cd_addons numeric, costo_directo numeric,
  pvp numeric, honorarios numeric, marketing numeric, ganancia numeric,
  reserva numeric, div_a numeric, div_b numeric, m2 int, pvp_m2 numeric,
  rango_min numeric, rango_max numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  pr public.params; g public.gamas;
  b numeric; a numeric; cd numeric; v numeric; gan numeric; res numeric; dt numeric; da numeric; sup int;
  n_add int;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_chasis not in ('S','M') then raise exception 'Chasis inválido' using errcode = '22023'; end if;

  select * into pr from public.params where id = 1;
  select * into g  from public.gamas  where nombre = p_gama;
  if not found then raise exception 'Gama inexistente' using errcode = '22023'; end if;

  p_addons := coalesce(p_addons, '{}');
  select count(*) into n_add from public.addons where id = any(p_addons);
  if n_add <> coalesce(array_length(p_addons, 1), 0) then
    raise exception 'Adicional inexistente o repetido' using errcode = '22023';
  end if;

  select coalesce(sum(i.costo * (case when p_chasis = 'S' then i.cant_s else i.cant_m end) * (1 + i.merma)), 0)
    into b from public.insumos i;
  select coalesce(sum(case when p_chasis = 'S' then ad.costo_s else ad.costo_m end), 0)
    into a from public.addons ad where ad.id = any(p_addons);

  sup := case when p_chasis = 'S' then 18 else 36 end;
  cd  := b * g.coef + a;
  v   := cd / pr.p_costo;               -- PVP = Costo Directo / % Costo  (regla imperativa, cl. 4.1.1)
  gan := v * pr.p_margen;
  res := gan * pr.p_reserva;
  dt  := gan - res;
  da  := dt * pr.p_div_socio;

  return query select b, g.coef, b * g.coef, a, cd, v, v * pr.p_hon, v * pr.p_mkt, gan,
                      res, da, dt - da, sup, v / sup, g.usd_m2_min, g.usd_m2_max;
end $$;

create or replace function public.convertir_cotizacion(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.cotizaciones; vid uuid;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización inexistente' using errcode = '22023'; end if;
  if c.estado = 'Ganada' then raise exception 'La cotización ya fue convertida' using errcode = '23514'; end if;
  insert into public.ventas (cliente, chasis, gama, pvp, cotizacion_id)
  values (c.cliente, c.chasis, c.gama, c.pvp, c.id) returning id into vid;
  update public.cotizaciones set estado = 'Ganada' where id = p_id;
  if c.lead_id is not null then update public.leads set estado = 'Cerrado' where id = c.lead_id; end if;
  return vid;
end $$;

create or replace function public.descontar_materiales(p_fab uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare f public.fabricacion; faltan text;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into f from public.fabricacion where id = p_fab for update;
  if not found then raise exception 'Orden de fabricación inexistente' using errcode = '22023'; end if;
  if f.materiales_descontados then raise exception 'Los materiales de esta orden ya fueron descontados' using errcode = '23514'; end if;

  select string_agg(codigo || ' (faltan ' || round(nec - stock, 2) || ' ' || unidad || ')', ', ')
    into faltan
    from (select codigo, unidad, stock,
                 (case when f.chasis = 'S' then cant_s else cant_m end) * (1 + merma) nec
            from public.insumos where categoria <> 'Mano de Obra') x
   where nec > stock;
  if faltan is not null then
    raise exception 'Stock insuficiente: %', faltan using errcode = '23514';
  end if;

  update public.insumos
     set stock = stock - (case when f.chasis = 'S' then cant_s else cant_m end) * (1 + merma)
   where categoria <> 'Mano de Obra';
  update public.fabricacion set materiales_descontados = true where id = p_fab;
end $$;

-- 2. Triggers 2.0 sobre tablas 1.0
drop trigger t_gamas_nombre_fijo on public.gamas;
drop trigger t_insumos_precio on public.insumos;
drop trigger t_insumos_historial on public.insumos;
drop trigger t_ventas_producto on public.ventas;
drop trigger t_fabricacion_producto on public.fabricacion;
drop trigger t_auditoria on public.leads;
drop trigger t_auditoria on public.oc_items;
drop trigger t_auditoria on public.horas;

-- 3. Vistas (se recrean con la definición 1.0 al final)
drop view public.v_ventas;
drop view public.v_fabricacion;

-- 4. Tablas nuevas (vacías: lo garantiza el control inicial; productos y matriz de adicionales vienen del seed)
alter table public.cotizaciones drop column presupuesto_id, drop column bom_id, drop column producto_id;
alter table public.ventas drop column bom_id, drop column producto_id;
alter table public.fabricacion drop column bom_id, drop column producto_id;
alter table public.insumos drop column tc_id;
drop table public.presupuesto_items;
drop table public.presupuestos;
drop table public.sustituciones;
drop table public.bom_items;
drop table public.boms;
drop table public.lead_intereses;
drop table public.addon_costos;
drop table public.precios_historial;
drop table public.productos;
drop table public.tipos_cambio;

-- 5. Columnas agregadas a tablas 1.0
alter table public.cotizaciones
  drop column generacion, drop column producto_codigo, drop column tecnologia, drop column superficie_m2,
  drop column bom_version, drop column costo_materiales, drop column costo_mdo, drop column costo_addons,
  drop column honorarios, drop column marketing, drop column ganancia, drop column reserva, drop column div_a,
  drop column div_b, drop column pvp_m2, drop column descuento, drop column pvp_final, drop column moneda,
  drop column tc_tipo, drop column tc_valor, drop column tc_fecha, drop column params_snapshot, drop column items_snapshot,
  drop column vigencia_dias, drop column valida_hasta, drop column aprobacion, drop column validado_por,
  drop column validado_at, drop column validacion_nota, drop column idem;
alter table public.ventas
  drop column generacion, drop column producto_codigo, drop column tecnologia, drop column superficie_m2,
  drop column bom_version, drop column cd_presupuestado;
alter table public.fabricacion
  drop column generacion, drop column bom_version, drop column costo_mat_pres, drop column costo_mdo_pres;
alter table public.leads
  drop column tecnologia_interes, drop column tamano_interes, drop column presupuesto_cliente, drop column plazo_estimado;

alter table public.insumos drop constraint precio_pendiente_coherente;
alter table public.insumos drop constraint pendiente_fuera_de_computo_1_0;
alter table public.insumos drop constraint insumos_categoria_check;
alter table public.insumos add constraint insumos_categoria_check check (categoria in
  ('Hierro','Aislación','Aberturas','Terminaciones','Revestimientos','Consumibles','Mano de Obra'));
alter table public.insumos drop constraint insumos_unidad_check;
alter table public.insumos add constraint insumos_unidad_check check (unidad in
  ('m','m²','m³','kg','un','lt','gl','jornal','hora','global'));
alter table public.insumos alter column costo type numeric(12,2);
alter table public.insumos alter column costo set not null;
alter table public.insumos
  drop column costo_original, drop column moneda, drop column tc_valor, drop column costo_ars,
  drop column fecha_cotizacion, drop column activo, drop column observaciones, drop column updated_at, drop column updated_by;

delete from public.gamas where nombre = 'Signature';
update public.gamas set vigente = true where nombre = 'Enterprise';
alter table public.gamas drop column generacion, drop column vigente;

-- 6. Funciones 2.0
drop function public.descontar_materiales_v2(uuid);
drop function public.presupuesto_anular(uuid);
drop function public.presupuesto_actualizar_precios(uuid);
drop function public.presupuesto_cambiar_tc(uuid, uuid);
drop function public.presupuesto_nueva_revision(uuid);
drop function public.presupuesto_agregar_material(uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid, boolean, uuid);
drop function public.presupuesto_crear(text, text, uuid, uuid, uuid[], text, uuid);
drop function public.sustitucion_aplicar(uuid, uuid);
drop function public.sustitucion_decidir(uuid, boolean, text);
drop function public.actualizar_precio_material(text, numeric, text, uuid, text);
drop function public.bom_importar(uuid, jsonb, uuid);
drop function public.bom_cambiar_estado(uuid, text);
drop function public.bom_duplicar(uuid, text, text);
drop function public.bom_crear(text, text);
drop function public.validar_cotizacion(uuid, boolean, text);
drop function public.crear_cotizacion_v2(text, text, uuid[], uuid, uuid, int, uuid);
drop function public.calcular_cotizacion_v2(text, uuid[], uuid, uuid);
drop function public.costo_addons_v2(uuid, uuid[]);
drop function public.finanzas_desde_costo(numeric);
drop function public.costo_presupuesto(uuid);
drop function public.costo_bom(uuid);
drop function public.tg_fabricacion_producto();
drop function public.tg_ventas_producto();
drop function public.tg_presupuesto_items();
drop function public.tg_presupuestos();
drop function public.tg_sustituciones();
drop function public.tg_bom_items();
drop function public.tg_boms();
drop function public.tg_insumos_historial();
drop function public.tg_insumos_precio();
drop function public.tg_productos();
drop function public.tg_gamas_nombre_fijo();

-- 7. Vistas 1.0 y permisos 1.0
create view public.v_ventas with (security_invoker = true) as
select v.*,
       x.cd_pres,
       x.cd,
       x.hon,
       x.mkt,
       x.gan                                      as ganancia,
       x.gan * p.p_reserva                        as reserva,
       (x.gan - x.gan * p.p_reserva) * p.p_div_socio                          as div_a,
       (x.gan - x.gan * p.p_reserva) - (x.gan - x.gan * p.p_reserva) * p.p_div_socio as div_b,
       case when v.costo_real is null then null else v.costo_real - x.cd_pres end    as desvio
  from public.ventas v
  cross join public.params p
  cross join lateral (
    select v.pvp * p.p_costo                              as cd_pres,
           coalesce(v.costo_real, v.pvp * p.p_costo)      as cd,
           v.pvp * p.p_hon                                as hon,
           v.pvp * p.p_mkt                                as mkt,
           v.pvp - coalesce(v.costo_real, v.pvp * p.p_costo) - v.pvp * p.p_hon - v.pvp * p.p_mkt as gan
  ) x;

create view public.v_fabricacion with (security_invoker = true) as
select f.*,
       coalesce(h.horas_total, 0) as horas_total,
       coalesce(h.mdo_real, 0)    as mdo_real,
       (select coalesce(sum(i.costo * (case when f.chasis = 'S' then i.cant_s else i.cant_m end) * (1 + i.merma)), 0)
          from public.insumos i where i.categoria = 'Mano de Obra') as mdo_presupuestada
  from public.fabricacion f
  left join (select fabricacion_id, sum(horas) horas_total, sum(horas * costo_hora_aplicado) mdo_real
               from public.horas group by fabricacion_id) h on h.fabricacion_id = f.id;

revoke all on public.v_ventas, public.v_fabricacion from anon;
grant select on public.v_ventas, public.v_gastos, public.v_fabricacion to authenticated;
revoke insert (fecha, cliente, chasis, gama, pvp, costo_real, estado_cobro, fecha_cobro, cotizacion_id),
       update (fecha, cliente, chasis, gama, pvp, costo_real, estado_cobro, fecha_cobro, cotizacion_id)
  on public.ventas from authenticated;
grant insert, update on public.ventas to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.es_socio(), public.mi_rol(),
  public.calcular_cotizacion(text, text, uuid[]),
  public.crear_cotizacion(text, text, text, uuid[], uuid),
  public.convertir_cotizacion(uuid),
  public.descontar_materiales(uuid),
  public.registrar_referencia_bom(text)
  to authenticated;

drop table public.schema_migraciones;

commit;
