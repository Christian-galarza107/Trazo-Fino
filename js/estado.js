// Estado de la aplicación en memoria (los datos reales viven en Supabase).
import { html } from './html.js';

export const S = {
  datos: null,          // resultado de cargarTodo()
  perfil: null,         // { user_id, nombre, rol, email }
  vista: 'panel',
  leadAbierto: null,
  ocAbierta: null,
  fabAbierta: null,
  auditoria: null,
  Q: { chasis: 'S', gama: 'Premium', addons: [], cliente: '', lead: '' }
};

// Ganchos que completa app.js (evita dependencias circulares).
export const bus = {
  render: () => {},
  refrescar: async () => {},
  ir: () => {}
};

export const nombreSocio = rol => {
  const s = (S.datos?.socios || []).find(x => x.rol === rol);
  return s ? s.nombre : (rol === 'A' ? 'Socio A' : 'Socio B');
};
export const nombreUsuario = uid => {
  const s = (S.datos?.socios || []).find(x => x.user_id === uid);
  return s ? s.nombre : '—';
};

export function head(titulo, sub, acciones) {
  return html`<div class="head"><div><h2>${titulo}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
    <div class="actions">${acciones || ''}</div></div>`;
}
export const vacio = (t, s) => html`<div class="empty"><b>${t}</b>${s}</div>`;
export const pill = (txt, cls = 'p-neutral') => html`<span class="pill ${cls}">${txt}</span>`;
export const kpi = (l, v, d, cls = '') =>
  html`<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d || ''}</div></div>`;
export const barra = (pctAncho, cls = '') => html`<div class="track"><div class="fill ${cls}" data-w="${pctAncho.toFixed(1)}"></div></div>`;
