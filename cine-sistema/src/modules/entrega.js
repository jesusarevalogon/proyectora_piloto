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
========================================================= */

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
  resumen: ["RESUMEN EJECUTIVO", "RESUMEN_EJECUTIVO"],
  sinopsis: ["SINOPSIS DESARROLLADA", "5.2 SINOPSIS DESARROLLADA", "SINOPSIS_DESARROLLADA"],
  guion: [
    "GUION / ARGUMENTO DOCUMENTAL",
    "GUION ARGUMENTO DOCUMENTAL",
    "5.3 GUION / ARGUMENTO DOCUMENTAL",
    "GUION_ARGUMENTO_DOCUMENTAL",
  ],
  propuesta: [
    "PROPUESTA CREATIVA DE DIRECCION",
    "PROPUESTA CREATIVA DE DIRECCIÓN",
    "5.4 PROPUESTA CREATIVA DE DIRECCION",
    "PROPUESTA_CREATIVA_DIRECCION",
  ],
  vision: [
    "VISION TECNICA Y CREATIVA DE PRODUCCION",
    "VISIÓN TÉCNICA Y CREATIVA DE PRODUCCIÓN",
    "5.5 VISION TECNICA Y CREATIVA DE PRODUCCION",
    "VISION_TECNICA_PRODUCCION",
    "VISION_TECNICA_Y_CREATIVA_DE_PRODUCCION",
  ],
  equipo: ["EQUIPO PROPUESTO", "5.6 EQUIPO PROPUESTO", "EQUIPO_PROPUESTO"],
  soportes: [
    "ESQUEMA FINANCIERO (SOPORTES DE GASTO)",
    "ESQUEMA FINANCIERO",
    "SOPORTES DE GASTO",
    "ESQUEMA_FINANCIERO_RATIFICACION",
    "ESQUEMA_FINANCIERO",
    "SOPORTES_GASTO",
  ],
  derechos: ["ESTADO DE DERECHOS", "ESTADO_DERECHOS"],
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
                <th style="width:60px;">#</th>
                <th>Módulo</th>
                <th style="width:240px;">Estado</th>
              </tr>
            </thead>
            <tbody id="entregaTbody">
              ${rows}
            </tbody>
          </table>
        </div>

        <div class="rc-actions" style="margin-top:12px;">
          <button id="entregaBtnCheck" class="btn btn-light">Revisar integridad</button>
          <button id="entregaBtnRun" class="btn btn-primary">ENTREGA (PDF)</button>
        </div>

        <p class="muted" style="margin-top:10px;">
          Nota: si falta un insumo, el sistema aborta y te dice exactamente cuál.
        </p>
      </div>
    </div>
  `;
}

export function bindEntregaEvents() {
  const btnCheck = document.getElementById("entregaBtnCheck");
  const btnRun = document.getElementById("entregaBtnRun");

  // ✅ Fix “todo rojo” al abrir: refresco en RAF + timeout corto
  requestAnimationFrame(() => {
    try { refreshStatusUI(); } catch (e) { console.warn(e); }
  });
  setTimeout(() => {
    try { refreshStatusUI(); } catch (e) { console.warn(e); }
  }, 120);

  btnCheck?.addEventListener("click", () => {
    try {
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
   STATUS: detección de insumos
========================================================= */

function computeStatus() {
  // 1) Detectar documentos de documentación desde localStorage (robusto)
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
      out[ins.id] = { ...ins, ok: count > 0, detail: count > 0 ? `${count} partidas` : "sin partidas" };
      continue;
    }

    if (ins.type === "soportes") {
      const hit = findDocByAliases(docsIndex, ["ESQUEMA FINANCIERO", "SOPORTES DE GASTO", "COTIZACION", "COTIZACIONES", "CARTA COMPROMISO", "CARTAS COMPROMISO"]);
      out[ins.id] = { ...ins, ok: !!hit, detail: hit ? "con anexos" : "sin archivo", doc: hit || null };
      continue;
    }

    out[ins.id] = { ...ins, ok: false, detail: "sin archivo" };
  }

  return out;
}

function firstMissing(status) {
  for (const ins of INSUMOS) {
    const s = status[ins.id];
    if (ins.required && !s?.ok) return ins;
  }
  return null;
}

function paintStatus(status) {
  const tbody = document.getElementById("entregaTbody");
  if (!tbody) return;

  for (const ins of INSUMOS) {
    const row = tbody.querySelector(`tr[data-insumo-id="${CSS.escape(ins.id)}"]`);
    if (!row) continue;

    const cell = row.querySelector(".entrega-status");
    if (!cell) continue;

    const s = status?.[ins.id];
    const ok = !!s?.ok;

    cell.classList.remove("entrega-status--ok", "entrega-status--bad");
    cell.classList.add(ok ? "entrega-status--ok" : "entrega-status--bad");

    if (ok) {
      cell.innerHTML = `OK <span class="muted">${escapeHtml(s.detail || "")}</span>`;
    } else {
      cell.innerHTML = `FALTA <span class="muted">${escapeHtml(s.detail || "sin archivo")}</span>`;
    }
  }
}

function countBudgetItems() {
  try {
    const raw = localStorage.getItem(LS_BUDGET_ITEMS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/* =========================================================
   ROBUST DOC SCAN
========================================================= */

function scanLocalStorageForDocsIndex() {
  const index = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;

    const raw = localStorage.getItem(k);
    if (!raw) continue;

    const firstChar = raw.trim()[0];
    if (firstChar !== "{" && firstChar !== "[") continue;

    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const extracted = extractDocEntriesFromUnknownShape(parsed, k);
    for (const e of extracted) index.push(e);
  }

  try {
    const wdocs = window?.appState?.docs || window?.docs;
    if (wdocs) {
      const extracted = extractDocEntriesFromUnknownShape(wdocs, "window");
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

    const dataUrl =
      obj.dataUrl || obj.dataURL || obj.url || obj.blobUrl || obj.base64 || obj.data || obj.content || "";

    const updatedAt = obj.updatedAt || obj.updated || obj.lastModified || obj.ts || obj.timestamp || null;

    const looksLikeDoc =
      (fileName || title || code) &&
      (typeof dataUrl === "string" && dataUrl.length > 10);

    if (!looksLikeDoc) return;

    out.push({
      sourceKey,
      code: String(code || ""),
      title: String(title || ""),
      fileName: String(fileName || ""),
      mime: String(mime || ""),
      dataUrl: String(dataUrl || ""),
      updatedAt,
    });
  };

  if (Array.isArray(parsed)) {
    for (const it of parsed) pushIfDocish(it, "");
    return out;
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.docs)) {
      for (const it of parsed.docs) pushIfDocish(it, "");
      return out;
    }

    for (const key of Object.keys(parsed)) {
      const v = parsed[key];
      if (Array.isArray(v)) {
        for (const it of v) pushIfDocish(it, key);
      } else if (v && typeof v === "object") {
        pushIfDocish(v, key);
        if (v.file && typeof v.file === "object") pushIfDocish(v.file, key);
        if (v.meta && typeof v.meta === "object") pushIfDocish(v.meta, key);
      }
    }
  }

  return out;
}

function findDocByAliases(index, aliases) {
  const wanted = (aliases || []).map((a) => norm(a));

  let best = null;
  let bestScore = 0;

  for (const e of index) {
    const hay = `${e.code} ${e.title} ${e.fileName} ${e.sourceKey}`;
    const H = norm(hay);

    let score = 0;
    for (const w of wanted) {
      if (!w) continue;
      if (H.includes(w)) score += 3;

      const parts = w.split(" ").filter(Boolean);
      const partHits = parts.filter((p) => H.includes(p)).length;
      if (partHits >= Math.max(2, Math.floor(parts.length * 0.6))) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  return bestScore >= 3 ? best : null;
}

/* =========================================================
   RUTA CRÍTICA: encontrar data para export (robusto)
========================================================= */

function scanLocalStorageForRutaCriticaData() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;

    const raw = localStorage.getItem(k);
    if (!raw) continue;

    const firstChar = raw.trim()[0];
    if (firstChar !== "{" && firstChar !== "[") continue;

    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const arrs = [];
    collectArrays(parsed, arrs);

    for (const arr of arrs) {
      if (!Array.isArray(arr) || !arr.length) continue;
      if (arr.length && looksLikeRutaArray(arr)) {
        return arr.map(x => ({
          etapa: x.etapa ?? x.stage ?? x.fase ?? "",
          tarea: x.tarea ?? x.task ?? x.nombre ?? "",
          inicio: x.inicio ?? x.start ?? x.fechaInicio ?? "",
          fin: x.fin ?? x.end ?? x.fechaFin ?? "",
        }));
      }
    }
  }

  try {
    const w = window?.appState?.rutaCritica || window?.rutaCritica || null;
    if (w) {
      const arrs = [];
      collectArrays(w, arrs);
      for (const arr of arrs) {
        if (Array.isArray(arr) && arr.length && looksLikeRutaArray(arr)) {
          return arr.map(x => ({
            etapa: x.etapa ?? x.stage ?? x.fase ?? "",
            tarea: x.tarea ?? x.task ?? x.nombre ?? "",
            inicio: x.inicio ?? x.start ?? x.fechaInicio ?? "",
            fin: x.fin ?? x.end ?? x.fechaFin ?? "",
          }));
        }
      }
    }
  } catch {}

  return null;
}

function collectArrays(obj, out) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    out.push(obj);
    for (const it of obj) collectArrays(it, out);
    return;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) collectArrays(obj[k], out);
  }
}

function looksLikeRutaArray(arr) {
  let hits = 0;
  const sample = arr.slice(0, Math.min(8, arr.length));
  for (const x of sample) {
    if (!x || typeof x !== "object") continue;
    const hasEtapa = ("etapa" in x) || ("stage" in x) || ("fase" in x);
    const hasTarea = ("tarea" in x) || ("task" in x) || ("nombre" in x);
    const hasInicio = ("inicio" in x) || ("start" in x) || ("fechaInicio" in x);
    const hasFin = ("fin" in x) || ("end" in x) || ("fechaFin" in x);
    if (hasEtapa && hasTarea && hasInicio && hasFin) hits++;
  }
  return hits >= Math.max(1, Math.floor(sample.length * 0.6));
}

/* =========================================================
   PDF MERGE (pdf-lib via CDN)
========================================================= */

async function loadPdfLib() {
  const mod = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
  return mod;
}

/**
 * ✅ Mantiene orientación (NO rota) y normaliza a:
 * - A4 Portrait si la página es vertical
 * - A4 Landscape si la página es horizontal
 * Escala priorizando ancho, y si se pasa de alto, reduce para que quepa.
 */
async function addPdfKeepOrientationSameWidth(outDoc, PDFLib, srcDoc, opts = {}) {
  const A4_P_W = 595.28;
  const A4_P_H = 841.89;
  const margin = opts.margin ?? 28;

  const indices = srcDoc.getPageIndices();
  const srcPages = indices.map((i) => srcDoc.getPage(i));
  const embedded = await outDoc.embedPages(srcPages);

  for (let i = 0; i < embedded.length; i++) {
    const ep = embedded[i];
    const sp = srcPages[i];

    const srcW = sp.getWidth();
    const srcH = sp.getHeight();

    const isLandscape = srcW > srcH;
    const targetW = isLandscape ? A4_P_H : A4_P_W;
    const targetH = isLandscape ? A4_P_W : A4_P_H;

    const maxW = targetW - margin * 2;
    const maxH = targetH - margin * 2;

    let scale = Math.min(maxW / srcW, 1);
    if (srcH * scale > maxH) scale = maxH / srcH;

    const drawW = srcW * scale;
    const drawH = srcH * scale;

    const x = (targetW - drawW) / 2;
    const y = (targetH - drawH) / 2;

    const page = outDoc.addPage([targetW, targetH]);
    page.drawPage(ep, { x, y, width: drawW, height: drawH });
  }
}

/**
 * ✅ Para imágenes sueltas: mismo criterio (A4 portrait/landscape según relación),
 * sin rotar, mismo ancho visual por orientación.
 */
async function addImageKeepOrientationSameWidth(outDoc, PDFLib, jpgEmbed, titleText, fontBold, font) {
  const { rgb } = PDFLib;

  const A4_P_W = 595.28;
  const A4_P_H = 841.89;
  const marginX = 28;
  const marginTop = 46;
  const marginBottom = 28;

  const imgW = jpgEmbed.width;
  const imgH = jpgEmbed.height;

  const isLandscape = imgW > imgH;
  const targetW = isLandscape ? A4_P_H : A4_P_W;
  const targetH = isLandscape ? A4_P_W : A4_P_H;

  const page = outDoc.addPage([targetW, targetH]);

  // título
  if (titleText) {
    page.drawText(titleText, {
      x: marginX,
      y: targetH - 30,
      size: 13,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
  }

  const maxW = targetW - marginX * 2;
  const maxH = targetH - (marginTop + marginBottom);

  let scale = Math.min(maxW / imgW, 1);
  if (imgH * scale > maxH) scale = maxH / imgH;

  const drawW = imgW * scale;
  const drawH = imgH * scale;

  const x = (targetW - drawW) / 2;
  const y = (targetH - drawH) / 2 - 10;

  page.drawImage(jpgEmbed, { x, y, width: drawW, height: drawH });
}

async function buildEntregaPdfBytes(PDFLib, status, loader) {
  const { PDFDocument, StandardFonts } = PDFLib;

  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);

  let step = 0;
  const totalSteps = INSUMOS.length;

  for (const ins of INSUMOS) {
    step++;
    const pct = Math.round(10 + (step / totalSteps) * 80);
    loader.set(pct, `Agregando: ${ins.n}. ${ins.label}…`);

    const s = status[ins.id];

    // 1-6,9,10: doc real
    if (ins.type === "doc" || ins.type === "doc_end" || ins.type === "soportes") {
      if (s?.doc?.dataUrl) {
        const bytes = await dataUrlToBytes(s.doc.dataUrl);

        // PDF -> normalizado por orientación (sin rotar)
        if (isPdfDataUrl(s.doc.dataUrl, s.doc.mime)) {
          const src = await PDFDocument.load(bytes);
          await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
          continue;
        }

        // Imagen: embebe como JPEG (si PNG, intenta convertir a JPG por canvas)
        const imgBytes = await ensureJpegBytes(bytes, s.doc.dataUrl);
        const jpg = await outDoc.embedJpg(imgBytes);

        await addImageKeepOrientationSameWidth(
          outDoc,
          PDFLib,
          jpg,
          `${ins.n}. ${ins.label}`,
          fontBold,
          font
        );
        continue;
      }

      addPlaceholderPage(outDoc, fontBold, font, `${ins.n}. ${ins.label}`, "No se encontró el archivo en localStorage.");
      continue;
    }

    // ✅ 7 Ruta crítica: INSERTAR PDF REAL (normalizado por orientación)
    if (ins.type === "system_ruta") {
      const data = scanLocalStorageForRutaCriticaData();
      if (!data || !data.length) {
        addPlaceholderPage(outDoc, fontBold, font, `${ins.n}. ${ins.label}`, "No encontré datos de Ruta Crítica para exportar.");
        continue;
      }

      const projectName = window?.appState?.project?.name || "Proyecto";

      const mod = await import("../services/rutaCriticaPreview.js");
      if (!mod?.exportarRutaCriticaPdfBytes) {
        addPlaceholderPage(outDoc, fontBold, font, `${ins.n}. ${ins.label}`, "Falta exportarRutaCriticaPdfBytes() en rutaCriticaPreview.js");
        continue;
      }

      const rcBytes = await mod.exportarRutaCriticaPdfBytes({ data, projectName });
      const src = await PDFDocument.load(rcBytes);
      await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
      continue;
    }

    // ✅ 8 Presupuesto: insertar PDF REAL (normalizado por orientación) si existe exportarPresupuestoPdfBytes()
    if (ins.type === "system_ppto") {
      const projectName = window?.appState?.project?.name || "Proyecto";
      const mod = await import("../services/presupuestoPdfExport.js");

      if (mod?.exportarPresupuestoPdfBytes) {
        const pptoBytes = await mod.exportarPresupuestoPdfBytes({ projectName });
        const src = await PDFDocument.load(pptoBytes);
        await addPdfKeepOrientationSameWidth(outDoc, PDFLib, src);
        continue;
      }

      addPlaceholderPage(
        outDoc,
        fontBold,
        font,
        `${ins.n}. ${ins.label}`,
        "Generado por sistema.\n(Falta exponer exportarPresupuestoPdfBytes() en presupuestoPdfExport.js para anexar el PDF real.)"
      );
      continue;
    }
  }

  // ✅ “compresión” ligera: object streams (no rompe nada)
  return await outDoc.save({ useObjectStreams: true, objectsPerTick: 50 });
}

function addPlaceholderPage(doc, fontBold, font, title, body) {
  // Placeholder en A4 landscape (no afecta el objetivo del “mismo ancho” en docs reales)
  const page = doc.addPage([841.89, 595.28]); // A4 landscape exacto
  const { height } = page.getSize();

  page.drawText(title, { x: 36, y: height - 48, size: 18, font: fontBold });
  const lines = (body || "").split("\n");
  let y = height - 90;
  for (const line of lines) {
    page.drawText(line, { x: 36, y, size: 12, font });
    y -= 18;
  }
}

function downloadBytesAsPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  // ✅ 1) Abrir en visor y forzar página 1 (Chrome/Edge suele respetarlo)
  try {
    const viewUrl = `${url}#page=1`;
    window.open(viewUrl, "_blank", "noopener,noreferrer");
  } catch {}

  // ✅ 2) Mantener descarga como antes
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Nota: no revocar inmediatamente, para que el visor alcance a cargar.
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch {}
  }, 8000);
}

function sanitizeFileName(name) {
  return (name || "Proyecto")
    .toString()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function isPdfDataUrl(dataUrl, mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return true;
  return (dataUrl || "").startsWith("data:application/pdf");
}

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

// Convierte PNG->JPEG con compresión para bajar peso (si es imagen)
async function ensureJpegBytes(bytes, dataUrl) {
  if ((dataUrl || "").startsWith("data:image/jpeg") || (dataUrl || "").startsWith("data:image/jpg")) {
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
    const jpgDataUrl = canvas.toDataURL("image/jpeg", 0.65);
    return await dataUrlToBytes(jpgDataUrl);
  } catch {
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

/* =========================================================
   ✅ Mensaje de peso (soft warning)
========================================================= */

function getByteLength(bytesLike) {
  // bytesLike puede ser Uint8Array o ArrayBuffer
  if (!bytesLike) return 0;
  if (typeof bytesLike === "string") return bytesLike.length;
  if (typeof bytesLike === "number") return bytesLike;
  if (typeof bytesLike.byteLength === "number") return bytesLike.byteLength;
  if (typeof bytesLike.length === "number") return bytesLike.length;
  return 0;
}

function formatBytesMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function showPesoMensaje(bytes) {
  const mbText = formatBytesMB(bytes);

  if (bytes <= SOFT_LIMIT_BYTES) {
    alert(`✅ Entrega generada correctamente.\nPeso final: ${mbText}`);
    return;
  }

  alert(
    `⚠️ Ojo: el PDF final pesa ${mbText} (mayor a ${SOFT_LIMIT_MB} MB).\n\n` +
    `Recomendación: comprímelo con una herramienta externa antes de enviarlo.\n` +
    `Ejemplos: iLovePDF / Smallpdf / Adobe Compress PDF.\n\n` +
    `Tip: si es un escaneo/fotos, la compresión suele bajar muchísimo.`
  );
}

/* =========================================================
   Loader UI
========================================================= */

function createEntregaLoader() {
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.inset = "0";
  wrap.style.zIndex = "99999";
  wrap.style.background = "rgba(0,0,0,.55)";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.padding = "16px";

  const card = document.createElement("div");
  card.style.width = "min(520px, 92vw)";
  card.style.background = "rgba(20,24,30,.95)";
  card.style.border = "1px solid rgba(255,255,255,.12)";
  card.style.borderRadius = "18px";
  card.style.boxShadow = "0 20px 60px rgba(0,0,0,.45)";
  card.style.padding = "16px 16px 14px";

  const title = document.createElement("div");
  title.textContent = "Compilando Entrega…";
  title.style.fontWeight = "900";
  title.style.fontSize = "18px";
  title.style.marginBottom = "8px";
  title.style.color = "#fff";

  const msg = document.createElement("div");
  msg.textContent = "Preparando el módulo, no cierres esta ventana.";
  msg.style.opacity = "0.85";
  msg.style.fontSize = "13px";
  msg.style.marginBottom = "12px";
  msg.style.color = "#fff";

  const barWrap = document.createElement("div");
  barWrap.style.height = "10px";
  barWrap.style.background = "rgba(255,255,255,.10)";
  barWrap.style.borderRadius = "999px";
  barWrap.style.overflow = "hidden";

  const bar = document.createElement("div");
  bar.style.height = "100%";
  bar.style.width = "0%";
  bar.style.background = "rgba(90,160,255,.95)";
  bar.style.borderRadius = "999px";
  bar.style.transition = "width 180ms ease";

  barWrap.appendChild(bar);

  const hint = document.createElement("div");
  hint.textContent = "No cierres esta ventana.";
  hint.style.fontSize = "12px";
  hint.style.opacity = "0.6";
  hint.style.marginTop = "10px";
  hint.style.color = "#fff";

  card.appendChild(title);
  card.appendChild(msg);
  card.appendChild(barWrap);
  card.appendChild(hint);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  return {
    set(pct, text) {
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      bar.style.width = `${p}%`;
      if (text) msg.textContent = text;
    },
    close() {
      try { wrap.remove(); } catch {}
    },
  };
}

/* =========================================================
   (Opcional) estilos mínimos para el estado OK/FALTA
========================================================= */
(function ensureEntregaStatusStylesOnce() {
  if (document.getElementById("entregaStatusStyles")) return;
  const st = document.createElement("style");
  st.id = "entregaStatusStyles";
  st.textContent = `
    .entrega-status--ok { color: #8CFF9D; font-weight: 900; }
    .entrega-status--bad { color: #FF8A8A; font-weight: 900; }
  `;
  document.head.appendChild(st);
})();
