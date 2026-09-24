-- =====================================================================
--  TRAZO FINO · Línea de módulos en seco
--  Esquema de base de datos para Supabase (PostgreSQL 15+)
--
--  Ejecutar UNA VEZ en: Supabase → SQL Editor → New query → Run
--
--  Principio de diseño: el navegador NO es de confianza.
--  Toda regla de negocio que importa (precios, reparto, aprobaciones,
--  stock) se valida o se calcula acá, en el servidor. El frontend solo
--  muestra y pide; si alguien manipula el navegador, la base rechaza.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SOCIOS  (quién puede entrar al sistema)
--    Se cargan a mano desde el SQL Editor, nunca desde la web.
-- ---------------------------------------------------------------------
create table public.socios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null check (char_length(nombre) between 2 and 60),
  rol     char(1) not null unique check (rol in ('A','B'))
);
comment on column public.socios.rol is 'A = Socio Arquitecto (taller/producto) · B = Socio Negocios (comercial/digital)';

create or replace function public.es_socio() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.socios where user_id = auth.uid());
$$;

create or replace function public.mi_rol() returns char
language sql stable security definer set search_path = public as $$
  select rol from public.socios where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 2. REGLAS DE PRECIO  (una sola fila)
--    El CHECK suma_100 hace imposible guardar porcentajes que no cierren.
-- ---------------------------------------------------------------------
create table public.params (
  id              int primary key default 1 check (id = 1),
  p_costo         numeric(6,4) not null check (p_costo  between 0.30 and 0.80),
  p_hon           numeric(6,4) not null check (p_hon    between 0    and 0.25),
  p_mkt           numeric(6,4) not null check (p_mkt    between 0    and 0.25),
  p_margen        numeric(6,4) not null check (p_margen between 0    and 0.50),
  p_reserva       numeric(6,4) not null check (p_reserva   between 0 and 1),
  p_div_socio     numeric(6,4) not null check (p_div_socio between 0 and 1),
  nombre_empresa  text not null default 'Trazo Fino' check (char_length(nombre_empresa) between 1 and 60),
  updated_at      timestamptz not null default now(),
  constraint suma_100 check (round(p_costo + p_hon + p_mkt + p_margen, 4) = 1)
);

-- ---------------------------------------------------------------------
-- 3. CATÁLOGO: gamas, adicionales, proveedores, insumos (BOM)
-- ---------------------------------------------------------------------
create table public.gamas (
  nombre      text primary key check (char_length(nombre) between 2 and 30),
  coef        numeric(6,3)  not null check (coef > 0 and coef <= 5),
  usd_m2_min  numeric(10,2) not null check (usd_m2_min >= 0),
  usd_m2_max  numeric(10,2) not null,
  orden       int not null default 0,
  constraint rango_valido check (usd_m2_max >= usd_m2_min)
);

create table public.addons (
  id       uuid primary key default gen_random_uuid(),
  nombre   text not null unique check (char_length(nombre) between 2 and 60),
  costo_s  numeric(12,2) not null check (costo_s between 0 and 1000000),
  costo_m  numeric(12,2) not null check (costo_m between 0 and 1000000)
);

create table public.proveedores (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (char_length(nombre) between 2 and 80),
  rubro     text check (char_length(rubro) <= 60),
  contacto  text check (char_length(contacto) <= 80),
  telefono  text check (telefono ~ '^[0-9 +()\-]{0,30}$'),
  email     text check (email is null or email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

create table public.insumos (
  codigo        text primary key check (codigo ~ '^[A-Z0-9\-]{2,20}$'),
  categoria     text not null check (categoria in
                ('Hierro','Aislación','Aberturas','Terminaciones','Revestimientos','Consumibles','Mano de Obra')),
  descripcion   text not null check (char_length(descripcion) between 2 and 120),
  unidad        text not null check (unidad in ('m','m²','m³','kg','un','lt','gl','jornal','hora','global')),
  costo         numeric(12,2) not null check (costo between 0 and 1000000),
  merma         numeric(5,4)  not null default 0 check (merma between 0 and 0.5),
  cant_s        numeric(12,2) not null default 0 check (cant_s >= 0),
  cant_m        numeric(12,2) not null default 0 check (cant_m >= 0),
  stock         numeric(12,2) not null default 0 check (stock >= 0),
  proveedor_id  uuid references public.proveedores(id) on delete set null
);

-- Referencia del cómputo para detectar variaciones >10 % (Pacto de Socios, cl. 3.2.b.7)
create table public.bom_referencias (
  id          uuid primary key default gen_random_uuid(),
  fecha       timestamptz not null default now(),
  costo_s     numeric(14,2) not null,
  costo_m     numeric(14,2) not null,
  nota        text check (char_length(nota) <= 300),
  created_by  uuid references public.socios(user_id) on delete set null
);

-- ---------------------------------------------------------------------
-- 4. CRM
-- ---------------------------------------------------------------------
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  fecha             date not null default current_date,
  nombre            text not null check (char_length(nombre) between 2 and 80),
  telefono          text check (telefono ~ '^[0-9 +()\-]{0,30}$'),
  email             text check (email is null or email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  terreno           boolean not null default false,
  ubicacion         text check (char_length(ubicacion) <= 80),
  gama              text not null default 'Indefinido' check (char_length(gama) <= 30),
  origen            text not null check (origen in
                    ('Meta Ads','Google Ads','Instagram orgánico','TikTok','Referido','Influencer','Web directa')),
  estado            text not null default 'Nuevo' check (estado in
                    ('Nuevo','Calificado','En Cotización','Cerrado','Perdido')),
  ult_contacto      date,
  proximo_contacto  date,
  notas             text check (char_length(notas) <= 1000),
  created_at        timestamptz not null default now()
);

create table public.interacciones (
  id       uuid primary key default gen_random_uuid(),
  lead_id  uuid not null references public.leads(id) on delete cascade,
  fecha    date not null default current_date check (fecha <= current_date + 1),
  tipo     text not null check (tipo in ('Llamada','WhatsApp','Email','Reunión','Visita a obra','Nota')),
  nota     text not null check (char_length(nota) between 1 and 1000),
  autor    uuid references public.socios(user_id) on delete set null
);

-- ---------------------------------------------------------------------
-- 5. COMERCIAL: cotizaciones y ventas
-- ---------------------------------------------------------------------
create table public.cotizaciones (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity,
  fecha          date not null default current_date,
  cliente        text not null check (char_length(cliente) between 1 and 80),
  chasis         char(1) not null check (chasis in ('S','M')),
  gama           text not null references public.gamas(nombre) on update cascade,
  addons         uuid[] not null default '{}',
  pvp            numeric(14,2) not null check (pvp >= 0),
  costo_directo  numeric(14,2) not null check (costo_directo >= 0),
  estado         text not null default 'Enviada' check (estado in ('Enviada','Ganada','Perdida')),
  lead_id        uuid references public.leads(id) on delete set null,
  created_by     uuid references public.socios(user_id) on delete set null
);

create table public.ventas (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity,
  fecha          date not null default current_date,
  cliente        text not null check (char_length(cliente) between 1 and 80),
  chasis         char(1) not null check (chasis in ('S','M')),
  gama           text not null references public.gamas(nombre) on update cascade,
  pvp            numeric(14,2) not null check (pvp > 0 and pvp <= 10000000),
  costo_real     numeric(14,2) check (costo_real is null or costo_real >= 0),
  estado_cobro   text not null default 'Seña recibida' check (estado_cobro in
                 ('Seña recibida','50% avance','Cobrado','Vencido')),
  fecha_cobro    date,
  cotizacion_id  uuid references public.cotizaciones(id) on delete set null,
  created_by     uuid references public.socios(user_id) on delete set null
);

-- ---------------------------------------------------------------------
-- 6. SCM: órdenes de compra
-- ---------------------------------------------------------------------
create table public.ordenes_compra (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity,
  fecha         date not null default current_date,
  proveedor_id  uuid not null references public.proveedores(id) on delete restrict,
  estado        text not null default 'Borrador' check (estado in ('Borrador','Enviada','Recibida','Cancelada')),
  notas         text check (char_length(notas) <= 500),
  recibida_at   timestamptz,
  created_by    uuid references public.socios(user_id) on delete set null
);

create table public.oc_items (
  id             uuid primary key default gen_random_uuid(),
  oc_id          uuid not null references public.ordenes_compra(id) on delete cascade,
  insumo_codigo  text not null references public.insumos(codigo) on update cascade on delete restrict,
  cantidad       numeric(12,2) not null check (cantidad > 0 and cantidad <= 1000000),
  costo_unit     numeric(12,2) not null check (costo_unit between 0 and 1000000)
);

-- ---------------------------------------------------------------------
-- 7. FINANZAS: gastos extraordinarios (Pacto de Socios, cl. 3.5)
-- ---------------------------------------------------------------------
create table public.gastos (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated always as identity,
  fecha                   date not null default current_date,
  concepto                text not null check (char_length(concepto) between 3 and 200),
  categoria               text not null check (categoria in ('Herramientas','Materiales','Pauta','Servicios','Otros')),
  monto                   numeric(12,2) not null check (monto > 0 and monto <= 1000000),
  solicitado_por          uuid references public.socios(user_id) on delete set null,
  urgencia                boolean not null default false,
  justificacion_urgencia  text check (char_length(justificacion_urgencia) <= 500),
  aprob_a                 boolean not null default false,
  aprob_b                 boolean not null default false,
  estado                  text not null default 'Pendiente' check (estado in ('Pendiente','Aprobado','Ejecutado','Rechazado')),
  constraint urgencia_justificada check (not urgencia or char_length(coalesce(justificacion_urgencia,'')) >= 10)
);

-- ---------------------------------------------------------------------
-- 8. TALLER / RR.HH.: operarios, órdenes de fabricación, horas
-- ---------------------------------------------------------------------
create table public.operarios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(nombre) between 2 and 80),
  oficio      text not null check (oficio in ('Herrero','Armador','Oficial','Ayudante','Aplicador')),
  costo_hora  numeric(10,2) not null check (costo_hora > 0 and costo_hora <= 1000),
  activo      boolean not null default true
);

create table public.fabricacion (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated always as identity,
  venta_id                uuid references public.ventas(id) on delete set null,
  chasis                  char(1) not null check (chasis in ('S','M')),
  gama                    text not null references public.gamas(nombre) on update cascade,
  estado                  text not null default 'Planificada' check (estado in ('Planificada','En curso','Terminada')),
  fecha_inicio            date,
  fecha_fin               date,
  materiales_descontados  boolean not null default false,
  notas                   text check (char_length(notas) <= 500),
  constraint fechas_coherentes check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create table public.horas (
  id                   uuid primary key default gen_random_uuid(),
  fecha                date not null default current_date check (fecha <= current_date + 1),
  operario_id          uuid not null references public.operarios(id) on delete restrict,
  fabricacion_id       uuid not null references public.fabricacion(id) on delete cascade,
  horas                numeric(4,2) not null check (horas > 0 and horas <= 16),
  costo_hora_aplicado  numeric(10,2) not null default 0,
  notas                text check (char_length(notas) <= 300)
);

-- ---------------------------------------------------------------------
-- 9. AUDITORÍA  (solo escribe el servidor; el navegador solo lee)
-- ---------------------------------------------------------------------
create table public.auditoria (
  id        bigint generated always as identity primary key,
  fecha     timestamptz not null default now(),
  usuario   uuid,
  tabla     text not null,
  accion    text not null,
  registro  text,
  datos     jsonb
);

-- =====================================================================
--  TRIGGERS: reglas que el navegador no puede saltear
-- =====================================================================

-- Autor = usuario autenticado. Nunca se confía en lo que manda el cliente.
create or replace function public.tg_set_autor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'interacciones' then new.autor := auth.uid();
  else new.created_by := auth.uid();
  end if;
  return new;
end $$;

create trigger t_autor before insert on public.interacciones  for each row execute function public.tg_set_autor();
create trigger t_autor before insert on public.ventas         for each row execute function public.tg_set_autor();
create trigger t_autor before insert on public.ordenes_compra for each row execute function public.tg_set_autor();
create trigger t_autor before insert on public.bom_referencias for each row execute function public.tg_set_autor();

-- Registrar un contacto actualiza la fecha de último contacto del lead.
create or replace function public.tg_interaccion_ultcontacto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set ult_contacto = new.fecha
   where id = new.lead_id and (ult_contacto is null or ult_contacto < new.fecha);
  return new;
end $$;
create trigger t_ultcontacto after insert on public.interacciones
  for each row execute function public.tg_interaccion_ultcontacto();

-- Gastos: quién pidió lo fija el servidor; cada socio solo firma su propia aprobación.
create or replace function public.tg_gastos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r char;
begin
  r := public.mi_rol();
  if tg_op = 'INSERT' then
    new.solicitado_por := auth.uid();
    new.aprob_a := false;
    new.aprob_b := false;
    new.estado  := case when new.monto <= 500 then 'Aprobado' else 'Pendiente' end;
    return new;
  end if;

  -- UPDATE
  if new.solicitado_por is distinct from old.solicitado_por then
    raise exception 'No se puede cambiar quién solicitó el gasto' using errcode = '42501';
  end if;
  if new.aprob_a is distinct from old.aprob_a and r is distinct from 'A' then
    raise exception 'Solo el Socio A puede firmar su aprobación' using errcode = '42501';
  end if;
  if new.aprob_b is distinct from old.aprob_b and r is distinct from 'B' then
    raise exception 'Solo el Socio B puede firmar su aprobación' using errcode = '42501';
  end if;
  -- Si cambia el monto, las firmas anteriores dejan de valer.
  if new.monto <> old.monto then
    new.aprob_a := false; new.aprob_b := false;
    if new.estado = 'Aprobado' and new.monto > 500 then new.estado := 'Pendiente'; end if;
  end if;
  if new.monto > 500 and new.estado = 'Aprobado' and not (new.aprob_a and new.aprob_b) then
    raise exception 'Un gasto mayor a USD 500 necesita la aprobación de ambos socios' using errcode = '23514';
  end if;
  if new.monto > 500 and new.aprob_a and new.aprob_b and new.estado = 'Pendiente' then
    new.estado := 'Aprobado';
  end if;
  return new;
end $$;
create trigger t_gastos before insert or update on public.gastos
  for each row execute function public.tg_gastos();

-- Horas: el costo por hora se congela al momento de cargar.
create or replace function public.tg_horas_costo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select costo_hora into new.costo_hora_aplicado from public.operarios where id = new.operario_id;
  return new;
end $$;
create trigger t_horas_costo before insert or update of operario_id on public.horas
  for each row execute function public.tg_horas_costo();

-- Órdenes de compra: al pasar a "Recibida" suma el stock. Recibida es irreversible.
create or replace function public.tg_oc_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'Recibida' and new.estado <> 'Recibida' then
    raise exception 'Una orden recibida no puede volver atrás' using errcode = '23514';
  end if;
  if new.estado = 'Recibida' and old.estado <> 'Recibida' then
    if not exists (select 1 from public.oc_items where oc_id = new.id) then
      raise exception 'La orden no tiene ítems' using errcode = '23514';
    end if;
    update public.insumos i set stock = i.stock + x.cantidad
      from (select insumo_codigo, sum(cantidad) cantidad from public.oc_items
             where oc_id = new.id group by insumo_codigo) x
     where i.codigo = x.insumo_codigo;
    new.recibida_at := now();
  end if;
  return new;
end $$;
create trigger t_oc_estado before update of estado on public.ordenes_compra
  for each row execute function public.tg_oc_estado();

create or replace function public.tg_oc_items_bloqueo() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  select estado into e from public.ordenes_compra where id = coalesce(new.oc_id, old.oc_id);
  if e in ('Recibida','Cancelada') then
    raise exception 'No se pueden modificar ítems de una orden %', lower(e) using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger t_oc_items_bloqueo before insert or update or delete on public.oc_items
  for each row execute function public.tg_oc_items_bloqueo();

-- Auditoría genérica
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare fila jsonb;
begin
  fila := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.auditoria(usuario, tabla, accion, registro, datos)
  values (auth.uid(), tg_table_name, tg_op,
          coalesce(fila->>'id', fila->>'codigo', fila->>'nombre'), fila);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['params','gamas','addons','insumos','ventas','cotizaciones',
                           'gastos','ordenes_compra','fabricacion','proveedores','operarios']
  loop
    execute format('create trigger t_auditoria after insert or update or delete on public.%I
                    for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;

-- =====================================================================
--  FUNCIONES DE NEGOCIO (se ejecutan en el servidor)
-- =====================================================================

-- Motor de cotización: la misma fórmula del Pacto de Socios, calculada en la base.
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

-- Guardar cotización: el PVP lo calcula el servidor, no el navegador.
create or replace function public.crear_cotizacion(
  p_cliente text, p_chasis text, p_gama text, p_addons uuid[] default '{}', p_lead uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r record; nid uuid;
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into r from public.calcular_cotizacion(p_chasis, p_gama, p_addons);
  insert into public.cotizaciones (cliente, chasis, gama, addons, pvp, costo_directo, lead_id, created_by)
  values (trim(p_cliente), p_chasis, p_gama, coalesce(p_addons, '{}'),
          round(r.pvp, 2), round(r.costo_directo, 2), p_lead, auth.uid())
  returning id into nid;
  if p_lead is not null then
    update public.leads set estado = 'En Cotización'
     where id = p_lead and estado in ('Nuevo','Calificado');
  end if;
  return nid;
end $$;

-- Convertir cotización en venta, con el PVP que calculó el servidor.
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

-- Descontar del stock los materiales de un chasis (atómico: todo o nada).
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

-- Registrar el cómputo vigente como referencia (base para la alerta del 10 %).
create or replace function public.registrar_referencia_bom(p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_socio() then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into public.bom_referencias (costo_s, costo_m, nota, created_by)
  select coalesce(sum(costo * cant_s * (1 + merma)), 0),
         coalesce(sum(costo * cant_m * (1 + merma)), 0),
         left(p_nota, 300), auth.uid()
    from public.insumos;
end $$;

-- =====================================================================
--  VISTAS CALCULADAS  (security_invoker: respetan la seguridad por fila)
-- =====================================================================

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

create view public.v_gastos with (security_invoker = true) as
select g.*,
       s.rol    as rol_solicitante,
       s.nombre as nombre_solicitante,
       (g.monto > 500 and g.estado = 'Ejecutado' and not (g.aprob_a and g.aprob_b) and not g.urgencia) as imputado
  from public.gastos g
  left join public.socios s on s.user_id = g.solicitado_por;

create view public.v_fabricacion with (security_invoker = true) as
select f.*,
       coalesce(h.horas_total, 0) as horas_total,
       coalesce(h.mdo_real, 0)    as mdo_real,
       (select coalesce(sum(i.costo * (case when f.chasis = 'S' then i.cant_s else i.cant_m end) * (1 + i.merma)), 0)
          from public.insumos i where i.categoria = 'Mano de Obra') as mdo_presupuestada
  from public.fabricacion f
  left join (select fabricacion_id, sum(horas) horas_total, sum(horas * costo_hora_aplicado) mdo_real
               from public.horas group by fabricacion_id) h on h.fabricacion_id = f.id;

-- =====================================================================
--  SEGURIDAD: permisos y seguridad por fila (RLS)
-- =====================================================================

-- Los anónimos no tocan nada. Defensa en profundidad además de RLS.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

grant execute on function public.es_socio(), public.mi_rol(),
  public.calcular_cotizacion(text, text, uuid[]),
  public.crear_cotizacion(text, text, text, uuid[], uuid),
  public.convertir_cotizacion(uuid),
  public.descontar_materiales(uuid),
  public.registrar_referencia_bom(text)
  to authenticated;

do $$
declare t text;
begin
  foreach t in array array['socios','params','gamas','addons','proveedores','insumos','bom_referencias',
                           'leads','interacciones','cotizaciones','ventas','ordenes_compra','oc_items',
                           'gastos','operarios','fabricacion','horas','auditoria']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Tablas de trabajo: cualquier socio autenticado lee y escribe.
do $$
declare t text;
begin
  foreach t in array array['gamas','addons','proveedores','insumos','leads','interacciones',
                           'ventas','ordenes_compra','oc_items','gastos','operarios','fabricacion','horas']
  loop
    execute format('create policy socios_todo on public.%I for all to authenticated
                    using (public.es_socio()) with check (public.es_socio())', t);
  end loop;
end $$;

-- Solo lectura para el navegador (las escriben funciones del servidor o el administrador).
create policy socios_leen on public.socios          for select to authenticated using (public.es_socio());
create policy socios_leen on public.auditoria       for select to authenticated using (public.es_socio());
create policy socios_leen on public.bom_referencias for select to authenticated using (public.es_socio());
revoke insert, update, delete on public.socios, public.auditoria, public.bom_referencias from authenticated;

-- Reglas de precio: se leen y se actualizan; no se crean ni se borran.
create policy socios_leen      on public.params for select to authenticated using (public.es_socio());
create policy socios_actualizan on public.params for update to authenticated
  using (public.es_socio()) with check (public.es_socio());
revoke insert, delete on public.params from authenticated;

-- Cotizaciones: se crean solo por función (PVP calculado en servidor).
-- Desde el navegador solo se puede cambiar el estado o borrarlas.
create policy socios_leen    on public.cotizaciones for select to authenticated using (public.es_socio());
create policy socios_estado  on public.cotizaciones for update to authenticated
  using (public.es_socio()) with check (public.es_socio());
create policy socios_borran  on public.cotizaciones for delete to authenticated using (public.es_socio());
revoke insert, update on public.cotizaciones from authenticated;
grant  update (estado) on public.cotizaciones to authenticated;

-- Columnas que solo escribe el servidor
revoke update on public.ordenes_compra from authenticated;
grant  update (fecha, proveedor_id, estado, notas) on public.ordenes_compra to authenticated;
revoke update on public.fabricacion from authenticated;
grant  update (venta_id, chasis, gama, estado, fecha_inicio, fecha_fin, notas) on public.fabricacion to authenticated;
revoke update on public.horas from authenticated;
grant  update (fecha, operario_id, horas, notas) on public.horas to authenticated;

grant select on public.v_ventas, public.v_gastos, public.v_fabricacion to authenticated;

-- =====================================================================
--  TIEMPO REAL: los cambios de un socio le aparecen al otro sin recargar
-- =====================================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['params','gamas','addons','proveedores','insumos','leads','interacciones',
                             'cotizaciones','ventas','ordenes_compra','oc_items','gastos','operarios',
                             'fabricacion','horas','bom_referencias']
    loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;

-- =====================================================================
--  DATOS INICIALES DEL CATÁLOGO
--  Reglas de precio del Pacto de Socios · valores de insumos REFERENCIALES
-- =====================================================================
insert into public.params (p_costo, p_hon, p_mkt, p_margen, p_reserva, p_div_socio, nombre_empresa)
values (0.52, 0.09, 0.09, 0.30, 0.50, 0.50, 'Trazo Fino');

insert into public.gamas (nombre, coef, usd_m2_min, usd_m2_max, orden) values
  ('Básico',     1.00,  650,  800, 1),
  ('Premium',    1.48,  850, 1100, 2),
  ('Enterprise', 2.10, 1200, 1600, 3);

insert into public.addons (nombre, costo_s, costo_m) values
  ('Deck exterior',      1450, 2300),
  ('Domótica',           1900, 2600),
  ('Solar off-grid',     2800, 3400),
  ('Aislación especial',  900, 1500);

insert into public.insumos (codigo, categoria, descripcion, unidad, costo, merma, cant_s, cant_m, stock) values
  ('HIE-001','Hierro','Caño estructural 100x100x2 mm','m',9.80,0.07,62,118,0),
  ('HIE-002','Hierro','Caño estructural 80x40x2 mm','m',5.40,0.07,95,180,0),
  ('HIE-003','Hierro','Chapa C25 cincalum trapezoidal','m²',12.50,0.08,74,136,0),
  ('CON-001','Consumibles','Insumos de soldadura y anticorrosivo','global',480,0,1,1.6,0),
  ('AIS-001','Aislación','Lana de vidrio 50 mm c/foil','m²',4.20,0.10,82,150,0),
  ('ABE-001','Aberturas','Ventana aluminio blanco 1,50x1,10','un',210,0,2,4,0),
  ('ABE-002','Aberturas','Puerta exterior inyectada','un',260,0,1,1,0),
  ('TER-001','Terminaciones','Placa de yeso 12,5 mm','m²',5.90,0.12,88,162,0),
  ('TER-002','Terminaciones','Piso vinílico SPC','m²',16,0.08,18,36,0),
  ('TER-003','Terminaciones','Kit sanitarios + grifería estándar','global',720,0,1,1,0),
  ('TER-004','Terminaciones','Instalación eléctrica y sanitaria','global',640,0,1,1.7,0),
  ('MDO-001','Mano de Obra','Jornal herrero (armado estructura)','jornal',55,0,22,38,0),
  ('MDO-002','Mano de Obra','Jornal oficial terminaciones','jornal',48,0,18,32,0);
