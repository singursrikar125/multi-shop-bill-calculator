import { num, round2, ymd, parseYmd } from './calc.js';
export { ymd, parseYmd };
export const cfg = { currency: 'INR', dateFormat: 'DD/MM/YYYY' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf = {};
export function money(n) {
  const c = cfg.currency;
  nf[c] ||= new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return nf[c].format(round2(n));
}
const qf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const qty = n => qf.format(num(n));
export const todayStr = () => ymd(new Date());
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return cfg.dateFormat === 'YYYY-MM-DD' ? s : cfg.dateFormat === 'MM/DD/YYYY' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}
export const tsDate = ts => (ts && ts.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null);
export const fmtTime = ts => { const d = tsDate(ts); return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''; };
export const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

export function toast(msg, type = 'ok', ms = 3800) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = `toast ${type}`; t.setAttribute('role', type === 'err' ? 'alert' : 'status'); t.textContent = msg;
  box.appendChild(t); setTimeout(() => t.remove(), ms);
}
export function modal(html, { title = '', wide = false, onClose } = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="sheet-h"><h3>${esc(title)}</h3><button class="x" aria-label="Close">✕</button></div><div class="sheet-b"></div></div>`;
  const body = $('.sheet-b', ov);
  if (typeof html === 'string') body.innerHTML = html; else body.appendChild(html);
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = e => { if (e.key === 'Escape' && ov === [...document.querySelectorAll('.overlay')].pop()) close(); };
  $('.x', ov).onclick = close; document.addEventListener('keydown', key);
  document.body.appendChild(ov);
  return { el: ov, body, close };
}
export function confirmBox(message, { title = 'Please confirm', okText = 'Confirm', danger = false, html = false } = {}) {
  return new Promise(res => {
    const m = modal(`<div class="msg">${html ? message : esc(message)}</div><div class="row end gap"><button class="btn ghost" data-c>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(okText)}</button></div>`, { title, onClose: () => res(false) });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-ok]', m.el).onclick = () => { m.el.remove(); res(true); };
  });
}
export function promptBox(title, fields, okText = 'Save') { // fields: [{name,label,type,value,placeholder,options}]
  return new Promise(res => {
    const f = fields.map(x => x.type === 'select'
      ? `<label>${esc(x.label)}<select name="${x.name}">${x.options.map(o => `<option value="${esc(o.v)}" ${o.v === x.value ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`
      : `<label>${esc(x.label)}<input name="${x.name}" type="${x.type || 'text'}" value="${esc(x.value ?? '')}" placeholder="${esc(x.placeholder || '')}" ${x.type === 'number' ? 'inputmode="decimal" step="any"' : ''} ${x.required ? 'required' : ''}></label>`).join('');
    const m = modal(`<form class="stack">${f}<div class="row end gap"><button type="button" class="btn ghost" data-c>Cancel</button><button class="btn">${esc(okText)}</button></div></form>`, { title, onClose: () => res(null) });
    $('[data-c]', m.el).onclick = () => m.close();
    $('form', m.el).onsubmit = e => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); m.el.remove(); res(o); };
    const first = $('input,select', m.el); first && first.focus();
  });
}
export async function busy(btn, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Please wait…';
  try { return await fn(); } catch (e) { console.error(e); toast(friendly(e), 'err', 7000); } finally { btn.disabled = false; btn.innerHTML = old; }
}
export function friendly(e) {
  const c = e?.code || '';
  const map = {
    'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with this email.',
    'auth/email-already-in-use': 'An account with this email already exists. Try logging in.', 'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'That email address is not valid.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.', 'auth/network-request-failed': 'No internet connection.',
    'auth/unauthorized-domain': 'This website address is not authorised in Firebase (Authentication → Settings → Authorised domains).',
    'auth/requires-recent-login': 'For security, sign out, sign in again, then retry.',
    'permission-denied': 'Permission denied by database security rules (are you signed in? are the rules deployed?).',
    'unavailable': 'Cannot reach the server. Check your internet connection.',
  };
  return map[c] || map[c.replace('firestore/', '')] || e?.message || 'Something went wrong.';
}
/** Never report success until the server confirms. If not confirmed within `ms`, say so honestly. */
export function confirmSave(p, ms = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve('pending'); } }, ms);
    p.then(() => { clearTimeout(t); if (settled) toast('Pending change is now confirmed in the cloud ✓'); else { settled = true; resolve('saved'); } },
      e => { clearTimeout(t); if (settled) toast('A pending change failed: ' + friendly(e), 'err', 9000); else { settled = true; reject(e); } });
  });
}
export const saveMsg = r => (r === 'saved' ? ['Saved to the cloud ✓', 'ok'] : ['Not confirmed by the server yet — kept on this device and will sync automatically when online.', 'warn']);

export function download(name, text, mime = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const toCSV = rows => '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
export function loadScript(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
export function loadCSS(href) { if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); } }
export const clone = o => JSON.parse(JSON.stringify(o));
export const groupBy = (arr, key) => arr.reduce((m, x) => { (m[x[key]] ||= []).push(x); return m; }, {});

// Print a chunk of HTML (invoice/ledger/report) using the browser print dialog.
export function printHTML(html) {
  const root = $('#printRoot'); root.innerHTML = html;
  const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); window.print();
}
// Render an element to a (multi-page) PDF. html2canvas draws with the browser's fonts, so Telugu text works.
export async function elementToPDF(el, filename, { asBlob = false } = {}) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
  const { jsPDF } = window.jspdf; const pdf = new jsPDF('p', 'mm', 'a4');
  const pw = 210, ph = 297, m = 8, w = pw - 2 * m;
  const pxPerMm = canvas.width / w, sliceH = Math.floor((ph - 2 * m) * pxPerMm);
  for (let y = 0, p = 0; y < canvas.height; y += sliceH, p++) {
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = Math.min(sliceH, canvas.height - y);
    c.getContext('2d').drawImage(canvas, 0, y, canvas.width, c.height, 0, 0, canvas.width, c.height);
    if (p) pdf.addPage(); pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', m, m, w, c.height / pxPerMm);
  }
  return asBlob ? pdf.output('blob') : pdf.save(filename);
}
