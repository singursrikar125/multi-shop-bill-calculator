// Cloud data layer: realtime listeners (cross-device sync) + all writes.
import { db } from './fb.js';
import { collection, doc, onSnapshot, setDoc, getDoc, getDocs, query, where, writeBatch, runTransaction, serverTimestamp, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { ledgerFor, num, round2, todaysDue, presentTotal, totalQty, firstNegative } from './calc.js';
import { groupBy } from './util.js';

export const COLS = ['villages', 'shops', 'items', 'bills', 'stock', 'trips', 'images'];
export const S = { uid: null, settings: {}, villages: [], shops: [], items: [], bills: [], stock: [], trips: [], images: [], loaded: new Set(), pendingBy: {}, cacheBy: {}, error: null };
let notify = () => {}, unsubs = [];
export const onData = fn => { notify = fn; };
export const col = n => collection(db, 'users', S.uid, n);
export const dref = (n, id) => doc(db, 'users', S.uid, n, id);

export function startSync(user) {
  stopSync(); S.uid = user.uid; S.error = null;
  const opts = { includeMetadataChanges: true };
  for (const n of COLS) {
    unsubs.push(onSnapshot(col(n), opts, snap => {
      S[n] = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
      S.pendingBy[n] = snap.metadata.hasPendingWrites; S.cacheBy[n] = snap.metadata.fromCache; S.loaded.add(n); notify(n);
    }, err => { S.error = err; notify('error'); }));
  }
  unsubs.push(onSnapshot(dref('settings', 'main'), opts, snap => {
    S.settings = snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : {};
    S.pendingBy.settings = snap.metadata.hasPendingWrites; S.loaded.add('settings'); notify('settings');
  }, err => { S.error = err; notify('error'); }));
}
export function stopSync() { unsubs.forEach(u => u()); unsubs = []; Object.assign(S, { uid: null, settings: {}, villages: [], shops: [], items: [], bills: [], stock: [], trips: [], images: [] }); S.loaded = new Set(); S.pendingBy = {}; S.cacheBy = {}; memo.b = null; }
export const isPending = () => Object.values(S.pendingBy).some(Boolean);
export const isLoaded = () => S.loaded.size >= COLS.length + 1;

// ---------- derived data (never stored as truth) ----------
const memo = { b: null, s: null, v: null };
export function ledgers() {
  if (memo.b === S.bills && memo.s === S.shops) return memo.v;
  const by = groupBy(S.bills, 'shopId'); const m = new Map();
  for (const sh of S.shops) m.set(sh.id, ledgerFor(sh.openingBalance, by[sh.id] || []));
  memo.b = S.bills; memo.s = S.shops; memo.v = m; return m;
}
export function billInfo(b) {
  const i = ledgers().get(b.shopId)?.perBill[b.id];
  return i || { prevDue: num(b.prevDue), remaining: num(b.remaining), todaysDue: todaysDue(b.presentTotal, b.cash, b.upi), oldPaid: round2(num(b.oldPaidCash) + num(b.oldPaidUpi)) };
}
export const villageById = id => S.villages.find(v => v.id === id);
export const shopById = id => S.shops.find(s => s.id === id);
export const itemById = id => S.items.find(i => i.id === id);
export const villageName = b => villageById(b.villageId)?.name || b.villageName || '—';
export const shopNameOf = b => shopById(b.shopId)?.name || b.shopName || '—';
export const sortedVillages = (all = false) => S.villages.filter(v => all || v.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
export const shopsOf = (vid, all = false) => S.shops.filter(s => s.villageId === vid && (all || s.active !== false)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
export const activeItems = () => S.items.filter(i => i.active !== false).sort((a, b) => a.name.localeCompare(b.name));
export const activeTrip = () => S.trips.find(t => t.status === 'active');
export const imagesOf = (kind, refId) => S.images.filter(i => i.kind === kind && i.refId === refId).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

// ---------- audit ----------
function auditRef() { return doc(col('audit')); }
const auditData = (action, entity, entityId, summary, before) => ({ action, entity, entityId, summary, before: before ? JSON.stringify(before).slice(0, 4000) : null, at: serverTimestamp() });

// ---------- first-run defaults (deterministic ids → safe if two devices run it at once) ----------
export async function ensureDefaults() {
  const s = await getDoc(dref('settings', 'main'));
  if (s.exists()) return;
  const b = writeBatch(db);
  b.set(dref('settings', 'main'), { businessName: 'My Shop', ownerName: '', phone: '', address: '', defaultItemId: 'item_kobari', invoicePrefix: 'INV-', units: ['pcs', 'kg', 'dozen', 'box'], currency: 'INR', dateFormat: 'DD/MM/YYYY', theme: 'dark', allowNegativeStock: false, createdAt: serverTimestamp() });
  const vs = [['v_sirgapoor', 'Sirgapoor', 1, 5, 1], ['v_tadkal', 'Tadkal', 2, 4, 6], ['v_kangti', 'Kangti', 3, 4, 10], ['v_chapta', 'Chapta', 4, 2, 14]];
  for (const [id, name, order, n, start] of vs) {
    b.set(dref('villages', id), { name, order, active: true, createdAt: serverTimestamp() });
    for (let i = 0; i < n; i++) b.set(dref('shops', `shop_${start + i}`), { name: `Shop ${start + i}`, villageId: id, openingBalance: 0, active: true, createdAt: serverTimestamp() });
  }
  b.set(dref('items', 'item_kobari'), { name: 'Kobari Kaya (కొబ్బరికాయ)', price: 0, unit: 'pcs', openingStock: 0, active: true, createdAt: serverTimestamp() });
  await b.commit();
}

// ---------- generic entity save (villages / shops / items / settings) ----------
export async function saveEntity(name, id, data) {
  const isNew = !id; id = id || doc(col(name)).id;
  const b = writeBatch(db);
  b.set(dref(name, id), { ...data, updatedAt: serverTimestamp(), ...(isNew ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
  b.set(auditRef(), auditData(isNew ? 'create' : 'update', name, id, `${name}: ${data.name || ''}`));
  await b.commit();
  if (name === 'shops' && 'openingBalance' in data) await recomputeShop(id);
  return id;
}
export const saveSettings = data => setDoc(dref('settings', 'main'), { ...data, updatedAt: serverTimestamp() }, { merge: true });
export async function removeEntity(name, id, label) {
  const b = writeBatch(db); b.delete(dref(name, id)); b.set(auditRef(), auditData('delete', name, id, `${name} removed: ${label || ''}`)); await b.commit();
}
export async function archiveEntity(name, id, label) {
  const b = writeBatch(db); b.set(dref(name, id), { active: false, updatedAt: serverTimestamp() }, { merge: true }); b.set(auditRef(), auditData('archive', name, id, `${name} archived: ${label || ''}`)); await b.commit();
}

// ---------- bills ----------
export const newBillId = () => doc(col('bills')).id;
export function billNoText(seq) { const p = S.settings.invoicePrefix ?? 'INV-'; return `${p}${String(seq).padStart(4, '0')}`; }

export function stockViolation(bill, editingId) {
  if (S.settings.allowNegativeStock) return null;
  const sim = S.bills.filter(b => b.id !== editingId).concat([bill]);
  const ids = new Set((bill.items || []).map(i => i.itemId));
  return firstNegative(S.items, S.stock, sim, ids, bill.date);
}

/** Create or edit a bill inside a transaction (atomic bill number, conflict detection), then recompute shop ledger. */
export async function saveBill(id, data, { editing = false, expectedVersion = 1, oldShopId = null } = {}) {
  const ref = dref('bills', id), cref = dref('meta', 'counters');
  const items = (data.items || []).map(i => ({ itemId: i.itemId, name: i.name, qty: num(i.qty), rate: num(i.rate) }));
  const total = presentTotal(items), cash = round2(data.cash), upi = round2(data.upi), oc = round2(data.oldPaidCash), ou = round2(data.oldPaidUpi);
  const doc_ = {
    date: data.date, villageId: data.villageId, shopId: data.shopId, villageName: data.villageName, shopName: data.shopName,
    items, itemNames: items.map(i => i.name).join(', '), totalQty: totalQty(items), presentTotal: total,
    cash, upi, upiRef: (data.upiRef || '').trim(), oldPaidCash: oc, oldPaidUpi: ou, oldDuePaid: round2(oc + ou),
    todaysDue: todaysDue(total, cash, upi), prevDue: round2(data.prevDue), remaining: round2(data.prevDue + total - cash - upi - oc - ou),
    notes: (data.notes || '').trim(), tripId: data.tripId || null, type: items.length ? 'sale' : 'payment',
  };
  await runTransaction(db, async tx => {
    let seq, billNo, version = 1, before = null;
    if (editing) {
      const cur = await tx.get(ref);
      if (!cur.exists()) throw new Error('This bill was deleted on another device.');
      if ((cur.data().version || 1) !== expectedVersion) throw new Error('This bill was changed on another device. Close it and open it again to see the latest version.');
      seq = cur.data().seq; billNo = cur.data().billNo; version = expectedVersion + 1; before = cur.data();
      tx.update(ref, { ...doc_, seq, billNo, version, updatedAt: serverTimestamp() });
    } else {
      const c = await tx.get(cref); seq = (c.exists() ? c.data().bill || 0 : 0) + 1; billNo = billNoText(seq);
      tx.set(cref, { bill: seq }, { merge: true });
      tx.set(ref, { ...doc_, seq, billNo, version, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    tx.set(auditRef(), auditData(editing ? 'edit' : 'create', 'bills', id, `Bill ${billNo}: total ${total}, cash ${cash}, UPI ${upi}, old due paid ${round2(oc + ou)}`, before && { presentTotal: before.presentTotal, cash: before.cash, upi: before.upi, oldDuePaid: before.oldDuePaid, items: before.items }));
  });
  await recomputeShop(data.shopId); if (oldShopId && oldShopId !== data.shopId) await recomputeShop(oldShopId);
  return id;
}

export async function deleteBill(bill) {
  const b = writeBatch(db);
  b.delete(dref('bills', bill.id));
  const imgs = imagesOf('bill', bill.id); imgs.forEach(i => b.delete(dref('images', i.id)));
  b.set(auditRef(), auditData('delete', 'bills', bill.id, `Bill ${bill.billNo} deleted (total ${bill.presentTotal})`, { presentTotal: bill.presentTotal, cash: bill.cash, upi: bill.upi, oldDuePaid: bill.oldDuePaid, items: bill.items, shopId: bill.shopId, date: bill.date }));
  await b.commit();
  await recomputeShop(bill.shopId);
  return imgs;
}

/** Rewrites stored prevDue/remaining on every bill of a shop from the authoritative bill list (fresh from server when online). */
export async function recomputeShop(shopId) {
  const snap = await getDocs(query(col('bills'), where('shopId', '==', shopId)));
  const bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const L = ledgerFor(shopById(shopId)?.openingBalance || 0, bills);
  let b = writeBatch(db), n = 0, total = 0;
  for (const x of bills) {
    const i = L.perBill[x.id];
    if (round2(x.prevDue) !== i.prevDue || round2(x.remaining) !== i.remaining) {
      b.update(dref('bills', x.id), { prevDue: i.prevDue, remaining: i.remaining }); n++; total++;
      if (n === 400) { await b.commit(); b = writeBatch(db); n = 0; }
    }
  }
  if (n) await b.commit();
  return total;
}

// ---------- stock ----------
export async function saveStockRows(date, rows) { // rows: [{itemId, loaded, damaged, note}]
  const b = writeBatch(db);
  for (const r of rows) b.set(dref('stock', `${date}_${r.itemId}`), { date, itemId: r.itemId, loaded: Math.max(0, num(r.loaded)), damaged: Math.max(0, num(r.damaged)), note: r.note || '', updatedAt: serverTimestamp() }, { merge: true });
  b.set(auditRef(), auditData('update', 'stock', date, `Stock saved for ${date}`));
  await b.commit();
}

// ---------- trips ----------
export const saveTrip = (id, data) => setDoc(dref('trips', id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
export const newTripId = () => doc(col('trips')).id;

// ---------- export / import / delete-all ----------
export async function exportAll() {
  const out = { exportedAt: new Date().toISOString(), version: 1, settings: S.settings };
  for (const n of [...COLS, 'audit']) { const s = await getDocs(col(n)); out[n] = s.docs.map(d => ({ id: d.id, ...d.data() })); }
  return JSON.parse(JSON.stringify(out, (k, v) => (v && typeof v === 'object' && typeof v.toMillis === 'function' ? v.toMillis() : v)));
}
export async function importData(data) {
  const writes = [];
  const add = (n, id, d) => writes.push([dref(n, id), { ...d, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }]);
  if (data.settings && Object.keys(data.settings).length) { const { createdAt, updatedAt, ...st } = data.settings; writes.push([dref('settings', 'main'), { ...st, updatedAt: serverTimestamp() }, true]); }
  for (const v of data.villages || []) add('villages', v.id, strip(v));
  for (const s of data.shops || []) add('shops', s.id, strip(s));
  for (const i of data.items || []) add('items', i.id, strip(i));
  for (const t of data.trips || []) add('trips', t.id, strip(t));
  for (const i of data.images || []) add('images', i.id, strip(i));
  for (const s of data.stock || []) { const d = strip(s); if ('daysAgo' in d) { d.date = dayShift(d.daysAgo); delete d.daysAgo; } add('stock', `${d.date}_${d.itemId}`, d); }
  const counters = (await getDoc(dref('meta', 'counters'))).data()?.bill || 0; let seq = counters;
  const bills = (data.bills || []).map(x => { const d = strip(x); if ('daysAgo' in d) { d.date = dayShift(d.daysAgo); delete d.daysAgo; } return d; })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0)));
  for (const d of bills) {
    d.items = d.items || []; d.presentTotal = presentTotal(d.items); d.totalQty = totalQty(d.items); d.itemNames = d.items.map(i => i.name).join(', ');
    d.cash = num(d.cash); d.upi = num(d.upi); d.oldPaidCash = num(d.oldPaidCash); d.oldPaidUpi = num(d.oldPaidUpi); d.oldDuePaid = round2(d.oldPaidCash + d.oldPaidUpi);
    d.todaysDue = todaysDue(d.presentTotal, d.cash, d.upi); d.prevDue = 0; d.remaining = 0; d.version = 1; d.type = d.items.length ? 'sale' : 'payment';
    d.notes = d.notes || ''; d.upiRef = d.upiRef || ''; d.tripId = d.tripId || null; d.villageId = d.villageId || ''; d.shopId = d.shopId || '';
    if (d.seq && d.billNo) seq = Math.max(seq, d.seq); else { seq++; d.seq = seq; d.billNo = billNoText(seq); }   // restore keeps original numbers
    const id = d.id; delete d.id; add('bills', id || doc(col('bills')).id, d);
  }
  for (let i = 0; i < writes.length; i += 400) {
    const b = writeBatch(db); writes.slice(i, i + 400).forEach(([r, d, merge]) => b.set(r, d, merge ? { merge: true } : {}));
    await b.commit();
  }
  if (seq !== counters) await setDoc(dref('meta', 'counters'), { bill: seq }, { merge: true });
  for (const sid of new Set(bills.map(b => b.shopId).filter(Boolean))) await recomputeShop(sid);
  return writes.length;
}
const strip = o => { const { createdAt, updatedAt, ...r } = o; return JSON.parse(JSON.stringify(r)); };
function dayShift(n) { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/** Deletes ALL of this user's Firestore data (used by the account-deletion workflow). Storage files are removed by the caller. */
export async function wipeAllData() {
  for (const n of [...COLS, 'audit', 'meta', 'settings']) {
    const s = await getDocs(col(n)); let b = writeBatch(db), k = 0;
    for (const d of s.docs) { b.delete(d.ref); if (++k === 400) { await b.commit(); b = writeBatch(db); k = 0; } }
    if (k) await b.commit();
  }
}
