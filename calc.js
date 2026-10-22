// Pure accounting / stock / filter logic. No DOM, no Firebase -> unit-testable in Node.
export const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : Number(v); return Number.isFinite(n) ? n : 0; };
export const round2 = n => Math.round((num(n) + Number.EPSILON) * 100) / 100;
export const round3 = n => Math.round((num(n) + Number.EPSILON) * 1000) / 1000;
export const lineTotal = it => round2(num(it.qty) * num(it.rate));
export const presentTotal = items => round2((items || []).reduce((s, i) => s + lineTotal(i), 0));
export const totalQty = items => round3((items || []).reduce((s, i) => s + num(i.qty), 0));
// Today's Due = Present Total - Cash - UPI   (old dues are NEVER part of this)
export const todaysDue = (total, cash, upi) => round2(num(total) - num(cash) - num(upi));
// Remaining = Previous + Present - Cash - UPI - OldDuePaid
export const remainingBalance = (prev, total, cash, upi, oldPaid) => round2(num(prev) + num(total) - num(cash) - num(upi) - num(oldPaid));
export const cmpBill = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0));

/** Build the chronological ledger of one shop. Everything is DERIVED from bills, so edit/delete can never double count. */
export function ledgerFor(opening, bills) {
  const sorted = [...bills].sort(cmpBill);
  let bal = round2(opening);
  const rows = [];
  const perBill = {};
  rows.push({ type: 'opening', label: 'Previous balance (opening)', date: null, debit: 0, credit: 0, balance: bal });
  for (const b of sorted) {
    const prev = bal;
    const total = round2(b.presentTotal), cash = round2(b.cash), upi = round2(b.upi);
    const oc = round2(b.oldPaidCash), ou = round2(b.oldPaidUpi);
    const base = { date: b.date, billId: b.id, billNo: b.billNo, ref: b.upiRef || '' };
    if (total > 0) { bal = round2(bal + total); rows.push({ ...base, type: 'bill', label: `New bill ${b.billNo || ''}`, debit: total, credit: 0, balance: bal }); }
    if (cash > 0) { bal = round2(bal - cash); rows.push({ ...base, type: 'cash', label: 'Cash payment (this bill)', debit: 0, credit: cash, balance: bal }); }
    if (upi > 0) { bal = round2(bal - upi); rows.push({ ...base, type: 'upi', label: 'UPI payment (this bill)', debit: 0, credit: upi, balance: bal }); }
    if (oc > 0) { bal = round2(bal - oc); rows.push({ ...base, type: 'oldcash', label: 'Old due payment – cash', debit: 0, credit: oc, balance: bal }); }
    if (ou > 0) { bal = round2(bal - ou); rows.push({ ...base, type: 'oldupi', label: 'Old due payment – UPI', debit: 0, credit: ou, balance: bal }); }
    perBill[b.id] = { prevDue: prev, remaining: bal, todaysDue: todaysDue(total, cash, upi), oldPaid: round2(oc + ou) };
  }
  return { rows, balance: bal, perBill };
}

/** Validate a bill before saving. Returns array of error strings (empty = ok). */
export function validateBill(b, prevDue) {
  const e = [];
  const amt = { cash: 'Cash received', upi: 'UPI received', oldPaidCash: 'Old due paid (cash)', oldPaidUpi: 'Old due paid (UPI)' };
  for (const k in amt) if (num(b[k]) < 0) e.push(`${amt[k]} cannot be negative.`);
  if (!b.date) e.push('Select a date.');
  if (!b.shopId) e.push('Select a shop.');
  const items = b.items || [];
  items.forEach((i, n) => {
    if (!i.itemId) e.push(`Item ${n + 1}: choose an item.`);
    if (num(i.qty) <= 0) e.push(`Item ${n + 1}: quantity must be greater than 0.`);
    if (num(i.rate) < 0) e.push(`Item ${n + 1}: rate cannot be negative.`);
  });
  const total = presentTotal(items);
  const oldPaid = round2(num(b.oldPaidCash) + num(b.oldPaidUpi));
  if (!items.length && oldPaid <= 0) e.push('Add at least one item, or enter an old-due payment.');
  if (round2(num(b.cash) + num(b.upi)) > total) e.push("Cash + UPI for this bill is more than the present total. Enter extra money under 'Old due paid today'.");
  if (oldPaid > round2(Math.max(prevDue, 0))) e.push(`Old due paid (${oldPaid}) is more than the previous outstanding balance (${round2(Math.max(prevDue, 0))}).`);
  return e;
}

// ---------- dates & filters ----------
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export function dateRange(preset, custom = {}, now = new Date()) {
  const t = ymd(now);
  switch (preset) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
    case 'week': { const dow = (now.getDay() + 6) % 7; return { from: addDays(t, -dow), to: t }; } // Monday start
    case 'month': return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: t };
    case 'all': return { from: '0000-01-01', to: '9999-12-31' };
    default: return { from: custom.from || t, to: custom.to || custom.from || t };
  }
}
export const billPaid = b => round2(num(b.cash) + num(b.upi));
export function billStatus(b) {
  if (!(num(b.presentTotal) > 0)) return 'payment';
  const due = todaysDue(b.presentTotal, b.cash, b.upi);
  if (due <= 0) return 'paid';
  return billPaid(b) > 0 ? 'partial' : 'unpaid';
}
export function filterBills(bills, f) {
  const { from, to } = dateRange(f.preset, f);
  return bills.filter(b => {
    if (b.date < from || b.date > to) return false;
    if (f.villageId && b.villageId !== f.villageId) return false;
    if (f.shopId && b.shopId !== f.shopId) return false;
    if (f.itemId && !(b.items || []).some(i => i.itemId === f.itemId)) return false;
    if (f.method === 'cash' && !(num(b.cash) + num(b.oldPaidCash) > 0)) return false;
    if (f.method === 'upi' && !(num(b.upi) + num(b.oldPaidUpi) > 0)) return false;
    if (f.method === 'credit' && !(todaysDue(b.presentTotal, b.cash, b.upi) > 0)) return false;
    return true;
  });
}
export function sumBills(bills, infoOf) {
  const t = { count: 0, qty: 0, present: 0, oldDue: 0, cash: 0, upi: 0, oldPaid: 0, due: 0, balance: 0 };
  for (const b of bills) {
    const i = infoOf(b);
    if (num(b.presentTotal) > 0) t.count++;
    t.qty += num(b.totalQty); t.present += num(b.presentTotal); t.oldDue += i.prevDue;
    t.cash += num(b.cash); t.upi += num(b.upi); t.oldPaid += i.oldPaid; t.due += i.todaysDue;
  }
  for (const k in t) t[k] = round3(t[k]);
  return t;
}

// ---------- stock ----------
export function stockIndex(items, stockDocs, bills) {
  const idx = {};
  const get = (id, d) => { const m = (idx[id] ||= new Map()); let r = m.get(d); if (!r) { r = { loaded: 0, damaged: 0, sold: 0 }; m.set(d, r); } return r; };
  for (const it of items) idx[it.id] ||= new Map();
  for (const s of stockDocs) { const r = get(s.itemId, s.date); r.loaded += num(s.loaded); r.damaged += num(s.damaged); }
  for (const b of bills) for (const l of b.items || []) get(l.itemId, b.date).sold += num(l.qty);
  return idx;
}
/** Remaining = Opening + Loaded - Sold - Damaged, per item, for a date. Opening chains from earlier days. */
export function stockRowsForDate(items, idx, date) {
  return items.map(item => {
    const m = idx[item.id] || new Map();
    let opening = num(item.openingStock);
    for (const [d, r] of m) if (d < date) opening += r.loaded - r.damaged - r.sold;
    const c = m.get(date) || { loaded: 0, damaged: 0, sold: 0 };
    return { item, opening: round3(opening), loaded: round3(c.loaded), sold: round3(c.sold), damaged: round3(c.damaged), remaining: round3(opening + c.loaded - c.sold - c.damaged) };
  });
}
export function firstNegative(items, stockDocs, bills, itemIds, fromDate) {
  const idx = stockIndex(items, stockDocs, bills);
  for (const id of itemIds) {
    const item = items.find(i => i.id === id); if (!item) continue;
    let run = num(item.openingStock);
    for (const d of [...(idx[id] || new Map()).keys()].sort()) {
      const r = idx[id].get(d); run += r.loaded - r.damaged - r.sold;
      if (d >= fromDate && run < -1e-9) return { item, date: d, remaining: round3(run) };
    }
  }
  return null;
}
