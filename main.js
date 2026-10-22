import { isConfigured, auth } from './fb.js';
import { $, $$, cfg, toast, friendly } from './util.js';

const show = id => ['boot', 'needConfig', 'auth', 'app'].forEach(x => ($('#' + x).hidden = x !== id));
if (!isConfigured) { show('needConfig'); } else init();

async function init() {
  const A = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
  const store = await import('./store.js');
  const { billView } = await import('./views/bill.js'); const { tripView, resumeTripIfAny } = await import('./views/trip.js');
  const { stockView } = await import('./views/stock.js'); const { ordersView } = await import('./views/orders.js');
  const { setupView } = await import('./views/setup.js'); const { reportsView } = await import('./views/reports.js');
  const { S } = store; const views = { bill: billView, trip: tripView, stock: stockView, orders: ordersView, setup: setupView, reports: reportsView };

  // ---------------- auth screens ----------------
  const errBox = $('#authErr'); const setErr = m => { errBox.hidden = !m; errBox.textContent = m || ''; };
  const go = n => { ['login', 'signup', 'forgot'].forEach(x => ($(`#${x}Form`).hidden = x !== n)); setErr(''); };
  $$('[data-go]').forEach(b => (b.onclick = () => go(b.dataset.go)));
  $$('.eye').forEach(b => (b.onclick = () => { const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; }));
  const withBtn = async (btn, fn) => { btn.disabled = true; setErr(''); try { await fn(); } catch (e) { console.error(e); setErr(friendly(e)); } btn.disabled = false; };
  $('#loginForm').onsubmit = e => { e.preventDefault(); const f = e.target.elements; if (!f.email.value || !f.password.value) return setErr('Enter your email and password.'); withBtn(e.submitter, () => A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value)); };
  $('#signupForm').onsubmit = e => { e.preventDefault(); const f = e.target.elements;
    if (!f.name.value.trim()) return setErr('Enter your full name.'); if (!/^\S+@\S+\.\S+$/.test(f.email.value.trim())) return setErr('Enter a valid email address.');
    if (f.password.value.length < 6) return setErr('Password must be at least 6 characters.'); if (f.password.value !== f.confirm.value) return setErr('Passwords do not match.');
    withBtn(e.submitter, async () => { const c = await A.createUserWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); await A.updateProfile(c.user, { displayName: f.name.value.trim() }); A.sendEmailVerification(c.user).catch(() => {}); }); };
  $('#forgotForm').onsubmit = e => { e.preventDefault(); const em = e.target.elements.email.value.trim(); if (!em) return setErr('Enter your email.');
    withBtn(e.submitter, async () => { await A.sendPasswordResetEmail(auth, em); toast('If an account exists for this email, a reset link has been sent.', 'ok', 7000); go('login'); }); };
  $$('[data-google]').forEach(b => (b.onclick = () => withBtn(b, async () => {
    const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { await A.signInWithPopup(auth, p); } catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await A.signInWithRedirect(auth, p); else throw e; }
  })));
  $('#signOutBtn').onclick = () => A.signOut(auth);

  // ---------------- shell ----------------
  let tab = null;
  function applySettings() {
    const s = S.settings; cfg.currency = s.currency || 'INR'; cfg.dateFormat = s.dateFormat || 'DD/MM/YYYY';
    document.documentElement.dataset.theme = s.theme || 'dark'; try { localStorage.setItem('theme', s.theme || 'dark'); } catch (e) {}
    $('#bizName').textContent = s.businessName || 'Bill Calculator'; document.title = (s.businessName ? s.businessName + ' – ' : '') + 'Bill Calculator';
  }
  function openTab(t, { force = false } = {}) {
    if (!views[t]) t = 'bill'; if (tab === t && !force) return;
    views[tab]?.unmount?.(); tab = t; if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
    $$('#nav button').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'); });
    const v = $('#view'); v.innerHTML = ''; views[t].mount(v); window.scrollTo(0, 0);
  }
  $$('#nav button').forEach(b => (b.onclick = () => openTab(b.dataset.tab)));
  window.addEventListener('hashchange', () => auth.currentUser && openTab(location.hash.slice(1)));

  function status() {
    const pill = $('#syncPill'), off = !navigator.onLine, pend = store.isPending();
    const allCache = [...S.loaded].length && Object.values(S.cacheBy).every(Boolean);
    let t, c;
    if (off) { t = pend ? '⏳ Offline – changes waiting to sync' : '⚠️ Offline'; c = 'warn'; }
    else if (pend) { t = '🔄 Syncing changes…'; c = 'info'; }
    else if (allCache && !store.isLoaded()) { t = 'Connecting…'; c = 'info'; }
    else { t = '✓ All changes synced'; c = 'ok'; }
    pill.textContent = t; pill.className = 'pill ' + c;
    const bn = $('#banner'); const u = auth.currentUser;
    if (S.error) { bn.hidden = false; bn.className = 'banner err'; bn.innerHTML = `Could not load your data: ${friendly(S.error)} <button class="btn sm" id="retry">Retry</button>`; $('#retry').onclick = () => { S.error = null; store.startSync(u); }; }
    else if (u && !u.emailVerified && u.providerData.some(p => p.providerId === 'password')) { bn.hidden = false; bn.className = 'banner warn'; bn.innerHTML = 'Please verify your email address (check your inbox). <button class="btn sm" id="resend">Resend email</button>'; $('#resend').onclick = () => A.sendEmailVerification(u).then(() => toast('Verification email sent ✓')).catch(e => toast(friendly(e), 'err')); }
    else bn.hidden = true;
  }
  window.addEventListener('online', status); window.addEventListener('offline', status);

  let raf = 0;
  store.onData(name => {
    if (raf) return; raf = requestAnimationFrame(() => {
      raf = 0; status(); if (!tab) return;
      if (name === 'settings') { applySettings(); views.setup.settingsChanged && tab === 'setup' ? views.setup.settingsChanged() : views[tab].update?.(); }
      else views[tab].update?.();
    });
  });

  // ---------------- session ----------------
  A.onAuthStateChanged(auth, async user => {
    if (!user) { store.stopSync(); tab = null; $('#view').innerHTML = ''; show('auth'); go('login'); return; }
    $('#userEmail').textContent = user.email || user.displayName || ''; show('app');
    store.startSync(user); await store.ensureDefaults().catch(e => console.warn('defaults', e));
    const wait = Date.now(); while (!store.isLoaded() && Date.now() - wait < 6000) await new Promise(r => setTimeout(r, 100));
    applySettings(); status(); openTab(location.hash.slice(1) || 'bill', { force: true }); resumeTripIfAny();
  });
  try { document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark'; } catch (e) {}
}
