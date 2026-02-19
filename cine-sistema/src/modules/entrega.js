/* =========================================================
   src/modules/entrega.js
   MÓDULO ENTREGA (V1 localStorage)

   ✅ AJUSTE QUIRÚRGICO:
   - 7 Ruta Crítica: inserta PDF REAL (bytes) desde rutaCriticaPreview (exportarRutaCriticaPdfBytes)
   - 8 Presupuesto: intenta insertar PDF REAL si existe exportarPresupuestoPdfBytes() en presupuestoPdfExport.js
     (si no existe, deja placeholder con mensaje claro)
   - Fix: al abrir módulo, refresca estado 2 veces (RAF + timeout) para evitar “todo rojo” inicial.

   ✅ NUEVO:
   - Unificar “ancho visual” sin rotar:
     * Mantiene orientación de cada página (portrait/landscape)
     * Normaliza a A4 portrait/landscape según orientación
     * Escala priorizando ancho y ajusta si se pasa de alto

   ✅ NUEVO (mensaje de peso):
   - Al generar el PDF:
     * Si pesa <= 50MB: avisa ✅ y muestra el peso
     * Si pesa > 50MB: avisa ⚠️, muestra el peso y recomienda comprimirlo externamente

   ✅ V2 (AJUSTE QUIRÚRGICO SOLICITADO):
   - Si existe "portada_pdf_final" en Documentación, se inserta AL PRINCIPIO del PDF final.
   - Si existe "respaldo_presupuesto_cartas_cotizaciones" en Documentación, se anexa JUSTO DESPUÉS del Presupuesto.
   - Si no existen, NO se agrega nada (sin placeholders).

   ✅ FIX QUIRÚRGICO (ERROR ACTUAL):
   - Entrega ya no depende solo de localStorage; ahora también lee docs desde
     Supabase Storage (path) + project_state (metadata) como Documentación V2.
========================================================= */

import { supabase } from "../services/supabase.js";

const BUCKET = "uploads";

const MAX_MB = Infinity;
const MAX_BYTES = Infinity;

// ✅ Soft limit solo para mensaje (no bloquea)
const SOFT_LIMIT_MB = 50;
const SOFT_LIMIT_BYTES = SOFT_LIMIT_MB * 1024 * 1024;

const norm = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const LS_BUDGET_ITEMS = "BUDGET_V1_ITEMS"; // de presupuesto.js

// ✅ (compat) si existe
const LS_DOCS_ITEMS = "DOCS_V1_ITEMS";

// Catálogo (en el orden exacto 1..10)
const INSUMOS = [
  { n: 1, id: "resumen", label: "Resumen Ejecutivo", required: true, type: "doc" },
  { n: 2, id: "sinopsis", label: "Sinopsis Desarrollada", required: true, type: "doc" },
  { n: 3, id: "guion", label: "Guion / Argumento Documental", required: true, type: "doc" },
  { n: 4, id: "propuesta", label: "Propuesta Creativa de Dirección", required: true, type: "doc" },
  { n: 5, id: "vision", label: "Visión Técnica y Creativa de Producción", required: true, type: "doc" },
  { n: 6, id: "equipo", label: "Equipo Propuesto", required: true, type: "doc" },
  { n: 7, id: "ruta", label: "Ruta Crítica General (Cronograma)", required: true, type: "system_ruta" },
  { n: 8, id: "ppto", label: "Presupuesto (Reporte)", required: true, type: "system_ppto" },
  { n: 9, id: "soportes", label: "Esquema Financiero (Soportes de Gasto)", required: true, type: "soportes" },
  { n: 10, id: "derechos", label: "Estado de Derechos", required: true, type: "doc_end" },
];

// Variantes para matching (porque en UI puede variar el texto)
const DOC_ALIASES = {
  resumen: ["RESUMEN EJECUTIVO", "RESUMEN_EJECUTIVO", "resumen_ejecutivo"],
  sinopsis: ["SINOPSIS DESARROLLADA", "5.2 SINOPSIS DESARROLLADA", "SINOPSIS_DESARROLLADA", "sinopsis_desarrollada"],
  guion: [
    "GUION / ARGUMENTO DOCUMENTAL",
    "GUION ARGUMENTO DOCUMENTAL",
    "5.3 GUION / ARGUMENTO DOCUMENTAL",
    "GUION_ARGUMENTO_DOCUMENTAL",
    "guion_argumento_documental",
  ],
  propuesta: [
    "PROPUESTA CREATIVA DE DIRECCION",
    "PROPUESTA CREATIVA DE DIRECCIÓN",
    "5.4 PROPUESTA CREATIVA DE DIRECCION",
    "PROPUESTA_CREATIVA_DIRECCION",
    "propuesta_creativa_direccion",
  ],
  vision: [
    "VISION TECNICA Y CREATIVA DE PRODUCCION",
    "VISIÓN TÉCNICA Y CREATIVA DE PRODUCCIÓN",
    "5.5 VISION TECNICA Y CREATIVA DE PRODUCCION",
    "VISION_TECNICA_PRODUCCION",
    "VISION_TECNICA_Y_CREATIVA_DE_PRODUCCION",
    "vision_tecnica_creativa_produccion",
  ],
  equipo: ["EQUIPO PROPUESTO", "5.6 EQUIPO PROPUESTO", "EQUIPO_PROPUESTO", "equipo_propuesto"],
  soportes: [
    "ESQUEMA FINANCIERO (SOPORTES DE GASTO)",
    "ESQUEMA FINANCIERO",
    "SOPORTES DE GASTO",
    "ESQUEMA_FINANCIERO_RATIFICACION",
    "ESQUEMA_FINANCIERO",
    "SOPORTES_GASTO",
    "soportes_gasto",
  ],
  derechos: ["ESTADO DE DERECHOS", "ESTADO_DERECHOS", "estado_derechos"],
};

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderEntregaView() {
  const rows = INSUMOS.map(
    (x) => `
      <tr data-insumo-id="${escapeHtml(x.id)}">
        <td>${x.n}</td>
        <td><b>${escapeHtml(x.label)}</b></td>
        <td class="entrega-status entrega-status--bad">FALTA <span class="muted">-</span></td>
      </tr>
    `
  ).join("");

  return `
    <div class="container" data-route="entrega">
      <div class="card">
        <h2>Entrega</h2>
        <p class="muted">Compila y descarga un PDF único con todos los insumos.</p>

        <div class="table-wrap">
          <table class="table" id="entregaTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Módulo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>

        <div class="row gap">
          <button class="btn" id="entregaBtnCheck">Revisar integridad</button>
          <button class="btn btn-primary" id="entregaBtnRun">ENTREGA (PDF)</button>
        </div>

        <div class="muted small" style="margin-top:8px">
          Nota: si falta un insumo, el sistema aborta y te dice exactamente cuál.
        </div>
      </div>
    </div>
  `;
}

export function bindEntregaEvents() {
  const btnCheck = document.getElementById("entregaBtnCheck");
  const btnRun = document.getElementById("entregaBtnRun");

  // ✅ Fix “todo rojo” al abrir: refresco en RAF + timeout corto
  // ✅ + FIX real: “hidratar” y/o detectar docs antes de pintar
  requestAnimationFrame(() => {
    try {
      ensureDocsHydratedFromAppState();
    } catch (e) {
      console.warn(e);
    }
    try {
      refreshStatusUI();
    } catch (e) {
      console.warn(e);
    }
  });
  setTimeout(() => {
    try {
      ensureDocsHydratedFromAppState();
    } catch (e) {
      console.warn(e);
    }
    try {
      refreshStatusUI();
    } catch (e) {
      console.warn(e);
    }
  }, 120);

  btnCheck?.addEventListener("click", () => {
    try {
      try {
        ensureDocsHydratedFromAppState();
      } catch (e) {
        console.warn(e);
      }
      const status = computeStatus();
      paintStatus(status);
      const missing = firstMissing(status);
      if (missing) alert(`Falta ${missing.label} para completar la entrega`);
      else alert("Integridad OK ✅");
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  btnRun?.addEventListener("click", async () => {
    try {
      try {
        ensureDocsHydratedFromAppState();
      } catch (e) {
        console.warn(e);
      }

      const status = computeStatus();
      paintStatus(status);

      const missing = firstMissing(status);
      if (missing) {
        alert(`Falta ${missing.label} para completar la entrega`);
        return;
      }

      const loader = createEntregaLoader();
      loader.set(2, "Preparando librería PDF…");

      const PDFLib = await loadPdfLib();
      loader.set(6, "Compilando documentos…");

      const bytes = await buildEntregaPdfBytes(PDFLib, status, loader);

      loader.set(95, "Finalizando…");

      const projectName = window?.appState?.project?.name || "Proyecto";
      const date = new Date();
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const filename = `Entrega_Proyecto_${sanitizeFileName(projectName)}_${y}-${m}-${d}.pdf`;

      downloadBytesAsPdf(bytes, filename);

      // ✅ NUEVO: mensaje de peso (no bloquea)
      showPesoMensaje(getByteLength(bytes));

      loader.set(100, "Listo ✅");
      setTimeout(() => loader.close(), 250);
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  function refreshStatusUI() {
    const status = computeStatus();
    paintStatus(status);
  }
}

/* =========================================================
   ✅ FIX QUIRÚRGICO: hidratar docs desde appState/localStorage
   (si Documentación ya fue abierto, ahí vive window.appState.docs)
========================================================= */

function ensureDocsHydratedFromAppState() {
  // Si ya hay docs en window, no hacemos nada
  const existing = window?.appState?.docs;
  if (existing && typeof existing === "object" && Object.keys(existing).length) return;

  // 1) Intentar desde localStorage DOCS_V1_ITEMS (si aún existe)
  try {
    const raw = localStorage.getItem(LS_DOCS_ITEMS);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
      if (!window.appState) window.appState = {};
      window.appState.docs = parsed;
      return;
    }
  } catch {}

  // 2) Intentar localizar docs dentro de appState / project_state (por si alguien lo guardó ahí)
  const app = window?.appState || null;
  const ps =
    app?.project_state ||
    app?.projectState ||
    app?.project_state_cache ||
    window?.project_state ||
    window?.projectState ||
    null;

  const candidates = [
    app?.docs,
    app?.documentacion,
    app?.documentation,
    app?.modules?.documentacion,
    app?.modules?.docs,
    app?.state?.documentacion,
    app?.state?.docs,
    ps?.documentacion,
    ps?.docs,
    ps?.modules?.documentacion,
    ps?.modules?.docs,
    ps?.state?.documentacion,
    ps?.state?.docs,
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && typeof c === "object" && Object.keys(c).length) {
      if (!window.appState) window.appState = {};
      window.appState.docs = c;
      try {
        localStorage.setItem(LS_DOCS_ITEMS, JSON.stringify(c));
      } catch {}
      return;
    }
  }

  // 3) ✅ V2 (Producción): si el usuario entra directo a Entrega,
  // todavía NO se ha abierto el módulo Documentación, por lo que window.appState.docs
  // no existe. En ese caso, hidratamos desde project_state (Supabase) en background.
  // NOTA: no esperamos (sync). Entrega ya hace refresh 2 veces; en el segundo
  // refresh normalmente ya está hidratado.
  try {
    if (window.__docsHydratePromise) return;

    const userId =
      window?.appState?.user?.uid ||
      window?.appState?.user?.id ||
      window?.appState?.auth?.user?.id ||
      null;

    const projectId =
      window?.appState?.profile?.projectId ||
      window?.appState?.project?.id ||
      window?.appState?.projectId ||
      window?.appState?.project?.project_id ||
      null;

    if (!userId || !projectId) return;

    window.__docsHydratePromise = (async () => {
      try {
        const mod = await import("../services/stateService.js");
        const loadModuleState = mod?.loadModuleState;
        if (typeof loadModuleState !== "function") return;

        const cloud = await loadModuleState({ userId, projectId, moduleKey: "documentacion" });
        if (cloud && typeof cloud === "object" && Object.keys(cloud).length) {
          if (!window.appState) window.appState = {};
          window.appState.docs = cloud;
          try {
            localStorage.setItem(LS_DOCS_ITEMS, JSON.stringify(cloud));
          } catch {}
        }
      } catch (e) {
        console.warn("[entrega] No se pudo hidratar Documentación desde servidor:", e);
      }
    })();
  } catch {}
}

/* =========================================================
   STATUS: detección de insumos
========================================================= */

function computeStatus() {
  // 1) Detectar documentos de documentación (robusto)
  const docsIndex = scanLocalStorageForDocsIndex();

  const out = {};
  for (const ins of INSUMOS) {
    if (ins.type === "doc" || ins.type === "doc_end") {
      const hit = findDocByAliases(docsIndex, DOC_ALIASES[ins.id] || [ins.label]);
      out[ins.id] = {
        ...ins,
        ok: !!hit,
        detail: hit ? (hit.fileName ? hit.fileName : "con archivo") : "sin archivo",
        doc: hit || null,
      };
      continue;
    }

    if (ins.type === "system_ruta") {
      out[ins.id] = { ...ins, ok: true, detail: "generado por sistema" };
      continue;
    }

    if (ins.type === "system_ppto") {
      const count = countBudgetItems();
      out[ins.id] = { ...ins, ok: count > 0, detail: count > 0 ? `${count} partidas` : "0 partidas" };
      continue;
    }

    if (ins.type === "soportes") {
      const hit = findDocByAliases(docsIndex, DOC_ALIASES[ins.id] || [ins.label]);
      out[ins.id] = {
        ...ins,
        ok: !!hit,
        detail: hit ? (hit.fileName ? hit.fileName : "con archivo") : "sin archivo",
        doc: hit || null,
      };
      continue;
    }

    out[ins.id] = { ...ins, ok: false, detail: "sin archivo" };
  }

  return out;
}

function firstMissing(status) {
  for (const ins of INSUMOS) {
    const s = status[ins.id];
    if (s?.required && !s?.ok) return s;
  }
  return null;
}

function paintStatus(status) {
  const table = document.getElementById("entregaTable");
  if (!table) return;

  for (const ins of INSUMOS) {
    const row = table.querySelector(`tr[data-insumo-id="${CSS.escape(ins.id)}"]`);
    if (!row) continue;

    const cell = row.querySelector(".entrega-status");
    if (!cell) continue;

    const s = status[ins.id];
    if (!s) continue;

    if (s.ok) {
      cell.classList.remove("entrega-status--bad");
      cell.classList.add("entrega-status--ok");
      cell.innerHTML = `OK <span class="muted">${escapeHtml(s.detail || "")}</span>`;
    } else {
      cell.classList.remove("entrega-status--ok");
      cell.classList.add("entrega-status--bad");
      cell.innerHTML = `FALTA <span class="muted">${escapeHtml(s.detail || "")}</span>`;
    }
  }
}

/* =========================================================
   SCAN ROBUSTO: localizar docs en localStorage + window.appState
   ✅ FIX: ahora reconoce Documentación V2 (metadata con `path`)
========================================================= */

function scanLocalStorageForDocsIndex() {
  const index = [];

  // ✅ intentar hidratar docs desde appState antes de escanear
  try {
    ensureDocsHydratedFromAppState();
  } catch {}

  // 1) Escanear localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;

    const raw = localStorage.getItem(k);
    if (!raw) continue;

    const firstChar = raw.trim()[0];
    if (firstChar !== "{" && firstChar !== "[") continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const extracted = extractDocEntriesFromUnknownShape(parsed, k);
    for (const e of extracted) index.push(e);
  }

  // 2) Escanear window candidates
  try {
    const candidates = [
      window?.appState?.docs,
      window?.docs,
      window?.appState,
      window?.appState?.project_state,
      window?.appState?.projectState,
      window?.appState?.modules,
      window?.appState?.modules?.documentacion,
      window?.appState?.state,
      window?.appState?.state?.documentacion,
      window?.project_state,
      window?.projectState,
    ].filter(Boolean);

    for (const c of candidates) {
      const extracted = extractDocEntriesFromUnknownShape(c, "window");
      for (const e of extracted) index.push(e);
    }
  } catch {}

  return index;
}

function extractDocEntriesFromUnknownShape(parsed, sourceKey) {
  const out = [];

  const pushIfDocish = (obj, parentKey = "") => {
    if (!obj || typeof obj !== "object") return;

    const fileName =
      obj.fileName || obj.filename || obj.name || obj.nombreArchivo || obj.originalName || obj.originalname || "";

    const title =
      obj.title || obj.titulo || obj.documento || obj.docName || obj.nombre || obj.label || obj.descripcion || "";

    const code =
      obj.code || obj.codigo || obj.id || obj.key || obj.slug || parentKey || "";

    const mime = obj.mime || obj.mimetype || obj.type || obj.contentType || "";

    // ✅ dataUrl/url/blob/base64 (V1)
    const dataUrl =
      obj.dataUrl || obj.dataURL || obj.url || obj.blobUrl || obj.base64 || obj.data || obj.content || "";

    // ✅ path (V2 Supabase Storage)
    const path = obj.path || obj.storagePath || obj.storage_path || obj.keyPath || obj.filePath || "";

    const updatedAt = obj.updatedAt || obj.updated || obj.lastModified || obj.ts || obj.timestamp || null;

    const looksLikeDoc =
      (fileName || title || code) &&
      (
        (typeof dataUrl === "string" && dataUrl.length > 10) ||
        (typeof path === "string" && path.length > 3)
      );

    if (!looksLikeDoc) return;

    out.push({
      sourceKey,
      code,
      title,
      fileName,
      mime,
      dataUrl,
      path,
      updatedAt,
      raw: obj,
    });
  };

  const walk = (node, parentKey = "") => {
    if (!node) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], parentKey);
      return;
    }

    if (typeof node !== "object") return;

    // Si parece entry directa:
    pushIfDocish(node, parentKey);

    // Si es objeto de "store" (key->entry)
    for (const [k, v] of Object.entries(node)) {
      if (!v) continue;
      if (typeof v === "object") {
        pushIfDocish(v, k);
        walk(v, k);
      }
    }
  };

  walk(parsed, "");
  return out;
}

function findDocByAliases(index, aliases) {
  const want = (aliases || []).map(norm);
  for (const entry of index) {
    const hay = [
      entry?.title,
      entry?.code,
      entry?.fileName,
      entry?.raw?.key,
      entry?.raw?.id,
      entry?.raw?.slug,
    ]
      .filter(Boolean)
      .map(norm);

    for (const w of want) {
      if (!w) continue;
      if (hay.some((h) => h.includes(w) || w.includes(h))) return entry;
    }
  }
  return null;
}

function countBudgetItems() {
  // 0) cache en memoria (hidratada desde servidor)
  try {
    const cached = window.__budgetItemsCache;
    if (Array.isArray(cached)) return cached.length;
    if (cached && typeof cached === "object" && Array.isArray(cached.items)) return cached.items.length;
  } catch {}

  // 1) intentar desde appState (si alguien lo dejó ahí)
  try {
    const app = window?.appState || {};
    const candidates = [
      app?.modules?.presupuesto,
      app?.state?.presupuesto,
      app?.presupuesto,
      app?.project_state?.presupuesto,
      app?.projectState?.presupuesto,
    ].filter(Boolean);

    for (const c of candidates) {
      if (Array.isArray(c?.items)) return c.items.length;
    }
  } catch {}

  // 2) fallback legacy: localStorage
  try {
    const raw = localStorage.getItem(LS_BUDGET_ITEMS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.length;
      if (arr && typeof arr === "object" && Array.isArray(arr.items)) return arr.items.length;
    }
  } catch {}

  // 3) ✅ V2 (Producción): si Entrega se abre antes de Presupuesto,
  // aún no hay localStorage ni DOM; hidratamos desde project_state en background.
  try {
    if (!window.__budgetHydratePromise) {
      const userId =
        window?.appState?.user?.uid ||
        window?.appState?.user?.id ||
        window?.appState?.auth?.user?.id ||
        null;

      const projectId =
        window?.appState?.profile?.projectId ||
        window?.appState?.project?.id ||
        window?.appState?.projectId ||
        window?.appState?.project?.project_id ||
        null;

      if (userId && projectId) {
        window.__budgetHydratePromise = (async () => {
          try {
            const mod = await import("../services/stateService.js");
            const loadModuleState = mod?.loadModuleState;
            if (typeof loadModuleState !== "function") return;

            const cloud = await loadModuleState({ userId, projectId, moduleKey: "presupuesto" });
            const items = Array.isArray(cloud?.items) ? cloud.items : [];
            window.__budgetItemsCache = items;

            // opcional: dejar respaldo local para compat
            try {
              localStorage.setItem(LS_BUDGET_ITEMS, JSON.stringify({ items }));
            } catch {}
          } catch (e) {
            console.warn("[entrega] No se pudo hidratar Presupuesto desde servidor:", e);
          }
        })();
      }
    }
  } catch {}

  return 0;
}

/* =========================================================
   PDF: loader + helpers
========================================================= */

function createEntregaLoader() {
  const el = document.createElement("div");
  el.className = "modal-overlay";
  el.innerHTML = `
    <div class="modal">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="spinner"></div>
        <div style="flex:1">
          <div style="font-weight:700">Generando PDF final…</div>
          <div class="muted small" id="entregaLoaderMsg">Iniciando…</div>
          <div class="progress" style="margin-top:10px">
            <div class="progress-bar" id="entregaLoaderBar" style="width:2%"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  return {
    set(p, msg) {
      const bar = el.querySelector("#entregaLoaderBar");
      const m = el.querySelector("#entregaLoaderMsg");
      if (bar) bar.style.width = `${Math.max(2, Math.min(100, p))}%`;
      if (m) m.textContent = msg || "";
    },
    close() {
      el.remove();
    },
  };
}

async function loadPdfLib() {
  // Lazy load desde CDN para evitar que el bundle truene al iniciar
  const mod = await import("https://esm.sh/pdf-lib@1.17.1");
  return mod;
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function downloadBytesAsPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "Entrega.pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getByteLength(u8) {
  try {
    return u8?.byteLength || 0;
  } catch {
    return 0;
  }
}

function humanMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function showPesoMensaje(bytes) {
  if (!bytes) return;
  const mb = bytes / (1024 * 1024);
  if (mb <= SOFT_LIMIT_MB) {
    alert(`PDF generado ✅\nPeso aproximado: ${humanMB(bytes)} MB`);
  } else {
    alert(`PDF generado ⚠️\nPeso aproximado: ${humanMB(bytes)} MB\nRecomendación: comprímelo externamente si la convocatoria lo requiere.`);
  }
}

/* =========================================================
   ✅ NUEVO: helpers para bytes desde V1 (dataUrl) o V2 (Storage path)
========================================================= */

async function entryToBytes(docEntry) {
  if (!docEntry) return null;

  // Prefer dataUrl/url/blob
  if (docEntry.dataUrl) {
    return await dataUrlToBytes(docEntry.dataUrl);
  }

  // Supabase Storage path (Documentación V2)
  const path = docEntry.path || "";
  if (path && supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
    if (error || !data?.signedUrl) throw new Error("No se pudo leer el archivo desde Storage.");
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error("No se pudo descargar el archivo desde Storage.");
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  // Último recurso: intentar fetch directo si hay url
  if (docEntry.url) {
    const res = await fetch(docEntry.url);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  return null;
}

function isPdfEntry(docEntry) {
  const mime = (docEntry?.mime || "").toLowerCase();
  const name = (docEntry?.fileName || "").toLowerCase();
  const dataUrl = docEntry?.dataUrl || "";
  if (isPdfDataUrl(dataUrl, mime)) return true;
  if (mime.includes("pdf")) return true;
  if (name.endsWith(".pdf")) return true;
  return false;
}

function isPngEntry(docEntry) {
  const mime = (docEntry?.mime || "").toLowerCase();
  const name = (docEntry?.fileName || "").toLowerCase();
  const dataUrl = docEntry?.dataUrl || "";
  if ((dataUrl || "").startsWith("data:image/png")) return true;
  if (mime.includes("png")) return true;
  if (name.endsWith(".png")) return true;
  return false;
}

function isJpgEntry(docEntry) {
  const mime = (docEntry?.mime || "").toLowerCase();
  const name = (docEntry?.fileName || "").toLowerCase();
  const dataUrl = docEntry?.dataUrl || "";
  if ((dataUrl || "").startsWith("data:image/jpeg") || (dataUrl || "").startsWith("data:image/jpg")) return true;
  if (mime.includes("jpeg") || mime.includes("jpg")) return true;
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return true;
  return false;
}

/* =========================================================
   PDF assembly (mantener orientación + mismo ancho visual)
========================================================= */

function isPdfDataUrl(dataUrl, mime = "") {
  if ((mime || "").toLowerCase().includes("pdf")) return true;
  return (dataUrl || "").startsWith("data:application/pdf");
}

function getA4ForOrientation(w, h) {
  // puntos (72dpi): A4 portrait = 595.28 x 841.89
  const A4P = { w: 595.28, h: 841.89 };
  const A4L = { w: 841.89, h: 595.28 };
  return w >= h ? A4L : A4P;
}

async function addPdfKeepOrientationSameWidth(outDoc, PDFLib, srcDoc) {
  const { PDFDocument } = PDFLib;

  const pages = srcDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const size = p.getSize();
    const target = getA4ForOrientation(size.width, size.height);

    const [embedded] = await outDoc.embedPages([p]);

    const newPage = outDoc.addPage([target.w, target.h]);

    const marginX = 18;
    const marginTop = 18;
    const marginBottom = 18;

    const maxW = target.w - marginX * 2;
    const maxH = target.h - (marginTop + marginBottom);

    let scale = Math.min(maxW / size.width, 1);
    if (size.height * scale > maxH) scale = maxH / size.height;

    const drawW = size.width * scale;
    const drawH = size.height * scale;

    const x = (target.w - drawW) / 2;
    const y = (target.h - drawH) / 2;

    newPage.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
  }
}

async function addImageKeepOrientationSameWidth(outDoc, PDFLib, imgEmbed, label, fontBold, fontRegular) {
  const { rgb } = PDFLib;

  const imgW = imgEmbed.width;
  const imgH = imgEmbed.height;

  const target = getA4ForOrientation(imgW, imgH);
  const page = outDoc.addPage([target.w, target.h]);

  const marginX = 18;
  const marginTop = 22;
  const marginBottom = 18;

  if (label) {
    page.drawText(label, {
      x: marginX,
      y: target.h - 18,
      size: 13,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
  }

  const maxW = target.w - marginX * 2;
  const maxH = target.h - (marginTop + marginBottom);

  let scale = Math.min(maxW / imgW, 1);
  if (imgH * scale > maxH) scale = maxH / imgH;

  const drawW = imgW * scale;
  const drawH = imgH * scale;

  const x = (target.w - drawW) / 2;
  const y = (target.h - drawH) / 2 - 10;

  page.drawImage(imgEmbed, { x, y, width: drawW, height: drawH });
}

/* =========================================================
   ✅ NUEVO (quirúrgico): helper para insertar doc opcional
========================================================= */
async function appendOptionalDocToOut(outDoc, PDFLib, PDFDocument, docEntry) {
  const bytes = await entryToBytes(docEntry);
  if (!bytes) return false;

  // PDF
  if (isPdfEntry(docEntry)) {
    const src = await PDFDocument.load(bytes);
    await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
    return true;
  }

  // Imagen
  const imgBytes = await ensureJpegBytes(bytes, docEntry.dataUrl || "", docEntry.mime || "");
  const jpg = await outDoc.embedJpg(imgBytes);
  await addImageKeepOrientationSameWidth(
    outDoc,
    PDFLib,
    jpg,
    "",
    await outDoc.embedFont(PDFLib.StandardFonts.HelveticaBold),
    await outDoc.embedFont(PDFLib.StandardFonts.Helvetica)
  );
  return true;
}

async function buildEntregaPdfBytes(PDFLib, status, loader) {
  const { PDFDocument, StandardFonts } = PDFLib;

  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);

  // ====== OPCIONALES V2 (quirúrgico) ======
  // Portada: si existe "portada_pdf_final" en Documentación -> AL PRINCIPIO
  const docsIndex = scanLocalStorageForDocsIndex();
  const portadaEntry = findDocByAliases(docsIndex, ["PORTADA", "PORTADA PDF FINAL", "portada_pdf_final"]);
  if (portadaEntry) {
    try {
      loader?.set?.(8, "Insertando portada…");
      await appendOptionalDocToOut(outDoc, PDFLib, PDFDocument, portadaEntry);
    } catch (e) {
      console.warn("No se pudo insertar portada:", e);
    }
  }

  // ====== ORDEN 1..10 ======
  let step = 10;

  for (const ins of INSUMOS) {
    const s = status[ins.id];

    // Docs normales
    if (ins.type === "doc" || ins.type === "doc_end" || ins.type === "soportes") {
      loader?.set?.(step, `Insertando: ${ins.label}…`);
      step += 6;

      const docEntry = s?.doc;
      if (!docEntry) throw new Error(`Falta ${ins.label}`);

      const bytes = await entryToBytes(docEntry);
      if (!bytes) throw new Error(`No se pudo leer: ${ins.label}`);

      if (isPdfEntry(docEntry)) {
        const src = await PDFDocument.load(bytes);
        await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
      } else {
        // Imagen -> convertir a JPG para compresión
        const jpgBytes = await ensureJpegBytes(bytes, docEntry.dataUrl || "", docEntry.mime || "");
        const jpg = await outDoc.embedJpg(jpgBytes);
        await addImageKeepOrientationSameWidth(outDoc, PDFLib, jpg, ins.label, fontBold, font);
      }

      continue;
    }

    // Ruta Crítica (generado por sistema)
    if (ins.type === "system_ruta") {
      loader?.set?.(step, "Insertando: Ruta Crítica…");
      step += 6;

      // Import lazy (para evitar romper inicial)
      const mod = await import("../services/rutaCriticaPreview.js");
      if (!mod?.exportarRutaCriticaPdfBytes) throw new Error("No se encontró exportarRutaCriticaPdfBytes()");
      const rutaBytes = await mod.exportarRutaCriticaPdfBytes();
      const src = await PDFDocument.load(rutaBytes);
      await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
      continue;
    }

    // Presupuesto (generado por sistema)
    if (ins.type === "system_ppto") {
      loader?.set?.(step, "Insertando: Presupuesto…");
      step += 6;

      let pptoBytes = null;
      try {
        const mod = await import("../services/presupuestoPdfExport.js");
        if (mod?.exportarPresupuestoPdfBytes) {
          pptoBytes = await mod.exportarPresupuestoPdfBytes();
        }
      } catch (e) {
        console.warn("No se pudo generar Presupuesto bytes:", e);
      }

      if (pptoBytes) {
        const src = await PDFDocument.load(pptoBytes);
        await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
      } else {
        // Placeholder claro si no hay bytes
        const page = outDoc.addPage([595.28, 841.89]);
        page.drawText("PRESUPUESTO: No se pudo generar el PDF automáticamente.", { x: 40, y: 780, size: 14, font: fontBold });
        page.drawText("Revisa que exportarPresupuestoPdfBytes() exista y funcione.", { x: 40, y: 758, size: 11, font });
      }

      // ✅ V2: respaldo_presupuesto_cartas_cotizaciones va justo después del Presupuesto
      const respaldoEntry = findDocByAliases(docsIndex, [
        "RESPALDO PRESUPUESTO",
        "CARTAS COMPROMISO",
        "COTIZACIONES",
        "respaldo_presupuesto_cartas_cotizaciones",
      ]);
      if (respaldoEntry) {
        try {
          loader?.set?.(step, "Anexando cartas/cotizaciones…");
          await appendOptionalDocToOut(outDoc, PDFLib, PDFDocument, respaldoEntry);
        } catch (e) {
          console.warn("No se pudo anexar respaldo_presupuesto_cartas_cotizaciones:", e);
        }
      }

      continue;
    }
  }

  loader?.set?.(92, "Comprimiendo y guardando…");
  const bytes = await outDoc.save({ useObjectStreams: true }); // compresión interna básica
  if (bytes.byteLength > MAX_BYTES) throw new Error(`PDF excede límite (${humanMB(bytes.byteLength)} MB)`);
  return bytes;
}

/* =========================================================
   Bytes helpers
========================================================= */

async function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl === "string" && dataUrl.startsWith("blob:")) {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  const m = (dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function dataUrlMime(dataUrl){ const m=(dataUrl||"").match(/^data:([^;]+);base64,/i); return m?m[1]:""; }

// Convierte PNG->JPEG con compresión para bajar peso (si es imagen)
async function ensureJpegBytes(bytes, dataUrl, mimeHint = "") {
  const mime = (mimeHint || dataUrlMime(dataUrl) || "").toLowerCase();
  if (
    (dataUrl || "").startsWith("data:image/jpeg") ||
    (dataUrl || "").startsWith("data:image/jpg") ||
    mime.includes("jpeg") ||
    mime.includes("jpg")
  ) {
    return bytes;
  }

  try {
    const blob = new Blob([bytes]);
    const img = await blobToImage(blob);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const outBlob = await canvasToJpegBlob(canvas, 0.72);
    const buf = await outBlob.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.warn("No se pudo convertir a JPG, se deja original:", e);
    return bytes;
  }
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

