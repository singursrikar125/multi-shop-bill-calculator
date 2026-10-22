import { S, saveEntity, saveSettings, removeEntity, archiveEntity, shopsOf, sortedVillages, itemById, shopById, exportAll, importData, wipeAllData, ledgers } from '../store.js';
import { auth } from '../fb.js';
import { sendPasswordResetEmail, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { num } from '../calc.js';
import { esc, money, toast, modal, confirmBox, promptBox, busy, friendly, download, toCSV, confirmSave, saveMsg, cfg } from '../util.js';
import { singlePhoto, removeStoragePaths } from '../images.js';

// ---------- item editor (also used by Stock tab) ----------
export async function itemEditor(id) {
  const it = id ? itemById(id) : null; const units = S.settings.units || ['pcs', 'kg', 'dozen', 'box'];
  const m = modal(`<form class="stack"><label>Item name<input name="name" value="${esc(it?.name || '')}" required maxlength="80" placeholder="e.g. Kobari Kaya (కొబ్బరికాయ)"></label>
    <div class="grid2"><label>Default rate<input name="price" type="number" inputmode="decimal" min="0" step="any" value="${it?.price ?? ''}"></label>
    <label>Unit<select name="unit">${units.map(u => `<option ${u === (it?.unit || units[0]) ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
    <label>Opening stock (starting quantity)<input name="openingStock" type="number" inputmode="decimal" step="any" value="${it?.openingStock ?? 0}"></label></div>
    ${it ? `<div class="row gap center-v"><div class="shopthumb">${it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="">` : '<span class="ph">📦</span>'}</div><button type="button" class="btn ghost" data-photo>📷 Item photo</button></div>` : '<p class="muted small">Save the item first, then add its photo.</p>'}
    <div class="row end gap"><button type="button" class="btn ghost" data-c>Cancel</button><button class="btn">Save item</button></div></form>`, { title: it ? 'Edit item' : 'New item' });
  m.el.querySelector('[data-c]').onclick = m.close;
  const ph = m.el.querySelector('[data-photo]');
  if (ph) ph.onclick = () => { m.close(); singlePhoto({ kind: 'item', refId: id, title: it.name, current: S.images.find(i => i.id === it.imageId), onChange: up => saveEntity('items', id, { name: it.name, imageId: up?.id || null, imageUrl: up?.url || null }) }); };
  m.el.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const f = e.target.elements; const name = f.name.value.trim(); if (!name) return;
    if (S.items.some(i => i.id !== id && i.name.toLowerCase() === name.toLowerCase())) return toast('An item with this name already exists.', 'err');
    if (num(f.price.value) < 0) return toast('Rate cannot be negative.', 'err');
    await busy(e.submitter, async () => { const r = await confirmSave(saveEntity('items', id, { name, price: num(f.price.value), unit: f.unit.value, openingStock: num(f.openingStock.value), active: true })); const [t, k] = saveMsg(r); toast(t, k); m.close(); });
  };
}
function shopEditor(shopId, villageId) {
  const sh = shopId ? shopById(shopId) : null;
  const m = modal(`<form class="stack"><label>Shop name<input name="name" value="${esc(sh?.name || '')}" required maxlength="80"></label>
    <label>Village<select name="v">${sortedVillages(true).map(v => `<option value="${v.id}" ${v.id === (sh?.villageId || villageId) ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label>Existing balance due when you started using this app<input name="ob" type="number" inputmode="decimal" step="any" value="${sh?.openingBalance ?? 0}"></label>
    ${sh ? `<div class="row gap"><div class="shopthumb">${sh.imageUrl ? `<img src="${esc(sh.imageUrl)}" alt="">` : '<span class="ph">🏪</span>'}</div><button type="button" class="btn ghost" data-photo>📷 Shop photo</button></div>` : ''}
    <div class="row end gap"><button type="button" class="btn ghost" data-c>Cancel</button><button class="btn">Save shop</button></div></form>`, { title: sh ? 'Edit shop' : 'New shop' });
  m.el.querySelector('[data-c]').onclick = m.close;
  const ph = m.el.querySelector('[data-photo]'); if (ph) ph.onclick = () => { m.close(); singlePhoto({ kind: 'shop', refId: shopId, title: sh.name, current: S.images.find(i => i.id === sh.imageId), onChange: up => saveEntity('shops', shopId, { name: sh.name, imageId: up?.id || null, imageUrl: up?.url || null }) }); };
  m.el.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = e.target.elements; const name = f.name.value.trim(); if (!name) return;
    if (S.shops.some(s => s.id !== shopId && s.villageId === f.v.value && s.name.toLowerCase() === name.toLowerCase())) return toast('This village already has a shop with that name.', 'err');
    await busy(e.submitter, async () => { await confirmSave(saveEntity('shops', shopId, { name, villageId: f.v.value, openingBalance: num(f.ob.value), active: true })); toast('Shop saved ✓'); m.close(); }); };
}

const section = (id, title, body, open = false) => `<details class="card acc" data-sec="${id}" ${open ? 'open' : ''}><summary><h3>${title}</h3></summary><div class="acc-b">${body}</div></details>`;

export const setupView = {
  mount(root) {
    this.root = root; const openSecs = new Set([...(root.querySelectorAll('details[open]') || [])].map(d => d.dataset.sec)); if (!this.firstDone) { openSecs.add('biz'); this.firstDone = true; }
    const s = S.settings;
    root.innerHTML =
      section('biz', '🏢 Business &amp; preferences', `<form class="stack" data-biz>
        <div class="grid2"><label>Business name<input name="businessName" value="${esc(s.businessName || '')}" maxlength="80"></label><label>Owner name<input name="ownerName" value="${esc(s.ownerName || '')}" maxlength="80"></label>
        <label>Contact number<input name="phone" type="tel" value="${esc(s.phone || '')}" maxlength="20"></label><label>Address<input name="address" value="${esc(s.address || '')}" maxlength="150"></label>
        <label>Default item<select name="defaultItemId">${S.items.filter(i => i.active !== false).map(i => `<option value="${i.id}" ${i.id === s.defaultItemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
        <label>Invoice prefix<input name="invoicePrefix" value="${esc(s.invoicePrefix ?? 'INV-')}" maxlength="10"></label>
        <label>Stock units (comma separated)<input name="units" value="${esc((s.units || ['pcs', 'kg', 'dozen', 'box']).join(', '))}"></label>
        <label>Currency<select name="currency">${['INR', 'USD', 'EUR', 'AED'].map(c => `<option ${c === (s.currency || 'INR') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Date format<select name="dateFormat">${['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(c => `<option ${c === (s.dateFormat || 'DD/MM/YYYY') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Theme<select name="theme">${[['dark', 'Dark navy'], ['light', 'Light']].map(([v, t]) => `<option value="${v}" ${v === (s.theme || 'dark') ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
        <label class="check"><input type="checkbox" name="allowNegativeStock" ${s.allowNegativeStock ? 'checked' : ''}> Allow selling beyond recorded stock (stock can go negative)</label>
        <div class="row gap wrap center-v"><div class="shopthumb">${S.images.find(i => i.id === s.logoImageId) ? `<img src="${esc(S.images.find(i => i.id === s.logoImageId).url)}" alt="">` : '<span class="ph">🏷️</span>'}</div><button type="button" class="btn ghost" data-logo>Business logo</button></div>
        <button class="btn">Save settings</button></form>`) +
      section('vs', '📍 Villages &amp; shops', `<div data-vs></div><button class="btn ghost" data-addv>＋ Add village</button>`) +
      section('items', '📦 Item catalogue &amp; prices', `<div data-items></div><button class="btn ghost" data-additem>＋ Add item</button>`) +
      section('backup', '💾 Backup &amp; export', `<p class="muted small">Your data lives in the cloud and is synced to every device. Download a copy regularly – this is your backup.</p>
        <div class="row gap wrap"><button class="btn ghost" data-expjson>⬇️ Full backup (JSON)</button><button class="btn ghost" data-expcsv>⬇️ All bills (CSV)</button><label class="btn ghost filebtn">⬆️ Restore / import JSON<input type="file" accept=".json,application/json" hidden data-imp></label><button class="btn ghost" data-sample>🧪 Load sample test data</button></div>`) +
      section('acct', '👤 Account', `<p>Signed in as <b>${esc(auth.currentUser?.email || '')}</b></p><div class="row gap wrap"><button class="btn ghost" data-reset>Send password-reset email</button><button class="btn ghost" data-out>Sign out</button><button class="btn danger" data-delacct>Delete account &amp; all data</button></div>`);
    openSecs.forEach(id => root.querySelector(`[data-sec="${id}"]`)?.setAttribute('open', ''));
    const q = x => root.querySelector(x);
    // business form
    q('[data-biz]').onsubmit = e => { e.preventDefault(); const f = e.target.elements;
      const units = f.units.value.split(',').map(x => x.trim()).filter(Boolean);
      busy(e.submitter, async () => { const r = await confirmSave(saveSettings({ businessName: f.businessName.value.trim(), ownerName: f.ownerName.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), defaultItemId: f.defaultItemId.value, invoicePrefix: f.invoicePrefix.value.trim(), units: units.length ? units : ['pcs'], currency: f.currency.value, dateFormat: f.dateFormat.value, theme: f.theme.value, allowNegativeStock: f.allowNegativeStock.checked })); const [m, t] = saveMsg(r); toast(m, t); }); };
    q('[data-logo]').onclick = () => singlePhoto({ kind: 'logo', refId: 'logo', title: 'Business logo', current: S.images.find(i => i.id === S.settings.logoImageId), onChange: up => saveSettings({ logoImageId: up?.id || null }) });
    q('[data-addv]').onclick = async () => { const r = await promptBox('New village', [{ name: 'name', label: 'Village name', required: true }]); if (r?.name.trim()) { if (S.villages.some(v => v.name.toLowerCase() === r.name.trim().toLowerCase())) return toast('Village already exists.', 'err'); await confirmSave(saveEntity('villages', null, { name: r.name.trim(), order: S.villages.length + 1, active: true })).catch(e => toast(friendly(e), 'err')); } };
    q('[data-additem]').onclick = () => itemEditor(null);
    q('[data-expjson]').onclick = e => busy(e.target, async () => { const d = await exportAll(); download(`backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 1), 'application/json'); toast('Backup downloaded'); });
    q('[data-expcsv]').onclick = () => download('all-bills.csv', toCSV([['Bill No', 'Date', 'Village', 'Shop', 'Items', 'Quantity', 'Present total', 'Previous due', 'Cash', 'UPI', 'UPI ref', 'Old due paid', "Today's due", 'Remaining balance', 'Notes'], ...S.bills.sort((a, b) => (a.seq || 0) - (b.seq || 0)).map(b => { return [b.billNo, b.date, b.villageName, b.shopName, b.itemNames, b.totalQty, b.presentTotal, b.prevDue, b.cash, b.upi, b.upiRef, b.oldDuePaid, b.todaysDue, b.remaining, b.notes]; })]), 'text/csv');
    q('[data-imp]').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!await confirmBox('Import this file into your account? Existing records with the same id are overwritten; nothing is deleted.', { okText: 'Import' })) return; await busy(q('[data-imp]').parentElement, async () => { const n = await importData(d); toast(`Imported ${n} records ✓`); }); } catch (er) { toast('Could not import: ' + friendly(er), 'err', 7000); } e.target.value = ''; };
    q('[data-sample]').onclick = async e => { if (!await confirmBox('Load the sample dataset (villages, shops, items, stock and a few demo bills)? Use this on a test account.', { okText: 'Load sample' })) return; busy(e.target, async () => { const d = await (await fetch('sample-data.json')).json(); const n = await importData(d); toast(`Sample data loaded (${n} records) ✓`); }); };
    q('[data-reset]').onclick = () => sendPasswordResetEmail(auth, auth.currentUser.email).then(() => toast('Password reset email sent ✓')).catch(e => toast(friendly(e), 'err'));
    q('[data-out]').onclick = () => signOut(auth);
    q('[data-delacct]').onclick = deleteAccount;
    this.drawLists();
  },
  drawLists() {
    const root = this.root, led = ledgers();
    root.querySelector('[data-vs]').innerHTML = sortedVillages(true).map(v => `<div class="vblock"><div class="row between"><b>${esc(v.name)}${v.active === false ? ' <small class="muted">(hidden)</small>' : ''}</b><span class="row gap"><button class="btn ghost sm" data-ev="${v.id}">Rename</button><button class="btn ghost sm" data-addshop="${v.id}">＋ Shop</button><button class="btn danger sm" data-dv="${v.id}">Remove</button></span></div>
      ${shopsOf(v.id, true).map(s => `<div class="row between srow"><span>${s.imageUrl ? `<img class="mini" src="${esc(s.imageUrl)}" alt="">` : '🏪'} ${esc(s.name)}${s.active === false ? ' <small class="muted">(archived)</small>' : ''} <small class="muted">${money(led.get(s.id)?.balance || 0)}</small></span><span class="row gap"><button class="btn ghost sm" data-es="${s.id}">Edit</button><button class="btn danger sm" data-ds="${s.id}">Remove</button></span></div>`).join('') || '<p class="muted small">No shops.</p>'}</div>`).join('') || '<p class="muted">No villages yet.</p>';
    root.querySelector('[data-items]').innerHTML = S.items.filter(i => i.active !== false).map(i => `<div class="row between srow"><span>${i.imageUrl ? `<img class="mini" src="${esc(i.imageUrl)}" alt="">` : '📦'} ${esc(i.name)} <small class="muted">${money(i.price)} / ${esc(i.unit || '')}${i.id === S.settings.defaultItemId ? ' · default' : ''}</small></span><span class="row gap"><button class="btn ghost sm" data-ei="${i.id}">Edit</button><button class="btn danger sm" data-di="${i.id}">Remove</button></span></div>`).join('') || '<p class="muted">No items.</p>';
    root.querySelector('[data-vs]').onclick = async e => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.ev) { const v = S.villages.find(x => x.id === d.ev); const r = await promptBox('Rename village', [{ name: 'name', label: 'Village name', value: v.name, required: true }]); if (r?.name.trim()) await confirmSave(saveEntity('villages', v.id, { name: r.name.trim() })).catch(er => toast(friendly(er), 'err')); }
      if (d.addshop) shopEditor(null, d.addshop); if (d.es) shopEditor(d.es);
      if (d.dv) { const v = S.villages.find(x => x.id === d.dv); if (S.shops.some(s => s.villageId === v.id)) return toast('Move or remove this village\'s shops first.', 'warn', 6000); if (await confirmBox(`Remove village "${v.name}"?`, { danger: true, okText: 'Remove' })) { if (S.bills.some(x => x.villageId === v.id)) await archiveEntity('villages', v.id, v.name), toast('Village has bills, so it was hidden (history kept).'); else await removeEntity('villages', v.id, v.name), toast('Village removed'); } }
      if (d.ds) { const s = shopById(d.ds); if (await confirmBox(`Remove shop "${s.name}"?` + (S.bills.some(x => x.shopId === s.id) ? ' It has bills, so it will be archived (hidden from new bills; history and ledger are kept).' : ''), { danger: true, okText: 'Remove' })) { if (S.bills.some(x => x.shopId === s.id)) { await archiveEntity('shops', s.id, s.name); toast('Shop archived'); } else { await removeEntity('shops', s.id, s.name); await removeStoragePaths(S.images.filter(i => i.kind === 'shop' && i.refId === s.id)); toast('Shop removed'); } } } };
    root.querySelector('[data-items]').onclick = async e => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.ei) itemEditor(d.ei);
      if (d.di) { const i = itemById(d.di); if (i.id === S.settings.defaultItemId) return toast('Choose another default item before removing this one.', 'warn'); if (await confirmBox(`Remove item "${i.name}"?`, { danger: true, okText: 'Remove' })) { const used = S.bills.some(x => (x.items || []).some(l => l.itemId === i.id)) || S.stock.some(x => x.itemId === i.id); if (used) { await archiveEntity('items', i.id, i.name); toast('Item has history, so it was archived.'); } else { await removeEntity('items', i.id, i.name); toast('Item removed'); } } } };
  },
  update() { if (!this.root) return; if (this.root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return; this.drawLists(); },
  settingsChanged() { if (!this.root || this.root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return; this.mount(this.root); },
};

async function deleteAccount() {
  const r = await promptBox('Delete account', [{ name: 'c', label: 'This permanently deletes ALL bills, shops, stock, trips, photos and your login. Download a backup first. Type DELETE to confirm.' }], 'Delete everything');
  if (!r || r.c !== 'DELETE') return r && toast('You must type DELETE exactly.', 'warn');
  try {
    toast('Deleting data…', 'ok', 4000);
    await removeStoragePaths(S.images); await wipeAllData();
    await deleteUser(auth.currentUser); toast('Account deleted.');
  } catch (e) { toast(friendly(e), 'err', 9000); }
}
