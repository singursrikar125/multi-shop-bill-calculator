// Photos: compress → upload to private Cloud Storage → metadata in Firestore. Nothing is public-listed.
import { storage } from './fb.js';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { S, dref, imagesOf, newBillId } from './store.js';
import { esc, toast, modal, confirmBox, friendly } from './util.js';

const MAX_BYTES = 5 * 1024 * 1024;
export async function compress(file, maxDim = 1600, quality = 0.8) {
  if (file.type === 'application/pdf') { if (file.size > MAX_BYTES) throw new Error('PDF is larger than 5 MB.'); return file; }
  if (!file.type.startsWith('image/')) throw new Error('Only image files (or PDF) can be uploaded.');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) { if (file.size > MAX_BYTES) throw new Error('Image too large.'); return file; }
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  if (!blob || blob.size > MAX_BYTES) throw new Error('Image is still larger than 5 MB after compression.');
  return blob;
}
/** kind: shop|item|bill|trip|logo ; refId: id of the owner record */
export async function uploadImage(file, { kind, refId, label = '' }, onProgress) {
  const blob = await compress(file);
  const id = newBillId(); const isPdf = blob.type === 'application/pdf';
  const path = `users/${S.uid}/${kind}/${refId || 'misc'}/${id}.${isPdf ? 'pdf' : 'jpg'}`;
  const task = uploadBytesResumable(ref(storage, path), blob, { contentType: blob.type });
  await new Promise((res, rej) => task.on('state_changed', s => onProgress && onProgress(s.bytesTransferred / s.totalBytes), rej, res));
  const url = await getDownloadURL(task.snapshot.ref);
  const meta = { kind, refId: refId || null, label, path, url, name: file.name || 'photo', size: blob.size, contentType: blob.type };
  await setDoc(dref('images', id), { ...meta, createdAt: serverTimestamp() });
  return { id, ...meta };
}
export async function removeImage(img) {
  await deleteObject(ref(storage, img.path)).catch(e => { if (e.code !== 'storage/object-not-found') throw e; });
  await deleteDoc(dref('images', img.id));
}
export async function removeStoragePaths(imgs) { for (const i of imgs) await deleteObject(ref(storage, i.path)).catch(() => {}); }

/** File chooser with camera + upload buttons and previews. `getFiles()` returns [{file,label}] */
export function picker(el, { multiple = true, labels = null } = {}) {
  el.innerHTML = `<div class="row gap wrap"><button type="button" class="btn ghost" data-cam>📷 Take photo</button><button type="button" class="btn ghost" data-up>🖼️ Upload</button></div><div class="previews"></div>
  <input type="file" accept="image/*,application/pdf" capture="environment" hidden data-icam><input type="file" accept="image/*,application/pdf" ${multiple ? 'multiple' : ''} hidden data-iup>`;
  const list = []; const pv = el.querySelector('.previews');
  const draw = () => {
    pv.innerHTML = '';
    list.forEach((x, n) => {
      const d = document.createElement('div'); d.className = 'pv';
      d.innerHTML = `${x.file.type.startsWith('image/') ? `<img src="${x.url}" alt="preview">` : '<div class="pdf">PDF</div>'}${labels ? `<select>${labels.map(l => `<option ${l === x.label ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}<button type="button" class="x">✕</button>`;
      d.querySelector('.x').onclick = () => { URL.revokeObjectURL(x.url); list.splice(n, 1); draw(); };
      const s = d.querySelector('select'); if (s) s.onchange = () => (x.label = s.value);
      pv.appendChild(d);
    });
  };
  const add = fl => { for (const f of fl) { if (!multiple) list.length = 0; list.push({ file: f, url: URL.createObjectURL(f), label: labels ? labels[0] : '' }); } draw(); };
  el.querySelector('[data-cam]').onclick = () => el.querySelector('[data-icam]').click();
  el.querySelector('[data-up]').onclick = () => el.querySelector('[data-iup]').click();
  for (const i of el.querySelectorAll('input')) i.onchange = () => { add([...i.files]); i.value = ''; };
  return { getFiles: () => list.slice(), clear: () => { list.forEach(x => URL.revokeObjectURL(x.url)); list.length = 0; draw(); } };
}
export async function uploadAll(files, base) {
  let ok = 0;
  for (const x of files) { try { await uploadImage(x.file, { ...base, label: x.label || base.label || '' }); ok++; } catch (e) { toast(`Photo not uploaded: ${friendly(e)}`, 'err', 7000); } }
  return ok;
}
/** Thumbnails of stored images with open/delete */
export function thumbs(el, kind, refId, { canDelete = true } = {}) {
  const imgs = imagesOf(kind, refId);
  el.innerHTML = imgs.length ? imgs.map(i => `<div class="pv" data-id="${i.id}">${i.contentType === 'application/pdf' ? `<a class="pdf" href="${esc(i.url)}" target="_blank" rel="noopener">PDF</a>` : `<img src="${esc(i.url)}" loading="lazy" alt="${esc(i.label || kind)}">`}<small>${esc(i.label || '')}</small>${canDelete ? '<button type="button" class="x">✕</button>' : ''}</div>`).join('') : '<p class="muted small">No photos yet.</p>';
  el.querySelectorAll('.pv').forEach(p => {
    const img = imgs.find(i => i.id === p.dataset.id);
    const im = p.querySelector('img'); if (im) im.onclick = () => viewImage(img);
    const x = p.querySelector('.x'); if (x) x.onclick = async () => { if (await confirmBox('Delete this photo permanently?', { danger: true, okText: 'Delete' })) { try { await removeImage(img); toast('Photo deleted'); } catch (e) { toast(friendly(e), 'err'); } } };
  });
}
export function viewImage(img) { modal(`<img class="bigimg" src="${esc(img.url)}" alt=""><p class="muted small">${esc(img.label || '')} ${esc(img.name || '')}</p>`, { title: 'Photo', wide: true }); }

/** Single-photo editor for shop / item / logo (replace + remove) */
export function singlePhoto({ kind, refId, title, current, onChange }) {
  const m = modal(`<div class="stack"><div class="center big-ph">${current?.url ? `<img class="bigimg" src="${esc(current.url)}" alt="">` : '<p class="muted">No photo yet (placeholder).</p>'}</div>
    <div data-pick></div><div class="bar" hidden><i></i></div><div class="row end gap wrap">${current ? '<button class="btn danger" data-rm>Remove photo</button>' : ''}<button class="btn" data-go>Save photo</button></div></div>`, { title });
  const p = picker(m.el.querySelector('[data-pick]'), { multiple: false });
  m.el.querySelector('[data-go]').onclick = async e => {
    const f = p.getFiles()[0]; if (!f) return toast('Choose or take a photo first', 'warn');
    const btn = e.target; btn.disabled = true; const bar = m.el.querySelector('.bar'); bar.hidden = false;
    try {
      const up = await uploadImage(f.file, { kind, refId }, pr => (bar.firstElementChild.style.width = `${pr * 100}%`));
      if (current) await removeImage(current).catch(() => {});
      await onChange(up); toast('Photo saved ✓'); m.close();
    } catch (er) { toast(friendly(er), 'err', 7000); btn.disabled = false; bar.hidden = true; }
  };
  const rm = m.el.querySelector('[data-rm]');
  if (rm) rm.onclick = async () => { if (!await confirmBox('Remove this photo?', { danger: true, okText: 'Remove' })) return; try { await removeImage(current); await onChange(null); toast('Photo removed'); m.close(); } catch (er) { toast(friendly(er), 'err'); } };
}
