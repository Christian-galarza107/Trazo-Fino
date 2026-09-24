// =====================================================================
//  Plantillas HTML con escape automático (protección contra XSS)
//
//  html`<td>${lead.nombre}</td>` escapa lead.nombre SIEMPRE.
//  Para insertar HTML ya construido se anida otro html`...`, nunca un
//  string suelto: un string suelto se escapa. Así, olvidarse de escapar
//  es imposible por construcción.
// =====================================================================

class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };
export const esc = v => String(v ?? '').replace(/[&<>"'`=]/g, c => MAP[c]);

function renderValor(v) {
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(renderValor).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings, ...valores) {
  let out = strings[0];
  for (let i = 0; i < valores.length; i++) out += renderValor(valores[i]) + strings[i + 1];
  return new SafeHTML(out);
}

export const isSafe = v => v instanceof SafeHTML;

/** Único punto donde se escribe innerHTML: solo acepta SafeHTML. */
export function montar(el, contenido) {
  if (!(contenido instanceof SafeHTML)) throw new TypeError('montar() solo acepta html`...`');
  el.innerHTML = contenido.s;
  // Anchos de barras: se aplican por CSSOM (la política CSP bloquea style="" en línea).
  el.querySelectorAll('[data-w]').forEach(b => {
    const w = Math.max(0, Math.min(100, Number(b.dataset.w) || 0));
    b.style.width = w + '%';
  });
}

// ---------- formato ----------
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pf = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const n0 = v => nf0.format(Number(v) || 0);
export const n2 = v => nf2.format(Number(v) || 0);
export const usd = v => 'USD ' + n0(v);
export const usd2 = v => 'USD ' + n2(v);
export const pct = v => pf.format(Number(v) || 0);
export const fecha = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
export const fechaHora = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};
export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
