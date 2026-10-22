import { S, billInfo, villageName, shopNameOf, sortedVillages, shopsOf, activeItems, ledgers, itemById } from '../store.js';
import { filterBills, sumBills, dateRange, num, round2, round3, stockIndex, stockRowsForDate, parseYmd, addDays, ymd } from '../calc.js';
import { esc, money, qty, fmtDate, fmtTime, fmtDur, download, toCSV, printHTML, toast, $, $$, tsDate, cfg } from '../util.js';
import { galleryView } from './gallery.js';

export const newFilter = (preset = 'today') => ({ preset, from: '', to: '', villageId: '', shopId: '', itemId: '', method: '' });

/** Filter bar: Today / Yesterday / This week / This month / Custom + village / shop / item / payment method */
export function filterBar(el, st, onChange, { show = ['preset', 'village', 'shop', 'item', 'method'] } = {}) {
  const draw = () => {
    const shops = st.villageId ? shopsOf(st.villageId, true) : S.shops.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (st.shopId && !shops.some(s => s.id === st.shopId)) st.shopId = '';
    const opt = (v, t, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`;
    el.innerHTML = `<div class="filters">
      ${show.includes('preset') ? `<label>Period<select data-k="preset">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom range'], ['all', 'All dates']].map(([v, t]) => opt(v, t, st.preset)).join('')}</select></label>` : ''}
      ${st.preset === 'custom' && show.includes('preset') ? `<label>From<input type="date" data-k="from" value="${st.from || ymd(new Date())}"></label><label>To<input type="date" data-k="to" value="${st.to || ymd(new Date())}"></label>` : ''}
      ${show.includes('village') ? `<label>Village<select data-k="villageId">${opt('', 'All villages', st.villageId)}${sortedVillages(true).map(v => opt(v.id, v.name, st.villageId)).join('')}</select></label>` : ''}
      ${show.includes('shop') ? `<label>Shop<select data-k="shopId">${opt('', 'All shops', st.shopId)}${shops.map(s => opt(s.id, s.name, st.shopId)).join('')}</select></label>` : ''}
      ${show.includes('item') ? `<label>Item<select data-k="itemId">${opt('', 'All items', st.itemId)}${S.items.map(i => opt(i.id, i.name, st.itemId)).join('')}</select></label>` : ''}
      ${show.includes('method') ? `<label>Payment<select data-k="method">${[['', 'Any'], ['cash', 'Cash'], ['upi', 'UPI'], ['credit', 'Unpaid / due']].map(([v, t]) => opt(v, t, st.method)).join('')}</select></label>` : ''}
    </div>`;
    el.querySelectorAll('[data-k]').forEach(i => (i.onchange = () => {
      st[i.dataset.k] = i.value;
      if (i.dataset.k === 'villageId') st.shopId = '';
      if (i.dataset.k === 'preset' && i.value === 'custom') { st.from = st.from || ymd(new Date()); st.to = st.to || st.from; }
      if (['preset', 'villageId'].includes(i.dataset.k)) draw(); onChange();
    }));
  };
  draw(); return { redraw: draw };
}

const C = (h, t = 's') => ({ h, t });
const inf = b => billInfo(b);

/** Every report is built as plain data {title, cols, rows, foot} so screen, CSV and print always agree. */
export function buildReport(type, st) {
  const { from, to } = dateRange(st.preset, st);
  const bills = filterBills(S.bills, st).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0)));
  const period = st.preset === 'all' ? 'All dates' : `${fmtDate(from)} – ${fmtDate(to)}`;
  const tot = arr => sumBills(arr, inf);
  const R = { period };
  if (type === 'bills') {
    R.title = 'Daily bill report'; R.cols = [C('Bill No'), C('Shop'), C('Items'), C('Qty', 'q'), C('Present total', 'm'), C('Old due', 'm'), C('Cash', 'm'), C('UPI', 'm'), C('Old due paid', 'm'), C("Today's due", 'm'), C('Balance', 'm')];
    R.rows = [];
    const line = b => { const i = inf(b); return [b.billNo, shopNameOf(b), b.itemNames || '(payment only)', num(b.totalQty), num(b.presentTotal), i.prevDue, num(b.cash), num(b.upi), i.oldPaid, i.todaysDue, i.remaining]; };
    const row = (label, t) => [label, '', '', t.qty, t.present, t.oldDue, t.cash, t.upi, t.oldPaid, t.due, ''];
    for (const v of sortedVillages(true)) {
      const vb = bills.filter(b => b.villageId === v.id); if (!vb.length) continue;
      R.rows.push({ k: 'grp', c: [v.name, ...Array(10).fill('')] });
      vb.forEach(b => R.rows.push({ c: line(b), id: b.id }));
      R.rows.push({ k: 'sub', c: row(`${v.name} total`, tot(vb)) });
    }
    const orphan = bills.filter(b => !S.villages.some(v => v.id === b.villageId));
    if (orphan.length) { R.rows.push({ k: 'grp', c: ['Other', ...Array(10).fill('')] }); orphan.forEach(b => R.rows.push({ c: line(b), id: b.id })); R.rows.push({ k: 'sub', c: row('Other total', tot(orphan)) }); }
    R.foot = row('GRAND TOTAL', tot(bills));
    R.note = 'Old due = previous outstanding balance before each bill. Today\'s due = present total − cash − UPI (old dues never included).';
  } else if (type === 'daily') {
    R.title = 'Daily sales report'; R.cols = [C('Date'), C('Bills', 'n'), C('Qty', 'q'), C('Sales', 'm'), C('Cash (bills)', 'm'), C('UPI (bills)', 'm'), C('Old due paid', 'm'), C("Today's due", 'm')];
    const by = {}; bills.forEach(b => (by[b.date] ||= []).push(b));
    R.rows = Object.keys(by).sort().map(d => { const t = tot(by[d]); return { c: [fmtDate(d), t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due] }; });
    const t = tot(bills); R.foot = ['GRAND TOTAL', t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due];
  } else if (type === 'village') {
    R.title = 'Village-wise sales'; R.cols = [C('Village'), C('Bills', 'n'), C('Qty', 'q'), C('Sales', 'm'), C('Cash', 'm'), C('UPI', 'm'), C('Old due paid', 'm'), C("Today's due", 'm')];
    R.rows = sortedVillages(true).map(v => { const t = tot(bills.filter(b => b.villageId === v.id)); return t.count || t.oldPaid ? { c: [v.name, t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due] } : null; }).filter(Boolean);
    const t = tot(bills); R.foot = ['GRAND TOTAL', t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due];
  } else if (type === 'shop') {
    R.title = 'Shop-wise sales'; R.cols = [C('Village'), C('Shop'), C('Bills', 'n'), C('Qty', 'q'), C('Sales', 'm'), C('Cash', 'm'), C('UPI', 'm'), C('Old due paid', 'm'), C("Today's due", 'm'), C('Balance now', 'm')];
    R.rows = [];
    for (const sh of S.shops) { const sb = bills.filter(b => b.shopId === sh.id); if (!sb.length) continue; const t = tot(sb); R.rows.push({ c: [villageName({ villageId: sh.villageId }), sh.name, t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due, ledgers().get(sh.id)?.balance ?? 0] }); }
    R.rows.sort((a, b) => a.c[0].localeCompare(b.c[0]) || a.c[1].localeCompare(b.c[1], undefined, { numeric: true }));
    const t = tot(bills); R.foot = ['GRAND TOTAL', '', t.count, t.qty, t.present, t.cash, t.upi, t.oldPaid, t.due, R.rows.reduce((s, r) => s + r.c[9], 0)];
  } else if (type === 'item') {
    R.title = 'Item-wise quantity'; R.cols = [C('Item'), C('Bills', 'n'), C('Quantity', 'q'), C('Amount', 'm')];
    const m = {}; bills.forEach(b => (b.items || []).forEach(l => { if (st.itemId && l.itemId !== st.itemId) return; const r = (m[l.itemId] ||= { name: itemById(l.itemId)?.name || l.name, bills: 0, q: 0, a: 0 }); r.bills++; r.q += num(l.qty); r.a += num(l.qty) * num(l.rate); }));
    R.rows = Object.values(m).sort((a, b) => b.q - a.q).map(r => ({ c: [r.name, r.bills, round3(r.q), round2(r.a)] }));
    R.foot = ['GRAND TOTAL', '', round3(R.rows.reduce((s, r) => s + r.c[2], 0)), round2(R.rows.reduce((s, r) => s + r.c[3], 0))];
  } else if (type === 'cash' || type === 'upi') {
    const u = type === 'upi';
    R.title = u ? 'UPI collection' : 'Cash collection';
    R.cols = [C('Date'), C('Bill No'), C('Village'), C('Shop'), C('This bill', 'm'), C('Old due', 'm'), C('Total', 'm'), ...(u ? [C('UPI reference')] : [])];
    R.rows = bills.filter(b => (u ? num(b.upi) + num(b.oldPaidUpi) : num(b.cash) + num(b.oldPaidCash)) > 0).map(b => { const a = u ? num(b.upi) : num(b.cash), o = u ? num(b.oldPaidUpi) : num(b.oldPaidCash); return { c: [fmtDate(b.date), b.billNo, villageName(b), shopNameOf(b), a, o, round2(a + o), ...(u ? [b.upiRef || ''] : [])] }; });
    R.foot = ['GRAND TOTAL', '', '', '', ...[4, 5, 6].map(i => round2(R.rows.reduce((s, r) => s + r.c[i], 0))), ...(u ? [''] : [])];
  } else if (type === 'dues') {
    R.title = 'Outstanding dues (current)'; R.period = `as of ${fmtDate(ymd(new Date()))}`;
    R.cols = [C('Village'), C('Shop'), C('Balance due', 'm'), C('Last bill')]; R.rows = [];
    for (const v of sortedVillages(true)) {
      let sub = 0;
      for (const sh of shopsOf(v.id, true)) {
        if (st.villageId && st.villageId !== v.id) continue; if (st.shopId && st.shopId !== sh.id) continue;
        const L = ledgers().get(sh.id); if (!L || Math.abs(L.balance) < 0.005) continue;
        const last = S.bills.filter(b => b.shopId === sh.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        R.rows.push({ c: [v.name, sh.name, L.balance, last ? fmtDate(last.date) : '—'] }); sub += L.balance;
      }
      if (sub) R.rows.push({ k: 'sub', c: [`${v.name} total`, '', round2(sub), ''] });
    }
    R.foot = ['GRAND TOTAL', '', round2(R.rows.filter(r => !r.k).reduce((s, r) => s + r.c[2], 0)), ''];
    R.note = 'Negative balance = advance paid by the customer.';
  } else if (type === 'olddues') {
    R.title = 'Previous dues collection'; R.cols = [C('Date'), C('Bill No'), C('Village'), C('Shop'), C('Cash', 'm'), C('UPI', 'm'), C('Total paid', 'm'), C('Balance after', 'm')];
    R.rows = bills.filter(b => num(b.oldPaidCash) + num(b.oldPaidUpi) > 0).map(b => ({ c: [fmtDate(b.date), b.billNo, villageName(b), shopNameOf(b), num(b.oldPaidCash), num(b.oldPaidUpi), inf(b).oldPaid, inf(b).remaining] }));
    R.foot = ['GRAND TOTAL', '', '', '', ...[4, 5, 6].map(i => round2(R.rows.reduce((s, r) => s + r.c[i], 0))), ''];
  } else if (type === 'stock') {
    R.title = 'Stock report'; R.cols = [C('Item'), C('Opening', 'q'), C('Loaded', 'q'), C('Sold', 'q'), C('Damaged', 'q'), C('Remaining', 'q')];
    const idx = stockIndex(S.items, S.stock, S.bills);
    const a = stockRowsForDate(S.items, idx, from), z = stockRowsForDate(S.items, idx, to);
    R.rows = S.items.map((it, n) => {
      let l = 0, s = 0, d = 0;
      for (const [dt, r] of idx[it.id] || []) if (dt >= from && dt <= to) { l += r.loaded; s += r.sold; d += r.damaged; }
      return { c: [it.name, a[n].opening, round3(l), round3(s), round3(d), z[n].remaining] };
    });
    R.foot = ['TOTAL', ...[1, 2, 3, 4, 5].map(i => round3(R.rows.reduce((s, r) => s + r.c[i], 0)))];
  } else if (type === 'trips') {
    R.title = 'Trip report'; R.cols = [C('Date'), C('Start'), C('End'), C('Distance km', 'q'), C('Duration'), C('Avg km/h', 'q'), C('Bills', 'n'), C('Sales', 'm'), C('Cash', 'm'), C('UPI', 'm'), C('Dues', 'm')];
    R.rows = S.trips.filter(t => t.date >= from && t.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1)).map(t => { const s = tripStats(t); return { c: [fmtDate(t.date), t.startAt ? fmtTime(new Date(t.startAt)) : '', t.endAt ? fmtTime(new Date(t.endAt)) : 'running', s.km, s.dur, s.avg, s.bills, s.sales, s.cash, s.upi, s.due] }; });
    R.foot = ['TOTAL', '', '', round3(R.rows.reduce((s, r) => s + r.c[3], 0)), '', '', ...[6, 7, 8, 9, 10].map(i => round2(R.rows.reduce((s, r) => s + r.c[i], 0)))];
  }
  return R;
}
export function tripStats(t) {
  const b = S.bills.filter(x => x.tripId === t.id); const tt = sumBills(b, inf);
  const end = t.endAt || Date.now(); const ms = t.startAt ? end - t.startAt : 0; const km = round3(num(t.distanceKm));
  return { km, dur: fmtDur(ms), avg: ms > 60000 ? round2(km / (ms / 3600000)) : 0, bills: tt.count, sales: tt.present, cash: round2(tt.cash + b.reduce((s, x) => s + num(x.oldPaidCash), 0)), upi: round2(tt.upi + b.reduce((s, x) => s + num(x.oldPaidUpi), 0)), due: tt.due };
}
const fmtCell = (v, t) => (t === 'm' ? money(v) : t === 'q' ? qty(v) : t === 'n' ? String(v) : esc(v));
export function renderReport(R, { clickable = false } = {}) {
  if (!R.rows.length) return `<p class="muted center pad">No records for this selection.</p>`;
  const head = `<tr>${R.cols.map(c => `<th class="${c.t !== 's' ? 'r' : ''}">${esc(c.h)}</th>`).join('')}</tr>`;
  const cells = (c, cols) => c.map((v, i) => `<td class="${cols[i].t !== 's' ? 'r' : ''}">${v === '' ? '' : fmtCell(v, cols[i].t)}</td>`).join('');
  const body = R.rows.map(r => {
    if (r.k === 'grp') return `<tr class="grp"><td colspan="${R.cols.length}">${esc(r.c[0])}</td></tr>`;
    return `<tr class="${r.k || ''}" ${r.id && clickable ? `data-bill="${r.id}"` : ''}>${cells(r.c, R.cols)}</tr>`;
  }).join('');
  const foot = R.foot ? `<tr class="grand">${cells(R.foot, R.cols)}</tr>` : '';
  return `<div class="tablewrap"><table class="tbl">${'<thead>' + head + '</thead>'}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>${R.note ? `<p class="muted small">${esc(R.note)}</p>` : ''}`;
}
export function reportCSV(R) {
  const rows = [[R.title, R.period || ''], R.cols.map(c => c.h), ...R.rows.filter(r => r.k !== 'grp').map(r => r.c)]; if (R.foot) rows.push(R.foot); return toCSV(rows);
}
export function printReport(R) {
  printHTML(`<h2>${esc(S.settings.businessName || 'Report')}</h2><h3>${esc(R.title)} <small>${esc(R.period || '')}</small></h3>${renderReport(R)}`);
}

const TYPES = [['bills', 'Daily bill report (village-wise + grand total)'], ['daily', 'Daily sales report'], ['village', 'Village-wise sales'], ['shop', 'Shop-wise sales'], ['item', 'Item-wise quantity'], ['cash', 'Cash collection'], ['upi', 'UPI collection'], ['dues', 'Outstanding dues'], ['olddues', 'Previous dues collection'], ['stock', 'Stock report'], ['trips', 'Trip report']];
export const reportsView = {
  mount(root) {
    this.root = root; this.st = this.st || newFilter('today'); this.type = this.type || 'bills'; this.tab = this.tab || 'reports';
    root.innerHTML = `<div class="seg"><button data-t="reports">Reports</button><button data-t="gallery">Gallery</button></div><div data-body></div>`;
    root.querySelectorAll('.seg button').forEach(b => (b.onclick = () => { this.tab = b.dataset.t; this.mount(root); }));
    root.querySelector(`.seg [data-t="${this.tab}"]`).classList.add('on');
    const body = root.querySelector('[data-body]');
    if (this.tab === 'gallery') return galleryView(body);
    body.innerHTML = `<section class="card"><label>Report<select data-type>${TYPES.map(([v, t]) => `<option value="${v}" ${v === this.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label><div data-f></div>
      <div class="row gap wrap"><button class="btn ghost" data-csv>⬇️ CSV</button><button class="btn ghost" data-print>🖨️ Print / PDF</button></div></section><section class="card" data-out></section>`;
    body.querySelector('[data-type]').onchange = e => { this.type = e.target.value; this.update(); };
    this.fb = filterBar(body.querySelector('[data-f]'), this.st, () => this.update());
    body.querySelector('[data-csv]').onclick = () => { const R = buildReport(this.type, this.st); download(`${this.type}-report-${ymd(new Date())}.csv`, reportCSV(R), 'text/csv'); };
    body.querySelector('[data-print]').onclick = () => printReport(buildReport(this.type, this.st));
    this.update();
  },
  update() {
    if (this.tab === 'gallery') { if (this.root) galleryView(this.root.querySelector('[data-body]')); return; }
    const out = this.root.querySelector('[data-out]'); if (!out) return;
    const R = buildReport(this.type, this.st);
    out.innerHTML = `<h3>${esc(R.title)} <small class="muted">${esc(R.period || '')}</small></h3>${renderReport(R)}`;
  },
};
