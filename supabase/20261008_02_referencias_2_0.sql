-- =====================================================================
--  TRAZO FINO 2.0 · Migración 02 — Ampliación de tablas existentes
--
--  ADITIVA: agrega columnas opcionales. No convierte ni recalcula datos
--  históricos: las cotizaciones, ventas y órdenes 1.0 (chasis 18/36 m²,
--  gama Enterprise) quedan marcadas como generación '1.0' y conservan
--  sus valores originales.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migraciones where version = '2026.10.08-01') then
    raise exception 'Falta aplicar la migración 2026.10.08-01. No se aplica nada.';
  end if;
  if exists (select 1 from public.schema_migraciones where version = '2026.10.08-02') then
    raise exception 'La migración 2026.10.08-02 ya fue aplicada. No se aplica nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Gamas: se marca a qué generación de catálogo pertenece cada una.
-- Enterprise NO se renombra: renombrarla cambiaría en cascada las
-- cotizaciones y ventas históricas. Signature se agrega como gama nueva (seed).
-- ---------------------------------------------------------------------
alter table public.gamas
  add column generacion text not null default '1.0' check (generacion in ('1.0','2.0','1.0 y 2.0')),
  add column vigente boolean not null default true;

-- ---------------------------------------------------------------------
-- Insumos = catálogo maestro de materiales (se reutiliza, no se duplica).
-- costo sigue siendo el costo unitario en USD que usan los cálculos.
-- Se agrega el precio en moneda original, el tipo de cambio y la trazabilidad.
-- ---------------------------------------------------------------------
alter table public.insumos
  add column costo_original    numeric(16,4) check (costo_original is null or costo_original between 0 and 1000000000),
  add column moneda            char(3) not null default 'USD' check (moneda in ('ARS','USD')),
  add column tc_id             uuid references public.tipos_cambio(id) on delete restrict,
  add column tc_valor          numeric(14,4),
  add column costo_ars         numeric(16,2),
  add column fecha_cotizacion  date,
  add column activo            boolean not null default true,
  add column observaciones     text check (char_length(observaciones) <= 500),
  add column updated_at        timestamptz,
  add column updated_by        uuid references public.socios(user_id) on delete set null;

-- Los precios existentes estaban en USD: se copian como precio original.
update public.insumos set costo_original = costo where costo_original is null;

-- Un material puede quedar "sin precio confirmado" (costo vacío, nunca cero).
alter table public.insumos alter column costo drop not null;

-- Categorías y unidades: se amplía la lista (superconjunto de la anterior).
alter table public.insumos drop constraint insumos_categoria_check;
alter table public.insumos add constraint insumos_categoria_check check (categoria in
  ('Hierro','Aislación','Aberturas','Terminaciones','Revestimientos','Consumibles','Mano de Obra',
   'Madera','Estructura','Instalación eléctrica','Instalación sanitaria','Equipamiento',
   'Herrajes y fijaciones','Pinturas y selladores','Otros'));
alter table public.insumos drop constraint insumos_unidad_check;
alter table public.insumos add constraint insumos_unidad_check check (unidad in
  ('m','m²','m³','kg','un','lt','gl','jornal','hora','global','pie²','rollo','caja','par','kit','bolsa'));

-- ---------------------------------------------------------------------
-- CRM: interés principal del lead (los intereses adicionales van en lead_intereses).
-- ---------------------------------------------------------------------
alter table public.leads
  add column tecnologia_interes   text check (tecnologia_interes in ('WOOD','IRON_STEEL')),
  add column tamano_interes       char(1) check (tamano_interes in ('S','M')),
  add column presupuesto_cliente  numeric(14,2) check (presupuesto_cliente is null or presupuesto_cliente between 0 and 100000000),
  add column plazo_estimado       text check (plazo_estimado in
    ('Inmediato','1 a 3 meses','3 a 6 meses','6 a 12 meses','Más de 12 meses','Sin definir'));

-- ---------------------------------------------------------------------
-- Cotizaciones: instantánea completa para las 2.0. Las existentes quedan '1.0'.
-- (Agregar una columna con DEFAULT completa las filas existentes sin
--  ejecutar triggers ni tocar ningún otro dato.)
-- ---------------------------------------------------------------------
alter table public.cotizaciones
  add column generacion        text not null default '1.0' check (generacion in ('1.0','2.0')),
  add column producto_id       uuid references public.productos(id) on delete restrict,
  add column producto_codigo   text,
  add column tecnologia        text check (tecnologia in ('WOOD','IRON_STEEL')),
  add column superficie_m2     numeric(8,2),
  add column bom_id            uuid references public.boms(id) on delete restrict,
  add column bom_version       int,
  add column presupuesto_id    uuid references public.presupuestos(id) on delete restrict,
  add column costo_materiales  numeric(14,2),
  add column costo_mdo         numeric(14,2),
  add column costo_addons      numeric(14,2),
  add column honorarios        numeric(14,2),
  add column marketing         numeric(14,2),
  add column ganancia          numeric(14,2),
  add column reserva           numeric(14,2),
  add column div_a             numeric(14,2),
  add column div_b             numeric(14,2),
  add column pvp_m2            numeric(12,2),
  add column descuento         numeric(12,2),
  add column pvp_final         numeric(14,2),
  add column moneda            char(3) not null default 'USD' check (moneda in ('USD')),
  add column tc_tipo           text,
  add column tc_valor          numeric(14,4),
  add column tc_fecha          date,
  add column params_snapshot   jsonb,
  add column items_snapshot    jsonb,
  add column vigencia_dias     int check (vigencia_dias is null or vigencia_dias between 1 and 180),
  add column valida_hasta      date,
  add column aprobacion        text check (aprobacion in ('Aprobada','Pendiente de validación','Rechazada')),
  add column validado_por      uuid references public.socios(user_id) on delete set null,
  add column validado_at       timestamptz,
  add column validacion_nota   text check (char_length(validacion_nota) <= 300),
  add column idem              uuid unique;

-- ---------------------------------------------------------------------
-- Ventas y fabricación: referencia al producto 2.0 (opcional).
-- ---------------------------------------------------------------------
alter table public.ventas
  add column generacion        text default '1.0' check (generacion in ('1.0','2.0')),
  add column producto_id       uuid references public.productos(id) on delete restrict,
  add column producto_codigo   text,
  add column tecnologia        text check (tecnologia in ('WOOD','IRON_STEEL')),
  add column superficie_m2     numeric(8,2),
  add column bom_id            uuid references public.boms(id) on delete restrict,
  add column bom_version       int,
  add column cd_presupuestado  numeric(14,2) check (cd_presupuestado is null or cd_presupuestado >= 0);
alter table public.ventas alter column generacion drop default;   -- las nuevas las marca el servidor

alter table public.fabricacion
  add column generacion      text default '1.0' check (generacion in ('1.0','2.0')),
  add column producto_id     uuid references public.productos(id) on delete restrict,
  add column bom_id          uuid references public.boms(id) on delete restrict,
  add column bom_version     int,
  add column costo_mat_pres  numeric(14,2),
  add column costo_mdo_pres  numeric(14,2);
alter table public.fabricacion alter column generacion drop default;

insert into public.schema_migraciones (version, descripcion)
values ('2026.10.08-02', 'Trazo Fino 2.0 · columnas nuevas en gamas, insumos, leads, cotizaciones, ventas y fabricación');

commit;
