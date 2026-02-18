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
    try { exportarPresupuestoPDF(); }
    catch (e) { alert(e?.message || String(e)); }
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

  renderAll();

  // Acciones
  btnCrear.addEventListener("click", () => openModal("create"));
  btnEditar.addEventListener("click", () => openModal("edit"));
  btnEliminar.addEventListener("click", deleteSelected);
  btnDescargar.addEventListener("click", downloadCSV);

  btnExportarPDF.addEventListener("click", () => {
    try { window.openPresupuestoPreview(); }
    catch (e) {
      try { exportarPresupuestoPDF(); }
      catch (err) { alert(err?.message || String(err)); }
    }
  });

  // Carga masiva
  btnCargaMasiva.addEventListener("click", openBulkModal);
  bulkClose.addEventListener("click", closeBulkModal);
  bulkCancel.addEventListener("click", closeBulkModal);
  bulkBackdrop.addEventListener("click", (e) => { if (e.target === bulkBackdrop) closeBulkModal(); });
  bulkPreview.addEventListener("click", previewBulk);
  bulkCommit.addEventListener("click", commitBulk);

  // Modal create/edit
  modalClose.addEventListener("click", closeModal);
  modalCancel.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
  modalSave.addEventListener("click", saveModal);

  selEntidad.addEventListener("change", applyEntidadRulesToModal);
  selTipoPago.addEventListener("change", applyTipoPagoRulesToModal);

  inpMonto.addEventListener("blur", () => clampInput(inpMonto, 0.01, false));
  inpCantidad.addEventListener("blur", () => clampInput(inpCantidad, 1, true));
  inpPlazo.addEventListener("blur", () => clampInput(inpPlazo, 1, true));

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

  function renderTable() {
    tbody.innerHTML = "";
    items.forEach((it) => {
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

      tr.addEventListener("click", (ev) => onRowClick(ev, it.uid));
      tbody.appendChild(tr);
    });

    syncButtons();
  }

  function onRowClick(ev, uid) {
    const isToggle = ev.ctrlKey || ev.metaKey;
    const isRange = ev.shiftKey;

    if (isRange && lastClickedUid) {
      selectRange(lastClickedUid, uid);
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

  function selectRange(fromUid, toUid) {
    const rowUids = items.map((x) => x.uid);
    const a = rowUids.indexOf(fromUid);
    const b = rowUids.indexOf(toUid);
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
      "folio","etapa","concepto","cuenta","entidad","formaPago","tipoPago",
      "monto","cantidad","plazo","subtotal","iva","total"
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
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
      const fixedPlazo = (tipoPago === "PROYECTO") ? 1 : plazo;

      const thisRowHasError = errors.some(e => e.startsWith(`Fila ${rowNum}:`));
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
function round2(n) { return Math.round(n * 100) / 100; }

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
