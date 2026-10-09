-- =====================================================================
--  TRAZO FINO 2.0 · Migración 05 — Catálogo inicial 2.0
--
--  Carga los 12 códigos de producto. NO carga costos: no hay costos reales
--  aprobados todavía, y el sistema no permite cotizaciones definitivas sin
--  un BOM aprobado. Signature queda inactiva hasta habilitarla a mano,
--  modelo por modelo.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migraciones where version = '2026.10.08-04') then
    raise exception 'Falta aplicar la migración 2026.10.08-04. No se aplica nada.';
  end if;
  if exists (select 1 from public.schema_migraciones where version = '2026.10.08-05') then
    raise exception 'La migración 2026.10.08-05 ya fue aplicada. No se aplica nada.';
  end if;
end $$;

-- Gamas: Signature es nueva; Enterprise queda como gama histórica (no se renombra).
-- El coeficiente de Signature no se usa: el cotizador 1.0 la rechaza y el 2.0
-- calcula con el BOM del producto. El rango USD/m² queda sin definir (0–0).
insert into public.gamas (nombre, coef, usd_m2_min, usd_m2_max, orden, generacion, vigente)
values ('Signature', 1.00, 0, 0, 4, '2.0', true)
on conflict (nombre) do nothing;
update public.gamas set generacion = '1.0 y 2.0' where nombre in ('Básico','Premium') and generacion = '1.0';
update public.gamas set vigente = false where nombre = 'Enterprise';

do $$
begin
  if (select count(*) from public.gamas where nombre in ('Básico','Premium','Signature')) <> 3 then
    raise exception 'Faltan las gamas Básico/Premium en la base: revisar antes de cargar el catálogo. No se aplica nada.';
  end if;
end $$;

-- Los 12 productos
insert into public.productos (codigo, tecnologia, tamano, gama, largo_m, ancho_m, superficie_m2,
                              nombre_comercial, descripcion, condiciones_venta, estado_comercial)
select 'TF-' || t.cod || '-' || d.tam || '-' || g.cod,
       t.tec, d.tam, g.gama, d.largo, 4.00, d.largo * 4,
       t.nombre || ' ' || d.tam || ' ' || g.gama,
       g.descr || ' ' || t.descr || ' Módulo ' || d.tam || ': ' ||
         replace(to_char(d.largo, 'FM90.00'), '.', ',') || ' × 4,00 m = ' || (d.largo * 4)::int || ' m².',
       g.cond, g.estado
  from (values ('WOD','WOOD','Wood','Estructura de madera.'),
               ('IST','IRON_STEEL','Iron Steel','Estructura metálica.')) t(cod, tec, nombre, descr)
 cross join (values ('S', 6.00::numeric), ('M', 12.00::numeric)) d(tam, largo)
 cross join (values ('BAS','Básico',   'Vivienda funcional, accesible y estandarizada.',
                     'Modelo estándar.', 'Activo'),
                    ('PRM','Premium',  'Mejores terminaciones, equipamiento y confort.',
                     'Modelo estándar.', 'Activo'),
                    ('SIG','Signature','Diseño superior, terminaciones de alta gama y personalización controlada.',
                     'Diseño exclusivo · Cotización a pedido. Sujeta a validación técnica y comercial.', 'Inactivo')
            ) g(cod, gama, descr, cond, estado)
on conflict (codigo) do nothing;

-- Matriz de adicionales por tecnología y tamaño: sin costo y no disponibles
-- hasta que se carguen costos reales (no se asume que cuestan lo mismo en Wood y en Iron Steel).
insert into public.addon_costos (addon_id, tecnologia, tamano, costo, disponible)
select a.id, t.tec, d.tam, null, false
  from public.addons a
 cross join (values ('WOOD'), ('IRON_STEEL')) t(tec)
 cross join (values ('S'), ('M')) d(tam)
on conflict (addon_id, tecnologia, tamano) do nothing;

insert into public.schema_migraciones (version, descripcion)
values ('2026.10.08-05', 'Trazo Fino 2.0 · catálogo de 12 productos, gama Signature y matriz de adicionales');

commit;
