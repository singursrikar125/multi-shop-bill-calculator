import { S, saveStockRows, activeItems } from '../store.js';
import { stockIndex, stockRowsForDate, num, round3 } from '../calc.js';
import { esc, qty, fmtDate, todayStr, toast, busy, confirmSave, saveMsg, friendly, $ } from '../util.js';
import { itemEditor } from './setup.js';

export const stockView = {
  mount(root) {
    this.root = root; this.date = this.date || todayStr();
    root.innerHTML = `<section class="card"><div class="row between wrap"><h3>Daily stock</h3><label class="inline">Stock date <input type="date" data-date value="${this.date}"></label></div>
      <p class="muted small">Remaining = Opening + Loaded − Sold − Damaged. <b>Sold</b> comes automatically from saved bills, so editing or deleting a bill can never double-count. Opening carries forward from the previous days.</p>
      <div data-table></div><div class="row gap wrap"><button class="btn" data-save>💾 Save stock</button><button class="btn ghost" data-add>➕ Add item</button></div></section>
      <section class="card"><h3>Previous stock records</h3><div data-hist></div></section>`;
    root.querySelector('[data-date]').onchange = e => { this.date = e.target.value; this.draw(); };
    root.querySelector('[data-add]').onclick = () => itemEditor(null);
    root.querySelector('[data-save]').onclick = e => busy(e.target, async () => {
      const rows = [...root.querySelectorAll('tr[data-item]')].map(r => ({ itemId: r.dataset.item, loaded: num(r.querySelector('.ld').value), damaged: num(r.querySelector('.dm').value) }));
      if (rows.some(r => r.loaded < 0 || r.damaged < 0)) throw new Error('Quantities cannot be negative.');
      const r = await confirmSave(saveStockRows(this.date, rows)); const [m, t] = saveMsg(r); toast(m, t, 5000);
    });
    this.draw();
  },
  draw() {
    const items = S.items.filter(i => i.active !== false);
    const idx = stockIndex(S.items, S.stock, S.bills), rows = stockRowsForDate(items, idx, this.date);
    const el = this.root.querySelector('[data-table]');
    el.innerHTML = rows.length ? `<div class="tablewrap"><table class="tbl stk"><thead><tr><th>Item</th><th class="r">Opening</th><th class="r">Loaded</th><th class="r">Sold</th><th class="r">Damaged</th><th class="r">Remaining</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-item="${r.item.id}"><td>${esc(r.item.name)}</td><td class="r">${qty(r.opening)}</td><td class="r"><input class="ld" type="number" inputmode="decimal" min="0" step="any" value="${r.loaded || ''}" placeholder="0"></td><td class="r">${qty(r.sold)}</td><td class="r"><input class="dm" type="number" inputmode="decimal" min="0" step="any" value="${r.damaged || ''}" placeholder="0"></td><td class="r rem ${r.remaining < 0 ? 'neg' : ''}"><b>${qty(r.remaining)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr class="grand"><td>Total</td>${['opening', 'loaded', 'sold', 'damaged', 'remaining'].map(k => `<td class="r">${qty(rows.reduce((s, r) => s + r[k], 0))}</td>`).join('')}</tr></tfoot></table></div>` : '<p class="muted">Add an item first.</p>';
    // live preview of remaining while typing
    el.querySelectorAll('tr[data-item]').forEach((tr, n) => { const r = rows[n]; const upd = () => { const rem = round3(r.opening + num(tr.querySelector('.ld').value) - r.sold - num(tr.querySelector('.dm').value)); const c = tr.querySelector('.rem'); c.innerHTML = `<b>${qty(rem)}</b>`; c.classList.toggle('neg', rem < 0); }; tr.querySelectorAll('input').forEach(i => i.addEventListener('input', upd)); });
    // history
    const dates = [...new Set([...S.stock.map(s => s.date), ...S.bills.map(b => b.date)])].sort().reverse().slice(0, 60);
    this.root.querySelector('[data-hist]').innerHTML = dates.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Date</th><th>Item</th><th class="r">Opening</th><th class="r">Loaded</th><th class="r">Sold</th><th class="r">Damaged</th><th class="r">Remaining</th></tr></thead><tbody>${dates.flatMap(d => stockRowsForDate(items, idx, d).filter(r => r.loaded || r.sold || r.damaged).map(r => `<tr data-d="${d}"><td>${fmtDate(d)}</td><td>${esc(r.item.name)}</td><td class="r">${qty(r.opening)}</td><td class="r">${qty(r.loaded)}</td><td class="r">${qty(r.sold)}</td><td class="r">${qty(r.damaged)}</td><td class="r"><b>${qty(r.remaining)}</b></td></tr>`)).join('')}</tbody></table></div>` : '<p class="muted">No records yet.</p>';
    this.root.querySelector('[data-hist]').onclick = e => { const tr = e.target.closest('[data-d]'); if (tr) { this.date = tr.dataset.d; this.root.querySelector('[data-date]').value = this.date; this.draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
  },
  update() { if (!this.root) return; if (this.root.contains(document.activeElement) && document.activeElement.matches('input')) return; this.draw(); },
};
