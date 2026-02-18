/* =========================================================
   src/services/rutaCriticaPreview.js
   Vista previa tipo Excel – Ruta Crítica
   ✅ Exportar PDF ajustado al ancho total (fit-to-width)

   ✅ FIX REAL (QUIRÚRGICO)
   - Guarda data en localStorage con una key fija:
     RUTA_CRITICA_V1_DATA
   - exportarRutaCriticaPdfBytes() puede funcionar aunque Entrega
     NO le pase {data}
========================================================= */

const LS_RC_KEY = "RUTA_CRITICA_V1_DATA";

export function abrirVistaPreviaRutaCritica({ data, projectName }) {
  if (!data || !data.length) {
    alert("No hay tareas para visualizar.");
    return;
  }

  // ✅ GUARDA DATA PARA ENTREGA (FIX)
  persistRutaCriticaData(data);

  const computed = computeRutaCritica(data);

  const html = buildRutaCriticaHTML({
    data: computed.data,
    projectName,
    totalWeeks: computed.totalWeeks,
    weeks: computed.weeks,
    yearBlocks: computed.yearBlocks,
    monthBlocks: computed.monthBlocks,
    etapas: computed.etapas,
  });

  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

/* =========================================================
   ✅ Export a PDF en memoria para ENTREGA
   - Si no recibe data, la toma de localStorage (key fija)
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
    throw new Error("No encontré datos de Ruta Crítica para exportar. Abre Ruta Crítica y la Vista Previa al menos una vez para cachear la data.");
  }

  // ✅ Asegura persistencia (por si viene desde window)
  persistRutaCriticaData(picked);

  const computed = computeRutaCritica(picked);

  const html = buildRutaCriticaHTML({
    data: computed.data,
    projectName: projectName || "Proyecto",
    totalWeeks: computed.totalWeeks,
    weeks: computed.weeks,
    yearBlocks: computed.yearBlocks,
    monthBlocks: computed.monthBlocks,
    etapas: computed.etapas,
  });

  return await htmlToPdfBytesFromRutaCriticaHTML(html);
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
  const data = (inputData || []).map(d => ({
    etapa: d?.etapa ?? d?.Etapa ?? d?.stage ?? "",
    tarea: d?.tarea ?? d?.Tarea ?? d?.task ?? "",
    inicio: d?.inicio ?? d?.Inicio ?? d?.start ?? "",
    fin: d?.fin ?? d?.Fin ?? d?.end ?? "",
  }));

  const fechasInicio = data.map(d => new Date(d.inicio)).filter(x => !isNaN(x));
  const minDate = new Date(Math.min(...fechasInicio));
  const projectStartMonday = getPreviousMonday(minDate);

  const withWeeks = data.map(d => {
    const ini = new Date(d.inicio);
    const fin = new Date(d.fin);
    const inicioWeek = getWeekNumber(ini, projectStartMonday);
    const finWeek = getWeekNumber(fin, projectStartMonday);
    return { ...d, inicioWeek, finWeek };
  });

  const maxDate = new Date(Math.max(...withWeeks.map(d => new Date(d.fin)).filter(x => !isNaN(x))));
  const totalWeeks = getWeekNumber(maxDate, projectStartMonday);

  const weeks = [];
  for (let i = 1; i <= totalWeeks; i++) {
    const monday = addDays(projectStartMonday, (i - 1) * 7);
    weeks.push({ week: i, monday, year: monday.getFullYear(), month: monday.getMonth() });
  }

  const yearBlocks = buildBlocks(weeks, "year");
  const monthBlocks = buildBlocks(weeks, "month");

  const etapas = [];
  withWeeks.forEach(d => {
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
   HTML builder (tu mismo HTML)
========================================================= */
function buildRutaCriticaHTML({ data, projectName, totalWeeks, weeks, yearBlocks, monthBlocks, etapas }) {
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

<div class="topbar">
  <div><b>Vista previa Ruta Crítica</b></div>
  <button id="btnExport">Exportar PDF</button>
</div>

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

  btn.addEventListener("click", () => {
    fitToWidthForPrint();
    window.print();
    setTimeout(() => { document.body.style.zoom = "1"; }, 300);
  });
})();
</script>

</body>
</html>
`;
}

/* =========================================================
   HTML -> PDF bytes (html2canvas + jsPDF)
========================================================= */
async function htmlToPdfBytesFromRutaCriticaHTML(html) {
  const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
  ]);

  const jsPDF = jsPdfMod.jsPDF || jsPdfMod.default?.jsPDF || jsPdfMod.default || jsPdfMod;

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
    windowWidth: (table?.scrollWidth || surface.scrollWidth || 2000),
    windowHeight: (surface.scrollHeight || 1200),
  });

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 18;
  const usableW = pageWidth - margin * 2;
  const usableH = pageHeight - margin * 2;

  const scale = usableW / canvas.width;
  const fullImgH = canvas.height * scale;

  if (fullImgH <= usableH) {
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(imgData, "JPEG", margin, margin, usableW, fullImgH, undefined, "FAST");
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
      pdf.addImage(imgData, "JPEG", margin, margin, usableW, h * scale, undefined, "FAST");

      y += h;
      pageIndex++;
    }
  }

  const buf = pdf.output("arraybuffer");
  try { iframe.remove(); } catch {}
  return new Uint8Array(buf);
}

/* =======================================================
   UTILIDADES
========================================================= */
function getPreviousMonday(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getWeekNumber(date, startMonday){
  const diff = date - startMonday;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function addDays(date, days){
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildBlocks(weeks, type){
  const blocks = [];
  let current = null;

  weeks.forEach(w => {
    const label = type === "year"
      ? String(w.year)
      : new Date(w.monday).toLocaleString("es-MX", { month:"long" }).toUpperCase();

    if (!current || current.label !== label){
      current = { label, span:1 };
      blocks.push(current);
    } else {
      current.span++;
    }
  });

  return blocks;
}

function getColorForTask(name){
  const colors = [
    "#8ecae6","#90be6d","#f9c74f","#f9844a","#cdb4db",
    "#a8dadc","#ffafcc","#ffd166","#84a59d","#bde0fe"
  ];

  let hash = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++){
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
