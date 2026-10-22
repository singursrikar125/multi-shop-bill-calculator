import { S, saveTrip, newTripId, activeTrip, imagesOf } from '../store.js';
import { num, round3 } from '../calc.js';
import { esc, money, fmtDate, fmtTime, fmtDur, todayStr, toast, modal, busy, confirmBox, promptBox, friendly, loadScript, loadCSS, confirmSave } from '../util.js';
import { picker, uploadAll, thumbs } from '../images.js';
import { tripStats } from './reports.js';

const LEAF = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const hav = (a, b, c, d) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(c - a), dg = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// ---- live tracking: only works while this page stays open (browsers stop GPS for closed/sleeping pages) ----
const T = { id: null, watch: null, pts: [], km: 0, last: null, lastSave: 0, unsaved: 0, wake: null, status: 'off', err: '' };
function startWatch(tripId, existing) {
  stopWatch(); T.id = tripId; T.pts = []; T.km = num(existing?.distanceKm); T.last = null;
  const flat = existing?.route || []; for (let i = 0; i + 2 < flat.length; i += 3) T.pts.push([flat[i], flat[i + 1], flat[i + 2]]); T.last = T.pts[T.pts.length - 1] || null;
  if (!navigator.geolocation) { T.status = 'unsupported'; T.err = 'This browser does not support location.'; return; }
  T.status = 'waiting';
  T.watch = navigator.geolocation.watchPosition(p => {
    T.status = 'tracking'; T.err = '';
    const { latitude: la, longitude: lo, accuracy } = p.coords; const t = Math.round(p.timestamp / 1000);
    if (accuracy > 60) return; // ignore very poor fixes
    if (T.last) { const d = hav(T.last[0], T.last[1], la, lo), dt = Math.max(1, t - T.last[2]); if (d < 0.015) return; if (d / dt * 3600 > 150) return; T.km += d; }
    T.last = [+la.toFixed(6), +lo.toFixed(6), t]; T.pts.push(T.last); T.unsaved++;
    if (T.pts.length > 5000) T.pts = T.pts.filter((_, i) => i % 2 === 0 || i === T.pts.length - 1);
    if (T.unsaved >= 8 || Date.now() - T.lastSave > 60000) flush();
    tripView.tick && tripView.tick();
  }, e => { T.status = e.code === 1 ? 'denied' : 'error'; T.err = e.code === 1 ? 'Location permission is blocked. Allow location for this site in the browser settings to record the route.' : 'Location unavailable: ' + e.message; tripView.tick && tripView.tick(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  navigator.wakeLock?.request('screen').then(w => (T.wake = w)).catch(() => {});
}
function flush() { if (!T.id) return; T.lastSave = Date.now(); T.unsaved = 0; saveTrip(T.id, { route: T.pts.flat(), distanceKm: round3(T.km) }).catch(() => {}); }
function stopWatch() { if (T.watch != null) navigator.geolocation.clearWatch(T.watch); T.watch = null; T.wake?.release?.().catch(() => {}); T.wake = null; T.status = 'off'; T.id = null; }
const here = () => new Promise(res => { if (!navigator.geolocation) return res({ err: 'Location is not supported by this browser.' }); navigator.geolocation.getCurrentPosition(p => res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), e => res({ err: e.code === 1 ? 'Location permission denied.' : 'Could not get location.' }), { enableHighAccuracy: true, timeout: 20000 }); });

async function showMap(trip) {
  const flat = trip.route || []; const pts = []; for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i], flat[i + 1]]);
  const m = modal(`<div id="tripmap" class="map"></div><p class="muted small">${pts.length ? `${pts.length} recorded points. Map tiles © OpenStreetMap contributors.` : 'No route was recorded for this trip (location was unavailable or the page was closed).'}</p>`, { title: `Trip ${fmtDate(trip.date)}`, wide: true });
  if (!pts.length) return;
  try { loadCSS(LEAF + 'leaflet.min.css'); await loadScript(LEAF + 'leaflet.min.js'); } catch (e) { return toast('Map library could not load (internet needed).', 'err'); }
  const map = window.L.map(m.el.querySelector('#tripmap')); window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const line = window.L.polyline(pts, { color: '#2f7bff', weight: 5 }).addTo(map);
  window.L.circleMarker(pts[0], { color: '#2ecc71', radius: 8 }).addTo(map).bindTooltip('Start'); window.L.circleMarker(pts[pts.length - 1], { color: '#ff5c6c', radius: 8 }).addTo(map).bindTooltip('End');
  map.fitBounds(line.getBounds(), { padding: [20, 20] }); setTimeout(() => map.invalidateSize(), 200);
}

export const tripView = {
  mount(root) {
    this.root = root; root.innerHTML = '<div data-cur></div><section class="card"><h3>Past trips</h3><div data-past></div></section>'; this.draw();
    clearInterval(this.iv); this.iv = setInterval(() => this.tick(), 1000);
  },
  unmount() { clearInterval(this.iv); },
  tick() { const t = activeTrip(); const el = this.root?.querySelector('[data-live]'); if (!t || !el) return; const s = tripStats(t); el.innerHTML = this.liveHTML(t, s); },
  liveHTML(t, s) { return `<div class="stats"><div class="stat"><span>Duration</span><b>${s.dur}</b></div><div class="stat"><span>Distance</span><b>${s.km.toFixed(2)} km</b></div><div class="stat"><span>Avg speed</span><b>${s.avg} km/h</b></div><div class="stat"><span>Bills</span><b>${s.bills}</b></div><div class="stat"><span>Sales</span><b>${money(s.sales)}</b></div><div class="stat"><span>Cash</span><b>${money(s.cash)}</b></div><div class="stat"><span>UPI</span><b>${money(s.upi)}</b></div><div class="stat"><span>Dues</span><b>${money(s.due)}</b></div></div>`; },
  update() { if (!this.root) return; if (modalOpen() || this.root.querySelector('[data-pick] .pv')) return; this.draw(); },
  draw() {
    const root = this.root, t = activeTrip(), cur = root.querySelector('[data-cur]');
    if (!t) {
      cur.innerHTML = `<section class="card"><h3>Trip</h3><p class="muted">Start a trip before you begin your route. Your phone's location is recorded <b>only while this page is open</b> and location permission is allowed; nothing is tracked when the website is closed.</p><label>Starting place name (optional)<input data-name placeholder="e.g. Warehouse"></label><button class="btn big" data-start>▶ Start trip</button></section>`;
      cur.querySelector('[data-start]').onclick = e => busy(e.target, async () => {
        const g = await here(); const id = newTripId();
        if (g.err) toast(g.err + ' The trip will start without a route.', 'warn', 7000);
        const r = await confirmSave(saveTrip(id, { date: todayStr(), startAt: Date.now(), endAt: null, status: 'active', startLoc: g.err ? null : { lat: g.lat, lng: g.lng, label: cur.querySelector('[data-name]').value.trim() }, endLoc: null, route: g.err ? [] : [g.lat, g.lng, Math.round(Date.now() / 1000)], distanceKm: 0 }));
        toast(r === 'saved' ? 'Trip started ✓' : 'Trip saved on this device; waiting to sync.', r === 'saved' ? 'ok' : 'warn');
        startWatch(id, { route: g.err ? [] : [g.lat, g.lng, Math.round(Date.now() / 1000)], distanceKm: 0 });
      });
    } else {
      const mine = T.id === t.id; const s = tripStats(t);
      cur.innerHTML = `<section class="card"><div class="row between"><h3>Trip in progress</h3><span class="badge ${mine && T.status === 'tracking' ? 'ok' : 'warn'}">${mine ? ({ tracking: 'GPS tracking', waiting: 'Waiting for GPS…', denied: 'Location blocked', error: 'GPS error', unsupported: 'No GPS' }[T.status] || '') : 'Not tracking on this device'}</span></div>
        <p class="muted small">Started ${fmtDate(t.date)} ${fmtTime(new Date(t.startAt))}${t.startLoc ? ` · from ${esc(t.startLoc.label || '')} (${t.startLoc.lat}, ${t.startLoc.lng})` : ' · no start location'}</p>
        ${mine && T.err ? `<p class="err">${esc(T.err)}</p>` : ''}${!mine ? '<p class="warn small">Location is recorded only on a device that is tracking with this page open. <button class="link" data-resume>Track on this device</button></p>' : ''}
        <div data-live>${this.liveHTML(t, s)}</div>
        <h4>Trip photos</h4><div class="previews" data-tp></div><div data-pick></div>
        <div class="row gap wrap"><button class="btn danger" data-end>■ End trip</button><button class="btn ghost" data-upload>Upload photos</button></div></section>`;
      thumbs(cur.querySelector('[data-tp]'), 'trip', t.id); const pk = picker(cur.querySelector('[data-pick]'), { labels: ['Trip photo'] });
      const res = cur.querySelector('[data-resume]'); if (res) res.onclick = () => { startWatch(t.id, t); this.draw(); };
      cur.querySelector('[data-upload]').onclick = e => busy(e.target, async () => { const n = await uploadAll(pk.getFiles(), { kind: 'trip', refId: t.id }); pk.clear(); toast(`${n} photo(s) uploaded`); });
      cur.querySelector('[data-end]').onclick = async e => {
        const r = await promptBox('End trip', [{ name: 'label', label: 'Ending place name (optional)', placeholder: 'e.g. Warehouse' }], 'End trip'); if (!r) return;
        busy(e.target, async () => {
          const g = mine ? { lat: T.last?.[0], lng: T.last?.[1] } : await here(); const pts = mine ? T.pts.flat() : t.route || [];
          const rr = await confirmSave(saveTrip(t.id, { status: 'done', endAt: Date.now(), endLoc: g.lat != null ? { lat: g.lat, lng: g.lng, label: r.label.trim() } : null, route: pts, distanceKm: round3(mine ? T.km : num(t.distanceKm)) }));
          if (mine) stopWatch(); toast(rr === 'saved' ? 'Trip saved to the cloud ✓' : 'Trip saved on this device; waiting to sync.', rr === 'saved' ? 'ok' : 'warn');
        });
      };
    }
    const past = S.trips.filter(x => x.status === 'done').sort((a, b) => b.startAt - a.startAt);
    root.querySelector('[data-past]').innerHTML = past.length ? past.map(x => { const s = tripStats(x); return `<article class="card inner"><div class="row between"><b>${fmtDate(x.date)}</b><button class="btn ghost sm" data-map="${x.id}">🗺 Map</button></div>
      <div class="muted small">${fmtTime(new Date(x.startAt))} → ${fmtTime(new Date(x.endAt))} · ${s.dur} · ${s.km.toFixed(2)} km · ${s.avg} km/h</div>
      <div class="muted small">${x.startLoc ? `From ${esc(x.startLoc.label || '')} (${x.startLoc.lat}, ${x.startLoc.lng})` : 'No start location'}${x.endLoc ? ` · To ${esc(x.endLoc.label || '')} (${x.endLoc.lat}, ${x.endLoc.lng})` : ''}</div>
      <div class="kv"><span>Bills</span><b>${s.bills}</b><span>Sales</span><b>${money(s.sales)}</b><span>Cash / UPI</span><b>${money(s.cash)} / ${money(s.upi)}</b><span>Dues</span><b>${money(s.due)}</b></div>
      <div class="previews" data-pt="${x.id}"></div></article>`; }).join('') : '<p class="muted">No completed trips yet.</p>';
    root.querySelectorAll('[data-pt]').forEach(el => thumbs(el, 'trip', el.dataset.pt, { canDelete: false }));
    root.querySelectorAll('[data-map]').forEach(b => (b.onclick = () => showMap(S.trips.find(x => x.id === b.dataset.map))));
  },
};
const modalOpen = () => !!document.querySelector('.overlay') || (document.activeElement && document.activeElement.closest?.('[data-pick]'));
// resume tracking automatically if this device reloads while a trip it started is still active
export function resumeTripIfAny() { const t = activeTrip(); if (t && T.id !== t.id && sessionStorage.getItem('trackingTrip') === t.id) startWatch(t.id, t); }
export const markTracking = () => { try { T.id && sessionStorage.setItem('trackingTrip', T.id); } catch (e) {} };
setInterval(markTracking, 5000);
