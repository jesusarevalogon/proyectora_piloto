/* =========================================================
   src/services/rutaCriticaPreview.js
   Vista previa tipo Excel – Ruta Crítica
   ✅ Exportar PDF ajustado al ancho total (fit-to-width)

   ✅ FIX REAL (QUIRÚRGICO)
   - Guarda data en localStorage con una key fija:
     RUTA_CRITICA_V1_DATA
   - exportarRutaCriticaPdfBytes() puede funcionar aunque Entrega
     NO le pase {data}

   ✅ V2 (NUEVO AJUSTE QUIRÚRGICO):
   - Si existe logo en Documentación (key: logo_proyecto), se coloca en tamaño decente
     arriba-derecha EN CADA PÁGINA del PDF exportado (Ruta Crítica).
   - Si no existe logo, todo queda igual.

   ✅ AJUSTE QUIRÚRGICO (SOLICITADO):
   - En el export final (exportarRutaCriticaPdfBytes) NO debe aparecer el botón "Exportar PDF"
   - En la vista previa (abrirVistaPreviaRutaCritica) SÍ debe aparecer

   ✅ AJUSTE QUIRÚRGICO (NUEVO):
   - Agrega una PRIMERA hoja "RESUMEN RUTA CRÍTICA" antes de la tabla completa,
     sin romper el slicing multipágina, logo, ni la vista previa.

   ✅ AJUSTE QUIRÚRGICO (NUEVO - ESTE CAMBIO):
   - El resumen en el export final debe quedar CENTRADO en la hoja
   - Y verse MÁS GRANDE (llenando mejor el ancho útil)
========================================================= */

const LS_RC_KEY = "RUTA_CRITICA_V1_DATA";

/* =========================================================
   ✅ LOGO desde Documentación (V1 + V2)
   - Espera key: logo_proyecto dentro de DOCS_V1_ITEMS
   - V1: dataUrl/base64/url en localStorage
   - V2: path en Supabase Storage (bucket uploads)
========================================================= */

import { supabase } from "./supabase.js";

const DOCS_LS_KEY = "DOCS_V1_ITEMS";
const BUCKET = "uploads";

async function readLogoDataUrlFromDocs() {
  try {
    const raw = localStorage.getItem(DOCS_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const entry = parsed.logo_proyecto;

    // ✅ V1: dataUrl/base64/url
    const dataUrl = entry?.dataUrl || entry?.dataURL || entry?.url || entry?.base64 || null;
    if (typeof dataUrl === "string" && dataUrl.length > 20) return dataUrl;

    // ✅ V2: path en Supabase Storage
    const path = entry?.path || entry?.storagePath || entry?.storage_path || null;
    if (typeof path === "string" && path.length > 3 && supabase) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
      if (error || !data?.signedUrl) return null;

      const res = await fetch(data.signedUrl);
      if (!res.ok) return null;

      const blob = await res.blob();
      return await blobToDataUrl(blob);
    }
  } catch {}
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
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
  let w = maxWpt;
  let h = (imgHpx / imgWpx) * w;
  if (h > maxHpt) {
    h = maxHpt;
    w = (imgWpx / imgHpx) * h;
  }
  return { w, h };
}

function stampLogoOnPage(pdf, imgData, logoWpt, logoHpt, opts = {}) {
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = opts.margin ?? 18;
  const topInset = opts.topInset ?? 8;
  const x = pageW - margin - logoWpt;
  const y = Math.max(6, margin - topInset);
  pdf.addImage(imgData, opts.format || "PNG", x, y, logoWpt, logoHpt, undefined, "FAST");
}

/* =========================================================
   API pública: Vista previa
========================================================= */
export function abrirVistaPreviaRutaCritica({ data, projectName }) {
  if (!data || !data.length) {
    alert("No hay tareas para visualizar.");
    return;
  }

  // ✅ GUARDA DATA PARA ENTREGA (FIX)
  persistRutaCriticaData(data);

  const computed = computeRutaCritica(data);

  // ✅ Vista previa: con botón
  const html = buildRutaCriticaHTML({
    data: computed.data,
    projectName,
    totalWeeks: computed.totalWeeks,
    weeks: computed.weeks,
    yearBlocks: computed.yearBlocks,
    monthBlocks: computed.monthBlocks,
    etapas: computed.etapas,
    showActions: true,
  });

  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();

  try {
    w.__RC_PREVIEW_PAYLOAD = {
      data: normalizeRutaArray(data) || data,
      projectName,
    };
  } catch {}

  w.focus();
}

/* =========================================================
   ✅ Export a PDF en memoria para ENTREGA
   - Si no recibe data, la toma de localStorage (key fija)
   ✅ Export final: SIN botón
========================================================= */
export async function exportarRutaCriticaPdfBytes({ data, projectName } = {}) {
  let picked = Array.isArray(data) && data.length ? data : null;

  // ✅ 1) Prioridad: localStorage con key fija
  if (!picked) {
    picked = readRutaCriticaDataFromLocalStorage();
  }

  // ✅ 2) Fallback: window.appState (por si existe)
  if (!picked) {
    picked =
      extractRutaArray(window?.appState?.rutaCritica) ||
      extractRutaArray(window?.appState?.ruta) ||
      extractRutaArray(window?.rutaCritica) ||
      extractRutaArray(window?.ruta) ||
      null;
  }

  if (!picked || !picked.length) {
    throw new Error(
      "No encontré datos de Ruta Crítica para exportar. Abre Ruta Crítica y la Vista Previa al menos una vez para cachear la data."
    );
  }

  // ✅ Asegura persistencia (por si viene desde window)
  persistRutaCriticaData(picked);

  const computed = computeRutaCritica(picked);

  const pName =
    projectName ||
    window?.appState?.project?.name ||
    document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
    "Proyecto";

  // ✅ Export final: sin botón / sin topbar / sin script
  const html = buildRutaCriticaHTML({
    data: computed.data,
    projectName: pName,
    totalWeeks: computed.totalWeeks,
    weeks: computed.weeks,
    yearBlocks: computed.yearBlocks,
    monthBlocks: computed.monthBlocks,
    etapas: computed.etapas,
    showActions: false,
  });

  const resumenRows = buildResumenFromComputed(computed);
  const resumenHtml = buildResumenRutaCriticaHTML({
    projectName: pName,
    rows: resumenRows,
    showActions: false,
  });

  return await htmlToPdfBytesFromRutaCriticaHTML({ html, resumenHtml });
}

if (typeof window !== "undefined") {
  window.__exportRutaCriticaPdfBytes = exportarRutaCriticaPdfBytes;
}

/* =========================================================
   Persistencia fija en localStorage (FIX)
========================================================= */
function persistRutaCriticaData(data) {
  try {
    const normalized = normalizeRutaArray(data) || [];
    if (!normalized.length) return;
    localStorage.setItem(LS_RC_KEY, JSON.stringify(normalized));
  } catch {}
}

function readRutaCriticaDataFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_RC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeRutaArray(parsed);
  } catch {
    return null;
  }
}

/* =========================================================
   CÁLCULO (igual que tu lógica, sin mutar input)
========================================================= */
function computeRutaCritica(inputData) {
  const data = (inputData || []).map((d) => ({
    etapa: d?.etapa ?? d?.Etapa ?? d?.stage ?? "",
    tarea: d?.tarea ?? d?.Tarea ?? d?.task ?? "",
    inicio: d?.inicio ?? d?.Inicio ?? d?.start ?? "",
    fin: d?.fin ?? d?.Fin ?? d?.end ?? "",
  }));

  const fechasInicio = data.map((d) => new Date(d.inicio)).filter((x) => !isNaN(x));
  const minDate = new Date(Math.min(...fechasInicio));
  const projectStartMonday = getPreviousMonday(minDate);

  const withWeeks = data.map((d) => {
    const ini = new Date(d.inicio);
    const fin = new Date(d.fin);
    const inicioWeek = getWeekNumber(ini, projectStartMonday);
    const finWeek = getWeekNumber(fin, projectStartMonday);
    return { ...d, inicioWeek, finWeek };
  });

  const maxDate = new Date(Math.max(...withWeeks.map((d) => new Date(d.fin)).filter((x) => !isNaN(x))));
  const totalWeeks = getWeekNumber(maxDate, projectStartMonday);

  const weeks = [];
  for (let i = 1; i <= totalWeeks; i++) {
    const monday = addDays(projectStartMonday, (i - 1) * 7);
    weeks.push({ week: i, monday, year: monday.getFullYear(), month: monday.getMonth() });
  }

  const yearBlocks = buildBlocks(weeks, "year");
  const monthBlocks = buildBlocks(weeks, "month");

  const etapas = [];
  withWeeks.forEach((d) => {
    if (d?.etapa && !etapas.includes(d.etapa)) etapas.push(d.etapa);
  });

  return { data: withWeeks, totalWeeks, weeks, yearBlocks, monthBlocks, etapas };
}

/* =========================================================
   Normalización / Extract
========================================================= */
function extractRutaArray(anyShape) {
  if (!anyShape) return null;
  if (Array.isArray(anyShape)) return normalizeRutaArray(anyShape);
  if (Array.isArray(anyShape.data)) return normalizeRutaArray(anyShape.data);
  if (Array.isArray(anyShape.items)) return normalizeRutaArray(anyShape.items);
  if (Array.isArray(anyShape.tareas)) return normalizeRutaArray(anyShape.tareas);
  if (Array.isArray(anyShape.tasks)) return normalizeRutaArray(anyShape.tasks);
  return null;
}

function normalizeRutaArray(arr) {
  if (!Array.isArray(arr)) return null;

  const out = arr
    .map((x) => {
      const etapa = x?.etapa ?? x?.Etapa ?? x?.stage ?? x?.STAGE ?? "";
      const tarea = x?.tarea ?? x?.Tarea ?? x?.task ?? x?.TASK ?? "";
      const inicio = x?.inicio ?? x?.Inicio ?? x?.start ?? x?.START ?? "";
      const fin = x?.fin ?? x?.Fin ?? x?.end ?? x?.END ?? "";
      return { etapa, tarea, inicio, fin };
    })
    .filter((x) => {
      const ini = new Date(x.inicio);
      const fin = new Date(x.fin);
      return (
        String(x.tarea || "").trim().length > 0 &&
        String(x.etapa || "").trim().length > 0 &&
        !isNaN(ini) &&
        !isNaN(fin)
      );
    });

  return out.length ? out : null;
}

/* =========================================================
   HTML builder
   ✅ showActions controla topbar + botón + script
========================================================= */
function buildRutaCriticaHTML({ data, projectName, totalWeeks, weeks, yearBlocks, monthBlocks, etapas, showActions = true }) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Ruta Crítica</title>
<style>
  body{ margin:0; font-family: Arial, Helvetica, sans-serif; color:#111; background:#fff; }

  .topbar{
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:10px;
  }
  button{
    padding:8px 12px;
    font-weight:700;
    border:1px solid #999;
    background:#fff;
    cursor:pointer;
  }

  .wrapper{ overflow:auto; padding: 0 10px 10px; }

  .print-surface{
    display:block;
    transform-origin: top left;
  }

  table{
    border-collapse: collapse;
    width: max-content;
    min-width: 100%;
    font-size:12px;
  }
  th, td{
    border:1px solid #bbb;
    padding:4px 6px;
    text-align:center;
  }
  .col-tarea{
    text-align:left;
    min-width:240px;
    position:sticky;
    left:0;
    background:#fff;
    z-index:2;
  }

  .header-title{
    background:#1f2a44;
    color:#fff;
    font-weight:900;
    font-size:14px;
    height:42px;
  }
  .header-year{ background:#e6e9ef; font-weight:800; }
  .header-month{ background:#f3f4f7; font-weight:700; }
  .header-week{ background:#fafafa; font-weight:700; }

  .stage-row td{
    background:#e9e9e9;
    font-weight:800;
    text-align:left;
  }

  .week-col{
    min-width:28px;
    width:28px;
    padding:2px;
  }
  .task-cell{ padding:0; }

  @page { size: A4 landscape; margin: 10mm; }

  @media print {
    #btnExport { display:none !important; }
    .topbar { display:none !important; }
    .wrapper { overflow: visible !important; padding: 0 !important; }
  }
</style>
</head>
<body>

${showActions ? `
<div class="topbar">
  <div><b>Vista previa Ruta Crítica</b></div>
  <button id="btnExport">Exportar PDF</button>
</div>
` : ``}

<div class="wrapper">
  <div id="printSurface" class="print-surface">
    <table id="rcTable">
      <tr>
        <th colspan="${totalWeeks + 1}" class="header-title">
          RUTA CRÍTICA - ${escapeHtml(projectName)}
        </th>
      </tr>

      <tr>
        <th class="col-tarea header-year">AÑO</th>
        ${yearBlocks.map(b => `<th colspan="${b.span}" class="header-year">${b.label}</th>`).join("")}
      </tr>

      <tr>
        <th class="col-tarea header-month">MESES</th>
        ${monthBlocks.map(b => `<th colspan="${b.span}" class="header-month">${b.label}</th>`).join("")}
      </tr>

      <tr>
        <th class="col-tarea header-week">SEMANAS</th>
        ${weeks.map(w => `<th class="week-col header-week">${w.week}</th>`).join("")}
      </tr>

      ${etapas.map(etapa => `
        <tr class="stage-row">
          <td colspan="${totalWeeks + 1}">${escapeHtml(etapa)}</td>
        </tr>

        ${data
          .filter(d => d.etapa === etapa)
          .map(d => `
            <tr>
              <td class="col-tarea">${escapeHtml(d.tarea)}</td>
              ${weeks.map(w => {
                if (w.week >= d.inicioWeek && w.week <= d.finWeek) {
                  return `<td class="week-col task-cell" style="background:${getColorForTask(d.tarea)};"></td>`;
                }
                return `<td class="week-col"></td>`;
              }).join("")}
            </tr>
          `).join("")}
      `).join("")}
    </table>
  </div>
</div>

${showActions ? `
<script>
(function(){
  const btn = document.getElementById("btnExport");
  const table = document.getElementById("rcTable");

  function getPrintablePageInnerWidthPx(){
    const usableMm = 277;
    return usableMm * 96 / 25.4;
  }

  function fitToWidthForPrint(){
    document.body.style.zoom = "1";
    const pageInnerWidthPx = getPrintablePageInnerWidthPx();
    const tableWidth = table.scrollWidth;
    if (!pageInnerWidthPx || !tableWidth) return;
    const scale = Math.min(1, pageInnerWidthPx / tableWidth);
    document.body.style.zoom = scale.toFixed(4);
  }

  async function exportWithResumenIfAvailable(){
    const openerFn = window.opener && window.opener.__exportRutaCriticaPdfBytes;
    if (typeof openerFn !== "function") return false;

    const payload = window.__RC_PREVIEW_PAYLOAD || {};
    try {
      const bytes = await openerFn({ data: payload.data, projectName: payload.projectName });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  btn.addEventListener("click", async () => {
    const ok = await exportWithResumenIfAvailable();
    if (ok) return;

    fitToWidthForPrint();
    window.print();
    setTimeout(() => { document.body.style.zoom = "1"; }, 300);
  });
})();
</script>
` : ``}

</body>
</html>
`;
}

/* =========================================================
   Resumen: HTML builder
========================================================= */
function buildResumenRutaCriticaHTML({ projectName, rows, showActions = false }) {
  const safeName = escapeHtml(projectName || "Proyecto");
  const items = Array.isArray(rows) ? rows : [];

  // ✅ "printSurface" con ancho controlado para que el PDF lo escale y llene mejor la hoja.
  // ✅ Wrapper en flex para centrar vertical/horizontal.
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Resumen Ruta Crítica</title>
<style>
  body{
    margin:0;
    font-family: Arial, Helvetica, sans-serif;
    color:#111;
    background:#fff;
  }

  .topbar{
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:10px;
  }
  button{
    padding:8px 12px;
    font-weight:700;
    border:1px solid #999;
    background:#fff;
    cursor:pointer;
  }

  /* ✅ Centrado total en página */
  .wrapper{
    min-height: 100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    padding: 0;
  }

  /* ✅ Superficie ancha para escalar a "fit-to-width" y verse grande */
  .print-surface{
    width: 2000px;
    box-sizing: border-box;
    padding: 80px 140px 70px;
  }

  .project-name{
    font-weight: 900;
    font-size: 34px;
    letter-spacing: .2px;
    text-align:center;
    margin: 0 0 16px;
  }

  .title{
    font-weight: 900;
    font-size: 28px;
    text-align:center;
    margin: 0 0 34px;
  }

  .card{
    width: 100%;
    max-width: none;
    margin: 0 auto;
  }

  table{
    width:100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 20px;
  }
  td{
    border: 2px solid #222;
    padding: 18px 18px;
    vertical-align: middle;
  }
  .col-etapa{
    width: 42%;
    color: #fff;
    font-weight: 900;
    text-align: center;
    letter-spacing: .2px;
  }
  .col-fecha{
    width: 58%;
    color: #111;
    font-weight: 500;
    text-align: center;
    background: #fff;
  }

  @page { size: A4 landscape; margin: 10mm; }

  @media print {
    .topbar { display:none !important; }
  }
</style>
</head>
<body>

${showActions ? `
<div class="topbar">
  <div><b>Vista previa Resumen Ruta Crítica</b></div>
  <button id="btnExport">Exportar PDF</button>
</div>
` : ``}

<div class="wrapper">
  <div id="printSurface" class="print-surface">
    <div class="project-name">NOMBRE DEL PROYECTO: ${safeName}</div>
    <div class="title">RESUMEN RUTA CRÍTICA</div>

    <div class="card">
      <table id="rcTable">
        <tbody>
          ${items
            .map(
              (r) => `
            <tr>
              <td class="col-etapa" style="background:${escapeAttr(r.color || "#1f2a44")};">
                ${escapeHtml(r.etapa || "")}
              </td>
              <td class="col-fecha">
                ${escapeHtml(r.rango || "")}
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

</body>
</html>
`;
}

/* =========================================================
   Resumen: consolidación por etapa desde computed
========================================================= */
function buildResumenFromComputed(computed) {
  const data = Array.isArray(computed?.data) ? computed.data : [];
  const order = ["DESARROLLO", "PREPRODUCCIÓN", "RODAJE", "EDICIÓN", "POSTPRODUCCIÓN"];

  const map = new Map();

  for (const d of data) {
    const etapa = String(d?.etapa || "").trim();
    if (!etapa) continue;

    const ini = safeIsoDate(d?.inicio);
    const fin = safeIsoDate(d?.fin) || ini;

    if (!ini) continue;

    if (!map.has(etapa)) {
      map.set(etapa, { etapa, minIni: ini, maxFin: fin });
    } else {
      const cur = map.get(etapa);
      if (cmpIso(ini, cur.minIni) < 0) cur.minIni = ini;
      if (cmpIso(fin, cur.maxFin) > 0) cur.maxFin = fin;
    }
  }

  const present = Array.from(map.values());

  const ordered = [];
  for (const e of order) {
    const found = present.find((x) => x.etapa === e);
    if (found) ordered.push(found);
  }
  for (const x of present) {
    if (!order.includes(x.etapa)) ordered.push(x);
  }

  return ordered.map((x) => ({
    etapa: x.etapa,
    rango: `${formatLongDateEsMX(x.minIni)} – ${formatLongDateEsMX(x.maxFin || x.minIni)}`,
    color: stageColor(x.etapa),
  }));
}

function stageColor(etapa) {
  const s = String(etapa || "");
  if (s === "DESARROLLO") return "#e84b64";
  if (s === "PREPRODUCCIÓN") return "#1f6f54";
  if (s === "RODAJE") return "#2f63c6";
  if (s === "EDICIÓN") return "#0e7c86";
  if (s === "POSTPRODUCCIÓN") return "#8b6cff";
  return "#1f2a44";
}

function safeIsoDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d)) return "";
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function cmpIso(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function formatLongDateEsMX(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d)) return s;
  const day = d.getDate();
  const month = d.toLocaleDateString("es-MX", { month: "long" });
  const year = d.getFullYear();
  return `${day} de ${month} ${year}`;
}

/* =========================================================
   HTML -> PDF bytes (html2canvas + jsPDF)
   ✅ V2: si hay logo, lo estampa en cada página (arriba derecha)
   ✅ V3: agrega una hoja resumen antes del contenido actual
========================================================= */
async function htmlToPdfBytesFromRutaCriticaHTML(htmlOrOpts) {
  const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
  ]);

  const jsPDF = jsPdfMod.jsPDF || jsPdfMod.default?.jsPDF || jsPdfMod.default || jsPdfMod;

  const mainHtml = typeof htmlOrOpts === "string" ? htmlOrOpts : (htmlOrOpts?.html || "");
  const resumenHtml = typeof htmlOrOpts === "string" ? null : (htmlOrOpts?.resumenHtml || null);

  const logoDataUrl = await readLogoDataUrlFromDocs();
  let logoStamp = null;

  if (logoDataUrl) {
    try {
      const img = await loadImageFromDataUrl(logoDataUrl);

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

      const headerExtra = h + 12;
      logoStamp = { imgData: logoDataUrl, wpt: w, hpt: h, headerExtra, format };
    } catch {
      logoStamp = null;
    }
  }

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 18;
  const headerExtra = logoStamp ? logoStamp.headerExtra : 0;
  const usableW = pageWidth - margin * 2;
  const usableH = pageHeight - margin * 2 - headerExtra;

  async function renderHtmlToCanvas(html) {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-99999px";
    iframe.style.top = "0";
    iframe.style.width = "2000px";
    iframe.style.height = "1200px";
    iframe.style.opacity = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;

    try {
      doc.open();
      doc.write(html);
      doc.close();

      await new Promise((r) => setTimeout(r, 250));
      try { await doc.fonts?.ready; } catch {}

      const table = doc.getElementById("rcTable");
      const surface = doc.getElementById("printSurface") || doc.body;

      const canvas = await html2canvas(surface, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        windowWidth: table?.scrollWidth || surface.scrollWidth || 2000,
        windowHeight: surface.scrollHeight || 1200,
      });

      return canvas;
    } finally {
      try { iframe.remove(); } catch {}
    }
  }

  function stampLogoIfAny() {
    if (!logoStamp) return;
    stampLogoOnPage(pdf, logoStamp.imgData, logoStamp.wpt, logoStamp.hpt, {
      margin,
      topInset: 8,
      format: logoStamp.format,
    });
  }

  function addImageToCurrentPage(imgData, imgW, imgH) {
    pdf.addImage(imgData, "JPEG", margin, margin + headerExtra, imgW, imgH, undefined, "FAST");
    stampLogoIfAny();
  }

  async function addCanvasAsPages(canvas, addPageBeforeFirst) {
    const scale = usableW / canvas.width;
    const fullImgH = canvas.height * scale;

    if (fullImgH <= usableH) {
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      if (addPageBeforeFirst) pdf.addPage();
      addImageToCurrentPage(imgData, usableW, fullImgH);
      return;
    }

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

      if (addPageBeforeFirst || pageIndex > 0) pdf.addPage();
      addImageToCurrentPage(imgData, usableW, h * scale);

      y += h;
      pageIndex++;
      addPageBeforeFirst = false;
    }
  }

  let usedFirstPage = false;

  if (resumenHtml) {
    const resumenCanvas = await renderHtmlToCanvas(resumenHtml);
    await addCanvasAsPages(resumenCanvas, false);
    usedFirstPage = true;
  }

  if (mainHtml) {
    const mainCanvas = await renderHtmlToCanvas(mainHtml);
    await addCanvasAsPages(mainCanvas, usedFirstPage);
  }

  const buf = pdf.output("arraybuffer");
  return new Uint8Array(buf);
}

/* =======================================================
   UTILIDADES
========================================================= */
function getPreviousMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getWeekNumber(date, startMonday) {
  const diff = date - startMonday;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildBlocks(weeks, type) {
  const blocks = [];
  let current = null;

  weeks.forEach((w) => {
    const label =
      type === "year"
        ? String(w.year)
        : new Date(w.monday).toLocaleString("es-MX", { month: "long" }).toUpperCase();

    if (!current || current.label !== label) {
      current = { label, span: 1 };
      blocks.push(current);
    } else {
      current.span++;
    }
  });

  return blocks;
}

function getColorForTask(name) {
  const colors = [
    "#8ecae6", "#90be6d", "#f9c74f", "#f9844a", "#cdb4db",
    "#a8dadc", "#ffafcc", "#ffd166", "#84a59d", "#bde0fe",
  ];

  let hash = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }

  return colors[Math.abs(hash) % colors.length];
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

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}
