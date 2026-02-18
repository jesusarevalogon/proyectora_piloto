// src/services/supabase.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getConfig() {
  return window.__SUPABASE_CONFIG__ || null;
}

const cfg = getConfig();

export const supabase = cfg
  ? createClient(cfg.url, cfg.anonKey)
  : null;

if (!supabase) {
  console.warn("[supabase] No hay config. App corriendo en modo local (sin backend).");
}
