import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

export { isConfigured };
export let app, auth, db, storage;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try { // offline cache so a pending write survives a dropped signal / closed tab, and syncs later
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { db = getFirestore(app); }
  storage = getStorage(app);
}
