# 01 · Visión general del proyecto — Trazo Fino

Generado el 08/10/2026 mediante el "Prompt maestro de auditoría y continuidad". Solo documenta; no se modificó código.

## Leyenda de evidencia (se usa en todos los documentos)

| Etiqueta | Significado |
|---|---|
| **[CÓDIGO]** | Verificado leyendo/ejecutando verificaciones estáticas sobre los archivos del repositorio en esta auditoría. |
| **[CONVERSACIÓN]** | Dicho por el usuario o mostrado en capturas/salidas durante las sesiones de trabajo. No re-verificado contra los sistemas reales. |
| **[INFERIDO]** | Deducción razonable, sin evidencia directa. |
| **[NO VERIFICADO]** | Afirmación existente (en docs o conversación) que no se pudo comprobar. |

## Fuentes disponibles y limitaciones de esta auditoría

- **No hay repositorio Git local** ni historial de commits disponible. No hay `CLAUDE.md`. [CÓDIGO]
- El directorio de trabajo original se perdió (reinicio del entorno). La base de análisis es `TrazoFino_ERP.zip` (paquete del que el usuario subió los archivos a GitHub). [CÓDIGO]
- El ZIP **no es idéntico** a lo publicado: en GitHub el usuario editó `js/config.js` desde la web (URL y clave reales de Supabase). El ZIP conserva los marcadores de posición. [CÓDIGO + CONVERSACIÓN]
- El ZIP **no contiene** dos cosas creadas después: la sección "Si un socio olvida la contraseña" del README (procedimiento SQL de emergencia) y `docs/CONTEXTO.md`. Existen solo como `Trazo-Fino-Contexto.md/.docx/.pdf` en la carpeta de salidas. [CÓDIGO]
- **No se pudo consultar** el repositorio de GitHub ni el sitio publicado (la herramienta de lectura web rechazó la consulta), ni el panel de Supabase. Todo lo que se afirma de esos sistemas proviene de capturas y mensajes del usuario. [NO VERIFICADO contra los sistemas]
- Transcripción disponible: solo la sesión inicial (hasta 23/09/2026 19:11) en `/mnt/transcripts/`. Las sesiones posteriores (despliegue, depuración del login, cambio de socio, visualizador 3D, pausa de Supabase) se reconstruyen desde el contexto de la conversación actual.
- **No se instalaron dependencias ni se re-ejecutaron los tests** en esta auditoría (la FASE 10 lo prohíbe). El último resultado conocido (59/59) es del 24–25/09/2026. [CONVERSACIÓN]

## Qué es

Sistema de gestión web privado para la **línea de módulos habitacionales en seco** de la empresa **Trazo Fino** (antes llamada "Custom Frame"), usado únicamente por dos socios. Integra: CRM, cotizador y cómputo de materiales (MRP), stock y compras (SCM), taller/mano de obra (HRM) y finanzas con gobernanza societaria (FRM). [CONVERSACIÓN + CÓDIGO]

- **Producto:** módulos sobre chasis de hierro propio, 3,00 m de ancho. Chasis **S = 18 m²**, Chasis **M = 36 m²**. Gamas: Básico, Premium, Enterprise. [CÓDIGO: `engine.js`, seed de `schema.sql`]
- **Usuarios:** dos socios con login. **Socio A** = Sebastian Gonzalez (arquitectura/taller, honorarios 9 %). **Socio B** = Christian Galarza (negocios/digital, marketing 9 %). [CONVERSACIÓN]
- **Problema que resuelve:** reemplazar planillas Excel/Word por un sistema compartido y seguro que calcule precios con la regla societaria, controle costos reales vs presupuestados, reparta ganancias y obligue la aprobación dual de gastos extraordinarios.
- **Plataforma:** sitio estático en GitHub Pages + Supabase (PostgreSQL, Auth, Realtime). [CÓDIGO]
- **Contexto de empresa:** Trazo Fino sería la constructora existente (casas tradicionales). El usuario busca sumar esta línea de módulos en seco como socio. Es [INFERIDO] que el "amigo" dueño original es Sebastian. **Pregunta abierta, sin responder:** si el sistema debe abarcar también la construcción tradicional (hoy solo cubre módulos). [CONVERSACIÓN]

## Reglas de negocio vigentes (deben respetarse)

| Regla | Valor | Evidencia |
|---|---|---|
| Fórmula de precio | **PVP = Costo Directo Total ÷ p_costo** (división, nunca recargo) | `engine.js: cotizar()`, `schema.sql: calcular_cotizacion()` [CÓDIGO] |
| Composición del PVP (suma 100 %, forzado por `CHECK suma_100`) | Costo 52 % · Honorarios 9 % · Marketing 9 % · Ganancia 30 % | seed `params` [CÓDIGO] |
| Reparto de la ganancia | 50 % Fondo de Reserva (no distribuible); 50 % masa, dividida 50/50 entre A y B | `params.p_reserva`, `p_div_socio` [CÓDIGO] |
| Coeficientes de gama | Básico 1,00 · Premium 1,48 · Enterprise 2,10 | seed `gamas` [CÓDIGO] |
| Rangos comerciales USD/m² | Básico 650–800 · Premium 850–1.100 · Enterprise 1.200–1.600 | seed `gamas` [CÓDIGO] |
| Gasto extraordinario | > USD 500 exige firma de ambos socios; sin firmas ni urgencia justificada se **imputa** a los dividendos de quien lo ejecutó | trigger `tg_gastos`, vista `v_gastos` [CÓDIGO] |
| Cláusula "Paredes Afuera" | Toda cotización impresa excluye fundaciones, flete, grúa/izaje, acometidas, permisos/planos | `imprimirCotizacion()` en `views-comercial.js` [CÓDIGO] |
| Alerta de variación | Costo directo varía > 10 % contra la última referencia registrada → avisar y recalibrar precios | `engine.js: variacionBom`, `UMBRAL_VARIACION_BOM` [CÓDIGO] |
| Rango sano de costo/m² | USD 250–550 (aviso visual) | `engine.js: RANGO_COSTO_M2` [CÓDIGO] |

**Discrepancia resuelta por decisión del usuario:** un "Master Prompt" posterior pedía 54 % / 28 %; el usuario pidió explícitamente **mantener 52 % / 30 %**. [CONVERSACIÓN]

**Valores de referencia verificados** (los tests los usan): costo base S = 8.063,43; M = 13.800,96; PVP Premium S = 22.949,75; venta de 26.500 con costo real 13.980 → ganancia 7.750, desvío +200. [CÓDIGO: `tests/engine.test.mjs`, `tests/schema.test.mjs`]
Hallazgo comunicado al usuario: Chasis S Básico queda en ~862 USD/m², **fuera** del rango 650–800 con los insumos de referencia. [CONVERSACIÓN]

## Requisitos

**Funcionales:** ver `03_FEATURE_INVENTORY.md`.

**No funcionales (pedidos explícitos del usuario, 9 reglas de seguridad):** sin claves/contraseñas expuestas; formularios protegidos contra spam/ataques; validación en servidor; anti-inyección; sin XSS; contraseñas encriptadas; sesiones/cookies seguras; HTTPS/SSL; dependencias actualizadas y seguras. Cómo se cumple cada una: `SECURITY.md` del repo y `04_DECISIONS.md`. [CONVERSACIÓN + CÓDIGO]

## Cómo funciona, desde el usuario final

1. Entra a la URL de GitHub Pages e inicia sesión con email y contraseña (sin registro público).
2. Ve un **Panel** con alertas (stock bajo, firmas pendientes, seguimientos vencidos, variación del 10 %), KPIs y reparto de ganancias.
3. Gestiona **leads** con historial y próximos seguimientos; **cotiza** (vista previa instantánea; el servidor recalcula el precio al guardar), imprime la cotización con la cláusula "Paredes Afuera" y la **convierte en venta**.
4. Mantiene el **cómputo** de insumos (costo × cantidad × (1+merma)), el **stock** y las **órdenes de compra** (recibirlas suma stock, irreversible).
5. Abre **órdenes de fabricación**, carga horas de operarios (costo/hora congelado) y descuenta materiales; el costo real alimenta la venta y recalcula dividendos.
6. Registra **gastos** y los firma cada socio con su propio login; consulta la **auditoría** y **exporta** CSV/JSON.
7. Los cambios de un socio aparecen al otro en vivo (Realtime). La sesión se cierra a los 30 min de inactividad.

## Estado general (resumen)

Sistema completo y desplegado; login confirmado funcionando por el usuario el 25/09/2026. El 08/10/2026 el proyecto Supabase (plan Free) se pausó por inactividad; el usuario lo reanudó pero **no está confirmado que el login haya vuelto a funcionar**. Detalle en `05_CURRENT_STATE.md` y `10_SESSION_HANDOFF.md`.
