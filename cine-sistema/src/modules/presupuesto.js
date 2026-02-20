/* =========================================================
  src/modules/presupuesto.js
  PRESUPUESTO V1 (localStorage) + CARGA MASIVA (paste Excel)

  ✅ Etapa por gasto: PREPRODUCCIÓN | PRODUCCIÓN | POSTPRODUCCIÓN
  ✅ Cuenta: solo nombre (lista fija)
  ✅ Cantidad
  ✅ Candado: NO permite 0 o negativos en monto/cantidad/plazo
  ✅ Reglas:
      - Subtotal = monto * cantidad * plazo
      - IVA 16% SOLO si Entidad = FOCINE
      - FOCINE => FormaPago siempre EFECTIVO (forzado)
      - CENTRO => FormaPago siempre ESPECIE (forzado)
      - TipoPago PROYECTO => Plazo = 1 (forzado)
  ✅ Exportar PDF (usa services/presupuestoPdfExport.js)
  ✅ Carga masiva: pegar TSV/CSV + preview + agregar en lote

  ✅ AJUSTE QUIRÚRGICO (NUEVO):
      - Selección múltiple en tabla (Ctrl/Cmd + click)
      - Shift + click selecciona rango (opcional, incluido)
      - Editar solo si hay 1 seleccionado
      - Eliminar si hay 1+ seleccionados

  ✅ V2 - PRIMER CAMBIO (PUNTUAL):
      - ELIMINAR POR COMPLETO "CARTAS" Y "COTIZACIONES" DEL PRESUPUESTO
        * Sin columnas COT/CARTA
        * Sin inputs de archivo
        * Sin campos cot/carta en datos, CSV ni carga masiva

  ✅ FIX QUIRÚRGICO:
      - Evitar crash: saveInFlight debe existir ANTES del primer renderAll()

  ✅ NUEVO (AJUSTE QUIRÚRGICO SOLICITADO):
      - Barra de búsqueda (texto) para coincidencias en gastos (Concepto / Cuenta / Entidad / Etapa)
      - Filtro simple para visualización (Etapa: Todas + PRE/PROD/POST)
      - Paginado en “pestaña” (20 en 20) + botón “Ver todos”
========================================================= */

import { exportarPresupuestoPDF } from "../services/presupuestoPdfExport.js";
import { loadModuleState, saveModuleState } from "../services/stateService.js";

/* =========================================================
  ✅ CAMBIO QUIRÚRGICO:
  Exponer función global para que Documentación pueda abrir
  la vista previa de Presupuesto igual que Ruta Crítica.
========================================================= */
if (typeof window !== "undefined") {
  window.openPresupuestoPreview = function () {
    try {
      exportarPresupuestoPDF();
    } catch (e) {
      alert(e?.message || String(e));
    }
  };
}

const LS_KEY = "BUDGET_V1_ITEMS";
const LS_SEQ = "BUDGET_V1_SEQ";

const ETAPAS = ["PREPRODUCCIÓN", "PRODUCCIÓN", "POSTPRODUCCIÓN"];
const ENTIDADES = ["FOCINE", "CENTRO", "INTERNO", "TERCEROS"];
const FORMAS_PAGO = ["EFECTIVO", "ESPECIE"];
const TIPOS_PAGO = ["PROYECTO", "DIA"];

// ✅ Tus cuentas
const CUENTAS = [
  "DESARROLLO",
  "PREPRODUCCIÓN",
  "PERSONAL DE DIRECCIÓN ",
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
  "GASTOS CONTABLES ",
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

export function renderPresupuestoView() {
  const cuentasOptions = CUENTAS.map(
    (c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`
  ).join("");

  const etapasOptions = ETAPAS.map(
    (e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`
  ).join("");

  const filtroEtapasOptions = [
    `<option value="">Todas las etapas</option>`,
    ...ETAPAS.map((e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`),
  ].join("");

  return `
    <div class="grid">
      <div class="card">
        <h2>Presupuesto / Esquema</h2>
        <p class="muted">Se actualiza automáticamente al crear/editar/eliminar.</p>

        <div class="table-wrap">
          <table class="table" id="budgetSummaryTable">
            <thead>
              <tr>
                <th>Entidad</th>
                <th>EFECTIVO</th>
                <th>ESPECIE</th>
                <th>Total</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody id="budgetSummaryTbody"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Acciones</h2>
        <div class="rc-actions">
          <button id="bgBtnCrear" class="btn btn-primary">Crear</button>
          <button id="bgBtnEditar" class="btn btn-light" disabled>Editar</button>
          <button id="bgBtnEliminar" class="btn btn-danger" disabled>Eliminar</button>
        </div>

        <div class="rc-actions" style="margin-top:10px;">
          <button id="bgBtnCargaMasiva" class="btn btn-secondary">Carga masiva</button>
          <button id="bgBtnExportarPDF" class="btn btn-secondary">VISTA PREVIA</button>
          <button id="bgBtnDescargar" class="btn btn-light">Descargar CSV</button>
        </div>

        <hr class="hr" />
        <p class="muted">
          Modo actual: <b>V1_LOCAL_ONLY</b>
        </p>
      </div>
    </div>

    <div class="card mt">
      <h2>Desglose</h2>
      <p class="muted">Tip: Ctrl/Cmd + click para seleccionar varios. Shift + click para rango.</p>

      <!-- ✅ NUEVO: Buscador + filtro + pestañas (paginado / todos) -->
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:10px 0 12px;">
        <div style="flex:1; min-width:220px;">
          <input id="bgSearchInput" type="text" placeholder="Buscar (concepto, cuenta, entidad, etapa)…"
                 style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); outline:none;" />
        </div>

        <div style="min-width:220px;">
          <select id="bgFilterEtapa" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12);">
            ${filtroEtapasOptions}
          </select>
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <button id="bgTabPaged" class="btn btn-light">Paginado (20)</button>
          <button id="bgTabAll" class="btn btn-light">Ver todos</button>
        </div>
      </div>

      <!-- ✅ NUEVO: Controles paginado -->
      <div id="bgPagerBar" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:-2px 0 10px;">
        <button id="bgPagePrev" class="btn btn-light">←</button>
        <div class="muted" id="bgPageInfo">Página 1 / 1</div>
        <button id="bgPageNext" class="btn btn-light">→</button>
        <div style="flex:1"></div>
        <div class="muted" id="bgResultsInfo">0 resultados</div>
      </div>

      <div class="table-wrap">
        <table class="table" id="budgetTable">
          <thead>
            <tr>
              <th>Etapa</th>
              <th>Concepto</th>
              <th>Cuenta</th>
              <th>Entidad</th>
              <th>Forma de pago</th>
              <th>Tipo de pago</th>
              <th>Monto</th>
              <th>Cantidad</th>
              <th>Plazo</th>
              <th>Subtotal</th>
              <th>IVA</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody id="budgetTbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Modal Crear/Editar -->
    <div id="bgModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h3 id="bgModalTitle">Crear gasto</h3>
          <button id="bgModalClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <label>
              <span>Etapa</span>
              <select id="bgEtapa">${etapasOptions}</select>
            </label>

            <label>
              <span>Concepto</span>
              <input id="bgConcepto" type="text" placeholder="Ej. Renta Cámara" />
            </label>

            <label>
              <span>Cuenta</span>
              <select id="bgCuenta">${cuentasOptions}</select>
            </label>

            <label>
              <span>Entidad</span>
              <select id="bgEntidad">
                <option value="FOCINE">FOCINE</option>
                <option value="CENTRO">CENTRO</option>
                <option value="INTERNO">INTERNO</option>
                <option value="TERCEROS">TERCEROS</option>
              </select>
            </label>

            <label>
              <span>Forma de pago</span>
              <select id="bgFormaPago">
                <option value="EFECTIVO">EFECTIVO</option>
                <option value="ESPECIE">ESPECIE</option>
              </select>
            </label>

            <label>
              <span>Tipo de pago</span>
              <select id="bgTipoPago">
                <option value="PROYECTO">PROYECTO</option>
                <option value="DIA">DÍA</option>
              </select>
            </label>

            <label>
              <span>Monto (costo unidad)</span>
              <input id="bgMonto" type="number" min="0.01" step="0.01" placeholder="0.00" />
            </label>

            <label>
              <span>Cantidad</span>
              <input id="bgCantidad" type="number" min="1" step="1" placeholder="1" />
            </label>

            <label>
              <span>Plazo</span>
              <input id="bgPlazo" type="number" min="1" step="1" placeholder="1" />
            </label>
          </div>

          <p class="muted" id="bgValidationMsg" style="display:none; margin-top:10px;"></p>
        </div>

        <div class="modal-footer">
          <button id="bgModalCancel" class="btn btn-light">Cancelar</button>
          <button id="bgModalSave" class="btn btn-primary">Guardar</button>
        </div>
      </div>
    </div>

    <!-- Modal Carga Masiva -->
    <div id="bgBulkBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width: 1020px;">
        <div class="modal-header">
          <h3>Carga masiva (pegar desde Excel)</h3>
          <button id="bgBulkClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body">
          <p class="muted" style="margin:0 0 10px;">
            Formato recomendado (tabulado):
            <br/>
            <b>ETAPA | CONCEPTO | CUENTA | ENTIDAD | FORMA_PAGO | TIPO_PAGO | MONTO | CANTIDAD | PLAZO</b>
          </p>

          <div class="rc-actions" style="margin:10px 0 10px; gap:10px; flex-wrap:wrap;">
            <input id="bgBulkFile" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <button id="bgBulkLoadFile" class="btn btn-light" type="button">Cargar archivo (CSV/XLSX)</button>
            <button id="bgBulkTemplate" class="btn btn-light" type="button">Descargar plantilla CSV</button>
            <div class="muted" style="flex:1; min-width:220px;">
              Tip: para evitar que “se corran” columnas, usa la plantilla XLSX con listas o importa CSV desde archivo.
            </div>
          </div>

          <textarea id="bgBulkText" style="width:100%; height:160px; resize:vertical;"
placeholder="ETAPA	CONCEPTO	CUENTA	ENTIDAD	FORMA_PAGO	TIPO_PAGO	MONTO	CANTIDAD	PLAZO
PREPRODUCCIÓN	Renta cámara	PERSONAL DE CÁMARA	FOCINE	EFECTIVO	DIA	5000	1	3"></textarea>

          <div class="rc-actions" style="margin-top:10px;">
            <button id="bgBulkPreview" class="btn btn-secondary">Previsualizar</button>
            <div style="flex:1"></div>
            <button id="bgBulkCommit" class="btn btn-primary" disabled>Agregar 0 gastos</button>
          </div>

          <div id="bgBulkErrors" class="muted" style="display:none; margin-top:10px;"></div>

          <div class="table-wrap" style="margin-top:10px;">
            <table class="table" id="bgBulkTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Etapa</th>
                  <th>Concepto</th>
                  <th>Cuenta</th>
                  <th>Entidad</th>
                  <th>Forma</th>
                  <th>Tipo pago</th>
                  <th>Monto</th>
                  <th>Cantidad</th>
                  <th>Plazo</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody id="bgBulkTbody"></tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer">
          <button id="bgBulkCancel" class="btn btn-light">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

export async function bindPresupuestoEvents() {
  const summaryTbody = document.getElementById("budgetSummaryTbody");
  const tbody = document.getElementById("budgetTbody");

  const btnCrear = document.getElementById("bgBtnCrear");
  const btnEditar = document.getElementById("bgBtnEditar");
  const btnEliminar = document.getElementById("bgBtnEliminar");
  const btnDescargar = document.getElementById("bgBtnDescargar");
  const btnExportarPDF = document.getElementById("bgBtnExportarPDF");
  const btnCargaMasiva = document.getElementById("bgBtnCargaMasiva");

  // ✅ NUEVO: UI buscador/filtro/paginado
  const inpSearch = document.getElementById("bgSearchInput");
  const selFilterEtapa = document.getElementById("bgFilterEtapa");
  const btnTabPaged = document.getElementById("bgTabPaged");
  const btnTabAll = document.getElementById("bgTabAll");
  const pagerBar = document.getElementById("bgPagerBar");
  const btnPagePrev = document.getElementById("bgPagePrev");
  const btnPageNext = document.getElementById("bgPageNext");
  const pageInfo = document.getElementById("bgPageInfo");
  const resultsInfo = document.getElementById("bgResultsInfo");

  // Modal crear/editar
  const modalBackdrop = document.getElementById("bgModalBackdrop");
  const modalTitle = document.getElementById("bgModalTitle");
  const modalClose = document.getElementById("bgModalClose");
  const modalCancel = document.getElementById("bgModalCancel");
  const modalSave = document.getElementById("bgModalSave");
  const validationMsg = document.getElementById("bgValidationMsg");

  const selEtapa = document.getElementById("bgEtapa");
  const inpConcepto = document.getElementById("bgConcepto");
  const selCuenta = document.getElementById("bgCuenta");
  const selEntidad = document.getElementById("bgEntidad");
  const selFormaPago = document.getElementById("bgFormaPago");
  const selTipoPago = document.getElementById("bgTipoPago");
  const inpMonto = document.getElementById("bgMonto");
  const inpCantidad = document.getElementById("bgCantidad");
  const inpPlazo = document.getElementById("bgPlazo");

  // Modal carga masiva
  const bulkBackdrop = document.getElementById("bgBulkBackdrop");
  const bulkClose = document.getElementById("bgBulkClose");
  const bulkCancel = document.getElementById("bgBulkCancel");
  const bulkText = document.getElementById("bgBulkText");
  const bulkFile = document.getElementById("bgBulkFile");
  const bulkLoadFile = document.getElementById("bgBulkLoadFile");
  const bulkTemplate = document.getElementById("bgBulkTemplate");
  const bulkPreview = document.getElementById("bgBulkPreview");
  const bulkCommit = document.getElementById("bgBulkCommit");
  const bulkErrors = document.getElementById("bgBulkErrors");
  const bulkTbody = document.getElementById("bgBulkTbody");

  const userId = window?.appState?.user?.uid;
  const projectId = window?.appState?.profile?.projectId;
  if (!userId || !projectId) throw new Error("Sesión/proyecto no inicializado para Presupuesto.");

  const MODULE_KEY = "presupuesto";

  // ✅ estado server
  let seq = 0;
  let items = [];

  try {
    const serverState = await loadModuleState({ userId, projectId, moduleKey: MODULE_KEY });
    items = Array.isArray(serverState?.items) ? serverState.items : [];
    seq = Number.isFinite(Number(serverState?.seq)) ? Number(serverState.seq) : 0;
  } catch (e) {
    throw new Error(`No pude cargar Presupuesto desde servidor: ${e?.message || String(e)}`);
  }

  /* =========================================================
    ✅ FIX QUIRÚRGICO:
    Declarar saveInFlight ANTES del primer renderAll()
  ========================================================= */
  let saveInFlight = Promise.resolve();

  function saveItemsAsync() {
    saveInFlight = saveInFlight
      .catch(() => {})
      .then(() =>
        saveModuleState({
          userId,
          projectId,
          moduleKey: MODULE_KEY,
          data: { seq, items },
        })
      );

    return saveInFlight;
  }

  function getNextSeqLocal() {
    seq = (Number.isFinite(seq) ? seq : 0) + 1;
    return seq;
  }

  function mkUid() {
    return crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now());
  }

  // ✅ selección múltiple
  let selectedUids = new Set();
  let lastClickedUid = null;

  let modalMode = "create";

  // bulk state
  let bulkParsed = [];

  // ✅ NUEVO: estado UI (filtro/busqueda/paginado)
  const PAGE_SIZE = 20;
  let uiSearch = "";
  let uiFilterEtapa = ""; // "" => todas
  let uiViewAll = false; // false => paginado (20)
  let uiPage = 0; // 0-based

  // init pestañas UI
  if (btnTabPaged && btnTabAll) {
    setTabButtons();
  }
  if (pagerBar) {
    pagerBar.style.display = uiViewAll ? "none" : "flex";
  }

  renderAll();

  // Acciones
  btnCrear.addEventListener("click", () => openModal("create"));
  btnEditar.addEventListener("click", () => openModal("edit"));
  btnEliminar.addEventListener("click", deleteSelected);
  btnDescargar.addEventListener("click", downloadCSV);

  btnExportarPDF.addEventListener("click", () => {
    try {
      window.openPresupuestoPreview();
    } catch (e) {
      try {
        exportarPresupuestoPDF();
      } catch (err) {
        alert(err?.message || String(err));
      }
    }
  });

  // Carga masiva
  btnCargaMasiva.addEventListener("click", openBulkModal);
  bulkClose.addEventListener("click", closeBulkModal);
  bulkCancel.addEventListener("click", closeBulkModal);
  bulkBackdrop.addEventListener("click", (e) => {
    if (e.target === bulkBackdrop) closeBulkModal();
  });
  bulkPreview.addEventListener("click", previewBulk);
  bulkCommit.addEventListener("click", commitBulk);

  // ✅ Importar desde archivo (CSV/XLSX)
  bulkLoadFile?.addEventListener("click", () => {
    void loadBulkFromFile();
  });
  bulkTemplate?.addEventListener("click", downloadBulkTemplateCSV);

  // Modal create/edit
  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  modalSave.addEventListener("click", saveModal);

  selEntidad.addEventListener("change", applyEntidadRulesToModal);
  selTipoPago.addEventListener("change", applyTipoPagoRulesToModal);

  inpMonto.addEventListener("blur", () => clampInput(inpMonto, 0.01, false));
  inpCantidad.addEventListener("blur", () => clampInput(inpCantidad, 1, true));
  inpPlazo.addEventListener("blur", () => clampInput(inpPlazo, 1, true));

  // ✅ NUEVO: buscador + filtro + pestañas + paginado
  inpSearch?.addEventListener("input", () => {
    uiSearch = (inpSearch.value || "").trim();
    uiPage = 0;
    renderTable();
  });

  selFilterEtapa?.addEventListener("change", () => {
    uiFilterEtapa = (selFilterEtapa.value || "").trim();
    uiPage = 0;
    renderTable();
  });

  btnTabPaged?.addEventListener("click", () => {
    uiViewAll = false;
    uiPage = 0;
    setTabButtons();
    if (pagerBar) pagerBar.style.display = "flex";
    renderTable();
  });

  btnTabAll?.addEventListener("click", () => {
    uiViewAll = true;
    uiPage = 0;
    setTabButtons();
    if (pagerBar) pagerBar.style.display = "none";
    renderTable();
  });

  btnPagePrev?.addEventListener("click", () => {
    uiPage = Math.max(0, uiPage - 1);
    renderTable();
  });

  btnPageNext?.addEventListener("click", () => {
    const { totalPages } = getFilteredAndPagedItems();
    uiPage = Math.min(Math.max(0, totalPages - 1), uiPage + 1);
    renderTable();
  });

  function setTabButtons() {
    // Mantenerlo simple, sin depender de CSS global
    if (!btnTabPaged || !btnTabAll) return;
    const on = (btn) => {
      btn.style.border = "1px solid rgba(0,0,0,.12)";
      btn.style.fontWeight = "900";
      btn.style.opacity = "1";
    };
    const off = (btn) => {
      btn.style.border = "1px solid rgba(0,0,0,.10)";
      btn.style.fontWeight = "700";
      btn.style.opacity = ".75";
    };
    if (uiViewAll) {
      off(btnTabPaged);
      on(btnTabAll);
    } else {
      on(btnTabPaged);
      off(btnTabAll);
    }
  }

  function normalizeEtapa(v) {
    const s = norm(v);
    if (s === "PREPRODUCCION" || s === "PRE PRODUCCION") return "PREPRODUCCIÓN";
    if (s === "PRODUCCION") return "PRODUCCIÓN";
    if (s === "POSTPRODUCCION" || s === "POST PRODUCCION" || s === "POST-PRODUCCION") return "POSTPRODUCCIÓN";
    return null;
  }

  function normalizeEntidad(v) {
    const s = norm(v);
    if (s === "FOCINE") return "FOCINE";
    if (s === "CENTRO") return "CENTRO";
    if (s === "INTERNO") return "INTERNO";
    if (s === "TERCEROS") return "TERCEROS";
    return null;
  }

  function normalizeTipoPago(v) {
    const s = norm(v);
    if (s === "PROYECTO") return "PROYECTO";
    if (s === "DIA" || s === "DÍA") return "DIA";
    return null;
  }

  function normalizeFormaPago(v) {
    const s = norm(v);
    if (s === "EFECTIVO") return "EFECTIVO";
    if (s === "ESPECIE") return "ESPECIE";
    return null;
  }

  function normalizeCuenta(v) {
    const raw = (v ?? "").toString().trim();
    const target = norm(raw);
    const found = CUENTAS.find((c) => norm(c) === target);
    return found || null;
  }

  function applyFormaRules(entidad, formaRaw) {
    if (entidad === "FOCINE") return "EFECTIVO";
    if (entidad === "CENTRO") return "ESPECIE";
    return formaRaw || "EFECTIVO";
  }

  function normalizeItem(it) {
    const entidad = it.entidad;
    const formaPago = applyFormaRules(entidad, (it.formaPago || "EFECTIVO").toUpperCase());

    let plazo = parseInt(it.plazo ?? 1, 10);
    if (!Number.isFinite(plazo) || plazo < 1) plazo = 1;
    if (it.tipoPago === "PROYECTO") plazo = 1;

    let cantidad = parseInt(it.cantidad ?? 1, 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;

    const monto = toPositiveNumber(it.monto, 0.01);

    const subtotal = round2(monto * plazo * cantidad);
    const iva = entidad === "FOCINE" ? round2(subtotal * 0.16) : 0;
    const total = round2(subtotal + iva);

    return {
      uid: it.uid || mkUid(),
      folio: it.folio ?? null,
      etapa: it.etapa,
      concepto: (it.concepto || "").trim(),
      cuenta: it.cuenta,
      entidad,
      formaPago,
      tipoPago: it.tipoPago,
      monto,
      cantidad,
      plazo,
      subtotal,
      iva,
      total,
      createdAt: it.createdAt ?? Date.now(),
      updatedAt: it.updatedAt ?? Date.now(),
    };
  }

  function renderAll() {
    items = items.map((x) => {
      const etapa = normalizeEtapa(x.etapa) || ETAPAS[0];
      const entidad = normalizeEntidad(x.entidad) || "FOCINE";
      const tipoPago = normalizeTipoPago(x.tipoPago) || "PROYECTO";
      const cuenta = normalizeCuenta(x.cuenta) || CUENTAS[0];
      const forma = normalizeFormaPago(x.formaPago) || "EFECTIVO";

      return normalizeItem({ ...x, etapa, entidad, tipoPago, cuenta, formaPago: forma });
    });

    const valid = new Set(items.map((x) => x.uid));
    selectedUids = new Set([...selectedUids].filter((u) => valid.has(u)));
    if (lastClickedUid && !valid.has(lastClickedUid)) lastClickedUid = null;

    saveItemsAsync().catch((e) => console.error("[presupuesto] saveModuleState failed:", e));

    renderSummary();
    renderTable();
    syncButtons();
  }

  function syncButtons() {
    const n = selectedUids.size;
    btnEditar.disabled = n !== 1;
    btnEliminar.disabled = n === 0;
  }

  function renderSummary() {
    const totals = {
      FOCINE: { efectivo: 0, especie: 0 },
      CENTRO: { efectivo: 0, especie: 0 },
      INTERNO: { efectivo: 0, especie: 0 },
      TERCEROS: { efectivo: 0, especie: 0 },
    };

    items.forEach((it) => {
      const e = it.entidad;
      if (it.formaPago === "EFECTIVO") totals[e].efectivo += it.total;
      if (it.formaPago === "ESPECIE") totals[e].especie += it.total;
    });

    const rows = ["FOCINE", "CENTRO", "INTERNO", "TERCEROS"];
    const grandTotal = rows.reduce((acc, e) => acc + totals[e].efectivo + totals[e].especie, 0);

    summaryTbody.innerHTML = "";
    rows.forEach((e) => {
      const efectivo = round2(totals[e].efectivo);
      const especie = round2(totals[e].especie);
      const total = round2(efectivo + especie);
      const pct = grandTotal > 0 ? round2((total / grandTotal) * 100) : 0;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(e)}</td>
        <td>${money(efectivo)}</td>
        <td>${money(especie)}</td>
        <td><b>${money(total)}</b></td>
        <td><b>${pct.toFixed(1)}%</b></td>
      `;
      summaryTbody.appendChild(tr);
    });

    const totalEfectivo = rows.reduce((a, e) => a + totals[e].efectivo, 0);
    const totalEspecie = rows.reduce((a, e) => a + totals[e].especie, 0);

    const trTotal = document.createElement("tr");
    trTotal.innerHTML = `
      <td><b>Totales</b></td>
      <td><b>${money(round2(totalEfectivo))}</b></td>
      <td><b>${money(round2(totalEspecie))}</b></td>
      <td><b>${money(round2(totalEfectivo + totalEspecie))}</b></td>
      <td><b>100%</b></td>
    `;
    summaryTbody.appendChild(trTotal);
  }

  // ✅ NUEVO: obtiene items filtrados + paginados (sin alterar items)
  function getFilteredAndPagedItems() {
    const q = norm(uiSearch);
    const etapaFilter = (uiFilterEtapa || "").trim();

    const filtered = items.filter((it) => {
      if (etapaFilter && it.etapa !== etapaFilter) return false;

      if (!q) return true;

      const hay = [
        it.concepto,
        it.cuenta,
        it.entidad,
        it.etapa,
        it.formaPago,
        it.tipoPago,
      ]
        .filter(Boolean)
        .map(norm)
        .join(" | ");

      return hay.includes(q);
    });

    const total = filtered.length;

    if (uiViewAll) {
      return {
        filtered,
        pageItems: filtered,
        total,
        totalPages: 1,
        page: 0,
      };
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(uiPage, totalPages - 1));
    uiPage = safePage;

    const start = safePage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageItems = filtered.slice(start, end);

    return { filtered, pageItems, total, totalPages, page: safePage };
  }

  function renderTable() {
    const { pageItems, total, totalPages, page } = getFilteredAndPagedItems();

    tbody.innerHTML = "";
    pageItems.forEach((it) => {
      const tr = document.createElement("tr");
      tr.dataset.uid = it.uid;

      if (selectedUids.has(it.uid)) tr.classList.add("is-selected");

      tr.innerHTML = `
        <td>${escapeHtml(it.etapa)}</td>
        <td>${escapeHtml(it.concepto)}</td>
        <td>${escapeHtml(it.cuenta)}</td>
        <td>${escapeHtml(it.entidad)}</td>
        <td>${escapeHtml(it.formaPago)}</td>
        <td>${escapeHtml(it.tipoPago)}</td>
        <td>${money(it.monto)}</td>
        <td>${escapeHtml(it.cantidad)}</td>
        <td>${escapeHtml(it.plazo)}</td>
        <td>${money(it.subtotal)}</td>
        <td>${money(it.iva)}</td>
        <td><b>${money(it.total)}</b></td>
      `;

      tr.addEventListener("click", (ev) => onRowClick(ev, it.uid, pageItems));
      tbody.appendChild(tr);
    });

    // ✅ UI: page info + results
    if (resultsInfo) resultsInfo.textContent = `${total} resultado${total === 1 ? "" : "s"}`;

    if (uiViewAll) {
      if (pageInfo) pageInfo.textContent = `Mostrando todos (${total})`;
      if (btnPagePrev) btnPagePrev.disabled = true;
      if (btnPageNext) btnPageNext.disabled = true;
    } else {
      if (pageInfo) pageInfo.textContent = `Página ${page + 1} / ${totalPages}`;
      if (btnPagePrev) btnPagePrev.disabled = page <= 0;
      if (btnPageNext) btnPageNext.disabled = page >= totalPages - 1;
    }

    syncButtons();
  }

  function onRowClick(ev, uid, visibleItems) {
    const isToggle = ev.ctrlKey || ev.metaKey;
    const isRange = ev.shiftKey;

    if (isRange && lastClickedUid) {
      selectRange(lastClickedUid, uid, visibleItems);
      return;
    }

    if (isToggle) {
      if (selectedUids.has(uid)) selectedUids.delete(uid);
      else selectedUids.add(uid);
      lastClickedUid = uid;
      paintSelection();
      syncButtons();
      return;
    }

    selectedUids = new Set([uid]);
    lastClickedUid = uid;
    paintSelection();
    syncButtons();
  }

  // ✅ rango en el contexto visible (página actual / tabla actual)
  function selectRange(fromUid, toUid, visibleItems) {
    const rowUids = (visibleItems || []).map((x) => x.uid);
    const a = rowUids.indexOf(fromUid);
    const b = rowUids.indexOf(toUid);

    // Si no están ambos visibles, cae al comportamiento original (solo toUid)
    if (a === -1 || b === -1) {
      selectedUids = new Set([toUid]);
      lastClickedUid = toUid;
      paintSelection();
      syncButtons();
      return;
    }

    const [start, end] = a < b ? [a, b] : [b, a];
    const range = rowUids.slice(start, end + 1);

    selectedUids = new Set(range);
    lastClickedUid = toUid;

    paintSelection();
    syncButtons();
  }

  function paintSelection() {
    [...tbody.querySelectorAll("tr")].forEach((r) => {
      const uid = r.dataset.uid;
      if (uid && selectedUids.has(uid)) r.classList.add("is-selected");
      else r.classList.remove("is-selected");
    });
  }

  function applyEntidadRulesToModal() {
    const entidad = (selEntidad.value || "").toUpperCase();
    if (entidad === "FOCINE") {
      selFormaPago.value = "EFECTIVO";
      selFormaPago.disabled = true;
      return;
    }
    if (entidad === "CENTRO") {
      selFormaPago.value = "ESPECIE";
      selFormaPago.disabled = true;
      return;
    }
    selFormaPago.disabled = false;
  }

  function applyTipoPagoRulesToModal() {
    const tipo = (selTipoPago.value || "").toUpperCase();
    if (tipo === "PROYECTO") {
      inpPlazo.value = "1";
      inpPlazo.disabled = true;
      return;
    }
    inpPlazo.disabled = false;
  }

  function clampInput(inputEl, minValue, integerOnly) {
    const raw = (inputEl.value ?? "").toString().trim();
    if (!raw) return;
    let n = Number(raw);
    if (!Number.isFinite(n)) n = minValue;
    if (integerOnly) n = Math.floor(n);
    if (n < minValue) n = minValue;
    inputEl.value = integerOnly ? String(parseInt(n, 10)) : String(round2(n));
  }

  function openModal(mode) {
    modalMode = mode;
    validationMsg.style.display = "none";
    validationMsg.textContent = "";

    if (mode === "create") {
      modalTitle.textContent = "Crear gasto";
      selEtapa.value = ETAPAS[0];
      inpConcepto.value = "";
      selCuenta.value = CUENTAS[0];
      selEntidad.value = "FOCINE";
      selFormaPago.value = "EFECTIVO";
      selTipoPago.value = "PROYECTO";
      inpMonto.value = "";
      inpCantidad.value = "1";
      inpPlazo.value = "1";
      applyEntidadRulesToModal();
      applyTipoPagoRulesToModal();
    } else {
      if (selectedUids.size !== 1) return;
      const onlyUid = [...selectedUids][0];

      const it = items.find((x) => x.uid === onlyUid);
      if (!it) return;

      modalTitle.textContent = "Editar gasto";
      selEtapa.value = it.etapa || ETAPAS[0];
      inpConcepto.value = it.concepto || "";
      selCuenta.value = it.cuenta || CUENTAS[0];
      selEntidad.value = it.entidad || "FOCINE";
      selFormaPago.value = it.formaPago || "EFECTIVO";
      selTipoPago.value = it.tipoPago || "PROYECTO";
      inpMonto.value = String(it.monto ?? "");
      inpCantidad.value = String(it.cantidad ?? 1);
      inpPlazo.value = String(it.plazo ?? 1);
      applyEntidadRulesToModal();
      applyTipoPagoRulesToModal();
    }

    modalBackdrop.style.display = "flex";
  }

  function closeModal() {
    modalBackdrop.style.display = "none";
  }

  function validateForm() {
    const concepto = inpConcepto.value.trim();
    if (!concepto) return "Falta: Concepto.";

    const monto = toPositiveNumber(inpMonto.value, 0.01);
    if (!(monto > 0)) return "Monto debe ser mayor a 0.";

    const cantidad = parseInt(inpCantidad.value || "1", 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) return "Cantidad debe ser 1 o mayor.";

    const tipo = (selTipoPago.value || "").toUpperCase();
    const plazo = parseInt(inpPlazo.value || "1", 10);

    if (tipo !== "PROYECTO") {
      if (!Number.isFinite(plazo) || plazo < 1) return "Plazo debe ser 1 o mayor.";
    }

    const cuenta = (selCuenta.value || "").trim();
    if (!cuenta) return "Falta: Cuenta.";

    return null;
  }

  async function saveModal() {
    clampInput(inpMonto, 0.01, false);
    clampInput(inpCantidad, 1, true);
    clampInput(inpPlazo, 1, true);

    const err = validateForm();
    if (err) {
      validationMsg.textContent = err;
      validationMsg.style.display = "block";
      return;
    }

    const etapa = selEtapa.value || ETAPAS[0];
    const cuenta = (selCuenta.value || CUENTAS[0]).trim();

    const entidad = (selEntidad.value || "").toUpperCase();
    let formaPago = (selFormaPago.value || "").toUpperCase();
    const tipoPago = (selTipoPago.value || "").toUpperCase();

    formaPago = applyFormaRules(entidad, formaPago);

    const monto = toPositiveNumber(inpMonto.value, 0.01);

    let plazo = parseInt(inpPlazo.value || "1", 10);
    if (!Number.isFinite(plazo) || plazo < 1) plazo = 1;
    if (tipoPago === "PROYECTO") plazo = 1;

    let cantidad = parseInt(inpCantidad.value || "1", 10);
    if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;

    const subtotal = round2(monto * plazo * cantidad);
    const iva = entidad === "FOCINE" ? round2(subtotal * 0.16) : 0;
    const total = round2(subtotal + iva);

    if (modalMode === "create") {
      const item = normalizeItem({
        uid: mkUid(),
        folio: getNextSeqLocal(),
        etapa,
        concepto: inpConcepto.value.trim(),
        cuenta,
        entidad,
        formaPago,
        tipoPago,
        monto,
        cantidad,
        plazo,
        subtotal,
        iva,
        total,
      });

      items.push(item);
      await saveItemsAsync();
      renderAll();

      selectedUids = new Set([item.uid]);
      lastClickedUid = item.uid;
      paintSelection();
      syncButtons();

      closeModal();
      return;
    }

    if (selectedUids.size !== 1) return;
    const onlyUid = [...selectedUids][0];

    const idx = items.findIndex((x) => x.uid === onlyUid);
    if (idx === -1) return;

    items[idx] = normalizeItem({
      ...items[idx],
      etapa,
      concepto: inpConcepto.value.trim(),
      cuenta,
      entidad,
      formaPago,
      tipoPago,
      monto,
      cantidad,
      plazo,
      subtotal,
      iva,
      total,
      updatedAt: Date.now(),
    });

    await saveItemsAsync();
    renderAll();

    selectedUids = new Set([items[idx].uid]);
    lastClickedUid = items[idx].uid;
    paintSelection();
    syncButtons();

    closeModal();
  }

  async function deleteSelected() {
    const n = selectedUids.size;
    if (n === 0) return;

    if (n === 1) {
      const uid = [...selectedUids][0];
      const it = items.find((x) => x.uid === uid);
      const ok = confirm(`¿Eliminar "${it?.concepto || "gasto"}"?`);
      if (!ok) return;

      items = items.filter((x) => x.uid !== uid);
      selectedUids.clear();
      lastClickedUid = null;

      await saveItemsAsync();
      renderAll();
      return;
    }

    const ok = confirm(`¿Eliminar ${n} gastos seleccionados?`);
    if (!ok) return;

    const toDelete = new Set(selectedUids);
    items = items.filter((x) => !toDelete.has(x.uid));
    selectedUids.clear();
    lastClickedUid = null;

    await saveItemsAsync();
    renderAll();
  }

  function csvEscape(v) {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCSV() {
    const headers = [
      "folio",
      "etapa",
      "concepto",
      "cuenta",
      "entidad",
      "formaPago",
      "tipoPago",
      "monto",
      "cantidad",
      "plazo",
      "subtotal",
      "iva",
      "total",
    ];
    const rows = items.map((it) => headers.map((h) => csvEscape(it[h] ?? "")).join(","));
    const csv = [headers.join(","), ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presupuesto_v2.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadBulkFromFile() {
    const file = bulkFile?.files?.[0];
    if (!file) {
      alert("Selecciona un archivo .CSV o .XLSX");
      return;
    }

    const name = (file.name || "").toLowerCase();
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls");

    try {
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const rows = await parseXlsxBudgetRows(buf);
        if (!rows.length) {
          alert("El archivo no contiene filas válidas en la hoja 'layout'.");
          return;
        }
        bulkText.value = rowsToTSV(rows, true);
        previewBulk();
        return;
      }

      // CSV
      const text = await file.text();
      const rows = parseCSVToRows(text);
      const normed = mapRowsToBudgetLayout(rows);
      if (!normed.length) {
        alert("El CSV no contiene filas válidas (revisa encabezados y datos).");
        return;
      }
      bulkText.value = rowsToTSV(normed, true);
      previewBulk();
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  function downloadBulkTemplateCSV() {
    const headers = ["ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD", "FORMA_PAGO", "TIPO_PAGO", "MONTO", "CANTIDAD", "PLAZO"];
    const sample = ["PREPRODUCCIÓN", "Renta cámara", "PERSONAL DE CÁMARA", "FOCINE", "EFECTIVO", "DIA", "5000", "1", "3"];
    const csv = [headers.join(","), sample.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_presupuesto.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function rowsToTSV(rows, includeHeader) {
    const header = ["ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD", "FORMA_PAGO", "TIPO_PAGO", "MONTO", "CANTIDAD", "PLAZO"];
    const lines = [];
    if (includeHeader) lines.push(header.join("\t"));
    for (const r of rows) {
      lines.push(
        [r.etapa, r.concepto, r.cuenta, r.entidad, r.formaPago, r.tipoPago, String(r.monto), String(r.cantidad), String(r.plazo)].join(
          "\t"
        )
      );
    }
    return lines.join("\n");
  }

  async function parseXlsxBudgetRows(arrayBuffer) {
    // SheetJS (XLSX) ESM CDN
    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");

    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames.includes("layout") ? "layout" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    // encontrar encabezado
    let headerRowIdx = -1;
    let colIdx = {};

    for (let i = 0; i < Math.min(20, grid.length); i++) {
      const row = (grid[i] || []).map((v) => norm(v));
      const hit = row.includes("ETAPA") && row.includes("CONCEPTO") && row.includes("CUENTA");
      if (hit) {
        headerRowIdx = i;
        const map = {};
        row.forEach((h, j) => {
          if (h) map[h] = j;
        });
        colIdx = map;
        break;
      }
    }

    if (headerRowIdx === -1) return [];

    const get = (row, key) => {
      const j = colIdx[key];
      if (j === undefined) return "";
      return (row[j] ?? "").toString().trim();
    };

    const out = [];
    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const etapa = get(row, "ETAPA");
      const concepto = get(row, "CONCEPTO");
      const cuenta = get(row, "CUENTA");
      const entidad = get(row, "ENTIDAD");
      const forma = get(row, "FORMA");
      const tipo = get(row, "TIPO PAGO") || get(row, "TIPO") || get(row, "TIPO_PAGO");

      const monto = get(row, "MONTO");
      const cantidad = get(row, "CANTIDAD");
      const plazo = get(row, "PLAZO");

      const allEmpty = [etapa, concepto, cuenta, entidad, forma, tipo, monto, cantidad, plazo].every((x) => !x);
      if (allEmpty) continue;

      out.push({
        etapa: etapa,
        concepto: concepto,
        cuenta: cuenta,
        entidad: entidad,
        formaPago: forma,
        tipoPago: tipo,
        monto: monto,
        cantidad: cantidad || "1",
        plazo: plazo || "1",
      });
    }

    return mapRowsToBudgetLayout([
      ["ETAPA", "CONCEPTO", "CUENTA", "ENTIDAD", "FORMA_PAGO", "TIPO_PAGO", "MONTO", "CANTIDAD", "PLAZO"],
      ...out.map((o) => [o.etapa, o.concepto, o.cuenta, o.entidad, o.formaPago, o.tipoPago, o.monto, o.cantidad, o.plazo]),
    ]);
  }

  function parseCSVToRows(text) {
    const s = (text || "").replace(/^\uFEFF/, ""); // BOM
    const firstLine = s.split(/\r?\n/)[0] || "";
    const sep = detectCsvSeparator(firstLine);

    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inQuotes) {
        if (ch === '"') {
          const next = s[i + 1];
          if (next === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === sep) {
        row.push(cur.trim());
        cur = "";
        continue;
      }

      if (ch === "\n") {
        row.push(cur.trim());
        rows.push(row);
        row = [];
        cur = "";
        continue;
      }

      if (ch === "\r") continue;

      cur += ch;
    }

    row.push(cur.trim());
    rows.push(row);

    return rows.filter((r) => r.some((c) => (c ?? "").toString().trim() !== ""));
  }

  function detectCsvSeparator(line) {
    let inQ = false;
    let comma = 0,
      semi = 0;
    for (let i = 0; i < (line || "").length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      if (inQ) continue;
      if (ch === ",") comma++;
      if (ch === ";") semi++;
    }
    return semi > comma ? ";" : ",";
  }

  function mapRowsToBudgetLayout(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const header = (rows[0] || []).map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("CONCEPTO");
    const start = hasHeader ? 1 : 0;

    const idx = {};
    if (hasHeader) {
      header.forEach((h, i) => {
        if (h) idx[h] = i;
      });
    }

    const get = (r, key, fallbackIndex) => {
      const i = idx[key];
      const v = (i !== undefined ? r[i] : r[fallbackIndex]) ?? "";
      return v.toString().trim();
    };

    const out = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const etapa = get(r, "ETAPA", 0);
      const concepto = get(r, "CONCEPTO", 1);
      const cuenta = get(r, "CUENTA", 2);
      const entidad = get(r, "ENTIDAD", 3);

      const formaPago = get(r, "FORMA_PAGO", 4) || get(r, "FORMA", 4);
      const tipoPago = get(r, "TIPO_PAGO", 5) || get(r, "TIPO PAGO", 5) || get(r, "TIPO", 5);

      const monto = get(r, "MONTO", 6);
      const cantidad = get(r, "CANTIDAD", 7);
      const plazo = get(r, "PLAZO", 8);

      const allEmpty = [etapa, concepto, cuenta, entidad, formaPago, tipoPago, monto, cantidad, plazo].every((x) => !x);
      if (allEmpty) continue;

      out.push({
        etapa,
        concepto,
        cuenta,
        entidad,
        formaPago,
        tipoPago,
        monto,
        cantidad: cantidad || "1",
        plazo: plazo || "1",
      });
    }

    return out;
  }

  function openBulkModal() {
    bulkParsed = [];
    bulkTbody.innerHTML = "";
    bulkErrors.style.display = "none";
    bulkErrors.textContent = "";
    bulkCommit.disabled = true;
    bulkCommit.textContent = "Agregar 0 gastos";
    bulkBackdrop.style.display = "flex";
  }

  function closeBulkModal() {
    bulkBackdrop.style.display = "none";
  }

  function previewBulk() {
    const raw = (bulkText.value || "").trim();
    bulkParsed = [];
    bulkTbody.innerHTML = "";
    bulkErrors.style.display = "none";
    bulkErrors.textContent = "";
    bulkCommit.disabled = true;
    bulkCommit.textContent = "Agregar 0 gastos";

    if (!raw) {
      showBulkErrors(["Pega al menos 1 fila (puede incluir encabezado)."]);
      return;
    }

    const parsed = parseBulkText(raw);
    if (parsed.errors.length) {
      showBulkErrors(parsed.errors);
      return;
    }

    bulkParsed = parsed.items;
    renderBulkPreview(bulkParsed);
    bulkCommit.disabled = bulkParsed.length === 0;
    bulkCommit.textContent = `Agregar ${bulkParsed.length} gastos`;
  }

  async function commitBulk() {
    if (!bulkParsed.length) return;

    const start = Number.isFinite(seq) ? seq : 0;

    const withSeq = bulkParsed.map((it, i) =>
      normalizeItem({
        uid: mkUid(),
        folio: start + (i + 1),
        ...it,
      })
    );

    seq = start + withSeq.length;

    items.push(...withSeq);

    await saveItemsAsync();

    renderAll();
    closeBulkModal();
  }

  function showBulkErrors(list) {
    bulkErrors.style.display = "block";
    bulkErrors.innerHTML = `
      <div style="color:#ffb4b4;"><b>Errores:</b></div>
      <ul style="margin:6px 0 0 18px;">
        ${list.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
      </ul>
    `;
  }

  function renderBulkPreview(list) {
    bulkTbody.innerHTML = "";
    list.slice(0, 150).forEach((it, idx) => {
      const n = normalizeItem({ uid: "x", folio: 0, ...it });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(n.etapa)}</td>
        <td>${escapeHtml(n.concepto)}</td>
        <td>${escapeHtml(n.cuenta)}</td>
        <td>${escapeHtml(n.entidad)}</td>
        <td>${escapeHtml(n.formaPago)}</td>
        <td>${escapeHtml(n.tipoPago)}</td>
        <td>${money(n.monto)}</td>
        <td>${escapeHtml(n.cantidad)}</td>
        <td>${escapeHtml(n.plazo)}</td>
        <td><b>${money(n.total)}</b></td>
      `;
      bulkTbody.appendChild(tr);
    });

    if (list.length > 150) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="11" class="muted"><b>Nota:</b> solo se muestran 150 filas en preview, pero se agregarán todas.</td>`;
      bulkTbody.appendChild(tr);
    }
  }

  function parseBulkText(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));

    const header = rows[0].map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("CONCEPTO");
    const start = hasHeader ? 1 : 0;

    const errors = [];
    const itemsOut = [];

    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;

      if (r.length < 9) {
        errors.push(`Fila ${rowNum}: faltan columnas (se esperan 9).`);
        continue;
      }

      const etapa = normalizeEtapa(r[0]);
      const concepto = (r[1] || "").trim();
      const cuenta = normalizeCuenta(r[2]);
      const entidad = normalizeEntidad(r[3]);

      const formaRaw = normalizeFormaPago(r[4]);
      const tipoPago = normalizeTipoPago(r[5]);

      const monto = toPositiveNumber(r[6], 0.01);
      const cantidad = parseInt(r[7], 10);
      const plazo = parseInt(r[8], 10);

      if (!etapa) errors.push(`Fila ${rowNum}: ETAPA inválida "${r[0]}".`);
      if (!concepto) errors.push(`Fila ${rowNum}: CONCEPTO vacío.`);
      if (!cuenta) errors.push(`Fila ${rowNum}: CUENTA fuera de catálogo "${r[2]}".`);
      if (!entidad) errors.push(`Fila ${rowNum}: ENTIDAD inválida "${r[3]}".`);
      if (!tipoPago) errors.push(`Fila ${rowNum}: TIPO_PAGO inválido "${r[5]}".`);

      if (entidad === "INTERNO" || entidad === "TERCEROS") {
        if (!formaRaw) errors.push(`Fila ${rowNum}: FORMA_PAGO inválida "${r[4]}". Usa EFECTIVO o ESPECIE.`);
      }

      if (!(monto > 0)) errors.push(`Fila ${rowNum}: MONTO debe ser > 0.`);
      if (!Number.isFinite(cantidad) || cantidad < 1) errors.push(`Fila ${rowNum}: CANTIDAD debe ser >= 1.`);
      if (!Number.isFinite(plazo) || plazo < 1) errors.push(`Fila ${rowNum}: PLAZO debe ser >= 1.`);

      const formaPago = applyFormaRules(entidad, formaRaw || "EFECTIVO");
      const fixedPlazo = tipoPago === "PROYECTO" ? 1 : plazo;

      const thisRowHasError = errors.some((e) => e.startsWith(`Fila ${rowNum}:`));
      if (!thisRowHasError) {
        itemsOut.push({
          etapa,
          concepto,
          cuenta,
          entidad,
          formaPago,
          tipoPago,
          monto,
          cantidad,
          plazo: fixedPlazo,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    return { items: itemsOut, errors };
  }
}

/* =======================
  Helpers globales
======================= */
function round2(n) {
  return Math.round(n * 100) / 100;
}

function toPositiveNumber(v, min) {
  const s = (v ?? "").toString().replace(/[$,]/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n;
}

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
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

function norm(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
