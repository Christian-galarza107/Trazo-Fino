-- =====================================================================
--  TRAZO FINO 2.0 · Migración 01 — Estructuras nuevas
--
--  ADITIVA: solo crea tablas nuevas. No modifica ni borra datos existentes.
--  Se ejecuta UNA vez, después de schema.sql (1.0), en una única transacción:
--  si algo falla, no queda nada a medias (ejecutar ROLLBACK si el editor
--  lo pide). Ver supabase/migrations/README.md antes de aplicar.
-- =====================================================================
begin;

-- Registro de migraciones aplicadas (impide ejecutar dos veces la misma).
create table if not exists public.schema_migraciones (
  version      text primary key,
  descripcion  text not null,
  aplicada_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'cotizaciones') then
    raise exception 'Falta el esquema base 1.0 (supabase/schema.sql). No se aplica nada.';
  end if;
  if exists (select 1 from public.schema_migraciones where version = '2026.10.08-01') then
    raise exception 'La migración 2026.10.08-01 ya fue aplicada. No se aplica nada.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tipos de cambio ARS/USD. Se cargan a mano con fuente y fecha: el
-- sistema nunca inventa cotizaciones. Un tipo de cambio cargado no se
-- edita (si hubo un error se carga otro); los importes que lo usaron
-- guardan una copia del valor.
-- ---------------------------------------------------------------------
create table public.tipos_cambio (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default current_date check (fecha <= current_date + 1),
  tipo        text not null check (tipo in ('MEP','Oficial BNA','CCL','Mayorista','Otro')),
  valor       numeric(14,4) not null check (valor > 0 and valor < 1000000),
  fuente      text not null check (char_length(fuente) between 2 and 120),
  created_by  uuid references public.socios(user_id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on column public.tipos_cambio.valor is 'Pesos argentinos por 1 dólar estadounidense';

-- ---------------------------------------------------------------------
-- Catálogo de productos 2.0: Tecnología × Tamaño × Gama = 12 modelos.
-- El código es un identificador estable: no cambia con el nombre comercial.
-- ---------------------------------------------------------------------
create table public.productos (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique check (codigo ~ '^TF-(WOD|IST)-(S|M)-(BAS|PRM|SIG)$'),
  tecnologia         text not null check (tecnologia in ('WOOD','IRON_STEEL')),
  tamano             char(1) not null check (tamano in ('S','M')),
  gama               text not null check (gama in ('Básico','Premium','Signature')),
  largo_m            numeric(6,2) not null check (largo_m > 0),
  ancho_m            numeric(6,2) not null check (ancho_m > 0),
  superficie_m2      numeric(8,2) not null check (superficie_m2 > 0),
  nombre_comercial   text not null check (char_length(nombre_comercial) between 2 and 80),
  descripcion        text check (char_length(descripcion) <= 500),
  condiciones_venta  text check (char_length(condiciones_venta) <= 500),
  estado_comercial   text not null default 'Inactivo' check (estado_comercial in ('Activo','A pedido','Inactivo')),
  aprobacion_tecnica text not null default 'Pendiente' check (aprobacion_tecnica in ('Pendiente','Aprobado','Rechazado')),
  version            int not null default 1 check (version > 0),
  vigencia_desde     date not null default current_date,
  vigencia_hasta     date,
  usd_m2_min         numeric(10,2) check (usd_m2_min is null or usd_m2_min >= 0),
  usd_m2_max         numeric(10,2),
  updated_at         timestamptz not null default now(),
  unique (tecnologia, tamano, gama),
  constraint codigo_coherente check (codigo =
    'TF-' || case tecnologia when 'WOOD' then 'WOD' else 'IST' end || '-' || tamano || '-' ||
    case gama when 'Básico' then 'BAS' when 'Premium' then 'PRM' else 'SIG' end),
  constraint superficie_coherente check (superficie_m2 = round(largo_m * ancho_m, 2)),
  constraint dimension_coherente check ((tamano = 'S' and superficie_m2 = 24) or (tamano = 'M' and superficie_m2 = 48)),
  constraint signature_bajo_pedido check (gama <> 'Signature' or estado_comercial <> 'Activo'),
  constraint rango_producto check (usd_m2_min is null or usd_m2_max is null or usd_m2_max >= usd_m2_min),
  constraint vigencia_coherente check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

-- Costo y compatibilidad de cada adicional por tecnología y tamaño.
-- Un costo vacío significa "sin definir", nunca cero.
create table public.addon_costos (
  id          uuid primary key default gen_random_uuid(),
  addon_id    uuid not null references public.addons(id) on delete cascade,
  tecnologia  text not null check (tecnologia in ('WOOD','IRON_STEEL')),
  tamano      char(1) not null check (tamano in ('S','M')),
  costo       numeric(12,2) check (costo is null or costo between 0 and 1000000),
  disponible  boolean not null default false,
  gamas       text[] not null default '{Básico,Premium,Signature}',
  unique (addon_id, tecnologia, tamano),
  constraint disponible_con_costo check (not disponible or costo is not null),
  constraint gamas_validas check (gamas <@ array['Básico','Premium','Signature']::text[])
);

-- ---------------------------------------------------------------------
-- BOM: lista de materiales por producto, versionada.
-- Solo un BOM Aprobado puede usarse para cotizar. Uno solo vigente por producto.
-- ---------------------------------------------------------------------
create table public.boms (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.productos(id) on delete restrict,
  version      int not null check (version > 0),
  estado       text not null default 'Borrador'
               check (estado in ('Borrador','Pendiente de validación','Aprobado','Obsoleto')),
  vigente      boolean not null default false,
  origen_id    uuid references public.boms(id) on delete set null,
  nota         text check (char_length(nota) <= 500),
  created_by   uuid references public.socios(user_id) on delete set null,
  created_at   timestamptz not null default now(),
  enviado_por  uuid references public.socios(user_id) on delete set null,
  enviado_at   timestamptz,
  aprobado_por uuid references public.socios(user_id) on delete set null,
  aprobado_at  timestamptz,
  unique (producto_id, version),
  constraint vigente_es_aprobado check (not vigente or estado = 'Aprobado')
);
create unique index boms_un_vigente_por_producto on public.boms(producto_id) where vigente;

create table public.bom_items (
  id                     uuid primary key default gen_random_uuid(),
  bom_id                 uuid not null references public.boms(id) on delete cascade,
  insumo_codigo          text not null references public.insumos(codigo) on update cascade on delete restrict,
  cantidad               numeric(14,4) not null check (cantidad > 0 and cantidad <= 1000000),
  merma                  numeric(5,4) not null check (merma between 0 and 0.5),
  pendiente_sustitucion  boolean not null default false,
  nota                   text check (char_length(nota) <= 300),
  unique (bom_id, insumo_codigo)
);
create index bom_items_bom on public.bom_items(bom_id);

-- Sustituciones de materiales (optimizador de costos). Es una herramienta de
-- análisis: aprobar una sustitución no cambia nada; aplicarla es otro paso.
create table public.sustituciones (
  id                   uuid primary key default gen_random_uuid(),
  bom_id               uuid not null references public.boms(id) on delete cascade,
  insumo_original      text not null references public.insumos(codigo) on update cascade on delete restrict,
  insumo_alternativa   text not null references public.insumos(codigo) on update cascade on delete restrict,
  factor_cantidad      numeric(10,4) not null default 1 check (factor_cantidad > 0 and factor_cantidad <= 100),
  estado               text not null default 'Propuesta' check (estado in ('Propuesta','Aprobada','Rechazada','Aplicada')),
  motivo               text not null check (char_length(motivo) between 3 and 500),
  nota_tecnica         text check (char_length(nota_tecnica) <= 500),
  created_by           uuid references public.socios(user_id) on delete set null,
  created_at           timestamptz not null default now(),
  decidido_por         uuid references public.socios(user_id) on delete set null,
  decidido_at          timestamptz,
  aplicada_at          timestamptz,
  constraint materiales_distintos check (insumo_original <> insumo_alternativa)
);

-- ---------------------------------------------------------------------
-- Presupuestos por proyecto: copia versionada del BOM aprobado que se
-- puede ajustar sin tocar el estándar. Cada revisión es una fila nueva.
-- ---------------------------------------------------------------------
create table public.presupuestos (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated always as identity,
  grupo                   uuid not null default gen_random_uuid(),
  revision                int not null default 1 check (revision > 0),
  cliente                 text not null check (char_length(cliente) between 1 and 80),
  lead_id                 uuid references public.leads(id) on delete set null,
  producto_id             uuid not null references public.productos(id) on delete restrict,
  bom_id                  uuid references public.boms(id) on delete restrict,
  bom_version             int,
  estado                  text not null default 'Borrador' check (estado in ('Borrador','Emitido','Reemplazado','Anulado')),
  tc_id                   uuid references public.tipos_cambio(id) on delete restrict,
  tc_tipo                 text,
  tc_valor                numeric(14,4) check (tc_valor is null or tc_valor > 0),
  tc_fecha                date,
  tc_fuente               text,
  addons                  uuid[] not null default '{}',
  descuento               numeric(12,2) not null default 0 check (descuento >= 0 and descuento <= 10000000),
  descuento_motivo        text check (char_length(descuento_motivo) <= 300),
  descuento_autorizado_por uuid references public.socios(user_id) on delete set null,
  nota                    text check (char_length(nota) <= 500),
  idem                    uuid unique,
  created_by              uuid references public.socios(user_id) on delete set null,
  created_at              timestamptz not null default now(),
  emitido_at              timestamptz,
  unique (grupo, revision),
  constraint descuento_justificado check (descuento = 0 or char_length(coalesce(descuento_motivo, '')) >= 5)
);

create table public.presupuesto_items (
  id               uuid primary key default gen_random_uuid(),
  presupuesto_id   uuid not null references public.presupuestos(id) on delete cascade,
  insumo_codigo    text references public.insumos(codigo) on update cascade on delete restrict,
  descripcion      text not null check (char_length(descripcion) between 2 and 120),
  categoria        text not null check (char_length(categoria) between 2 and 40),
  unidad           text not null check (char_length(unidad) between 1 and 20),
  cantidad         numeric(14,4) not null check (cantidad > 0 and cantidad <= 1000000),
  merma            numeric(5,4) not null default 0 check (merma between 0 and 0.5),
  costo_original   numeric(16,4) check (costo_original is null or costo_original >= 0),
  moneda           char(3) not null default 'USD' check (moneda in ('ARS','USD')),
  costo_unit_usd   numeric(16,6) check (costo_unit_usd is null or costo_unit_usd >= 0),
  origen           text not null default 'BOM' check (origen in ('BOM','Solo proyecto','Catálogo','Sustitución')),
  motivo           text check (char_length(motivo) <= 300),
  idem             uuid unique,
  created_by       uuid references public.socios(user_id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint agregado_con_motivo check (origen = 'BOM' or char_length(coalesce(motivo, '')) >= 3),
  constraint solo_proyecto_sin_catalogo check ((origen = 'Solo proyecto') = (insumo_codigo is null))
);
create index presupuesto_items_pres on public.presupuesto_items(presupuesto_id);

-- Historial de precios del catálogo (lo escribe el servidor).
create table public.precios_historial (
  id               bigint generated always as identity primary key,
  fecha            timestamptz not null default now(),
  insumo_codigo    text not null references public.insumos(codigo) on update cascade on delete restrict,
  costo_usd_ant    numeric(14,4),
  costo_usd_nuevo  numeric(14,4),
  original_ant     numeric(16,4),
  original_nuevo   numeric(16,4),
  moneda_ant       char(3),
  moneda_nueva     char(3),
  tc_valor         numeric(14,4),
  usuario          uuid,
  motivo           text
);
create index precios_historial_insumo on public.precios_historial(insumo_codigo, fecha desc);

-- CRM: un lead puede interesarse por varias configuraciones sin pisar las anteriores.
create table public.lead_intereses (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  producto_id  uuid references public.productos(id) on delete restrict,
  tecnologia   text check (tecnologia in ('WOOD','IRON_STEEL')),
  tamano       char(1) check (tamano in ('S','M')),
  gama         text check (gama in ('Básico','Premium','Signature')),
  estado       text not null default 'Abierto' check (estado in ('Abierto','Cotizado','Ganado','Descartado')),
  nota         text check (char_length(nota) <= 300),
  created_by   uuid references public.socios(user_id) on delete set null,
  created_at   timestamptz not null default now()
);
create index lead_intereses_lead on public.lead_intereses(lead_id);

-- ---------------------------------------------------------------------
-- Seguridad inmediata: Supabase da permisos por defecto al rol anónimo
-- sobre las tablas nuevas. Se cierran en esta misma transacción, antes de
-- que existan políticas (sin política, RLS no devuelve ninguna fila).
-- Las políticas para los socios se crean en la migración 04.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['schema_migraciones','tipos_cambio','productos','addon_costos','boms','bom_items',
                           'sustituciones','presupuestos','presupuesto_items','precios_historial','lead_intereses']
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
revoke all on public.schema_migraciones from authenticated;
revoke all on all sequences in schema public from anon;

insert into public.schema_migraciones (version, descripcion)
values ('2026.10.08-01', 'Trazo Fino 2.0 · estructuras nuevas (productos, BOM, presupuestos, tipos de cambio)');

commit;
