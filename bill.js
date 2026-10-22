import { S, villageById, shopById, itemById, sortedVillages, shopsOf, activeItems, activeTrip, ledgers, billInfo, saveBill, saveEntity, newBillId, stockViolation, imagesOf } from '../store.js';
import { ledgerFor, num, round2, lineTotal, presentTotal, totalQty, todaysDue, validateBill, stockIndex, stockRowsForDate, sumBills, dateRange } from '../calc.js';
import { esc, money, qty, fmtDate, todayStr, toast, modal, confirmBox, promptBox, busy, friendly, confirmSave, saveMsg, $ } from '../util.js';
import { picker, uploadAll, thumbs, singlePhoto } from '../images.js';
import { filterBar, newFilter, buildReport, renderReport, reportCSV, printReport } from './reports.js';
import { openInvoice, openLedger } from './invoice.js';
import { download } from '../util.js';

// ================= dashboard cards =================
export function dashCards(el, date) {
  const dayBills = S.bills.filter(b => b.date === date);
  const t = sumBills(dayBills, billInfo);
  const oldCash = dayBills.reduce((s, b) => s + num(b.oldPaidCash), 0), oldUpi = dayBills.reduce((s, b) => s + num(b.oldPaidUpi), 0);
  let prevOut = 0; // total outstanding at the START of the selected day
  for (const sh of S.shops) prevOut += ledgerFor(sh.openingBalance, S.bills.filter(b => b.shopId === sh.id && b.date < date)).balance;
  const rows = stockRowsForDate(S.items, stockIndex(S.items, S.stock, S.bills), date);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const cards = [
    ['Quantity today', qty(t.qty)], ['Sales today', money(t.present)], ['Cash received', money(t.cash + oldCash), oldCash ? `incl. ${money(oldCash)} old dues` : ''],
    ['UPI received', money(t.upi + oldUpi), oldUpi ? `incl. ${money(oldUpi)} old dues` : ''], ["Today's due", money(t.due), 'from today\'s bills'], ['Previous dues', money(prevOut), 'outstanding at start of day'],
    ['Stock loaded', qty(sum('loaded'))], ['Stock sold', qty(sum('sold'))], ['Remaining stock', qty(sum('remaining'))], ['Bills today', String(t.count)],
  ];
  el.innerHTML = cards.map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}</b>${c ? `<small>${esc(c)}</small>` : ''}</div>`).join('');
}

// ================= bill form (new + edit) =================
export function billForm(root, { bill = null, presetShopId = null, onDone = () => {} } = {}) {
  const editing = !!bill; const billId = bill?.id || newBillId();
  const trip = activeTrip();
  root.innerHTML = `<form class="stack" novalidate>
    <div class="grid2">
      <label>Date<input type="date" name="date" value="${bill?.date || todayStr()}" required></label>
      <label>Village<select name="village"></select></label>
      <label>Shop<select name="shop"></select></label>
      <div class="shopbox"><div class="shopthumb" data-sphoto></div><div class="stack small"><button type="button" class="link" data-sdetails>🏪 Shop details &amp; photo</button><button type="button" class="link" data-sledger>📒 View ledger</button></div></div>
    </div>
    <h4>Items</h4><div data-items class="items"></div>
    <button type="button" class="btn ghost" data-add>➕ Add another item</button>
    <div class="totals">
      <div class="trow"><span>Present total</span><b data-total>${money(0)}</b></div>
      <div class="trow muted"><span>Old due (previous outstanding balance)</span><b data-prev>${money(0)}</b></div>
    </div>
    <div class="grid2">
      <label>Cash received (this bill)<input name="cash" type="number" inputmode="decimal" min="0" step="any" value="${bill ? bill.cash || '' : ''}" placeholder="0"></label>
      <label>UPI received (this bill)<input name="upi" type="number" inputmode="decimal" min="0" step="any" value="${bill ? bill.upi || '' : ''}" placeholder="0"></label>
      <label class="span2">UPI transaction reference<input name="upiRef" value="${esc(bill?.upiRef || '')}" placeholder="UTR / transaction ID" maxlength="60"></label>
    </div>
    <div class="trow em"><span>Today's due = Present total − Cash − UPI</span><b data-due>${money(0)}</b></div>
    <fieldset class="oldpay"><legend>Old due paid today (separate from today's sales)</legend>
      <div class="grid2"><label>Paid in cash<input name="oldPaidCash" type="number" inputmode="decimal" min="0" step="any" value="${bill ? bill.oldPaidCash || '' : ''}" placeholder="0"></label>
      <label>Paid by UPI<input name="oldPaidUpi" type="number" inputmode="decimal" min="0" step="any" value="${bill ? bill.oldPaidUpi || '' : ''}" placeholder="0"></label></div></fieldset>
    <div class="trow grand"><span>Remaining customer balance</span><b data-rem>${money(0)}</b></div>
    <p class="err small" data-err hidden></p>
    <label>Notes (optional)<textarea name="notes" rows="2" maxlength="500">${esc(bill?.notes || '')}</textarea></label>
    <div><h4>Photos &amp; documents (optional)</h4><p class="muted small">Handwritten bill, receipt, UPI screenshot, delivery photo…</p>
      ${editing ? '<div class="previews" data-existing></div>' : ''}<div data-pick></div></div>
    <p class="muted small">${bill ? (bill.tripId ? 'Linked to a trip.' : '') : trip ? '🚚 This bill will be linked to the running trip.' : ''}</p>
    <button class="btn big" data-save>${editing ? 'Review &amp; save changes' : 'Review &amp; save bill'}</button>
  </form>`;
  const f = root.querySelector('form'), q = s => root.querySelector(s), val = n => f.elements[n].value;
  const pk = picker(q('[data-pick]'), { labels: ['Handwritten bill', 'Receipt', 'UPI screenshot', 'Delivery photo', 'Other'] });
  if (editing) thumbs(q('[data-existing]'), 'bill', billId);
  let selVillage = bill?.villageId || shopById(presetShopId)?.villageId || sortedVillages()[0]?.id || '';
  let selShop = bill?.shopId || presetShopId || '';

  // ---- dropdowns ----
  function fillVillages() {
    const vs = sortedVillages(); if (bill && !vs.some(v => v.id === bill.villageId) && villageById(bill.villageId)) vs.push(villageById(bill.villageId));
    f.elements.village.innerHTML = vs.map(v => `<option value="${v.id}" ${v.id === selVillage ? 'selected' : ''}>${esc(v.name)}</option>`).join('') || '<option value="">(add a village in Setup)</option>';
    if (!vs.some(v => v.id === selVillage)) selVillage = vs[0]?.id || '';
    f.elements.village.value = selVillage; fillShops();
  }
  function fillShops() {
    const ss = shopsOf(selVillage); if (bill && bill.villageId === selVillage && !ss.some(s => s.id === bill.shopId) && shopById(bill.shopId)) ss.push(shopById(bill.shopId));
    f.elements.shop.innerHTML = `<option value="">— select shop —</option>${ss.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}<option value="__new__">＋ New shop…</option>`;
    if (!ss.some(s => s.id === selShop)) selShop = ss.length === 1 && !editing ? ss[0].id : '';
    f.elements.shop.value = selShop; recalc();
  }
  f.elements.village.onchange = () => { selVillage = val('village'); selShop = ''; fillShops(); };
  f.elements.shop.onchange = async () => {
    if (val('shop') === '__new__') {
      const r = await promptBox('New shop', [{ name: 'name', label: 'Shop name', required: true }, { name: 'ob', label: 'Existing balance due (optional)', type: 'number', value: '' }], 'Create shop');
      if (!r || !r.name.trim()) { f.elements.shop.value = selShop; return; }
      try { const id = await saveEntity('shops', null, { name: r.name.trim(), villageId: selVillage, openingBalance: Math.max(0, num(r.ob)), active: true }); selShop = id; toast('Shop created ✓'); } catch (e) { toast(friendly(e), 'err'); selShop = ''; }
      fillShops();
    } else { selShop = val('shop'); recalc(); }
  };
  q('[data-sdetails]').onclick = () => selShop ? shopDetails(selShop) : toast('Select a shop first', 'warn');
  q('[data-sledger]').onclick = () => selShop ? openLedger(selShop) : toast('Select a shop first', 'warn');

  // ---- item rows ----
  const itemsEl = q('[data-items]');
  function itemOptions(sel) {
    const list = activeItems(); if (sel && !list.some(i => i.id === sel) && itemById(sel)) list.push(itemById(sel));
    return `<option value="">— item —</option>${list.map(i => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}`;
  }
  function addRow(it = {}) {
    const d = document.createElement('div'); d.className = 'irow';
    d.innerHTML = `<img class="ithumb" alt="" hidden><select class="isel" aria-label="Item">${itemOptions(it.itemId)}</select><input class="iqty" type="number" inputmode="decimal" min="0" step="any" placeholder="Qty" aria-label="Quantity" value="${it.qty ?? ''}"><input class="irate" type="number" inputmode="decimal" min="0" step="any" placeholder="Rate" aria-label="Rate" value="${it.rate ?? ''}"><output class="itot">${money(0)}</output><button type="button" class="ghost rm" aria-label="Remove item">✕</button>`;
    const sel = d.querySelector('.isel'), rate = d.querySelector('.irate'), img = d.querySelector('.ithumb');
    const pic = () => { const i = itemById(sel.value); if (i?.imageUrl) { img.src = i.imageUrl; img.hidden = false; } else img.hidden = true; };
    sel.onchange = () => { const i = itemById(sel.value); if (i && (!rate.value || rate.dataset.auto === '1')) { rate.value = i.price || ''; rate.dataset.auto = '1'; } pic(); recalc(); };
    rate.addEventListener('input', () => (rate.dataset.auto = '0'));
    d.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
    d.querySelector('.rm').onclick = () => { d.remove(); recalc(); };
    itemsEl.appendChild(d); pic(); return d;
  }
  const readItems = () => [...itemsEl.querySelectorAll('.irow')].map(r => { const id = r.querySelector('.isel').value; return { itemId: id, name: itemById(id)?.name || '', qty: num(r.querySelector('.iqty').value), rate: num(r.querySelector('.irate').value), _row: r }; });
  q('[data-add]').onclick = () => addRow();
  if (editing) bill.items.forEach(addRow);
  else { const di = itemById(S.settings.defaultItemId) || activeItems()[0]; const r = addRow({ itemId: di?.id, rate: di?.price || '' }); if (di) r.querySelector('.irate').dataset.auto = '1'; }
  if (!editing && presetShopId) itemsEl.innerHTML = '';

  // ---- calculation (display only; the saved numbers are recomputed in store.saveBill and enforced by security rules) ----
  function prevDue() {
    if (!selShop) return 0; const sh = shopById(selShop); if (!sh) return 0; const date = val('date');
    const before = S.bills.filter(b => b.shopId === selShop && (!bill || b.id !== bill.id) && (b.date < date || (b.date === date && (!bill || (b.seq || 0) < (bill.seq || 0)))));
    return ledgerFor(sh.openingBalance, before).balance;
  }
  let prev = 0;
  function recalc() {
    const items = readItems(); items.forEach(i => (i._row.querySelector('.itot').textContent = money(lineTotal(i))));
    const total = presentTotal(items), cash = num(val('cash')), upi = num(val('upi')), oc = num(val('oldPaidCash')), ou = num(val('oldPaidUpi'));
    prev = prevDue();
    q('[data-total]').textContent = money(total); q('[data-prev]').textContent = money(prev);
    q('[data-due]').textContent = money(todaysDue(total, cash, upi)); q('[data-rem]').textContent = money(round2(prev + total - cash - upi - oc - ou));
    const errs = validateBill(collect(), prev).filter(e => !/Select a shop|Add at least|choose an item/.test(e)); const el = q('[data-err]');
    el.hidden = !errs.length; el.textContent = errs[0] || '';
  }
  function collect() {
    const sh = shopById(selShop), items = readItems().map(({ _row, ...r }) => r);
    return { date: val('date'), villageId: selVillage, shopId: selShop, villageName: villageById(selVillage)?.name || '', shopName: sh?.name || '', items, cash: num(val('cash')), upi: num(val('upi')), upiRef: val('upiRef'), oldPaidCash: num(val('oldPaidCash')), oldPaidUpi: num(val('oldPaidUpi')), notes: val('notes'), prevDue: prev, tripId: bill ? bill.tripId || null : trip?.id || null };
  }
  f.addEventListener('input', recalc); f.addEventListener('change', recalc);

  // ---- save with confirmation ----
  f.onsubmit = async e => {
    e.preventDefault(); recalc(); const d = collect();
    d.items = d.items.filter(i => i.itemId || i.qty || i.rate);
    const errs = validateBill(d, prev); if (errs.length) return toast(errs[0], 'err', 6000);
    const sv = stockViolation({ ...d, id: billId }, bill?.id);
    if (sv) return toast(`Not enough stock: ${sv.item.name} would be ${sv.remaining} on ${fmtDate(sv.date)}. Load stock in the Stock tab, or allow selling beyond stock in Setup.`, 'err', 9000);
    const total = presentTotal(d.items), oldPaid = round2(d.oldPaidCash + d.oldPaidUpi);
    const summary = `<div class="confirm"><p><b>${esc(d.villageName)} › ${esc(d.shopName)}</b> · ${fmtDate(d.date)}</p>
      <table class="tbl">${d.items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${qty(i.qty)} × ${money(i.rate)}</td><td class="r">${money(lineTotal(i))}</td></tr>`).join('')}</table>
      <table class="tbl sum"><tr><td>Present total</td><td class="r">${money(total)}</td></tr><tr><td>Cash / UPI received</td><td class="r">${money(d.cash)} / ${money(d.upi)}</td></tr><tr class="em"><td>Today's due</td><td class="r">${money(todaysDue(total, d.cash, d.upi))}</td></tr>
      <tr><td>Previous outstanding</td><td class="r">${money(prev)}</td></tr><tr><td>Old due paid today</td><td class="r">${money(oldPaid)}</td></tr><tr class="grand"><td>Remaining customer balance</td><td class="r">${money(round2(prev + total - d.cash - d.upi - oldPaid))}</td></tr></table></div>`;
    if (!await confirmBox(summary, { title: editing ? 'Save changes to this bill?' : 'Save this bill?', okText: 'Confirm & save', html: true })) return;
    await busy(q('[data-save]'), async () => {
      const r = await confirmSave(saveBill(billId, d, { editing, expectedVersion: bill?.version || 1, oldShopId: bill?.shopId }));
      const files = pk.getFiles(); let up = 0;
      if (files.length) { toast('Uploading photos…', 'ok', 2500); up = await uploadAll(files, { kind: 'bill', refId: billId }); }
      const [m, t] = saveMsg(r); toast(m + (up ? ` ${up} photo(s) uploaded.` : ''), t, 5000);
      pk.clear(); onDone(billId);
      if (!editing) { f.elements.cash.value = f.elements.upi.value = f.elements.upiRef.value = f.elements.oldPaidCash.value = f.elements.oldPaidUpi.value = f.elements.notes.value = ''; itemsEl.innerHTML = ''; const di = itemById(S.settings.defaultItemId) || activeItems()[0]; addRow({ itemId: di?.id, rate: di?.price || '' }); f.elements.shop.value = selShop; recalc(); }
    });
  };
  fillVillages(); updatePhoto();
  function updatePhoto() { const sh = shopById(selShop); q('[data-sphoto]').innerHTML = sh?.imageUrl ? `<img src="${esc(sh.imageUrl)}" alt="Shop photo">` : '<span class="ph">🏪</span>'; }
  f.elements.shop.addEventListener('change', updatePhoto);
  return { refresh() { // cloud data changed: keep what the user typed, refresh options and balances only
    fillVillages(); updatePhoto();
    itemsEl.querySelectorAll('.isel').forEach(s => { const v = s.value; s.innerHTML = itemOptions(v); s.value = v; }); recalc(); } };
}

export function shopDetails(shopId) {
  const sh = shopById(shopId); if (!sh) return;
  const L = ledgers().get(shopId);
  const m = modal(`<div class="stack"><div class="center">${sh.imageUrl ? `<img class="bigimg" src="${esc(sh.imageUrl)}" alt="">` : '<div class="ph big">🏪<br><small class="muted">No photo yet (placeholder)</small></div>'}</div>
    <p><b>${esc(villageById(sh.villageId)?.name || '')} › ${esc(sh.name)}</b></p><p>Balance due: <b>${money(L?.balance || 0)}</b></p>
    <div class="row gap wrap"><button class="btn" data-photo>📷 ${sh.imageUrl ? 'Replace photo' : 'Add photo'}</button><button class="btn ghost" data-ledger>📒 Ledger</button></div></div>`, { title: 'Shop details' });
  m.el.querySelector('[data-photo]').onclick = () => { m.close(); singlePhoto({ kind: 'shop', refId: shopId, title: sh.name, current: S.images.find(i => i.id === sh.imageId), onChange: up => saveEntity('shops', shopId, { name: sh.name, imageId: up?.id || null, imageUrl: up?.url || null }) }); };
  m.el.querySelector('[data-ledger]').onclick = () => { m.close(); openLedger(shopId); };
}

export function openBillEditor(bill, { presetShopId } = {}) {
  const m = modal('<div data-f></div>', { title: bill ? `Edit bill ${bill.billNo}` : 'New bill / payment', wide: true });
  billForm(m.el.querySelector('[data-f]'), { bill, presetShopId, onDone: () => m.close() });
}

// ================= Bill tab =================
export const billView = {
  mount(root) {
    this.root = root; this.date = this.date || todayStr(); this.st = this.st || newFilter('today');
    root.innerHTML = `<section class="card"><div class="row between wrap"><h3>Summary</h3><label class="inline">Date <input type="date" data-date value="${this.date}"></label></div><div class="stats" data-stats></div></section>
      <section class="card"><h3>New bill</h3><div data-form></div></section>
      <section class="card"><div class="row between wrap"><h3>Daily bill report</h3><div class="row gap"><button class="btn ghost" data-csv>⬇️ CSV</button><button class="btn ghost" data-print>🖨️</button></div></div><div data-f></div><div data-rep></div></section>`;
    root.querySelector('[data-date]').onchange = e => { this.date = e.target.value; this.update(true); };
    this.form = billForm(root.querySelector('[data-form]'), {});
    filterBar(root.querySelector('[data-f]'), this.st, () => this.update(true));
    root.querySelector('[data-csv]').onclick = () => download('daily-bills.csv', reportCSV(buildReport('bills', this.st)), 'text/csv');
    root.querySelector('[data-print]').onclick = () => printReport(buildReport('bills', this.st));
    root.querySelector('[data-rep]').onclick = e => { const tr = e.target.closest('[data-bill]'); if (tr) { const b = S.bills.find(x => x.id === tr.dataset.bill); b && openInvoice(b, { onEdit: x => openBillEditor(x) }); } };
    this.update(true);
  },
  update(all) {
    if (!this.root) return; dashCards(this.root.querySelector('[data-stats]'), this.date);
    this.root.querySelector('[data-rep]').innerHTML = renderReport(buildReport('bills', this.st), { clickable: true });
    this.form && this.form.refresh();
  },
};
