/* =========================================================
   src/services/presupuestoPdfExport.js

   ✅ Exporta:
   - exportarPresupuestoPDF(): abre vista previa con botón imprimir (como ya lo tienes)
   - exportarPresupuestoPdfBytes(): genera PDF EN MEMORIA (Uint8Array) para que Entrega lo anexe
     (NO depende de html2pdf en window)

   ✅ AJUSTE QUIRÚRGICO (SOLICITADO):
   - En el export final (exportarPresupuestoPdfBytes) NO debe aparecer el botón "EXPORTAR PDF"
   - En la vista previa (exportarPresupuestoPDF) SÍ debe aparecer

   ✅ V2 (NUEVO AJUSTE QUIRÚRGICO):
   - Si existe logo en Documentación (key: logo_proyecto), se coloca en tamaño decente
     arriba-derecha EN CADA PÁGINA del PDF exportado (Presupuesto).
   - Soporta:
     * V1: dataUrl/base64/url en localStorage
     * V2: path en Supabase Storage (bucket uploads)
========================================================= */

import { supabase } from "./supabase.js";
import { loadModuleState } from "./stateService.js";

const BASE = { PREPRODUCCION: 1000, PRODUCCION: 2000, POSTPRODUCCION: 4000 };
const STEP = 100;

// ✅ fallback a localStorage cuando NO existe el DOM del módulo Presupuesto (ej. desde Entrega)
const LS_KEY = "BUDGET_V1_ITEMS";

/** Orden cerrado (lista cerrada) */
const ORDEN_CUENTAS = [
  "DESARROLLO",
  "PREPRODUCCIÓN",
  "PERSONAL DE DIRECCIÓN",
  "PERSONAL DE CÁMARA",
  "PERSONAL DE ARTE",
  "PERSONAL DE SONIDO",
  "PERSONAL DE DATA MANAGER",
  "PERSONAL FOTO FIJA Y MAKING OF",
  "REPARTO",
  "EQUIPO DE CÁMARA",
  "EQUIPO DE SONIDO",
  "GASTOS DE DISEÑO DE PRODUCCIÓN",
  "LOCACIONES",
  "TRANSPORTE RODAJE",
  "ALIMENTACIÓN",
  "HOSPEDAJE",
  "GASTOS EXTRA DE PRODUCCIÓN",
  "GASTOS CONTABLES",
  "GASTOS LEGALES",
  "EDICIÓN",
  "POSTPRODUCCIÓN DE SONIDO",
  "POSTPRODUCCIÓN DE IMAGEN",
  "CRÉDITOS",
  "SUBTÍTULOS",
  "PRESS KIT",
  "DELIVERIES",
  "RESGUARDO Y PROMOCIÓN IMCINE",
  "PÓLIZA DE SEGURO",
  "CIERRE ADMINISTRATIVO FOCINE 2027",
];

/** Colores aproximados */
const COLORS = {
  etapa: {
    PREPRODUCCION: { bg: "#F8C9D1", fg: "#B00020" },
    PRODUCCION: { bg: "#6AA84F", fg: "#000000" },
    POSTPRODUCCION: { bg: "#B4A7D6", fg: "#000000" },
  },
  cuenta: {
    PRE_BLOQUE: { bg: "#3C78D8", fg: "#000000" },
    PROD_BLOQUE: { bg: "#B4A7D6", fg: "#000000" },
    POST_BLOQUE: { bg: "#F4CCCC", fg: "#000000" },
  },
  subtotal: { bg: "#46BEC6", fg: "#000000" },
  totalHighlight: { bg: "#00FF00", fg: "#000000" },
};

const norm = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function normalizeEtapa(raw) {
  const s = norm(raw).replace(/-/g, " ");
  if (s === "PREPRODUCCION" || s === "PRE PRODUCCION") return "PREPRODUCCION";
  if (s === "PRODUCCION") return "PRODUCCION";
  if (s === "POSTPRODUCCION" || s === "POST PRODUCCION") return "POSTPRODUCCION";
  return null;
}

function toNum(v) {
  const n = Number((v ?? "").toString().replace(/,/g, "").replace(/\$/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function money(n) {
  return Number(n || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function etapaRank(etapa) {
  return etapa === "PREPRODUCCION" ? 1 : etapa === "PRODUCCION" ? 2 : 3;
}

function pickCuentaColorKey(etapa) {
  if (etapa === "PREPRODUCCION") return "PRE_BLOQUE";
  if (etapa === "POSTPRODUCCION") return "POST_BLOQUE";
  return "PROD_BLOQUE";
}

function labelEtapa(etapa) {
  if (etapa === "PREPRODUCCION") return "PREPRODUCCIÓN";
  if (etapa === "POSTPRODUCCION") return "POST-PRODUCCIÓN";
  return "PRODUCCIÓN";
}

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   ✅ LOGO (V1 + V2):
   - Espera key: logo_proyecto dentro de DOCS_V1_ITEMS (V1) o project_state/documentacion (V2)
========================================================= */
const DOCS_LS_KEY = "DOCS_V1_ITEMS";
const BUCKET = "uploads";

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function getAuthCtx() {
  try {
    // ✅ App V2 (como en los módulos): window.appState.user.uid + window.appState.profile.projectId
    const userId =
      window?.appState?.user?.uid ||
      window?.appState?.user?.id ||
      window?.appState?.auth?.user?.id ||
      null;

    const projectId =
      window?.appState?.profile?.projectId ||
      window?.appState?.project?.id ||
      window?.appState?.project?.project_id ||
      window?.appState?.projectId ||
      window?.appState?.project?.key ||
      null;

    if (userId && projectId) return { userId, projectId };

    // ✅ Fallback: auth.getUser() si existe
    if (supabase?.auth?.getUser) {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id || null;

      const pid =
        projectId ||
        window?.appState?.profile?.projectId ||
        window?.appState?.project?.id ||
        window?.appState?.projectId ||
        null;

      if (uid && pid) return { userId: uid, projectId: pid };
    }
  } catch {}
  return { userId: null, projectId: null };
}

async function readLogoDataUrlFromDocs() {
  // 1) Primero: Supabase (project_state -> module_key: "documentacion")
  try {
    const { userId, projectId } = await getAuthCtx();
    if (userId && projectId) {
      const docState = await loadModuleState({ userId, projectId, moduleKey: "documentacion" });
      const entry = docState?.logo_proyecto;

      if (entry && typeof entry === "object") {
        // ✅ V1: dataUrl/base64/url
        const dataUrl = entry?.dataUrl || entry?.dataURL || entry?.url || entry?.base64 || null;
        if (typeof dataUrl === "string" && dataUrl.length > 20) return dataUrl;

        // ✅ V2: path en Storage (bucket uploads)
        const path = entry?.path || entry?.storagePath || entry?.storage_path || null;
        if (typeof path === "string" && path.length > 3 && supabase) {
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
          if (!error && data?.signedUrl) {
            const res = await fetch(data.signedUrl);
            if (res.ok) {
              const blob = await res.blob();
              const du = await blobToDataUrl(blob);
              if (du) return du;
            }
          }
        }
      }
    }
  } catch {}

  // 2) Fallback: localStorage (V1)
  try {
    const raw = localStorage.getItem(DOCS_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entry = parsed?.logo_proyecto;
    if (!entry || typeof entry !== "object") return null;
    const dataUrl = entry?.dataUrl || entry?.dataURL || entry?.url || entry?.base64 || null;
    if (typeof dataUrl === "string" && dataUrl.length > 20) return dataUrl;
  } catch {}

  return null;
}

function dataUrlMime(dataUrl) {
  const m = (dataUrl || "").match(/^data:([^;]+);base64,/i);
  return m ? m[1].toLowerCase() : "";
}

async function loadImageFromDataUrl(dataUrl) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

function computeLogoDrawSize(imgWpx, imgHpx, maxWpt, maxHpt) {
  // Conserva proporción. Entrada px, salida pt (relación no importa, solo ratio)
  let w = maxWpt;
  let h = (imgHpx / imgWpx) * w;
  if (h > maxHpt) {
    h = maxHpt;
    w = (imgWpx / imgHpx) * h;
  }
  return { w, h };
}

/** =========================================================
 *  ✅ QUÍRÚRGICO: inserta logo arriba-derecha
 *  - No tapa contenido: reservamos headerHeight adicional en el margen superior
 *  ========================================================= */
function stampLogoOnPage(pdf, imgData, logoWpt, logoHpt, opts = {}) {
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = opts.margin ?? 18;
  const topInset = opts.topInset ?? 10;
  const x = pageW - margin - logoWpt;
  const y = margin - topInset;
  pdf.addImage(imgData, opts.format || "PNG", x, Math.max(6, y), logoWpt, logoHpt, undefined, "FAST");
}


// ✅ leer desde servidor (project_state) cuando Presupuesto ya no vive en localStorage (V2)
async function readItemsFromServerState() {
  try {
    const { userId, projectId } = await getAuthCtx();
    if (!userId || !projectId) return [];

    const state = await loadModuleState({ userId, projectId, moduleKey: "presupuesto" });
    const arr = Array.isArray(state?.items) ? state.items : [];
    if (!arr.length) return [];

    // Normaliza al mismo shape que el lector DOM/LS
    const items = arr.map((it, i) => {
      const etapa = normalizeEtapa(it?.etapa);
      const concepto = (it?.concepto || "").toString().trim();
      const cuentaNombre = (it?.cuenta || it?.cuentaNombre || "").toString().trim();

      const entidadRaw = (it?.entidad || "").toString().trim().toUpperCase();
      const entidad =
        entidadRaw === "INTERNO" ? "PROPIAS" : entidadRaw === "PROPIA" ? "PROPIAS" : entidadRaw;

      const forma = (it?.formaPago || it?.forma || "").toString().trim().toUpperCase();
      const tipo = (it?.tipoPago || it?.tipo || "").toString().trim().toUpperCase();

      const monto = Number.isFinite(Number(it?.monto)) ? Number(it.monto) : toNum(it?.monto);
      const cantidad = Number.isFinite(Number(it?.cantidad)) ? Number(it.cantidad) : toNum(it?.cantidad);
      const plazo = Number.isFinite(Number(it?.plazo)) ? Number(it.plazo) : toNum(it?.plazo);
      const subtotal = Number.isFinite(Number(it?.subtotal)) ? Number(it.subtotal) : toNum(it?.subtotal);
      const iva = Number.isFinite(Number(it?.iva)) ? Number(it.iva) : toNum(it?.iva);
      const total = Number.isFinite(Number(it?.total)) ? Number(it.total) : toNum(it?.total);

      if (!etapa) return { __error: `Registro #${i + 1}: Etapa inválida "${it?.etapa}".` };
      if (!concepto) return { __error: `Registro #${i + 1}: falta Concepto.` };
      if (!cuentaNombre) return { __error: `Registro #${i + 1}: falta Cuenta.` };

      if (![monto, cantidad, plazo, subtotal, iva, total].every(Number.isFinite)) {
        return { __error: `Registro #${i + 1}: números inválidos en "${concepto}" (${cuentaNombre}).` };
      }

      return { etapa, concepto, cuentaNombre, entidad, forma, tipo, monto, cantidad, plazo, subtotal, iva, total };
    });

    const errors = items.filter((x) => x && x.__error).map((x) => x.__error);
    if (errors.length) throw new Error(errors.join("\n"));
    return items;
  } catch (e) {
    // si falla servidor, devolvemos [] para que caller haga fallback DOM/LS
    return [];
  }
}

// ✅ leer desde localStorage si no hay DOM del presupuesto
function readItemsFromLocalStorage() {
  let raw = null;
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch {
    raw = null;
  }

  const arr = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(arr) || !arr.length) return [];

  const items = arr.map((it, i) => {
    const etapa = normalizeEtapa(it?.etapa);
    const concepto = (it?.concepto || "").toString().trim();
    const cuentaNombre = (it?.cuenta || it?.cuentaNombre || "").toString().trim();

    // 🔧 Map quirúrgico para que aporte "PROPIAS" en vez de "INTERNO"
    const entidadRaw = (it?.entidad || "").toString().trim().toUpperCase();
    const entidad =
      entidadRaw === "INTERNO"
        ? "PROPIAS"
        : entidadRaw === "PROPIA"
        ? "PROPIAS"
        : entidadRaw;

    const forma = (it?.formaPago || it?.forma || "").toString().trim().toUpperCase();
    const tipo = (it?.tipoPago || it?.tipo || "").toString().trim().toUpperCase();

    const monto = Number.isFinite(Number(it?.monto)) ? Number(it.monto) : toNum(it?.monto);
    const cantidad = Number.isFinite(Number(it?.cantidad)) ? Number(it.cantidad) : toNum(it?.cantidad);
    const plazo = Number.isFinite(Number(it?.plazo)) ? Number(it.plazo) : toNum(it?.plazo);
    const subtotal = Number.isFinite(Number(it?.subtotal)) ? Number(it.subtotal) : toNum(it?.subtotal);
    const iva = Number.isFinite(Number(it?.iva)) ? Number(it.iva) : toNum(it?.iva);
    const total = Number.isFinite(Number(it?.total)) ? Number(it.total) : toNum(it?.total);

    if (!etapa) return { __error: `Registro #${i + 1}: Etapa inválida "${it?.etapa}".` };
    if (!concepto) return { __error: `Registro #${i + 1}: falta Concepto.` };
    if (!cuentaNombre) return { __error: `Registro #${i + 1}: falta Cuenta.` };

    if (![monto, cantidad, plazo, subtotal, iva, total].every(Number.isFinite)) {
      return { __error: `Registro #${i + 1}: números inválidos en "${concepto}" (${cuentaNombre}).` };
    }

    return { etapa, concepto, cuentaNombre, entidad, forma, tipo, monto, cantidad, plazo, subtotal, iva, total };
  });

  const errors = items.filter((x) => x && x.__error).map((x) => x.__error);
  if (errors.length) throw new Error(errors.join("\n"));

  return items;
}

/** =========================================================
 *  1) Leer items del DOM
 *     A) .ppto-item (si existiera)
 *     B) Tabla de "Desglose" (TU CASO ACTUAL)
 *  ========================================================= */
function readItemsFromDOM() {
  const nodes = Array.from(document.querySelectorAll(".ppto-item"));
  if (nodes.length) {
    const itemsA = nodes.map((n, i) => {
      const etapa = normalizeEtapa(n.dataset.etapa);
      const concepto = (n.dataset.concepto || "").trim();
      const cuentaNombre = (n.dataset.cuenta || "").trim();

      const entidad = (n.dataset.entidad || "").trim().toUpperCase();
      const forma = (n.dataset.formaDePago || "").trim().toUpperCase();
      const tipo = (n.dataset.tipoDePago || "").trim().toUpperCase();

      const monto = toNum(n.dataset.monto);
      const cantidad = toNum(n.dataset.cantidad);
      const plazo = toNum(n.dataset.plazo);
      const subtotal = toNum(n.dataset.subtotal);
      const iva = toNum(n.dataset.iva);
      const total = toNum(n.dataset.total);

      if (!etapa) return { __error: `Registro #${i + 1}: Etapa inválida "${n.dataset.etapa}".` };
      if (!concepto) return { __error: `Registro #${i + 1}: falta Concepto.` };
      if (!cuentaNombre) return { __error: `Registro #${i + 1}: falta Cuenta.` };

      if (![monto, cantidad, plazo, subtotal, iva, total].every(Number.isFinite)) {
        return { __error: `Registro #${i + 1}: números inválidos en "${concepto}" (${cuentaNombre}).` };
      }

      return { etapa, concepto, cuentaNombre, entidad, forma, tipo, monto, cantidad, plazo, subtotal, iva, total };
    });

    const errorsA = itemsA.filter((x) => x && x.__error).map((x) => x.__error);
    if (errorsA.length) throw new Error(errorsA.join("\n"));
    return itemsA;
  }

  const presupuestoSection =
    document.querySelector('#app [data-route="presupuesto"]') || document.querySelector("#app") || document;

  const tables = Array.from(presupuestoSection.querySelectorAll("table"));

  if (!tables.length) {
    const lsItems = readItemsFromLocalStorage();
    if (!lsItems.length) throw new Error("No encontré tablas en la vista para exportar y no hay presupuesto guardado.");
    return lsItems;
  }

  function headerText(th) {
    return norm(th?.textContent || "");
  }

  const expected = [
    "ETAPA",
    "CONCEPTO",
    "CUENTA",
    "ENTIDAD",
    "FORMA DE PAGO",
    "TIPO DE PAGO",
    "MONTO",
    "CANTIDAD",
    "PLAZO",
    "SUBTOTAL",
    "IVA",
    "TOTAL",
  ];

  let targetTable = null;
  let headerMap = null;

  for (const t of tables) {
    const ths = Array.from(t.querySelectorAll("thead th"));
    if (!ths.length) continue;

    const headers = ths.map(headerText);
    const map = new Map();
    headers.forEach((h, idx) => map.set(h, idx));

    const hasAll = expected.every((k) => map.has(norm(k)));
    if (hasAll) {
      targetTable = t;
      headerMap = map;
      break;
    }
  }

  if (!targetTable) {
    targetTable = tables.find((t) => t.querySelector("thead") && t.querySelector("tbody"));
    if (!targetTable) {
      const lsItems = readItemsFromLocalStorage();
      if (!lsItems.length) throw new Error("No encontré una tabla válida para leer el desglose.");
      return lsItems;
    }

    const ths = Array.from(targetTable.querySelectorAll("thead th"));
    const headers = ths.map(headerText);
    headerMap = new Map();
    headers.forEach((h, idx) => headerMap.set(h, idx));
  }

  function idxOf(name) {
    const key = norm(name);
    return headerMap.has(key) ? headerMap.get(key) : -1;
  }

  const idxEtapa = idxOf("ETAPA");
  const idxConcepto = idxOf("CONCEPTO");
  const idxCuenta = idxOf("CUENTA");
  const idxEntidad = idxOf("ENTIDAD");
  const idxForma = idxOf("FORMA DE PAGO");
  const idxTipo = idxOf("TIPO DE PAGO");
  const idxMonto = idxOf("MONTO");
  const idxCantidad = idxOf("CANTIDAD");
  const idxPlazo = idxOf("PLAZO");
  const idxSubtotal = idxOf("SUBTOTAL");
  const idxIva = idxOf("IVA");
  const idxTotal = idxOf("TOTAL");

  const required = [
    ["ETAPA", idxEtapa],
    ["CONCEPTO", idxConcepto],
    ["CUENTA", idxCuenta],
    ["ENTIDAD", idxEntidad],
    ["FORMA DE PAGO", idxForma],
    ["TIPO DE PAGO", idxTipo],
    ["MONTO", idxMonto],
    ["CANTIDAD", idxCantidad],
    ["PLAZO", idxPlazo],
    ["SUBTOTAL", idxSubtotal],
    ["IVA", idxIva],
    ["TOTAL", idxTotal],
  ];
  const missingCols = required.filter(([, v]) => v === -1).map(([k]) => k);

  if (missingCols.length) {
    const lsItems = readItemsFromLocalStorage();
    if (!lsItems.length) {
      throw new Error(`No pude detectar columnas en la tabla para exportar. Faltan: ${missingCols.join(", ")}`);
    }
    return lsItems;
  }

  const rows = Array.from(targetTable.querySelectorAll("tbody tr"));
  if (!rows.length) {
    const lsItems = readItemsFromLocalStorage();
    if (!lsItems.length) throw new Error("La tabla de desglose está vacía.");
    return lsItems;
  }

  const itemsB = rows.map((tr, i) => {
    const tds = Array.from(tr.querySelectorAll("td"));
    const get = (idx) => (tds[idx]?.textContent || "").trim();

    const etapa = normalizeEtapa(get(idxEtapa));
    const concepto = get(idxConcepto);
    const cuentaNombre = get(idxCuenta);

    const entidad = get(idxEntidad).toUpperCase();
    const forma = get(idxForma).toUpperCase();
    const tipo = get(idxTipo).toUpperCase();

    const monto = toNum(get(idxMonto));
    const cantidad = toNum(get(idxCantidad));
    const plazo = toNum(get(idxPlazo));
    const subtotal = toNum(get(idxSubtotal));
    const iva = toNum(get(idxIva));
    const total = toNum(get(idxTotal));

    if (!etapa) return { __error: `Fila #${i + 1}: Etapa inválida "${get(idxEtapa)}".` };
    if (!concepto) return { __error: `Fila #${i + 1}: falta Concepto.` };
    if (!cuentaNombre) return { __error: `Fila #${i + 1}: falta Cuenta.` };

    if (![monto, cantidad, plazo, subtotal, iva, total].every(Number.isFinite)) {
      return { __error: `Fila #${i + 1}: números inválidos en "${concepto}" (${cuentaNombre}).` };
    }

    return { etapa, concepto, cuentaNombre, entidad, forma, tipo, monto, cantidad, plazo, subtotal, iva, total };
  });

  const errorsB = itemsB.filter((x) => x && x.__error).map((x) => x.__error);
  if (errorsB.length) throw new Error(errorsB.join("\n"));
  return itemsB;
}

/** =========================
 *  2) Mapear cuentas SIN HUECOS (solo usadas por etapa)
 *  ========================= */
function buildCuentaNumeroMapForItems(items) {
  const orderIdx = new Map(ORDEN_CUENTAS.map((c, i) => [norm(c), i]));

  const byEtapa = new Map(); // etapa -> Set(cuentaNorm)
  for (const it of items) {
    const k = it.etapa;
    if (!byEtapa.has(k)) byEtapa.set(k, new Set());
    byEtapa.get(k).add(norm(it.cuentaNombre));
  }

  const maps = {};
  for (const etapa of ["PREPRODUCCION", "PRODUCCION", "POSTPRODUCCION"]) {
    const set = byEtapa.get(etapa) || new Set();
    const used = Array.from(set);

    used.sort((a, b) => {
      const ia = orderIdx.has(a) ? orderIdx.get(a) : 999999;
      const ib = orderIdx.has(b) ? orderIdx.get(b) : 999999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });

    const m = new Map();
    used.forEach((cuentaNorm, i) => {
      m.set(cuentaNorm, BASE[etapa] + i * STEP);
    });

    maps[etapa] = m;
  }

  return maps;
}

/** =========================
 *  3) Consecutivo por cuenta + subcuenta
 *  ========================= */
function enrich(items) {
  const CUENTA_MAPS = buildCuentaNumeroMapForItems(items);

  const rows = items.map((it) => {
    const numeroCuenta = CUENTA_MAPS[it.etapa].get(norm(it.cuentaNombre));
    if (!numeroCuenta) {
      throw new Error(`Cuenta no mapeada: "${it.cuentaNombre}" en etapa ${it.etapa}.`);
    }
    return { ...it, numeroCuenta };
  });

  rows.sort(
    (a, b) =>
      etapaRank(a.etapa) - etapaRank(b.etapa) ||
      a.numeroCuenta - b.numeroCuenta ||
      a.concepto.localeCompare(b.concepto)
  );

  const counters = new Map();
  return rows.map((it) => {
    const c = counters.get(it.numeroCuenta) || 0;
    const consecutivo = c + 1;
    counters.set(it.numeroCuenta, consecutivo);
    const subcuenta = it.numeroCuenta + consecutivo;
    return { ...it, consecutivo, subcuenta };
  });
}

/** =========================
 *  4) Aportaciones por Entidad/Forma
 *  ========================= */
function aportacionesFrom(row) {
  const e = (row.entidad || "").toUpperCase();
  const f = (row.forma || "").toUpperCase();
  const val = row.total;

  const out = {
    focine_efectivo: 0,
    centro_especie: 0,
    propias_efectivo: 0,
    propias_especie: 0,
    terceros_efectivo: 0,
    terceros_especie: 0,
  };

  if (e === "FOCINE") {
    out.focine_efectivo = val;
    return out;
  }
  if (e === "CENTRO") {
    out.centro_especie = val;
    return out;
  }
  if (e === "PROPIAS") {
    if (f === "ESPECIE") out.propias_especie = val;
    else out.propias_efectivo = val;
    return out;
  }
  if (e === "TERCEROS") {
    if (f === "ESPECIE") out.terceros_especie = val;
    else out.terceros_efectivo = val;
    return out;
  }
  return out;
}

/** =========================
 *  5) HTML imprimible
 *  ========================= */
// ✅ AJUSTE QUIRÚRGICO: opts.showActions controla el botón "EXPORTAR PDF"
function buildPrintableHTML(rows, projectName, opts = {}) {
  const showActions = opts.showActions !== false;

  const grouped = new Map();
  const etapaTotals = new Map();

  const grand = {
    subtotal: 0,
    iva: 0,
    total: 0,
    focine_efectivo: 0,
    centro_especie: 0,
    propias_efectivo: 0,
    propias_especie: 0,
    terceros_efectivo: 0,
    terceros_especie: 0,
  };

  function emptyTotals() {
    return {
      subtotal: 0,
      iva: 0,
      total: 0,
      focine_efectivo: 0,
      centro_especie: 0,
      propias_efectivo: 0,
      propias_especie: 0,
      terceros_efectivo: 0,
      terceros_especie: 0,
    };
  }

  function addTotals(target, r) {
    const ap = aportacionesFrom(r);
    target.subtotal += r.subtotal;
    target.iva += r.iva;
    target.total += r.total;

    target.focine_efectivo += ap.focine_efectivo;
    target.centro_especie += ap.centro_especie;
    target.propias_efectivo += ap.propias_efectivo;
    target.propias_especie += ap.propias_especie;
    target.terceros_efectivo += ap.terceros_efectivo;
    target.terceros_especie += ap.terceros_especie;
  }

  for (const r of rows) {
    if (!grouped.has(r.etapa)) grouped.set(r.etapa, new Map());
    const m = grouped.get(r.etapa);
    if (!m.has(r.numeroCuenta)) m.set(r.numeroCuenta, { cuentaNombre: r.cuentaNombre, rows: [] });
    m.get(r.numeroCuenta).rows.push(r);

    if (!etapaTotals.has(r.etapa)) etapaTotals.set(r.etapa, emptyTotals());
    addTotals(etapaTotals.get(r.etapa), r);
    addTotals(grand, r);
  }

  const etapaOrder = ["PREPRODUCCION", "PRODUCCION", "POSTPRODUCCION"].filter((e) => grouped.has(e));

  const renderEtapaBanner = (etapa) => {
    const c = COLORS.etapa[etapa];
    return `<tr class="etapa-banner" style="background:${c.bg}; color:${c.fg};">
      <td colspan="14">${labelEtapa(etapa)}</td>
    </tr>`;
  };

  const renderCuentaGroupRow = (etapa, numeroCuenta, cuentaNombre) => {
    const key = pickCuentaColorKey(etapa);
    const c = COLORS.cuenta[key];
    return `<tr class="cuenta-group" style="background:${c.bg}; color:${c.fg};">
      <td class="code">${numeroCuenta}</td>
      <td class="desc" colspan="13">${escapeHtml(cuentaNombre)}</td>
    </tr>`;
  };

  const renderSubtotalCuenta = (numeroCuenta, acc) => {
    const c = COLORS.subtotal;
    return `<tr class="subtotal" style="background:${c.bg}; color:${c.fg};">
      <td class="code"></td>
      <td class="desc">SUBTOTALES SUBCUENTA ${numeroCuenta}</td>
      <td class="num">${acc.cantidad}</td>
      <td class="num">${money(acc.monto)}</td>
      <td class="num">${acc.plazo}</td>
      <td class="num">${money(acc.subtotal)}</td>
      <td class="num">${money(acc.iva)}</td>
      <td class="num total-highlight">${money(acc.total)}</td>
      <td class="num">${acc.focine_efectivo ? money(acc.focine_efectivo) : ""}</td>
      <td class="num">${acc.centro_especie ? money(acc.centro_especie) : ""}</td>
      <td class="num">${acc.propias_efectivo ? money(acc.propias_efectivo) : ""}</td>
      <td class="num">${acc.propias_especie ? money(acc.propias_especie) : ""}</td>
      <td class="num">${acc.terceros_efectivo ? money(acc.terceros_efectivo) : ""}</td>
      <td class="num">${acc.terceros_especie ? money(acc.terceros_especie) : ""}</td>
    </tr>`;
  };

  const renderTotalEtapa = (etapa) => {
    const t = etapaTotals.get(etapa);
    return `<tr class="grand">
      <td class="code"></td>
      <td class="desc" colspan="4">GRAN TOTAL ${labelEtapa(etapa)}</td>
      <td class="num">${money(t.subtotal)}</td>
      <td class="num">${money(t.iva)}</td>
      <td class="num total-highlight">${money(t.total)}</td>
      <td class="num">${t.focine_efectivo ? money(t.focine_efectivo) : ""}</td>
      <td class="num">${t.centro_especie ? money(t.centro_especie) : ""}</td>
      <td class="num">${t.propias_efectivo ? money(t.propias_efectivo) : ""}</td>
      <td class="num">${t.propias_especie ? money(t.propias_especie) : ""}</td>
      <td class="num">${t.terceros_efectivo ? money(t.terceros_efectivo) : ""}</td>
      <td class="num">${t.terceros_especie ? money(t.terceros_especie) : ""}</td>
    </tr>`;
  };

  const renderGrandTotal = () => {
    return `<tr class="grand grand-final">
      <td class="code"></td>
      <td class="desc" colspan="4">GRAN TOTAL</td>
      <td class="num">${money(grand.subtotal)}</td>
      <td class="num">${money(grand.iva)}</td>
      <td class="num total-highlight">${money(grand.total)}</td>
      <td class="num">${grand.focine_efectivo ? money(grand.focine_efectivo) : ""}</td>
      <td class="num">${grand.centro_especie ? money(grand.centro_especie) : ""}</td>
      <td class="num">${grand.propias_efectivo ? money(grand.propias_efectivo) : ""}</td>
      <td class="num">${grand.propias_especie ? money(grand.propias_especie) : ""}</td>
      <td class="num">${grand.terceros_efectivo ? money(grand.terceros_efectivo) : ""}</td>
      <td class="num">${grand.terceros_especie ? money(grand.terceros_especie) : ""}</td>
    </tr>`;
  };

  let bodyRows = "";

  for (const etapa of etapaOrder) {
    bodyRows += renderEtapaBanner(etapa);
    const cuentasMap = grouped.get(etapa);

    for (const [numeroCuenta, bucket] of cuentasMap.entries()) {
      bodyRows += renderCuentaGroupRow(etapa, numeroCuenta, bucket.cuentaNombre);

      const acc = {
        cantidad: 0,
        monto: 0,
        plazo: 0,
        subtotal: 0,
        iva: 0,
        total: 0,
        focine_efectivo: 0,
        centro_especie: 0,
        propias_efectivo: 0,
        propias_especie: 0,
        terceros_efectivo: 0,
        terceros_especie: 0,
      };

      for (const r of bucket.rows) {
        const ap = aportacionesFrom(r);

        acc.cantidad += r.cantidad;
        acc.monto += r.monto;
        acc.plazo += r.plazo;

        acc.subtotal += r.subtotal;
        acc.iva += r.iva;
        acc.total += r.total;

        acc.focine_efectivo += ap.focine_efectivo;
        acc.centro_especie += ap.centro_especie;
        acc.propias_efectivo += ap.propias_efectivo;
        acc.propias_especie += ap.propias_especie;
        acc.terceros_efectivo += ap.terceros_efectivo;
        acc.terceros_especie += ap.terceros_especie;

        bodyRows += `
          <tr class="item">
            <td class="code">${r.subcuenta}</td>
            <td class="desc">${escapeHtml(r.concepto)}</td>

            <td class="num">${r.cantidad}</td>
            <td class="num">${money(r.monto)}</td>
            <td class="num">${r.plazo}</td>

            <td class="num">${money(r.subtotal)}</td>
            <td class="num">${money(r.iva)}</td>
            <td class="num">${money(r.total)}</td>

            <td class="num">${ap.focine_efectivo ? money(ap.focine_efectivo) : ""}</td>
            <td class="num">${ap.centro_especie ? money(ap.centro_especie) : ""}</td>
            <td class="num">${ap.propias_efectivo ? money(ap.propias_efectivo) : ""}</td>
            <td class="num">${ap.propias_especie ? money(ap.propias_especie) : ""}</td>
            <td class="num">${ap.terceros_efectivo ? money(ap.terceros_efectivo) : ""}</td>
            <td class="num">${ap.terceros_especie ? money(ap.terceros_especie) : ""}</td>
          </tr>
        `;
      }

      bodyRows += renderSubtotalCuenta(numeroCuenta, acc);
    }

    bodyRows += renderTotalEtapa(etapa);
  }

  bodyRows += renderGrandTotal();

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Presupuesto</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { font-family: Arial, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111; background:#fff; }

  @media print { .no-print { display: none !important; } }

  .top-actions{
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 9999;
    display: flex;
    gap: 8px;
  }
  .btn-export{
    border: 1px solid rgba(0,0,0,.25);
    background: #ffffff;
    padding: 8px 12px;
    border-radius: 10px;
    font-weight: 900;
    cursor: pointer;
  }

  .title { font-size: 14px; font-weight: 800; margin: 0 0 6px; }
  .note { font-size: 10px; margin: 0 0 10px; opacity: .85; }

  table { border-collapse: collapse; width: 100%; font-size: 9.5px; }
  th, td { border: 1px solid rgba(0,0,0,.25); padding: 4px 6px; vertical-align: top; }
  th { background: #f3f3f3; text-align: center; font-weight: 800; }

  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.code { text-align: center; width: 74px; font-weight: 800; }
  td.desc { width: 460px; }

  .etapa-banner td { text-align: center; font-weight: 900; letter-spacing: .5px; }
  .cuenta-group td { font-weight: 900; }
  .subtotal td { font-weight: 900; }
  .total-highlight { background: ${COLORS.totalHighlight.bg} !important; font-weight: 900; }
  .grand td { font-weight: 900; background: #FFE7C2; }
  .grand-final td { background: #FFD89C; }

  tr { break-inside: avoid; }
</style>
</head>
<body>
  ${showActions ? `
  <div class="top-actions no-print">
    <button class="btn-export" onclick="window.print()">EXPORTAR PDF</button>
  </div>
  ` : ``}

  <div class="title">PRESUPUESTO DESGLOSADO</div>
  <div class="note">${escapeHtml(projectName || "Proyecto")}</div>

  <table>
    <thead>
      <tr>
        <th rowspan="2">CUENTA Y SUBCUENTA</th>
        <th rowspan="2">DESCRIPCIÓN</th>
        <th rowspan="2">CANT.</th>
        <th rowspan="2">COSTO UNIDAD</th>
        <th rowspan="2">PLAZO</th>
        <th rowspan="2">SUBTOTAL</th>
        <th rowspan="2">IVA</th>
        <th rowspan="2">TOTAL</th>

        <th colspan="1" style="background:#FFFF00;">APORTACIÓN FOCINE</th>
        <th colspan="1">APORTACIÓN CENTRO</th>
        <th colspan="2">APORTACIONES PROPIAS (DIRECCIÓN)</th>
        <th colspan="2">APORTACIONES DE TERCEROS</th>
      </tr>
      <tr>
        <th style="background:#FFFF00;">EFECTIVO</th>
        <th>ESPECIE</th>
        <th>EFECTIVO</th>
        <th>ESPECIE</th>
        <th>EFECTIVO</th>
        <th>ESPECIE</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;

  return html;
}

/** =========================
 *  API pública (vista previa / imprimir)
 *  ========================= */
export function exportarPresupuestoPDF() {
  const items = readItemsFromDOM();
  const rows = enrich(items);

  const projectName =
    window?.appState?.project?.name ||
    document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
    "Proyecto";

  // ✅ Vista previa: con botón
  const printable = buildPrintableHTML(rows, projectName, { showActions: true });

  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup bloqueado. Permite popups para esta página.");
  w.document.open();
  w.document.write(printable);
  w.document.close();
  w.focus();
}

/** =========================================================
 *  ✅ Exportar a PDF EN MEMORIA (Uint8Array)
 *  - Entrega lo usa para anexar el Presupuesto (8)
 *  ========================================================= */
export async function exportarPresupuestoPdfBytes({ projectName } = {}) {
  // ✅ V2: desde Entrega NO existe el DOM del módulo Presupuesto.
  // Intentamos primero servidor (project_state). Si no hay, fallback a DOM/LS.
  let items = await readItemsFromServerState();

  if (!items.length) {
    try {
      items = readItemsFromDOM();
    } catch {
      // ignore
    }
  }

  if (!items.length) {
    try {
      items = readItemsFromLocalStorage();
    } catch {
      items = [];
    }
  }

  if (!items.length) {
    throw new Error("No hay partidas de Presupuesto para exportar.");
  }

  const rows = enrich(items);

  const pName =
    projectName ||
    window?.appState?.project?.name ||
    window?.appState?.profile?.projectName ||
    document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
    "Proyecto";

  // ✅ Export final: sin botón
  const html = buildPrintableHTML(rows, pName, { showActions: false });
  return await htmlToPdfBytes(html);
}


/* =========================================================
   HTML -> PDF bytes (html2canvas + jsPDF)
   - renderiza el HTML en un iframe oculto
   - genera páginas A4 landscape
   ✅ V2: si hay logo, lo estampa en cada página (arriba derecha)
========================================================= */

async function htmlToPdfBytes(html) {
  const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
  ]);

  const jsPDF = jsPdfMod.jsPDF || jsPdfMod.default?.jsPDF || jsPdfMod.default || jsPdfMod;

  // ✅ V2: preparar logo (si existe) — ahora es async
  const logoDataUrl = await readLogoDataUrlFromDocs();
  let logoStamp = null; // { imgData, wpt, hpt, headerExtra, format }
  if (logoDataUrl) {
    try {
      const img = await loadImageFromDataUrl(logoDataUrl);

      // Tamaño “decente” para A4 landscape (pt)
      const maxWpt = 140;
      const maxHpt = 38;

      const { w, h } = computeLogoDrawSize(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        maxWpt,
        maxHpt
      );

      const mime = dataUrlMime(logoDataUrl);
      const format = mime.includes("jpeg") || mime.includes("jpg") ? "JPEG" : "PNG";

      const headerExtra = h + 12; // margen extra superior reservado para no tapar contenido
      logoStamp = { imgData: logoDataUrl, wpt: w, hpt: h, headerExtra, format };
    } catch {
      logoStamp = null;
    }
  }

  // iframe oculto (sandbox seguro)
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = "1400px";
  iframe.style.height = "900px";
  iframe.style.opacity = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;

  try {
    doc.open();
    doc.write(html);
    doc.close();

    // espera a que pinte
    await new Promise((r) => setTimeout(r, 250));
    try {
      await doc.fonts?.ready;
    } catch {}

    const target = doc.body;

    const canvas = await html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    });

    // A4 landscape en puntos
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const margin = 18;
    const headerExtra = logoStamp ? logoStamp.headerExtra : 0;
    const usableW = pageWidth - margin * 2;
    const usableH = pageHeight - margin * 2 - headerExtra;

    const scale = usableW / canvas.width;
    const fullImgH = canvas.height * scale;

    if (fullImgH <= usableH) {
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(imgData, "JPEG", margin, margin + headerExtra, usableW, fullImgH, undefined, "FAST");

      if (logoStamp) {
        stampLogoOnPage(pdf, logoStamp.imgData, logoStamp.wpt, logoStamp.hpt, {
          margin,
          topInset: 8,
          format: logoStamp.format,
        });
      }
    } else {
      const sliceCanvas = document.createElement("canvas");
      const sliceCtx = sliceCanvas.getContext("2d");

      const slicePxH = Math.floor(usableH / scale);

      let y = 0;
      let pageIndex = 0;

      while (y < canvas.height) {
        const h = Math.min(slicePxH, canvas.height - y);

        sliceCanvas.width = canvas.width;
        sliceCanvas.height = h;

        sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        sliceCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);

        const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);

        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", margin, margin + headerExtra, usableW, h * scale, undefined, "FAST");

        if (logoStamp) {
          stampLogoOnPage(pdf, logoStamp.imgData, logoStamp.wpt, logoStamp.hpt, {
            margin,
            topInset: 8,
            format: logoStamp.format,
          });
        }

        y += h;
        pageIndex++;
      }
    }

    const buf = pdf.output("arraybuffer");
    return new Uint8Array(buf);
  } finally {
    try {
      iframe.remove();
    } catch {}
  }
}
