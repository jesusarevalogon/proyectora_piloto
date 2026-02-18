// src/services/stateService.js
import { supabase } from "./supabase.js";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado. Este sistema ya no usa localStorage.");
}

function isNotFoundSingleRowError(error) {
  // PostgREST: cuando usas .single() y no hay filas suele venir:
  // code: "PGRST116" y/o status 406
  const code = error?.code || "";
  const status = error?.status;
  return code === "PGRST116" || status === 406;
}

export async function loadModuleState({ userId, projectId, moduleKey }) {
  requireSupabase();

  const { data, error } = await supabase
    .from("project_state")
    .select("data")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("module_key", moduleKey)
    .single();

  // ✅ Si no existe row, regresamos null (sin tronar)
  if (error) {
    if (isNotFoundSingleRowError(error)) return null;
    // ✅ Si es cualquier otro error (RLS, permisos, etc.), lo mostramos
    throw error;
  }

  return data?.data ?? null;
}

export async function saveModuleState({ userId, projectId, moduleKey, data }) {
  requireSupabase();

  const { error } = await supabase
    .from("project_state")
    .upsert(
      {
        user_id: userId,
        project_id: projectId,
        module_key: moduleKey,
        data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,project_id,module_key" }
    );

  if (error) throw error;
}

