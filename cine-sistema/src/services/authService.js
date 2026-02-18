// src/services/authService.js
import { auth } from "./firebase.js";

// Firebase Auth (si existe)
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Fallback local (si NO existe Firebase)
const LS_KEY = "V1_LOCAL_SESSION";

function localLogin(email, password) {
  // DEMO: admin / user
  // admin: admin@demo.com / 123456
  // user : user@demo.com / 123456
  const ok =
    (email === "admin@demo.com" && password === "123456") ||
    (email === "user@demo.com" && password === "123456");

  if (!ok) {
    const err = new Error("Credenciales inválidas (modo local).");
    err.code = "local/invalid-credential";
    throw err;
  }

  const uid = email === "admin@demo.com" ? "LOCAL_ADMIN" : "LOCAL_USER";
  localStorage.setItem(LS_KEY, JSON.stringify({ uid, email }));
  window.dispatchEvent(new Event("v1-local-auth-changed"));
  return { user: { uid, email } };
}

function localLogout() {
  localStorage.removeItem(LS_KEY);
  window.dispatchEvent(new Event("v1-local-auth-changed"));
}

function localGetUser() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function login(email, password) {
  if (auth) {
    return signInWithEmailAndPassword(auth, email, password);
  }
  return localLogin(email, password);
}

export async function logout() {
  if (auth) {
    return signOut(auth);
  }
  return localLogout();
}

export function onSessionChanged(cb) {
  if (auth) {
    return onAuthStateChanged(auth, cb);
  }

  // Local fallback
  const emit = () => {
    const u = localGetUser();
    cb(u ? { uid: u.uid, email: u.email } : null);
  };

  window.addEventListener("v1-local-auth-changed", emit);
  emit();

  return () => window.removeEventListener("v1-local-auth-changed", emit);
}
