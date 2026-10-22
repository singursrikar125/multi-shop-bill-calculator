// ▼▼▼ PASTE YOUR FIREBASE WEB APP CONFIG HERE (Firebase console → Project settings → Your apps → Web app) ▼▼▼
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app", // or PASTE_PROJECT_ID.appspot.com (copy exactly what the console shows)
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};
// ▲▲▲ The web config is NOT a secret. Your data is protected by Authentication + firestore.rules + storage.rules. ▲▲▲
export const isConfigured = !String(firebaseConfig.apiKey).startsWith("PASTE");
