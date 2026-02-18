// src/services/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function getConfig() {
  // 1) Si defines window.__FIREBASE_CONFIG__ en consola o en un snippet, se usa.
  // 2) Si no existe, trabajamos en modo V1 local.
  return window.__FIREBASE_CONFIG__ || null;
}

let app = null;
let auth = null;
let db = null;

const config = getConfig();

if (config) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  console.warn("[firebase] No hay config. Ejecutando en modo V1 local (sin Auth/Firestore reales).");
}

export { app, auth, db };
