// =====================================================================
//  Interfaz común: formularios modales, confirmación y avisos
//  La validación de acá es solo comodidad: la regla real vive en la base.
// =====================================================================
import { html, montar } from './html.js';
import { mensajeError } from './db.js';

const $ = s => document.querySelector(s);
let alGuardar = null;
let campos = [];

export function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'on ' + tipo;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 3200);
}

function control(f, v) {
  const id = 'f_' + f.k;
  const comunes = { id, name: f.k };
  if (f.t === 'select') {
    return html`<select id="${comunes.id}" name="${comunes.name}" ${f.req ? html`required` : ''}>
      ${f.opts.map(o => {
        const [val, txt] = Array.isArray(o) ? o : [o, o];
        return html`<option value="${val}" ${String(val) === String(v ?? '') ? html`selected` : ''}>${txt}</option>`;
      })}</select>`;
  }
  if (f.t === 'textarea') {
    return html`<textarea id="${comunes.id}" name="${comunes.name}" rows="3" maxlength="${f.max || 1000}">${v ?? ''}</textarea>`;
  }
  if (f.t === 'checkbox') {
    return html`<label class="chk"><input type="checkbox" id="${comunes.id}" name="${comunes.name}" ${v ? html`checked` : ''}> ${f.texto || ''}</label>`;
  }
  const tipo = f.t || 'text';
  return html`<input id="${comunes.id}" name="${comunes.name}" type="${tipo}" value="${v ?? ''}"
    ${f.req ? html`required` : ''}
    ${tipo === 'number' ? html`inputmode="decimal" step="${f.step || 'any'}"` : ''}
    ${f.min !== undefined ? html`min="${f.min}"` : ''}
    ${f.maxN !== undefined ? html`max="${f.maxN}"` : ''}
    ${tipo === 'text' || tipo === 'email' || tipo === 'tel' ? html`maxlength="${f.max || 120}"` : ''}
    ${f.pattern ? html`pattern="${f.pattern}"` : ''}
    ${f.ph ? html`placeholder="${f.ph}"` : ''}
    autocomplete="off">`;
}

/**
 * Abre un formulario. onSave(valores) puede ser async; si lanza un error,
 * el formulario queda abierto mostrando el mensaje.
 */
export function formulario(titulo, especificacion, valores, onSave, textoBoton = 'Guardar') {
  campos = especificacion;
  alGuardar = onSave;
  montar($('#modal'), html`
    <form id="modalForm" novalidate>
      <h3>${titulo}</h3>
      <div class="mbody grid2">
        ${especificacion.map(f => html`
          <div class="${f.ancho ? 'span2' : ''}">
            <label class="f" for="f_${f.k}"><span>${f.l}${f.req ? ' *' : ''}</span>${control(f, valores[f.k])}</label>
            ${f.ayuda ? html`<p class="hint">${f.ayuda}</p>` : ''}
          </div>`)}
      </div>
      <p class="merror" id="modalError" role="alert"></p>
      <div class="mfoot">
        <button type="button" class="btn" data-action="modal-cerrar">Cancelar</button>
        <button type="submit" class="btn primary" id="modalOk">${textoBoton}</button>
      </div>
    </form>`);
  $('#veil').classList.add('on');
  const primero = $('#modal input, #modal select, #modal textarea');
  if (primero) primero.focus();
}

function leerValores() {
  const out = {};
  for (const f of campos) {
    const el = document.getElementById('f_' + f.k);
    if (!el) continue;
    let v;
    if (f.t === 'checkbox') v = el.checked;
    else if (f.t === 'number') v = el.value.trim() === '' ? null : Number(el.value);
    else v = el.value.trim();
    if (f.t !== 'checkbox' && f.t !== 'number' && v === '' && !f.req) v = null;
    if (f.pct && v !== null) v = Math.round(v * 100) / 10000;
    out[f.k] = v;
  }
  return out;
}

function validar(v) {
  for (const f of campos) {
    const val = v[f.k];
    if (f.req && (val === null || val === '' || val === undefined || (f.t === 'number' && Number.isNaN(val)))) return `Completá "${f.l}".`;
    if (f.t === 'number' && val !== null) {
      if (Number.isNaN(val)) return `"${f.l}" debe ser un número.`;
      const bruto = f.pct ? val * 100 : val;
      if (f.min !== undefined && bruto < f.min) return `"${f.l}" no puede ser menor que ${f.min}.`;
      if (f.maxN !== undefined && bruto > f.maxN) return `"${f.l}" no puede ser mayor que ${f.maxN}.`;
    }
    if (typeof val === 'string' && f.pattern && val && !new RegExp('^(?:' + f.pattern + ')$').test(val)) return f.errorPatron || `"${f.l}" tiene un formato inválido.`;
    if (typeof val === 'string' && val.length > (f.max || 1000)) return `"${f.l}" es demasiado largo.`;
  }
  return null;
}

export async function enviarFormulario(e) {
  e.preventDefault();
  const btn = $('#modalOk');
  if (btn.disabled) return;                       // evita doble envío
  const valores = leerValores();
  const err = validar(valores);
  if (err) { $('#modalError').textContent = err; return; }
  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    await alGuardar(valores);
    cerrarModal();
  } catch (ex) {
    $('#modalError').textContent = mensajeError(ex);
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

export function cerrarModal() {
  $('#veil').classList.remove('on');
  $('#modal').replaceChildren();
  alGuardar = null;
}

export function confirmar(mensaje, onSi, textoBoton = 'Sí, continuar') {
  campos = [];
  alGuardar = onSi;
  montar($('#modal'), html`
    <form id="modalForm">
      <h3>Confirmar</h3>
      <div class="mbody"><p>${mensaje}</p></div>
      <p class="merror" id="modalError" role="alert"></p>
      <div class="mfoot">
        <button type="button" class="btn" data-action="modal-cerrar">Cancelar</button>
        <button type="submit" class="btn primary" id="modalOk">${textoBoton}</button>
      </div>
    </form>`);
  $('#veil').classList.add('on');
}
