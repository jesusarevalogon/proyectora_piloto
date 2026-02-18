// src/services/authService.js
import { supabase } from "./supabase.js";

// ======= MODO LOCAL (fallback) =======
const LS_SESSION = "LOCAL_SESSION_V1";

function localGetSession() {
  const raw = localStorage.getItem(LS_SESSION);
  return raw ? JSON.parse(raw) : null;
}

function localSetSession(user) {
  localStorage.setItem(LS_SESSION, JSON.stringify(user));
  window.dispatchEvent(new Event("local-auth-changed"));
}

function localClearSession() {
  localStorage.removeItem(LS_SESSION);
  window.dispatchEvent(new Event("local-auth-changed"));
}

// ======= Normalizador de user =======
function normalizeUser(u) {
  if (!u) return null;
  return {
    uid: u.id || u.uid,
    email: u.email || null,
  };
}

// ======= API PUBLICA =======
export async function login(email, password) {
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Mensajes más claros para pilotos
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("email not confirmed")) {
        throw new Error("Tu correo aún no está confirmado. Revisa tu email e inténtalo de nuevo.");
      }
      throw error;
    }

    return { user: normalizeUser(data.user) };
  }

  // fallback local (demo)
  const user = { uid: "LOCAL_USER", email };
  localSetSession(user);
  return { user };
}

export async function logout() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return;
  }
  localClearSession();
}

/**
 * Devuelve el usuario actual (o null) de forma directa.
 * Útil para módulos que necesiten leer rápido sin esperar onSessionChanged.
 */
export async function getCurrentUser() {
  if (supabase) {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Si no hay sesión, Supabase puede devolver error. Tratamos como null.
      return null;
    }
    return normalizeUser(data.user);
  }
  return normalizeUser(localGetSession());
}

/**
 * Igual que getCurrentUser pero si no hay sesión, lanza error claro.
 */
export async function requireUser() {
  const u = await getCurrentUser();
  if (!u?.uid) throw new Error("No hay sesión activa. Inicia sesión.");
  return u;
}

export function onSessionChanged(cb) {
  if (supabase) {
    // 1) estado inicial (doble estrategia: getSession y luego getUser si hiciera falta)
    supabase.auth.getSession().then(async ({ data }) => {
      let u = data.session?.user ? normalizeUser(data.session.user) : null;

      // A veces session llega null pero sí hay usuario; lo intentamos 1 vez
      if (!u) {
        try {
          const gu = await getCurrentUser();
          u = gu || null;
        } catch {
          // ignore
        }
      }

      cb(u);
    });

    // 2) cambios
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ? normalizeUser(session.user) : null;
      cb(u);
    });

    return () => sub.subscription.unsubscribe();
  }

  // local fallback
  const emit = () => cb(normalizeUser(localGetSession()));
  window.addEventListener("local-auth-changed", emit);
  emit();
  return () => window.removeEventListener("local-auth-changed", emit);
}
