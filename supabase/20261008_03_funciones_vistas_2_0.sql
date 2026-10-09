-- =====================================================================
--  TRAZO FINO 2.0 · Migración 03 — Funciones, triggers y vistas
--
--  · Funciones NUEVAS con sufijo _v2 o nombre propio: no pisan nada.
--  · Funciones 1.0 reemplazadas con la MISMA firma y el mismo resultado
--    para los datos 1.0: calcular_cotizacion (rechaza gamas exclusivas
--    de 2.0), convertir_cotizacion y descontar_materiales (derivan a la
--    lógica 2.0 solo cuando el registro es 2.0).
--  · Regla imperativa intacta: PVP = Costo Directo Total / p_costo.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migraciones where version = '2026.10.08-02') then
    raise exception 'Falta aplicar la migración 2026.10.08-02. No se aplica nada.';
  end if;
  if exists (select 1 from public.schema_migraciones where version = '2026.10.08-03') then
    raise exception 'La migración 2026.10.08-03 ya fue aplicada. No se aplica nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- A. Precisión del costo unitario en USD (2 → 4 decimales).
--    Un material cotizado en pesos y convertido a dólares necesita más de
--    dos decimales. Ampliar la escala no cambia ningún valor existente.
--    v_fabricacion depende de la columna: se recrea más abajo.
-- ---------------------------------------------------------------------
drop view public.v_fabricacion;
alter table public.insumos alter column costo type numeric(14,4);

-- ---------------------------------------------------------------------
-- B. Triggers de integridad
-- ---------------------------------------------------------------------

-- El nombre de una gama es un identificador histórico (cotizaciones y
-- ventas lo referencian con ON UPDATE CASCADE): no se puede renombrar.
create or replace function public.tg_gamas_nombre_fijo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nombre is distinct from old.nombre then
    raise exception 'El nombre de una gama no se puede cambiar: lo usan cotizaciones y ventas históricas' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger t_gamas_nombre_fijo before update of nombre on public.gamas
  for each row execute function public.tg_gamas_nombre_fijo();

-- Productos: código, tecnología, tamaño, gama y dimensiones son inmutables.
create or replace function public.tg_productos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.codigo, new.tecnologia, new.tamano, new.gama, new.largo_m, new.ancho_m, new.superficie_m2)
     is distinct from (old.codigo, old.tecnologia, old.tamano, old.gama, old.largo_m, old.ancho_m, old.superficie_m2) then
    raise exception 'El código, la tecnología, el tamaño, la gama y las dimensiones de un producto no se pueden cambiar' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger t_productos before update on public.productos
  for each row execute function public.tg_productos();

-- Insumos: el servidor deriva el costo en USD y en ARS a partir del precio
-- original, la moneda y el tipo de cambio. El navegador no puede imponerlos.
create or replace function public.tg_insumos_precio() returns trigger
language plpgsql security definer set search_path = public as $$
declare tc public.tipos_cambio;
begin
  -- Compatibilidad 1.0: si solo llega "costo" (USD), es el precio original en USD.
  if tg_op = 'INSERT' then
    if new.costo_original is null and new.costo is not null then
      new.costo_original := new.costo; new.moneda := 'USD';
    end if;
  elsif new.costo is distinct from old.costo
        and new.costo_original is not distinct from old.costo_original
        and new.moneda is not distinct from old.moneda
        and new.tc_id is not distinct from old.tc_id then
    new.costo_original := new.costo; new.moneda := 'USD';
  end if;

  if new.tc_id is not null then
    select * into tc from public.tipos_cambio where id = new.tc_id;
  end if;
  if new.costo_original is null then                      -- precio pendiente: nunca cero
    new.costo := null; new.costo_ars := null; new.tc_valor := tc.valor;
  elsif new.moneda = 'USD' then
    new.costo := round(new.costo_original, 4);
    new.tc_valor := tc.valor;
    new.costo_ars := case when tc.valor is null then null else round(new.costo_original * tc.valor, 2) end;
  else
    if new.tc_id is null then
      raise exception 'Un precio en pesos necesita un tipo de cambio' using errcode = '23514';
    end if;
    new.tc_valor := tc.valor;
    new.costo := round(new.costo_original / tc.valor, 4);
    new.costo_ars := round(new.costo_original, 2);
  end if;
  if tg_op = 'INSERT' or new.costo_original is distinct from old.costo_original
     or new.moneda is distinct from old.moneda or new.tc_id is distinct from old.tc_id then
    new.fecha_cotizacion := coalesce(tc.fecha, current_date);
  end if;
  new.updated_at := now();
  new.updated_by := (select user_id from public.socios where user_id = auth.uid());
  return new;
end $$;
create trigger t_insumos_precio before insert or update on public.insumos
  for each row execute function public.tg_insumos_precio();

alter table public.insumos add constraint precio_pendiente_coherente check ((costo is null) = (costo_original is null));
-- Un material sin precio confirmado no puede formar parte del cómputo 1.0 (que lo sumaría como cero).
alter table public.insumos add constraint pendiente_fuera_de_computo_1_0 check (costo is not null or (cant_s = 0 and cant_m = 0));

-- Historial de precios: lo escribe el servidor en cada alta o cambio de precio.
create or replace function public.tg_insumos_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.costo is distinct from old.costo or new.costo_original is distinct from old.costo_original
     or new.moneda is distinct from old.moneda or new.tc_id is distinct from old.tc_id then
    insert into public.precios_historial (insumo_codigo, costo_usd_ant, costo_usd_nuevo, original_ant, original_nuevo,
                                          moneda_ant, moneda_nueva, tc_valor, usuario, motivo)
    values (new.codigo,
            case when tg_op = 'UPDATE' then old.costo end, new.costo,
            case when tg_op = 'UPDATE' then old.costo_original end, new.costo_original,
            case when tg_op = 'UPDATE' then old.moneda end, new.moneda, new.tc_valor, auth.uid(),
            coalesce(nullif(current_setting('tf.motivo', true), ''),
                     case when tg_op = 'INSERT' then 'Alta en catálogo' else 'Edición directa' end));
  end if;
  return null;
end $$;
create trigger t_insumos_historial after insert or update on public.insumos
  for each row execute function public.tg_insumos_historial();

-- BOM: solo se borra en borrador; sus ítems solo se tocan en borrador.
create or replace function public.tg_boms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado <> 'Borrador' then
    raise exception 'Solo se puede borrar un BOM en borrador (este está %)', lower(old.estado) using errcode = '23514';
  end if;
  return old;
end $$;
create trigger t_boms before delete on public.boms for each row execute function public.tg_boms();

create or replace function public.tg_bom_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if tg_op = 'UPDATE' and new.bom_id <> old.bom_id then
    raise exception 'Un ítem no se puede mover a otro BOM' using errcode = '23514';
  end if;
  select estado into e from public.boms where id = coalesce(new.bom_id, old.bom_id);
  if found and e <> 'Borrador' then
    raise exception 'El BOM está % : duplicalo para crear una versión nueva y modificarla', lower(e) using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.merma is null then
    select merma into new.merma from public.insumos where codigo = new.insumo_codigo;
  end if;
  return new;
end $$;
create trigger t_bom_items before insert or update or delete on public.bom_items
  for each row execute function public.tg_bom_items();

-- Sustituciones: nacen "Propuesta"; decididas o aplicadas quedan en el historial.
create or replace function public.tg_sustituciones() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tf.interno', true), '') = '1' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    new.estado := 'Propuesta'; new.decidido_por := null; new.decidido_at := null; new.aplicada_at := null;
    new.created_by := auth.uid();
    if not exists (select 1 from public.bom_items where bom_id = new.bom_id and insumo_codigo = new.insumo_original) then
      raise exception 'El material original no está en ese BOM' using errcode = '23514';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.estado <> 'Propuesta' then
      raise exception 'Una sustitución ya decidida no se modifica: proponé una nueva' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.estado in ('Aprobada','Aplicada') then
    raise exception 'Una sustitución aprobada o aplicada queda en el historial y no se borra' using errcode = '23514';
  end if;
  return old;
end $$;
create trigger t_sustituciones before insert or update or delete on public.sustituciones
  for each row execute function public.tg_sustituciones();

-- Presupuestos: editables solo en borrador. Emitir, reemplazar o anular lo hacen funciones.
create or replace function public.tg_presupuestos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tf.interno', true), '') = '1' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'Borrador' then
      raise exception 'Solo se puede borrar un presupuesto en borrador' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.estado <> 'Borrador' then
    raise exception 'El presupuesto está %: creá una revisión nueva para modificarlo', lower(old.estado) using errcode = '23514';
  end if;
  if new.descuento is distinct from old.descuento or new.descuento_motivo is distinct from old.descuento_motivo then
    new.descuento_autorizado_por := case when new.descuento > 0 then auth.uid() end;
  end if;
  return new;
end $$;
create trigger t_presupuestos before update or delete on public.presupuestos
  for each row execute function public.tg_presupuestos();

create or replace function public.tg_presupuesto_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.presupuestos;
begin
  select * into p from public.presupuestos where id = coalesce(new.presupuesto_id, old.presupuesto_id);
  if found and p.estado <> 'Borrador' then
    raise exception 'El presupuesto está %: creá una revisión nueva para modificarlo', lower(p.estado) using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.presupuesto_id <> old.presupuesto_id then
    raise exception 'Un ítem no se puede mover a otro presupuesto' using errcode = '23514';
  end if;
  -- Costo en USD con el tipo de cambio del presupuesto (no con el del catálogo).
  if new.costo_original is null then
    new.costo_unit_usd := null;
  elsif new.moneda = 'USD' then
    new.costo_unit_usd := new.costo_original;
  elsif p.tc_valor is null then
    raise exception 'El presupuesto no tiene tipo de cambio: no se puede convertir un precio en pesos' using errcode = '23514';
  else
    new.costo_unit_usd := round(new.costo_original / p.tc_valor, 6);
  end if;
  return new;
end $$;
create trigger t_presupuesto_items before insert or update or delete on public.presupuesto_items
  for each row execute function public.tg_presupuesto_items();

-- Ventas: si se indica un producto 2.0, el servidor completa tecnología, superficie, tamaño y gama.
create or replace function public.tg_ventas_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr public.productos;
begin
  if new.producto_id is null then
    if tg_op = 'UPDATE' and old.producto_id is not null then
      new.producto_codigo := null; new.tecnologia := null; new.superficie_m2 := null; new.generacion := null;
    end if;
    return new;
  end if;
  select * into pr from public.productos where id = new.producto_id;
  new.producto_codigo := pr.codigo; new.tecnologia := pr.tecnologia; new.superficie_m2 := pr.superficie_m2;
  new.chasis := pr.tamano; new.gama := pr.gama; new.generacion := '2.0';
  return new;
end $$;
create trigger t_ventas_producto before insert or update on public.ventas
  for each row execute function public.tg_ventas_producto();

-- ---------------------------------------------------------------------
-- C. Motor de costos y precio 2.0
-- ---------------------------------------------------------------------

-- Costo de un BOM a precios del catálogo. Los materiales sin precio NO se
-- suman como cero: se informan en "pendientes" y el BOM queda incompleto.
create or replace function public.costo_bom(p_bom uuid)
returns table (materiales numeric, mano_obra numeric, total numeric, items int, pendientes int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select coalesce(sum(case when i.categoria <> 'Mano de Obra' then i.costo * b.cantidad * (1 + b.merma) end), 0)::numeric,
         coalesce(sum(case when i.categoria =  'Mano de Obra' then i.costo * b.cantidad * (1 + b.merma) end), 0)::numeric,
         coalesce(sum(i.costo * b.cantidad * (1 + b.merma)), 0)::numeric,
         count(*)::int,
         (count(*) filter (where i.costo is null))::int
    from public.bom_items b join public.insumos i on i.codigo = b.insumo_codigo
   where b.bom_id = p_bom;
end $$;

create or replace function public.costo_presupuesto(p_pres uuid)
returns table (materiales numeric, mano_obra numeric, total numeric, items int, pendientes int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select coalesce(sum(case when x.categoria <> 'Mano de Obra' then x.costo_unit_usd * x.cantidad * (1 + x.merma) end), 0)::numeric,
         coalesce(sum(case when x.categoria =  'Mano de Obra' then x.costo_unit_usd * x.cantidad * (1 + x.merma) end), 0)::numeric,
         coalesce(sum(x.costo_unit_usd * x.cantidad * (1 + x.merma)), 0)::numeric,
         count(*)::int,
         (count(*) filter (where x.costo_unit_usd is null))::int
    from public.presupuesto_items x
   where x.presupuesto_id = p_pres;
end $$;

-- Reglas societarias aplicadas a un costo directo. Única fuente del PVP 2.0.
create or replace function public.finanzas_desde_costo(p_cd numeric)
returns table (pvp numeric, honorarios numeric, marketing numeric, ganancia numeric,
               reserva numeric, masa numeric, div_a numeric, div_b numeric)
language plpgsql stable security definer set search_path = public as $$
declare pr public.params; v numeric; gan numeric; res numeric; dt numeric; da numeric;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_cd is null or p_cd < 0 then raise exception 'Costo directo inválido' using errcode = '22023'; end if;
  select * into pr from public.params where id = 1;
  if pr.p_costo is null or pr.p_costo <= 0 or round(pr.p_costo + pr.p_hon + pr.p_mkt + pr.p_margen, 4) <> 1 then
    raise exception 'Las reglas de precio no suman 100 %%' using errcode = '23514';
  end if;
  v   := p_cd / pr.p_costo;          -- PVP = Costo Directo / % Costo  (regla imperativa, cl. 4.1.1)
  gan := v * pr.p_margen;
  res := gan * pr.p_reserva;
  dt  := gan - res;
  da  := dt * pr.p_div_socio;
  return query select v, v * pr.p_hon, v * pr.p_mkt, gan, res, dt, da, dt - da;
end $$;

-- Costo de los adicionales para un producto. Rechaza adicionales no disponibles,
-- sin costo definido o incompatibles con la tecnología, el tamaño o la gama.
create or replace function public.costo_addons_v2(p_producto uuid, p_addons uuid[])
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare pr public.productos; n int := coalesce(array_length(p_addons, 1), 0); n_ok int; total numeric;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if n = 0 then return 0; end if;
  if (select count(distinct x) from unnest(p_addons) x) <> n then
    raise exception 'Adicional repetido' using errcode = '22023';
  end if;
  select * into pr from public.productos where id = p_producto;
  select count(*), coalesce(sum(ac.costo), 0) into n_ok, total
    from public.addon_costos ac
   where ac.addon_id = any(p_addons) and ac.tecnologia = pr.tecnologia and ac.tamano = pr.tamano
     and ac.disponible and ac.costo is not null and pr.gama = any(ac.gamas);
  if n_ok <> n then
    raise exception 'Algún adicional no está disponible, no tiene costo definido o no es compatible con %', pr.codigo using errcode = '22023';
  end if;
  return total;
end $$;

-- Motor de cotización 2.0. Fuente del costo: el presupuesto del proyecto si
-- se indica; si no, un BOM puntual (análisis) o el BOM aprobado vigente.
create or replace function public.calcular_cotizacion_v2(
  p_producto text, p_addons uuid[] default '{}', p_presupuesto uuid default null, p_bom uuid default null)
returns table (
  producto_id uuid, codigo text, tecnologia text, tamano char, gama text, m2 numeric,
  bom_id uuid, bom_version int, bom_estado text,
  costo_materiales numeric, costo_mdo numeric, costo_addons numeric, costo_directo numeric,
  pvp numeric, pvp_m2 numeric, honorarios numeric, marketing numeric, ganancia numeric,
  reserva numeric, masa numeric, div_a numeric, div_b numeric,
  items int, pendientes int, definitivo boolean, observacion text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare pr public.productos; b public.boms; ps public.presupuestos; k record; f record;
        ad numeric; cd numeric; obs text[] := '{}';
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into pr from public.productos x where x.codigo = p_producto;
  if not found then raise exception 'Producto inexistente' using errcode = '22023'; end if;

  if p_presupuesto is not null then
    select * into ps from public.presupuestos x where x.id = p_presupuesto;
    if not found or ps.producto_id <> pr.id then
      raise exception 'El presupuesto no corresponde a ese producto' using errcode = '22023';
    end if;
    select * into b from public.boms x where x.id = ps.bom_id;
    select * into k from public.costo_presupuesto(ps.id);
    p_addons := ps.addons;
  else
    if p_bom is not null then
      select * into b from public.boms x where x.id = p_bom and x.producto_id = pr.id;
      if not found then raise exception 'El BOM no corresponde a ese producto' using errcode = '22023'; end if;
    else
      select * into b from public.boms x where x.producto_id = pr.id and x.vigente;
    end if;
    if b.id is null then
      select 0::numeric as materiales, 0::numeric as mano_obra, 0::numeric as total, 0 as items, 0 as pendientes into k;
    else
      select * into k from public.costo_bom(b.id);
    end if;
  end if;

  ad := public.costo_addons_v2(pr.id, coalesce(p_addons, '{}'));
  cd := k.total + ad;
  select * into f from public.finanzas_desde_costo(cd);

  if pr.estado_comercial = 'Inactivo' then obs := obs || 'Producto inactivo'::text; end if;
  if pr.aprobacion_tecnica <> 'Aprobado' then obs := obs || 'Producto sin aprobación técnica'::text; end if;
  if b.id is null then obs := obs || 'Sin BOM aprobado vigente'::text;
  elsif not (b.estado = 'Aprobado' or (p_presupuesto is not null and b.estado = 'Obsoleto')) then
    obs := obs || ('BOM v' || b.version || ' en estado ' || b.estado);
  end if;
  if k.items = 0 then obs := obs || 'Lista de materiales vacía'::text; end if;
  if k.pendientes > 0 then obs := obs || (k.pendientes || ' material(es) sin precio confirmado'); end if;
  if p_presupuesto is not null and ps.estado <> 'Borrador' then obs := obs || ('Presupuesto ' || lower(ps.estado)); end if;

  return query select pr.id, pr.codigo, pr.tecnologia, pr.tamano, pr.gama, pr.superficie_m2,
                      b.id, b.version, b.estado,
                      k.materiales, k.mano_obra, ad, cd,
                      f.pvp, f.pvp / pr.superficie_m2, f.honorarios, f.marketing, f.ganancia,
                      f.reserva, f.masa, f.div_a, f.div_b,
                      k.items, k.pendientes, cardinality(obs) = 0, array_to_string(obs, ' · ');
end $$;

-- Emitir una cotización 2.0 definitiva con instantánea de costos, parámetros
-- y tipo de cambio. Los cambios futuros del catálogo no la alteran.
create or replace function public.crear_cotizacion_v2(
  p_cliente text, p_producto text, p_addons uuid[] default '{}', p_lead uuid default null,
  p_presupuesto uuid default null, p_vigencia_dias int default 15, p_idem uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r record; pr public.productos; ps public.presupuestos; nid uuid; snap jsonb;
        dto numeric := 0; adds uuid[];
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_idem is not null then
    select id into nid from public.cotizaciones where idem = p_idem;
    if found then return nid; end if;                       -- reintento: no duplica
  end if;
  if char_length(trim(coalesce(p_cliente, ''))) = 0 then
    raise exception 'Indicá el cliente' using errcode = '22023';
  end if;
  if p_vigencia_dias is null or p_vigencia_dias not between 1 and 180 then
    raise exception 'La vigencia debe estar entre 1 y 180 días' using errcode = '22023';
  end if;
  if p_presupuesto is not null then
    select * into ps from public.presupuestos where id = p_presupuesto for update;
    if not found then raise exception 'Presupuesto inexistente' using errcode = '22023'; end if;
    if ps.estado <> 'Borrador' then
      raise exception 'El presupuesto ya fue emitido o anulado: creá una revisión nueva' using errcode = '23514';
    end if;
  end if;

  select * into r from public.calcular_cotizacion_v2(p_producto, p_addons, p_presupuesto, null);
  if not r.definitivo then
    raise exception 'No se puede emitir una cotización definitiva: %', r.observacion using errcode = '23514';
  end if;
  select * into pr from public.productos where id = r.producto_id;

  if p_presupuesto is null then
    adds := coalesce(p_addons, '{}');
    select jsonb_agg(jsonb_build_object('codigo', i.codigo, 'descripcion', i.descripcion, 'categoria', i.categoria,
             'unidad', i.unidad, 'cantidad', b.cantidad, 'merma', b.merma, 'costo_unit_usd', i.costo,
             'moneda', i.moneda, 'costo_original', i.costo_original, 'tc_valor', i.tc_valor,
             'subtotal', round(i.costo * b.cantidad * (1 + b.merma), 2)) order by i.categoria, i.codigo)
      into snap
      from public.bom_items b join public.insumos i on i.codigo = b.insumo_codigo
     where b.bom_id = r.bom_id;
  else
    adds := ps.addons;
    dto := ps.descuento;
    select jsonb_agg(jsonb_build_object('codigo', x.insumo_codigo, 'descripcion', x.descripcion, 'categoria', x.categoria,
             'unidad', x.unidad, 'cantidad', x.cantidad, 'merma', x.merma, 'costo_unit_usd', x.costo_unit_usd,
             'moneda', x.moneda, 'costo_original', x.costo_original, 'tc_valor', ps.tc_valor, 'origen', x.origen,
             'subtotal', round(x.costo_unit_usd * x.cantidad * (1 + x.merma), 2)) order by x.categoria, x.descripcion)
      into snap
      from public.presupuesto_items x where x.presupuesto_id = ps.id;
  end if;
  if dto >= r.pvp then
    raise exception 'El descuento no puede igualar ni superar el precio' using errcode = '23514';
  end if;

  insert into public.cotizaciones (
    cliente, chasis, gama, addons, pvp, costo_directo, estado, lead_id, created_by,
    generacion, producto_id, producto_codigo, tecnologia, superficie_m2, bom_id, bom_version, presupuesto_id,
    costo_materiales, costo_mdo, costo_addons, honorarios, marketing, ganancia, reserva, div_a, div_b, pvp_m2,
    descuento, pvp_final, tc_tipo, tc_valor, tc_fecha, params_snapshot, items_snapshot,
    vigencia_dias, valida_hasta, aprobacion, idem)
  values (
    trim(p_cliente), pr.tamano, pr.gama, adds, round(r.pvp, 2), round(r.costo_directo, 2), 'Enviada', p_lead, auth.uid(),
    '2.0', pr.id, pr.codigo, pr.tecnologia, pr.superficie_m2, r.bom_id, r.bom_version, p_presupuesto,
    round(r.costo_materiales, 2), round(r.costo_mdo, 2), round(r.costo_addons, 2), round(r.honorarios, 2),
    round(r.marketing, 2), round(r.ganancia, 2), round(r.reserva, 2), round(r.div_a, 2), round(r.div_b, 2), round(r.pvp_m2, 2),
    dto, round(r.pvp, 2) - dto, ps.tc_tipo, ps.tc_valor, ps.tc_fecha,
    (select to_jsonb(x) - 'id' from public.params x where x.id = 1), coalesce(snap, '[]'::jsonb),
    p_vigencia_dias, current_date + p_vigencia_dias,
    case when pr.gama = 'Signature' then 'Pendiente de validación' else 'Aprobada' end, p_idem)
  returning id into nid;

  if p_presupuesto is not null then
    perform set_config('tf.interno', '1', true);
    update public.presupuestos set estado = 'Reemplazado' where grupo = ps.grupo and estado = 'Emitido';
    update public.presupuestos set estado = 'Emitido', emitido_at = now() where id = p_presupuesto;
    perform set_config('tf.interno', '', true);
  end if;
  if p_lead is not null then
    update public.leads set estado = 'En Cotización' where id = p_lead and estado in ('Nuevo','Calificado');
    update public.lead_intereses set estado = 'Cotizado' where lead_id = p_lead and producto_id = pr.id and estado = 'Abierto';
  end if;
  return nid;
end $$;

-- Validación técnica/comercial de una cotización Signature (queda registrado quién y cuándo).
create or replace function public.validar_cotizacion(p_id uuid, p_aprobar boolean, p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.cotizaciones;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización inexistente' using errcode = '22023'; end if;
  if c.aprobacion is distinct from 'Pendiente de validación' then
    raise exception 'La cotización no está pendiente de validación' using errcode = '23514';
  end if;
  update public.cotizaciones
     set aprobacion = case when p_aprobar then 'Aprobada' else 'Rechazada' end,
         validado_por = auth.uid(), validado_at = now(), validacion_nota = left(p_nota, 300)
   where id = p_id;
end $$;

-- 1.0 con la misma firma: rechaza gamas exclusivas del catálogo 2.0
-- (por ejemplo Signature) para que el cotizador 1.0 no las precie con un
-- coeficiente que no les corresponde. Para el resto, idéntica.
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
  if g.generacion = '2.0' then
    raise exception 'La gama % pertenece al catálogo 2.0: usá el cotizador 2.0', p_gama using errcode = '22023';
  end if;

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

-- 1.0 con la misma firma. Cotizaciones 1.0: comportamiento idéntico.
-- Cotizaciones 2.0: exige aprobación (Signature validada) y lleva a la venta
-- el producto, el BOM y el costo directo presupuestado.
create or replace function public.convertir_cotizacion(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.cotizaciones; vid uuid;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización inexistente' using errcode = '22023'; end if;
  if c.estado = 'Ganada' then raise exception 'La cotización ya fue convertida' using errcode = '23514'; end if;
  if c.generacion = '2.0' then
    if c.aprobacion is distinct from 'Aprobada' then
      raise exception 'La cotización necesita estar aprobada (validación Signature) antes de convertirse en venta' using errcode = '23514';
    end if;
    insert into public.ventas (cliente, chasis, gama, pvp, cotizacion_id, producto_id, bom_id, bom_version, cd_presupuestado)
    values (c.cliente, c.chasis, c.gama, coalesce(c.pvp_final, c.pvp), c.id, c.producto_id, c.bom_id, c.bom_version, c.costo_directo)
    returning id into vid;
    if c.lead_id is not null then
      update public.lead_intereses set estado = 'Ganado' where lead_id = c.lead_id and producto_id = c.producto_id;
    end if;
  else
    insert into public.ventas (cliente, chasis, gama, pvp, cotizacion_id)
    values (c.cliente, c.chasis, c.gama, c.pvp, c.id) returning id into vid;
  end if;
  update public.cotizaciones set estado = 'Ganada' where id = p_id;
  if c.lead_id is not null then update public.leads set estado = 'Cerrado' where id = c.lead_id; end if;
  return vid;
end $$;

-- ---------------------------------------------------------------------
-- D. BOM: crear, duplicar, flujo de aprobación, importación
-- ---------------------------------------------------------------------
create or replace function public.bom_crear(p_producto text, p_nota text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.productos; nid uuid; v int;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into pr from public.productos where codigo = p_producto for update;
  if not found then raise exception 'Producto inexistente' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v from public.boms where producto_id = pr.id;
  insert into public.boms (producto_id, version, nota, created_by)
  values (pr.id, v, left(p_nota, 500), auth.uid()) returning id into nid;
  return nid;
end $$;

-- Copia un BOM (de cualquier estado) como borrador nuevo, del mismo u otro
-- producto. Los ítems se copian: no se comparten registros editables.
create or replace function public.bom_duplicar(p_origen uuid, p_producto text default null, p_nota text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.boms; destino text; nid uuid;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into o from public.boms where id = p_origen;
  if not found then raise exception 'BOM inexistente' using errcode = '22023'; end if;
  destino := coalesce(p_producto, (select codigo from public.productos where id = o.producto_id));
  nid := public.bom_crear(destino, coalesce(p_nota, 'Copia del BOM v' || o.version));
  update public.boms set origen_id = o.id where id = nid;
  insert into public.bom_items (bom_id, insumo_codigo, cantidad, merma, pendiente_sustitucion, nota)
  select nid, insumo_codigo, cantidad, merma, pendiente_sustitucion, nota from public.bom_items where bom_id = o.id;
  return nid;
end $$;

create or replace function public.bom_cambiar_estado(p_bom uuid, p_estado text)
returns void
language plpgsql security definer set search_path = public as $$
declare b public.boms; k record; n int;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into b from public.boms where id = p_bom for update;
  if not found then raise exception 'BOM inexistente' using errcode = '22023'; end if;

  if b.estado = 'Borrador' and p_estado = 'Pendiente de validación' then
    if not exists (select 1 from public.bom_items where bom_id = b.id) then
      raise exception 'El BOM no tiene materiales' using errcode = '23514';
    end if;
    update public.boms set estado = p_estado, enviado_por = auth.uid(), enviado_at = now() where id = b.id;

  elsif b.estado = 'Pendiente de validación' and p_estado = 'Borrador' then
    update public.boms set estado = 'Borrador' where id = b.id;

  elsif b.estado = 'Pendiente de validación' and p_estado = 'Aprobado' then
    select * into k from public.costo_bom(b.id);
    if k.pendientes > 0 then
      raise exception 'No se puede aprobar: % material(es) sin precio confirmado', k.pendientes using errcode = '23514';
    end if;
    select count(*) into n from public.bom_items x where x.bom_id = b.id and x.pendiente_sustitucion;
    if n > 0 then
      raise exception 'No se puede aprobar: % material(es) marcados como pendientes de sustitución', n using errcode = '23514';
    end if;
    select count(*) into n from public.bom_items x join public.insumos i on i.codigo = x.insumo_codigo
     where x.bom_id = b.id and not i.activo;
    if n > 0 then
      raise exception 'No se puede aprobar: % material(es) inactivos en el catálogo', n using errcode = '23514';
    end if;
    perform 1 from public.productos where id = b.producto_id for update;
    update public.boms set vigente = false where producto_id = b.producto_id and vigente;
    update public.boms set estado = 'Aprobado', vigente = true, aprobado_por = auth.uid(), aprobado_at = now() where id = b.id;

  elsif b.estado = 'Aprobado' and p_estado = 'Obsoleto' then
    update public.boms set estado = 'Obsoleto', vigente = false where id = b.id;

  else
    raise exception 'Cambio de estado no permitido: % → %', b.estado, p_estado using errcode = '23514';
  end if;
end $$;

-- Importa líneas (por ejemplo, el presupuesto de Sebastián) a un BOM en borrador.
-- Reutiliza materiales existentes por código (sin tocar su precio) y crea los
-- nuevos en el catálogo. Todo o nada.
-- Cada línea: {codigo?, descripcion, categoria, unidad, cantidad, merma?, precio?, moneda?, pendiente_sustitucion?}
create or replace function public.bom_importar(p_bom uuid, p_lineas jsonb, p_tc uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.boms; l jsonb; cod text; ins public.insumos; creados int := 0; reutilizados int := 0; filas int := 0;
        avisos text[] := '{}'; n int := 0; precio numeric; mon text; cant numeric; mer numeric;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into b from public.boms where id = p_bom for update;
  if not found or b.estado <> 'Borrador' then
    raise exception 'Solo se importa sobre un BOM en borrador' using errcode = '23514';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 500 then
    raise exception 'La importación debe tener entre 1 y 500 líneas' using errcode = '22023';
  end if;
  perform set_config('tf.motivo', 'Importación de presupuesto', true);

  for l in select * from jsonb_array_elements(p_lineas) loop
    filas := filas + 1;
    cod  := upper(nullif(trim(coalesce(l->>'codigo', '')), ''));
    cant := (l->>'cantidad')::numeric;
    if cant is null or cant <= 0 then
      raise exception 'Línea %: cantidad inválida', filas using errcode = '22023';
    end if;
    mer := nullif(l->>'merma', '')::numeric;
    if cod is null then                                    -- código automático MAT-0001…
      loop
        n := n + 1; cod := 'MAT-' || lpad(n::text, 4, '0');
        exit when not exists (select 1 from public.insumos where codigo = cod);
      end loop;
    end if;
    select * into ins from public.insumos where codigo = cod;
    if found then
      reutilizados := reutilizados + 1;
      precio := nullif(l->>'precio', '')::numeric;
      if precio is not null and ins.costo_original is distinct from precio then
        avisos := avisos || format('%s: el catálogo tiene %s %s y el archivo %s (no se cambió el catálogo)',
                                   cod, coalesce(ins.costo_original::text, 'sin precio'), ins.moneda, precio);
      end if;
    else
      precio := nullif(l->>'precio', '')::numeric;
      mon := upper(coalesce(nullif(l->>'moneda', ''), 'USD'));
      insert into public.insumos (codigo, categoria, descripcion, unidad, costo_original, moneda, tc_id, merma, cant_s, cant_m, stock)
      values (cod, l->>'categoria', l->>'descripcion', l->>'unidad', precio, mon,
              case when mon = 'ARS' or p_tc is not null then p_tc end, coalesce(mer, 0), 0, 0, 0);
      creados := creados + 1;
      if precio is null then avisos := avisos || format('%s: sin precio, queda pendiente', cod); end if;
    end if;
    if exists (select 1 from public.bom_items where bom_id = b.id and insumo_codigo = cod) then
      avisos := avisos || format('%s: aparecía dos veces; se sumaron las cantidades', cod);
      update public.bom_items set cantidad = cantidad + cant where bom_id = b.id and insumo_codigo = cod;
    else
      insert into public.bom_items (bom_id, insumo_codigo, cantidad, merma, pendiente_sustitucion)
      values (b.id, cod, cant, mer, coalesce((l->>'pendiente_sustitucion')::boolean, false));
    end if;
  end loop;
  return jsonb_build_object('lineas', filas, 'creados', creados, 'reutilizados', reutilizados, 'avisos', to_jsonb(avisos));
end $$;

-- Cambio de precio con motivo (queda en el historial).
create or replace function public.actualizar_precio_material(
  p_codigo text, p_costo_original numeric, p_moneda text, p_tc uuid default null, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Indicá el motivo del cambio de precio' using errcode = '22023';
  end if;
  if p_costo_original is not null and p_costo_original < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '22023';
  end if;
  perform set_config('tf.motivo', left(trim(p_motivo), 300), true);
  update public.insumos set costo_original = p_costo_original, moneda = upper(p_moneda), tc_id = p_tc
   where codigo = p_codigo;
  if not found then raise exception 'Material inexistente' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------
-- E. Sustituciones (optimizador de costos)
-- ---------------------------------------------------------------------
create or replace function public.sustitucion_decidir(p_id uuid, p_aprobar boolean, p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sustituciones;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into s from public.sustituciones where id = p_id for update;
  if not found or s.estado <> 'Propuesta' then
    raise exception 'La sustitución no está pendiente de decisión' using errcode = '23514';
  end if;
  if p_aprobar and (select costo from public.insumos where codigo = s.insumo_alternativa) is null then
    raise exception 'La alternativa no tiene precio confirmado' using errcode = '23514';
  end if;
  perform set_config('tf.interno', '1', true);
  update public.sustituciones
     set estado = case when p_aprobar then 'Aprobada' else 'Rechazada' end,
         decidido_por = auth.uid(), decidido_at = now(),
         nota_tecnica = coalesce(left(p_nota, 500), nota_tecnica)
   where id = p_id;
  perform set_config('tf.interno', '', true);
end $$;

-- Aplica una sustitución APROBADA a un BOM en borrador (el de la propuesta u
-- otro, por ejemplo una copia). Nunca toca BOM aprobados.
create or replace function public.sustitucion_aplicar(p_id uuid, p_bom uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sustituciones; dest uuid; it public.bom_items; malt numeric;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into s from public.sustituciones where id = p_id for update;
  if not found or s.estado <> 'Aprobada' then
    raise exception 'Solo se aplica una sustitución aprobada' using errcode = '23514';
  end if;
  dest := coalesce(p_bom, s.bom_id);
  select * into it from public.bom_items where bom_id = dest and insumo_codigo = s.insumo_original;
  if not found then raise exception 'El BOM destino no contiene el material original' using errcode = '23514'; end if;
  select merma into malt from public.insumos where codigo = s.insumo_alternativa;
  delete from public.bom_items where id = it.id;                    -- falla si el BOM no está en borrador
  insert into public.bom_items (bom_id, insumo_codigo, cantidad, merma, nota)
  values (dest, s.insumo_alternativa, it.cantidad * s.factor_cantidad, malt, left('Sustituye a ' || s.insumo_original, 300))
  on conflict (bom_id, insumo_codigo) do update set cantidad = public.bom_items.cantidad + excluded.cantidad;
  perform set_config('tf.interno', '1', true);
  update public.sustituciones set estado = 'Aplicada', aplicada_at = now() where id = p_id;
  perform set_config('tf.interno', '', true);
end $$;

-- ---------------------------------------------------------------------
-- F. Presupuestos por proyecto
-- ---------------------------------------------------------------------
create or replace function public.presupuesto_crear(
  p_producto text, p_cliente text, p_lead uuid default null, p_tc uuid default null,
  p_addons uuid[] default '{}', p_nota text default null, p_idem uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.productos; b public.boms; tc public.tipos_cambio; nid uuid;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_idem is not null then
    select id into nid from public.presupuestos where idem = p_idem;
    if found then return nid; end if;
  end if;
  select * into pr from public.productos where codigo = p_producto;
  if not found then raise exception 'Producto inexistente' using errcode = '22023'; end if;
  if pr.estado_comercial = 'Inactivo' then raise exception 'El producto % está inactivo', pr.codigo using errcode = '23514'; end if;
  select * into b from public.boms where producto_id = pr.id and vigente;
  if not found then raise exception 'El producto % no tiene un BOM aprobado vigente', pr.codigo using errcode = '23514'; end if;
  if p_tc is not null then
    select * into tc from public.tipos_cambio where id = p_tc;
    if not found then raise exception 'Tipo de cambio inexistente' using errcode = '22023'; end if;
  end if;
  insert into public.presupuestos (cliente, lead_id, producto_id, bom_id, bom_version, tc_id, tc_tipo, tc_valor, tc_fecha, tc_fuente,
                                   addons, nota, idem, created_by)
  values (trim(p_cliente), p_lead, pr.id, b.id, b.version, tc.id, tc.tipo, tc.valor, tc.fecha, tc.fuente,
          coalesce(p_addons, '{}'), left(p_nota, 500), p_idem, auth.uid())
  returning id into nid;
  insert into public.presupuesto_items (presupuesto_id, insumo_codigo, descripcion, categoria, unidad, cantidad, merma,
                                        costo_original, moneda, origen, created_by)
  select nid, i.codigo, i.descripcion, i.categoria, i.unidad, x.cantidad, x.merma, i.costo_original, i.moneda, 'BOM', auth.uid()
    from public.bom_items x join public.insumos i on i.codigo = x.insumo_codigo
   where x.bom_id = b.id;
  return nid;
end $$;

-- Agregar un material a un proyecto.
--   p_modo = 'proyecto' → Opción A: solo en este presupuesto (no toca el catálogo ni el BOM).
--   p_modo = 'catalogo' → Opción B: lo crea en el catálogo maestro y lo agrega al proyecto,
--                         en la misma transacción. Si ya existe, exige p_reutilizar.
create or replace function public.presupuesto_agregar_material(
  p_presupuesto uuid, p_modo text, p_codigo text, p_descripcion text, p_categoria text, p_unidad text,
  p_cantidad numeric, p_merma numeric default 0, p_costo_original numeric default null, p_moneda text default 'USD',
  p_motivo text default null, p_proveedor uuid default null, p_reutilizar boolean default false, p_idem uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ps public.presupuestos; ins public.insumos; cod text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
        nid uuid; creado boolean := false; reut boolean := false; mon text := upper(coalesce(p_moneda, 'USD'));
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_idem is not null then
    perform 1 from public.presupuesto_items where idem = p_idem;
    if found then
      return (select jsonb_build_object('item_id', x.id, 'insumo_codigo', x.insumo_codigo, 'repetido', true)
                from public.presupuesto_items x where x.idem = p_idem);
    end if;
  end if;
  if p_modo not in ('proyecto','catalogo') then raise exception 'Modo inválido' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indicá el motivo del agregado' using errcode = '22023'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad inválida' using errcode = '22023'; end if;
  select * into ps from public.presupuestos where id = p_presupuesto for update;
  if not found then raise exception 'Presupuesto inexistente' using errcode = '22023'; end if;
  if ps.estado <> 'Borrador' then
    raise exception 'El presupuesto está %: creá una revisión nueva para modificarlo', lower(ps.estado) using errcode = '23514';
  end if;

  if cod is not null then select * into ins from public.insumos where codigo = cod; end if;
  if ins.codigo is null and p_modo = 'catalogo' then
    select * into ins from public.insumos
     where lower(trim(descripcion)) = lower(trim(coalesce(p_descripcion, ''))) limit 1;
  end if;

  if p_modo = 'catalogo' then
    if ins.codigo is not null and not p_reutilizar then
      raise exception 'Ya existe en el catálogo el material % (%): reutilizalo en lugar de crear un duplicado',
        ins.codigo, ins.descripcion using errcode = '23505';
    end if;
    if ins.codigo is null then
      if cod is null then raise exception 'Indicá el código del material nuevo' using errcode = '22023'; end if;
      perform set_config('tf.motivo', left('Alta desde presupuesto N.º ' || ps.numero || ': ' || trim(p_motivo), 300), true);
      insert into public.insumos (codigo, categoria, descripcion, unidad, costo_original, moneda, tc_id, merma, proveedor_id,
                                  cant_s, cant_m, stock)
      values (cod, p_categoria, trim(p_descripcion), p_unidad, p_costo_original, mon,
              case when mon = 'ARS' then ps.tc_id end, coalesce(p_merma, 0), p_proveedor, 0, 0, 0)
      returning * into ins;
      creado := true;
    else
      reut := true;
    end if;
  elsif ins.codigo is not null then
    reut := true;                                          -- material del catálogo, solo para este proyecto
  end if;

  if ins.codigo is not null then
    insert into public.presupuesto_items (presupuesto_id, insumo_codigo, descripcion, categoria, unidad, cantidad, merma,
                                          costo_original, moneda, origen, motivo, idem, created_by)
    values (ps.id, ins.codigo, ins.descripcion, ins.categoria, ins.unidad, p_cantidad, coalesce(p_merma, ins.merma),
            case when creado or p_costo_original is null then ins.costo_original else p_costo_original end,
            case when creado or p_costo_original is null then ins.moneda else mon end,
            'Catálogo', trim(p_motivo), p_idem, auth.uid())
    returning id into nid;
  else
    insert into public.presupuesto_items (presupuesto_id, insumo_codigo, descripcion, categoria, unidad, cantidad, merma,
                                          costo_original, moneda, origen, motivo, idem, created_by)
    values (ps.id, null, trim(p_descripcion), p_categoria, p_unidad, p_cantidad, coalesce(p_merma, 0),
            p_costo_original, mon, 'Solo proyecto', trim(p_motivo), p_idem, auth.uid())
    returning id into nid;
  end if;
  return jsonb_build_object('item_id', nid, 'insumo_codigo', ins.codigo, 'creado_en_catalogo', creado, 'reutilizado', reut);
end $$;

create or replace function public.presupuesto_nueva_revision(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.presupuestos; nid uuid; rev int;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into o from public.presupuestos where id = p_id;
  if not found then raise exception 'Presupuesto inexistente' using errcode = '22023'; end if;
  if o.estado = 'Anulado' then raise exception 'No se revisa un presupuesto anulado' using errcode = '23514'; end if;
  perform 1 from public.presupuestos where grupo = o.grupo for update;
  select max(revision) + 1 into rev from public.presupuestos where grupo = o.grupo;
  insert into public.presupuestos (grupo, revision, cliente, lead_id, producto_id, bom_id, bom_version, tc_id, tc_tipo, tc_valor,
                                   tc_fecha, tc_fuente, addons, descuento, descuento_motivo, descuento_autorizado_por, nota, created_by)
  values (o.grupo, rev, o.cliente, o.lead_id, o.producto_id, o.bom_id, o.bom_version, o.tc_id, o.tc_tipo, o.tc_valor,
          o.tc_fecha, o.tc_fuente, o.addons, o.descuento, o.descuento_motivo, o.descuento_autorizado_por, o.nota, auth.uid())
  returning id into nid;
  insert into public.presupuesto_items (presupuesto_id, insumo_codigo, descripcion, categoria, unidad, cantidad, merma,
                                        costo_original, moneda, origen, motivo, created_by)
  select nid, insumo_codigo, descripcion, categoria, unidad, cantidad, merma, costo_original, moneda, origen, motivo, auth.uid()
    from public.presupuesto_items where presupuesto_id = o.id;
  return nid;
end $$;

-- Cambiar el tipo de cambio de un presupuesto en borrador (recalcula los ítems en pesos).
create or replace function public.presupuesto_cambiar_tc(p_id uuid, p_tc uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare tc public.tipos_cambio;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into tc from public.tipos_cambio where id = p_tc;
  if not found then raise exception 'Tipo de cambio inexistente' using errcode = '22023'; end if;
  update public.presupuestos set tc_id = tc.id, tc_tipo = tc.tipo, tc_valor = tc.valor, tc_fecha = tc.fecha, tc_fuente = tc.fuente
   where id = p_id;                                       -- el trigger exige borrador
  if not found then raise exception 'Presupuesto inexistente' using errcode = '22023'; end if;
  update public.presupuesto_items set moneda = moneda where presupuesto_id = p_id;
end $$;

-- Traer al presupuesto en borrador los precios actuales del catálogo.
create or replace function public.presupuesto_actualizar_precios(p_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.presupuesto_items x set costo_original = i.costo_original, moneda = i.moneda
    from public.insumos i
   where x.presupuesto_id = p_id and x.insumo_codigo = i.codigo
     and (x.costo_original is distinct from i.costo_original or x.moneda is distinct from i.moneda);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.presupuesto_anular(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  perform set_config('tf.interno', '1', true);
  update public.presupuestos set estado = 'Anulado' where id = p_id and estado in ('Borrador','Emitido');
  if not found then raise exception 'El presupuesto no se puede anular' using errcode = '23514'; end if;
  perform set_config('tf.interno', '', true);
end $$;

-- ---------------------------------------------------------------------
-- G. Producción 2.0: la orden toma el producto y el BOM aprobado
-- ---------------------------------------------------------------------
create or replace function public.tg_fabricacion_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.ventas; c public.cotizaciones; pr public.productos; b public.boms; k record;
begin
  if tg_op = 'UPDATE' then
    if old.producto_id is not null and (new.chasis is distinct from old.chasis or new.gama is distinct from old.gama) then
      raise exception 'En una orden 2.0 el tamaño y la gama salen del producto' using errcode = '23514';
    end if;
    if new.venta_id is distinct from old.venta_id and new.venta_id is not null and old.producto_id is not null then
      select * into v from public.ventas where id = new.venta_id;
      if v.producto_id is distinct from old.producto_id then
        raise exception 'La venta corresponde a otro producto' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- INSERT: los costos presupuestados los fija el servidor
  new.costo_mat_pres := null; new.costo_mdo_pres := null; new.bom_version := null;
  if new.venta_id is not null then
    select * into v from public.ventas where id = new.venta_id;
    if v.producto_id is not null then
      new.producto_id := v.producto_id;
      new.bom_id := coalesce(v.bom_id, new.bom_id);
    end if;
  end if;
  if new.producto_id is null then
    new.generacion := '1.0'; new.bom_id := null;            -- orden 1.0: cómputo del chasis base
    return new;
  end if;
  select * into pr from public.productos where id = new.producto_id;
  if not found then raise exception 'Producto inexistente' using errcode = '22023'; end if;
  if new.bom_id is null then
    select * into b from public.boms where producto_id = pr.id and vigente;
    if not found then raise exception 'El producto % no tiene un BOM aprobado vigente', pr.codigo using errcode = '23514'; end if;
  else
    select * into b from public.boms where id = new.bom_id;
    if not found or b.producto_id <> pr.id or b.estado not in ('Aprobado','Obsoleto') then
      raise exception 'El BOM indicado no está aprobado para ese producto' using errcode = '23514';
    end if;
  end if;
  new.bom_id := b.id; new.bom_version := b.version; new.generacion := '2.0';
  new.chasis := pr.tamano; new.gama := pr.gama;
  if v.cotizacion_id is not null then
    select * into c from public.cotizaciones where id = v.cotizacion_id;
  end if;
  if c.generacion = '2.0' then
    new.costo_mat_pres := c.costo_materiales; new.costo_mdo_pres := c.costo_mdo;
  else
    select * into k from public.costo_bom(b.id);
    new.costo_mat_pres := round(k.materiales, 2); new.costo_mdo_pres := round(k.mano_obra, 2);
  end if;
  return new;
end $$;
create trigger t_fabricacion_producto before insert or update on public.fabricacion
  for each row execute function public.tg_fabricacion_producto();

-- Descuento de stock 2.0: usa el BOM aprobado de la orden. Atómico: si falta
-- algo no descuenta nada; una orden no se descuenta dos veces.
create or replace function public.descontar_materiales_v2(p_fab uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare f public.fabricacion; faltan text;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into f from public.fabricacion where id = p_fab for update;
  if not found then raise exception 'Orden de fabricación inexistente' using errcode = '22023'; end if;
  if f.materiales_descontados then raise exception 'Los materiales de esta orden ya fueron descontados' using errcode = '23514'; end if;
  if f.bom_id is null then raise exception 'La orden no tiene un BOM 2.0' using errcode = '23514'; end if;

  select string_agg(i.codigo || ' (faltan ' || round(x.cantidad * (1 + x.merma) - i.stock, 2) || ' ' || i.unidad || ')', ', ' order by i.codigo)
    into faltan
    from public.bom_items x join public.insumos i on i.codigo = x.insumo_codigo
   where x.bom_id = f.bom_id and i.categoria <> 'Mano de Obra' and x.cantidad * (1 + x.merma) > i.stock;
  if faltan is not null then
    raise exception 'Stock insuficiente: %', faltan using errcode = '23514';
  end if;

  update public.insumos i set stock = i.stock - x.cantidad * (1 + x.merma)
    from public.bom_items x
   where x.bom_id = f.bom_id and x.insumo_codigo = i.codigo and i.categoria <> 'Mano de Obra';
  update public.fabricacion set materiales_descontados = true where id = p_fab;
end $$;

-- 1.0 con la misma firma: las órdenes 1.0 siguen igual; las 2.0 usan su BOM.
create or replace function public.descontar_materiales(p_fab uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare f public.fabricacion; faltan text;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into f from public.fabricacion where id = p_fab for update;
  if not found then raise exception 'Orden de fabricación inexistente' using errcode = '22023'; end if;
  if f.bom_id is not null then
    perform public.descontar_materiales_v2(p_fab);
    return;
  end if;
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

-- ---------------------------------------------------------------------
-- H. Vistas. Se conservan todas las columnas existentes, en el mismo
--    orden; las nuevas se agregan al final.
-- ---------------------------------------------------------------------
create or replace view public.v_ventas with (security_invoker = true) as
select v.id, v.numero, v.fecha, v.cliente, v.chasis, v.gama, v.pvp, v.costo_real, v.estado_cobro,
       v.fecha_cobro, v.cotizacion_id, v.created_by,
       x.cd_pres,
       x.cd,
       x.hon,
       x.mkt,
       x.gan                                      as ganancia,
       x.gan * p.p_reserva                        as reserva,
       (x.gan - x.gan * p.p_reserva) * p.p_div_socio                          as div_a,
       (x.gan - x.gan * p.p_reserva) - (x.gan - x.gan * p.p_reserva) * p.p_div_socio as div_b,
       case when v.costo_real is null then null else v.costo_real - x.cd_pres end    as desvio,
       -- 2.0
       v.generacion, v.producto_id, v.producto_codigo, v.tecnologia, v.superficie_m2,
       v.bom_id, v.bom_version, v.cd_presupuestado,
       case when v.costo_real is null or x.cd_pres = 0 then null else (v.costo_real - x.cd_pres) / x.cd_pres end as desvio_pct,
       x.gan - x.gan * p.p_reserva                as masa_distribuible
  from public.ventas v
  cross join public.params p
  cross join lateral (
    -- Costo presupuestado: el que fijó la cotización 2.0 si existe; si no, PVP × p_costo (1.0, sin cambios).
    select coalesce(v.cd_presupuestado, v.pvp * p.p_costo)                       as cd_pres,
           coalesce(v.costo_real, v.cd_presupuestado, v.pvp * p.p_costo)         as cd,
           v.pvp * p.p_hon                                                       as hon,
           v.pvp * p.p_mkt                                                       as mkt,
           v.pvp - coalesce(v.costo_real, v.cd_presupuestado, v.pvp * p.p_costo) - v.pvp * p.p_hon - v.pvp * p.p_mkt as gan
  ) x;

create view public.v_fabricacion with (security_invoker = true) as
select f.id, f.numero, f.venta_id, f.chasis, f.gama, f.estado, f.fecha_inicio, f.fecha_fin,
       f.materiales_descontados, f.notas,
       coalesce(h.horas_total, 0) as horas_total,
       coalesce(h.mdo_real, 0)    as mdo_real,
       case when f.bom_id is not null then coalesce(f.costo_mdo_pres, 0)
            else (select coalesce(sum(i.costo * (case when f.chasis = 'S' then i.cant_s else i.cant_m end) * (1 + i.merma)), 0)
                    from public.insumos i where i.categoria = 'Mano de Obra') end as mdo_presupuestada,
       -- 2.0
       f.generacion, f.producto_id, f.bom_id, f.bom_version, f.costo_mat_pres, f.costo_mdo_pres,
       pr.codigo as producto_codigo, pr.tecnologia, pr.superficie_m2
  from public.fabricacion f
  left join (select fabricacion_id, sum(horas) horas_total, sum(horas * costo_hora_aplicado) mdo_real
               from public.horas group by fabricacion_id) h on h.fabricacion_id = f.id
  left join public.productos pr on pr.id = f.producto_id;

-- Permisos de lo recreado / nuevo (Supabase da permisos por defecto a anon y a PUBLIC)
revoke all on public.v_fabricacion from anon;
grant select on public.v_fabricacion to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.es_socio(), public.mi_rol(),
  public.calcular_cotizacion(text, text, uuid[]),
  public.crear_cotizacion(text, text, text, uuid[], uuid),
  public.convertir_cotizacion(uuid),
  public.descontar_materiales(uuid),
  public.registrar_referencia_bom(text)
  to authenticated;

insert into public.schema_migraciones (version, descripcion)
values ('2026.10.08-03', 'Trazo Fino 2.0 · motor de costos, cotización 2.0, BOM, presupuestos, producción y vistas');

commit;
