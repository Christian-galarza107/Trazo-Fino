-- =====================================================================
--  TRAZO FINO 2.0 · Migración 04 — Seguridad, tiempo real y auditoría
--
--  Mismo criterio que el esquema 1.0: solo los socios (es_socio()) leen o
--  escriben; el rol anónimo no tiene ningún permiso; lo que calcula el
--  servidor no se puede escribir desde el navegador (permisos por columna).
--  Habilitar RLS no alcanza: acá se definen las políticas explícitas.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migraciones where version = '2026.10.08-03') then
    raise exception 'Falta aplicar la migración 2026.10.08-03. No se aplica nada.';
  end if;
  if exists (select 1 from public.schema_migraciones where version = '2026.10.08-04') then
    raise exception 'La migración 2026.10.08-04 ya fue aplicada. No se aplica nada.';
  end if;
end $$;

-- Defensa en profundidad: anónimo sin nada (también lo recién creado).
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
-- Tablas de trabajo: cualquier socio lee y escribe (las reglas las imponen triggers).
do $$
declare t text;
begin
  foreach t in array array['addon_costos','bom_items','lead_intereses']
  loop
    execute format('create policy socios_todo on public.%I for all to authenticated
                    using (public.es_socio()) with check (public.es_socio())', t);
  end loop;
end $$;

-- Tipos de cambio: se leen, se cargan y se borran si nadie los usa (FK). No se editan.
create policy socios_leen    on public.tipos_cambio for select to authenticated using (public.es_socio());
create policy socios_cargan  on public.tipos_cambio for insert to authenticated with check (public.es_socio());
create policy socios_borran  on public.tipos_cambio for delete to authenticated using (public.es_socio());
revoke update on public.tipos_cambio from authenticated;

-- Productos: el catálogo de 12 códigos lo crea la migración. Se editan solo
-- los datos comerciales (los identificadores los protege un trigger).
create policy socios_leen      on public.productos for select to authenticated using (public.es_socio());
create policy socios_actualizan on public.productos for update to authenticated using (public.es_socio()) with check (public.es_socio());
revoke insert, update, delete on public.productos from authenticated;
grant update (nombre_comercial, descripcion, condiciones_venta, estado_comercial, aprobacion_tecnica,
              vigencia_desde, vigencia_hasta, usd_m2_min, usd_m2_max) on public.productos to authenticated;

-- BOM: se crean y cambian de estado solo por funciones; desde la web se edita la nota
-- y se borra un borrador (el trigger impide borrar otros estados).
create policy socios_leen      on public.boms for select to authenticated using (public.es_socio());
create policy socios_actualizan on public.boms for update to authenticated using (public.es_socio()) with check (public.es_socio());
create policy socios_borran    on public.boms for delete to authenticated using (public.es_socio());
revoke insert, update on public.boms from authenticated;
grant update (nota) on public.boms to authenticated;

-- Sustituciones: se proponen desde la web; se deciden y aplican por funciones.
create policy socios_leen      on public.sustituciones for select to authenticated using (public.es_socio());
create policy socios_proponen  on public.sustituciones for insert to authenticated with check (public.es_socio());
create policy socios_actualizan on public.sustituciones for update to authenticated using (public.es_socio()) with check (public.es_socio());
create policy socios_borran    on public.sustituciones for delete to authenticated using (public.es_socio());
revoke insert, update on public.sustituciones from authenticated;
grant insert (bom_id, insumo_original, insumo_alternativa, factor_cantidad, motivo, nota_tecnica) on public.sustituciones to authenticated;
grant update (insumo_alternativa, factor_cantidad, motivo, nota_tecnica) on public.sustituciones to authenticated;

-- Presupuestos: se crean, emiten, revisan y anulan por funciones.
create policy socios_leen      on public.presupuestos for select to authenticated using (public.es_socio());
create policy socios_actualizan on public.presupuestos for update to authenticated using (public.es_socio()) with check (public.es_socio());
create policy socios_borran    on public.presupuestos for delete to authenticated using (public.es_socio());
revoke insert, update on public.presupuestos from authenticated;
grant update (cliente, lead_id, addons, descuento, descuento_motivo, nota) on public.presupuestos to authenticated;

create policy socios_leen      on public.presupuesto_items for select to authenticated using (public.es_socio());
create policy socios_actualizan on public.presupuesto_items for update to authenticated using (public.es_socio()) with check (public.es_socio());
create policy socios_borran    on public.presupuesto_items for delete to authenticated using (public.es_socio());
revoke insert, update on public.presupuesto_items from authenticated;
grant update (cantidad, merma, costo_original, moneda, motivo) on public.presupuesto_items to authenticated;

-- Historial de precios: solo lectura (lo escribe un trigger).
create policy socios_leen on public.precios_historial for select to authenticated using (public.es_socio());
revoke insert, update, delete on public.precios_historial from authenticated;

-- schema_migraciones: sin acceso desde la web (RLS sin políticas + sin permisos).
revoke all on public.schema_migraciones from authenticated;

-- ---------------------------------------------------------------------
-- Columnas que calcula el servidor en tablas existentes
-- ---------------------------------------------------------------------
-- Ventas: el costo presupuestado, el BOM y los datos del producto los fija el
-- servidor; desde la web se siguen editando los mismos campos que en 1.0.
revoke insert, update on public.ventas from authenticated;
grant insert (fecha, cliente, chasis, gama, pvp, costo_real, estado_cobro, fecha_cobro, cotizacion_id, producto_id)
  on public.ventas to authenticated;
grant update (fecha, cliente, chasis, gama, pvp, costo_real, estado_cobro, fecha_cobro, cotizacion_id, producto_id)
  on public.ventas to authenticated;

-- Insumos: costo en USD/ARS, tipo de cambio aplicado y trazabilidad los deriva el trigger,
-- que los recalcula siempre; no hace falta restringir columnas.

-- ---------------------------------------------------------------------
-- Funciones públicas 2.0 (solo socios autenticados; todas verifican es_socio())
-- ---------------------------------------------------------------------
grant execute on function
  public.es_socio(), public.mi_rol(),
  public.calcular_cotizacion(text, text, uuid[]),
  public.crear_cotizacion(text, text, text, uuid[], uuid),
  public.convertir_cotizacion(uuid),
  public.descontar_materiales(uuid),
  public.registrar_referencia_bom(text),
  public.costo_bom(uuid),
  public.costo_presupuesto(uuid),
  public.finanzas_desde_costo(numeric),
  public.costo_addons_v2(uuid, uuid[]),
  public.calcular_cotizacion_v2(text, uuid[], uuid, uuid),
  public.crear_cotizacion_v2(text, text, uuid[], uuid, uuid, int, uuid),
  public.validar_cotizacion(uuid, boolean, text),
  public.bom_crear(text, text),
  public.bom_duplicar(uuid, text, text),
  public.bom_cambiar_estado(uuid, text),
  public.bom_importar(uuid, jsonb, uuid),
  public.actualizar_precio_material(text, numeric, text, uuid, text),
  public.sustitucion_decidir(uuid, boolean, text),
  public.sustitucion_aplicar(uuid, uuid),
  public.presupuesto_crear(text, text, uuid, uuid, uuid[], text, uuid),
  public.presupuesto_agregar_material(uuid, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid, boolean, uuid),
  public.presupuesto_nueva_revision(uuid),
  public.presupuesto_cambiar_tc(uuid, uuid),
  public.presupuesto_actualizar_precios(uuid),
  public.presupuesto_anular(uuid),
  public.descontar_materiales_v2(uuid)
  to authenticated;

grant select on public.v_ventas, public.v_gastos, public.v_fabricacion to authenticated;

-- ---------------------------------------------------------------------
-- Auditoría: tablas nuevas y tablas 1.0 que no se auditaban (roadmap P2-2)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tipos_cambio','productos','addon_costos','boms','bom_items','sustituciones',
                           'presupuestos','presupuesto_items','lead_intereses','leads','oc_items','horas']
  loop
    execute format('create trigger t_auditoria after insert or update or delete on public.%I
                    for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;

-- Autoría fijada por el servidor
create trigger t_autor before insert on public.tipos_cambio   for each row execute function public.tg_set_autor();
create trigger t_autor before insert on public.lead_intereses for each row execute function public.tg_set_autor();

-- ---------------------------------------------------------------------
-- Tiempo real: los cambios de un socio le aparecen al otro
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tipos_cambio','productos','addon_costos','boms','bom_items','sustituciones',
                             'presupuestos','presupuesto_items','precios_historial','lead_intereses']
    loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

insert into public.schema_migraciones (version, descripcion)
values ('2026.10.08-04', 'Trazo Fino 2.0 · políticas RLS, permisos, auditoría y tiempo real');

commit;
