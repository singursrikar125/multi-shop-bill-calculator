import { S, billInfo, villageName, shopNameOf, deleteBill } from '../store.js';
import { filterBills, billStatus, num } from '../calc.js';
import { esc, money, qty, fmtDate, fmtTime, confirmBox, toast, friendly, busy, confirmSave, saveMsg } from '../util.js';
import { filterBar, newFilter } from './reports.js';
import { openInvoice, openLedger, openPayments } from './invoice.js';
import { openBillEditor } from './bill.js';
import { removeStoragePaths } from '../images.js';

export async function askDelete(b) {
  if (!await confirmBox(`Delete bill ${b.billNo} (${shopNameOf(b)}, ${fmtDate(b.date)}, ${money(b.presentTotal)})? Stock, daily totals and the customer balance will be recalculated. Its photos are deleted too. This cannot be undone.`, { title: 'Delete bill', danger: true, okText: 'Delete bill' })) return;
  const imgs = S.images.filter(i => i.kind === 'bill' && i.refId === b.id);
  try {
    const r = await confirmSave(deleteBill(b)); const [m, t] = saveMsg(r);
    toast(r === 'saved' ? 'Bill deleted ✓ – totals recalculated' : m, t);
    removeStoragePaths(imgs);
  } catch (e) { toast(friendly(e), 'err', 7000); }
}
const BADGE = { paid: ['Paid', 'ok'], partial: ['Partly paid', 'warn'], unpaid: ['Unpaid', 'err'], payment: ['Payment', 'info'] };
let page = 1;
export const ordersView = {
  mount(root) {
    this.root = root; this.st = this.st || newFilter('all'); this.q = this.q || ''; this.status = this.status || '';
    root.innerHTML = `<section class="card"><div class="row between wrap"><h3>Orders</h3><button class="btn" data-new>＋ New bill</button></div>
      <input type="search" data-q placeholder="Search bill no, village, shop, item, date (dd/mm/yyyy)…" value="${esc(this.q)}">
      <div class="seg small" data-status>${[['', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Partly paid'], ['paid', 'Fully paid'], ['payment', 'Payments only']].map(([v, t]) => `<button data-v="${v}" class="${v === this.status ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div data-f></div></section><div data-list></div>`;
    root.querySelector('[data-new]').onclick = () => openBillEditor(null);
    root.querySelector('[data-q]').oninput = e => { this.q = e.target.value; page = 1; this.update(); };
    root.querySelectorAll('[data-status] button').forEach(b => (b.onclick = () => { this.status = b.dataset.v; page = 1; root.querySelectorAll('[data-status] button').forEach(x => x.classList.toggle('on', x === b)); this.update(); }));
    filterBar(root.querySelector('[data-f]'), this.st, () => { page = 1; this.update(); }, { show: ['preset', 'village', 'shop', 'item', 'method'] });
    this.update();
  },
  update() {
    const list = this.root.querySelector('[data-list]'); if (!list) return;
    const needle = this.q.trim().toLowerCase();
    let bills = filterBills(S.bills, this.st).filter(b => !this.status || billStatus(b) === this.status);
    if (needle) bills = bills.filter(b => [b.billNo, villageName(b), shopNameOf(b), b.itemNames, b.date, fmtDate(b.date), b.upiRef, b.notes].join(' ').toLowerCase().includes(needle));
    bills.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 0) - (a.seq || 0)));
    const shown = bills.slice(0, page * 30);
    list.innerHTML = (shown.length ? shown.map(b => { const i = billInfo(b), [bt, bc] = BADGE[billStatus(b)];
      return `<article class="card bill" data-id="${b.id}"><div class="row between"><b>${esc(b.billNo)}</b><span class="badge ${bc}">${bt}</span></div>
      <div class="muted small">${fmtDate(b.date)} ${fmtTime(b.createdAt)} · ${esc(villageName(b))} › ${esc(shopNameOf(b))}</div><div class="small">${esc(b.itemNames || 'Old-due payment only')}${b.totalQty ? ` · Qty ${qty(b.totalQty)}` : ''}</div>
      <div class="kv"><span>Total</span><b>${money(b.presentTotal)}</b><span>Cash / UPI</span><b>${money(b.cash)} / ${money(b.upi)}</b><span>Today's due</span><b>${money(i.todaysDue)}</b><span>Old due paid</span><b>${money(i.oldPaid)}</b><span>Balance</span><b>${money(i.remaining)}</b></div>
      <div class="row gap wrap"><button class="btn ghost sm" data-a="view">View</button><button class="btn ghost sm" data-a="edit">Edit</button><button class="btn ghost sm" data-a="pay">Payments</button><button class="btn ghost sm" data-a="ledger">Ledger</button><button class="btn danger sm" data-a="del">Delete</button></div></article>`; }).join('')
      : '<p class="muted center pad">No bills match.</p>') + (bills.length > shown.length ? `<button class="btn ghost full" data-more>Show more (${bills.length - shown.length})</button>` : '') + `<p class="muted small center">${bills.length} bill(s)</p>`;
    list.onclick = e => {
      const more = e.target.closest('[data-more]'); if (more) { page++; return this.update(); }
      const a = e.target.closest('[data-a]'); if (!a) return; const b = S.bills.find(x => x.id === a.closest('.bill').dataset.id); if (!b) return;
      ({ view: () => openInvoice(b, { onEdit: openBillEditor, onDelete: askDelete }), edit: () => openBillEditor(b), pay: () => openPayments(b.shopId), ledger: () => openLedger(b.shopId, { onReceive: id => openBillEditor(null, { presetShopId: id }) }), del: () => askDelete(b) })[a.dataset.a]();
    };
  },
};
