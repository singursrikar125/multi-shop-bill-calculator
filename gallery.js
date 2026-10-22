import { S, shopById, itemById, shopNameOf } from '../store.js';
import { esc, modal, confirmBox, toast, friendly, fmtDate } from '../util.js';
import { removeImage, viewImage } from '../images.js';

let kind = 'shop';
export function galleryView(el) {
  const label = i => {
    if (i.kind === 'shop') return shopById(i.refId)?.name || 'Shop';
    if (i.kind === 'item') return itemById(i.refId)?.name || 'Item';
    if (i.kind === 'bill') { const b = S.bills.find(x => x.id === i.refId); return b ? `${b.billNo} · ${shopNameOf(b)} · ${fmtDate(b.date)}` : 'Bill'; }
    if (i.kind === 'trip') { const t = S.trips.find(x => x.id === i.refId); return t ? `Trip ${fmtDate(t.date)}` : 'Trip'; }
    return i.kind;
  };
  const imgs = S.images.filter(i => i.kind === kind).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  el.innerHTML = `<section class="card"><div class="seg small">${['shop', 'item', 'bill', 'trip'].map(k => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${{ shop: 'Shops', item: 'Items', bill: 'Bills', trip: 'Trips' }[k]}</button>`).join('')}</div>
  <div class="gallery">${imgs.length ? imgs.map(i => `<figure data-id="${i.id}">${i.contentType === 'application/pdf' ? `<a class="pdf" href="${esc(i.url)}" target="_blank" rel="noopener">PDF</a>` : `<img loading="lazy" src="${esc(i.url)}" alt="${esc(label(i))}">`}<figcaption>${esc(label(i))}<br><small>${esc(i.label || '')}</small></figcaption></figure>`).join('') : '<p class="muted center pad">No photos in this category yet.</p>'}</div></section>`;
  el.querySelectorAll('[data-k]').forEach(b => (b.onclick = () => { kind = b.dataset.k; galleryView(el); }));
  el.querySelectorAll('figure img').forEach(im => (im.onclick = () => {
    const img = imgs.find(i => i.id === im.closest('figure').dataset.id);
    const m = modal(`<img class="bigimg" src="${esc(img.url)}" alt=""><p>${esc(label(img))}</p><div class="row end"><button class="btn danger" data-d>Delete photo</button></div>`, { title: 'Photo', wide: true });
    m.el.querySelector('[data-d]').onclick = async () => { if (await confirmBox('Delete this photo permanently?', { danger: true, okText: 'Delete' })) { try { await removeImage(img); m.close(); toast('Photo deleted'); } catch (e) { toast(friendly(e), 'err'); } } };
  }));
}
