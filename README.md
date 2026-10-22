# Multi-Shop Bill Calculator – cloud edition

Mobile-first billing app (Bill · Trip · Stock · Orders · Setup · Reports) on **Firebase Authentication + Cloud Firestore + Cloud Storage**, hosted as plain static files (GitHub Pages works). No build step.

> **Read this first – what is and isn't verified**
> * I could not see your existing website, so this is a fresh build that follows your spec and colour style (dark navy / blue). Compare it with your current site and tell me anything missing.
> * Accounting + stock logic has automated tests (`npm test` / `node tests/calc.test.mjs`) covering your examples (₹5,500 due, ₹20,600 Kangti balance, stock 48).
> * The screens were smoke-tested in a headless browser against an in-memory stand-in for Firebase (bill save, old-due rules, stock blocking, all reports, invoice, ledger, sample import).
> * **Not yet tested against a real Firebase project, real Google sign-in, or two real phones.** Cross-device sync, photo upload and the security rules must be verified by you with the checklist in §7 before you rely on it.

---
## 1. Files
```
index.html            page shell (login/sign-up + app)
css/style.css         dark-navy theme, responsive, print styles
js/firebase-config.js  ← YOU paste your Firebase settings here
js/fb.js              Firebase init (offline cache on)
js/store.js           realtime sync, all writes, transactions, ledger recompute, import/export
js/calc.js            pure accounting / stock / filter logic (unit-tested)
js/images.js          camera/upload, compression, private Storage upload
js/util.js            formatting (₹1,23,456.00), modals, toasts, CSV, PDF, print
js/main.js            login / sign-up / Google / reset, tabs, sync indicator
js/views/*.js         bill, trip, stock, orders, reports, gallery, setup, invoice+ledger
firestore.rules       database security rules   storage.rules   photo security rules
sample-data.json      test dataset              tests/calc.test.mjs   unit tests
```

## 2. Firebase setup (≈10 minutes)
1. <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started**. Enable **Email/Password** and **Google** (choose a support email).
3. **Build → Firestore Database → Create database** (production mode, a region near you, e.g. `asia-south1`).
4. **Build → Storage → Get started** (production mode). *Google may require the pay-as-you-go "Blaze" plan to create a Storage bucket; a small shop normally stays inside the free allowance – check the console's current pricing notice.* Skipping Storage only disables photos.
5. **Project settings (⚙) → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` object.
6. Open **`js/firebase-config.js`** and replace every `PASTE_…` value with your values. (Web config is not secret; the rules protect the data.)
7. **Publish the security rules** (either way):
   * *Console:* Firestore → **Rules** → paste `firestore.rules` → Publish. Storage → **Rules** → paste `storage.rules` → Publish.
   * *CLI:* `npm i -g firebase-tools && firebase login && firebase use <project-id> && firebase deploy --only firestore:rules,storage`
8. **Authentication → Settings → Authorized domains** → add `YOUR-USERNAME.github.io` (and `localhost` is already there). Without this Google sign-in fails with "unauthorised domain".

## 3. Deploy on GitHub Pages
1. Create a GitHub repo, upload **all files in this folder** (keep the folder structure), commit.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
3. Open `https://YOUR-USERNAME.github.io/REPO/`. GitHub Pages only serves the files; login, data and photos all go to Firebase.

Local test: `npx serve .` (or `python3 -m http.server`) then open `http://localhost:3000` – sign-in needs http(s), not `file://`.

## 4. How the accounting works (so you can audit it)
* **Present total** = Σ(qty × rate). **Today's due** = present total − cash − UPI. Old dues are never part of it.
* **Old due paid today** (cash and/or UPI) is stored in separate fields, is *not* counted as sales, and is limited to the previous outstanding balance.
* **Remaining balance** = previous outstanding + present total − cash − UPI − old due paid.
  Example Kangti / Shop 10: 19,200 + 6,400 − 5,000 = **20,600** (in `sample-data.json`).
* Each shop has an **opening balance** (Setup → shop → "existing balance due") – enter what customers owed when you start the app.
* **Nothing is double counted:** the customer ledger and stock are *derived* from the list of saved bills every time. Editing a bill replaces it; deleting removes it; every later bill's "previous due" is recalculated (and re-stored).
* Stock: Remaining = Opening + Loaded − Sold − Damaged. *Sold* comes from bills automatically; Opening carries forward day to day (starting from the item's opening stock). A bill that would make stock negative is blocked unless Setup → "Allow selling beyond recorded stock" is ticked.
* Bill numbers come from an atomic counter (needs internet). Editing uses a version check – if another phone changed the same bill, you are told to reopen it instead of silently overwriting.
* **Grand totals** (daily bill report): quantity, present total, old due, cash, UPI, today's due (+ old-due-paid column), per village and overall. "Old due" sums each bill's previous balance as your spec requests.
* A "Saved ✓" message appears only after Firebase confirms. If the server does not confirm within ~12 s you get an orange "kept on this device, will sync" message instead; the header pill shows **Syncing / Offline – changes waiting**.

## 5. Database structure (all under `users/{uid}/…`)
| Collection | Key fields |
|---|---|
| `settings/main` | businessName, ownerName, phone, address, defaultItemId, invoicePrefix, units[], currency, dateFormat, theme, allowNegativeStock, logoImageId |
| `villages/{id}` | name, order, active |
| `shops/{id}` | name, villageId, openingBalance, imageId, imageUrl, active |
| `items/{id}` | name, price, unit, openingStock, imageId, imageUrl, active |
| `bills/{id}` | billNo, seq, version, date, villageId, shopId, items[{itemId,name,qty,rate}], presentTotal, cash, upi, upiRef, oldPaidCash, oldPaidUpi, oldDuePaid, todaysDue, prevDue, remaining, notes, tripId, createdAt/updatedAt (server time) |
| `stock/{date_itemId}` | date, itemId, loaded, damaged |
| `trips/{id}` | date, startAt, endAt, status, startLoc, endLoc, route[lat,lng,t,…], distanceKm |
| `images/{id}` | kind (shop/item/bill/trip/logo), refId, label, path, url, size |
| `audit/{id}` | action, entity, entityId, summary, before, at |
| `meta/counters` | bill (last bill sequence number) |
Photos: Storage path `users/{uid}/{kind}/{refId}/{imageId}.jpg`.

## 6. Security (what is enforced where)
* **Firestore rules:** every path must match `request.auth.uid`; changing an id/URL cannot reach another user. For **bills** the rules also check on the server: numbers ≥ 0, `presentTotal = Σ qty×rate` (≤ 12 lines per bill), `todaysDue = total − cash − UPI`, `cash + UPI ≤ total`, `oldDuePaid = cash part + UPI part`. So a tampered client cannot save inconsistent money fields. No Cloud Function is needed for this.
* **Storage rules:** only the owner can read/write/delete their folder; images or PDF only, < 6 MB. Photos are compressed in the browser (max 1600 px).
* **Passwords** are handled only by Firebase Authentication (never stored by this app). No service-account keys are in the code.
* *Caveat:* a photo "download URL" is an unguessable link; anyone who is given the exact link can open it, but it cannot be listed or guessed. If you need stricter access, tell me and I will switch to authenticated blob downloads.
* **Account deletion:** Setup → Account → type DELETE: removes your Firestore data, photos, then the login (may ask you to sign in again first).
* **Backup / recovery:** Setup → Backup → *Full backup (JSON)* (download weekly). *Restore / import JSON* re-creates records (original bill numbers kept). You can also enable Firestore scheduled backups/PITR in the Google Cloud console (paid feature).

## 7. Testing checklist (do this on a TEST Google account)
| # | Do this | Expect |
|---|---|---|
| 1 | Log in with **Continue with Google** | App opens, your email shown at top |
| 2 | Open the site on a 2nd phone, same Google account | Same data appears (header says "All changes synced") |
| – | Setup → Backup → **Load sample test data** | Villages/shops/stock + 4 demo bills; Orders shows INV-0001… |
| 3 | Bill → Sirgapoor → Shop 1 → Kobari Kaya | Shops list shows only Sirgapoor's 5 shops |
| 4 | Qty 100, rate 115, cash 5,000, UPI 1,000 | Present ₹11,500 · Today's due ₹5,500 |
| 5 | Kangti / Shop 10 with ₹19,200 prior balance: qty 256 × ₹25, old due paid cash ₹5,000 | Remaining ₹20,600 (old part ₹14,200 + today ₹6,400) |
| 6 | Save → confirm dialog → Orders | Bill appears (also on phone 2) |
| 7 | Stock tab (load stock first), save a bill | *Sold* up, *Remaining* down; overselling is blocked |
| 8 | Edit the bill's quantity | Stock/ledger/totals change by the difference only |
| 9 | Bill → Shop details → add photo | Photo appears on phone 2 / Reports → Gallery |
| 10 | Reports → Daily bill report | Village subtotals + GRAND TOTAL match the Orders list |
| 11 | Sign up a 2nd account; try to read the 1st account's data (Firebase console → Rules Playground, or open the other account's doc via a URL/id) | Denied |
| 12 | Repeat on an Android phone and a computer | Works; layout adapts; tab bar at bottom on phones |
Also: Trip → Start (allow location) → drive/walk → End → Past trips → **Map**; Orders → View → **PDF / Print / Share**.

## 8. Known limits
* Trip route is recorded only while the page is open and allowed to use location (a wake-lock keeps the screen on where supported). Closed page = no tracking.
* All bills are loaded into the browser (fine for many thousands; very large histories may need paging later).
* Bill numbers need an internet connection; most other edits queue offline and sync later.
* Maps use OpenStreetMap tiles; PDFs use html2canvas + jsPDF (loaded from cdnjs when first needed).
