/* =========================================================
   src/services/budgetService.js
   PRESUPUESTO V2 (Supabase via project_state)

   ✅ Objetivo:
   - Nada de localStorage aquí.
   - Fuente de verdad: tabla public.project_state (module_key = "presupuesto")
   - Formato recomendado en DB:
     {
       "seq": number,
       "items": array
     }

   ✅ API:
   - getBudgetState()
   - saveBudgetState(state)
   - getBudgetItems()
   - saveBudgetItems(items)
   - getNextBudgetSeq()  -> incrementa y persiste
   - resetBudgetState()

   NOTA:
   - projectId se toma de:
     opts.projectId || window.appState.project.id || window.appState.project.project_id || ...
========================================================= */

import { loadModuleState, saveModuleState } from "./stateService.js";

const MODULE_KEY = "presupuesto";

function getActiveProjectId(opts = {}) {
  const fromOpts = opts.projectId || opts.project_id;
  if (fromOpts) return String(fromOpts);

  const w = typeof window !== "undefined" ? window : null;
  const p =
    w?.appState?.project ||
    w?.appState?.currentProject ||
    w?.project ||
    null;

  const pid =
    p?.id ||
    p?.project_id ||
    p?.projectId ||
    w?.appState?.project_id ||
    null;

  return pid ? String(pid) : null;
}

function normalizeState(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const seq = Number.isFinite(Number(safe.seq)) ? Number(safe.seq) : 0;
  const items = Array.isArray(safe.items) ? safe.items : [];
  return { seq, items };
}

/** =========================
 *  Leer estado completo
 *  ========================= */
export async function getBudgetState(opts = {}) {
  const projectId = getActiveProjectId(opts);
  if (!projectId) {
    // Sin projectId no podemos ir a Supabase; devolvemos vacío (no localStorage).
    return { seq: 0, items: [] };
  }

  const data = await loadModuleState(MODULE_KEY, projectId);
  return normalizeState(data);
}

/** =========================
 *  Guardar estado completo
 *  ========================= */
export async function saveBudgetState(state, opts = {}) {
  const projectId = getActiveProjectId(opts);
  if (!projectId) return false;

  const normalized = normalizeState(state);
  await saveModuleState(MODULE_KEY, normalized, projectId);
  return true;
}

/** =========================
 *  Items (helpers)
 *  ========================= */
export async function getBudgetItems(opts = {}) {
  const st = await getBudgetState(opts);
  return st.items || [];
}

export async function saveBudgetItems(items, opts = {}) {
  const st = await getBudgetState(opts);
  const next = {
    ...st,
    items: Array.isArray(items) ? items : [],
  };
  return await saveBudgetState(next, opts);
}

/** =========================
 *  Secuencia (helpers)
 *  - incrementa y persiste
 *  ========================= */
export async function getNextBudgetSeq(opts = {}) {
  const st = await getBudgetState(opts);
  const nextSeq = (Number.isFinite(Number(st.seq)) ? Number(st.seq) : 0) + 1;

  await saveBudgetState(
    {
      ...st,
      seq: nextSeq,
    },
    opts
  );

  return nextSeq;
}

/** =========================
 *  Reset total
 *  ========================= */
export async function resetBudgetState(opts = {}) {
  return await saveBudgetState({ seq: 0, items: [] }, opts);
}
