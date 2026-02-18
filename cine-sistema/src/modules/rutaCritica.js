/* =========================================================
   src/modules/rutaCritica.js
   RUTA CRÍTICA V1 (localStorage)

   ✅ Etapas fijas: PREPRODUCCIÓN | PRODUCCIÓN | POSTPRODUCCIÓN
   ✅ UI:
      - Resumen (arriba izq): fechas inicio/fin + botón Vista (filtro)
      - Panel derecho: crear/editar tarea
      - Tabla: tareas ordenadas por fecha inicio + multi-selección
      - Carga masiva (TSV/CSV) estilo presupuesto
      - Vista previa (arriba derecha) -> abre ventana (sin print)
        y adentro botón EXPORTAR PDF (print) oculto en impresión

   ✅ Reglas Etapas:
      - Guardar etapas en localStorage
      - No overlap
      - La etapa siguiente inicia AL DÍA SIGUIENTE del fin anterior:
        * Si inicio siguiente vacío -> autocompleta
        * Si inicio siguiente existe y NO coincide -> warning amarillo + bloqueo
      - Si etapas inválidas -> NO permite tareas ni vista previa

   ✅ Reglas Tareas:
      - No se pueden crear fuera del rango de su etapa (bloqueo total)
      - Si falta fecha fin -> igualar a inicio (1 día)
      - Ordenadas por fecha inicio
========================================================= */

// ✅ CAMBIO QUIRÚRGICO: importar el service de vista previa tipo Excel
import { abrirVistaPreviaRutaCritica } from "../services/rutaCriticaPreview.js";

const LS_STAGES = "RC_V1_STAGES";
const LS_TASKS = "RC_V1_TASKS";

const ETAPAS = ["PREPRODUCCIÓN", "PRODUCCIÓN", "POSTPRODUCCIÓN"];

/* =========================================================
   ✅ CAMBIO QUIRÚRGICO (PUENTE GLOBAL PARA DOCUMENTACIÓN)
   - Documentación llama: window.openRutaCriticaPreview()
   - Este stub SIEMPRE existe.
   - bindRutaCriticaEvents registra la implementación real en:
     window.__rcOpenPreviewImpl
========================================================= */
if (typeof window !== "undefined") {
  window.__rcOpenPreviewImpl = window.__rcOpenPreviewImpl || null;

  window.openRutaCriticaPreview = function () {
    if (typeof window.__rcOpenPreviewImpl === "function") {
      return window.__rcOpenPreviewImpl();
    }
    alert(
      "La vista previa de Ruta Crítica no está disponible todavía. Entra a Ruta Crítica al menos una vez para inicializarla."
    );
  };
}

export function renderRutaCriticaView() {
  const etapasOptions = ETAPAS.map(
    (e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`
  ).join("");

  return `
    <div class="grid">
      <div class="card">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
          <div>
            <h2 style="margin-bottom:6px;">Ruta Crítica</h2>
            <p class="muted" style="margin:0;">V1: se guarda en este navegador (localStorage).</p>
          </div>

          <div>
            <button id="rcBtnVistaPrevia" class="btn btn-secondary">VISTA PREVIA</button>
            <div id="rcGateMsgTop" class="muted" style="margin-top:8px; display:none;"></div>
          </div>
        </div>

        <div class="rc-stages" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-top:14px;">
          ${renderStageCard("PREPRODUCCIÓN")}
          ${renderStageCard("PRODUCCIÓN")}
          ${renderStageCard("POSTPRODUCCIÓN")}
        </div>

        <div class="rc-actions" style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
          <button id="rcBtnVerTodas" class="btn btn-light">Ver todas</button>
          <button id="rcBtnCargaMasiva" class="btn btn-secondary">Carga masiva</button>
          <div style="flex:1;"></div>
          <div class="muted" id="rcFiltroLabel">Filtro: <b>todas</b></div>
        </div>

        <div class="table-wrap" style="margin-top:10px;">
          <table class="table" id="rcTable">
            <thead>
              <tr>
                <th style="width:42px; text-align:center;">
                  <input id="rcChkAll" type="checkbox" />
                </th>
                <th>Etapa</th>
                <th>Tarea</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody id="rcTbody"></tbody>
          </table>
        </div>

        <div class="rc-actions" style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
          <button id="rcBtnEditar" class="btn btn-light" disabled>Editar</button>
          <button id="rcBtnEliminar" class="btn btn-danger" disabled>Eliminar</button>
          <button id="rcBtnEliminarSel" class="btn btn-danger" disabled>Eliminar seleccionados</button>
          <div style="flex:1;"></div>
          <button id="rcBtnLimpiar" class="btn btn-light">Limpiar</button>
        </div>
      </div>

      <div class="card">
        <h2>Crear tarea</h2>
        <p class="muted" style="margin-top:0;">
          Las tareas deben estar dentro del rango de su etapa (y las etapas deben estar correctas).
        </p>

        <div id="rcGateMsgRight" class="muted" style="display:none; margin:10px 0; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background: rgba(255,200,0,.10);">
        </div>

        <div class="form-grid">
          <label>
            <span>Etapa</span>
            <select id="rcEtapa">${etapasOptions}</select>
          </label>

          <label>
            <span>Tarea</span>
            <input id="rcTarea" type="text" placeholder="Ej. Confirmar locaciones" />
          </label>

          <label>
            <span>Fecha inicio</span>
            <input id="rcIni" type="date" />
            <div class="muted" style="margin-top:6px;">Puedes elegir en calendario o escribir (dd/mm/aaaa o yyyy-mm-dd).</div>
          </label>

          <label>
            <span>Fecha fin</span>
            <input id="rcFin" type="date" />
            <div class="muted" style="margin-top:6px;">Si lo dejas vacío, se iguala a inicio (tarea 1 día).</div>
          </label>

          <label style="grid-column: 1 / -1;">
            <span>Notas</span>
            <textarea id="rcNotas" rows="4" placeholder="Opcional"></textarea>
          </label>
        </div>

        <div class="rc-actions" style="display:flex; gap:10px; margin-top:12px;">
          <button id="rcBtnGuardarTarea" class="btn btn-primary">Agregar / Guardar</button>
          <button id="rcBtnNuevo" class="btn btn-light">Nuevo</button>
        </div>
      </div>
    </div>

    <!-- Modal Carga Masiva -->
    <div id="rcBulkBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width: 1020px;">
        <div class="modal-header">
          <h3>Carga masiva (pegar desde Excel)</h3>
          <button id="rcBulkClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body">
          <p class="muted" style="margin:0 0 10px;">
            Formato recomendado (tabulado):
            <br/>
            <b>ETAPA | TAREA | INICIO | FIN | NOTAS</b>
          </p>

          <textarea id="rcBulkText" style="width:100%; height:160px; resize:vertical;"
placeholder="ETAPA	TAREA	INICIO	FIN	NOTAS
PREPRODUCCIÓN	Renta equipo A	2026-02-01	2026-02-03	confirmar proveedor"></textarea>

          <div class="rc-actions" style="margin-top:10px; display:flex; gap:10px; align-items:center;">
            <button id="rcBulkPreview" class="btn btn-secondary">Previsualizar</button>
            <div style="flex:1"></div>
            <button id="rcBulkCommit" class="btn btn-primary" disabled>Agregar 0 tareas</button>
          </div>

          <div id="rcBulkErrors" class="muted" style="display:none; margin-top:10px;"></div>

          <div class="table-wrap" style="margin-top:10px;">
            <table class="table" id="rcBulkTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Etapa</th>
                  <th>Tarea</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody id="rcBulkTbody"></tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer">
          <button id="rcBulkCancel" class="btn btn-light">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function etapaKey(label) {
  if (label === "PREPRODUCCIÓN") return "PRE";
  if (label === "PRODUCCIÓN") return "PROD";
  return "POST";
}

function renderStageCard(etapaLabel) {
  const key = etapaKey(etapaLabel);
  return `
    <div class="card" style="padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-weight:800;">${escapeHtml(etapaLabel)}</div>
        <button class="btn btn-light" id="rcVista_${key}">Vista</button>
      </div>

      <div style="margin-top:10px; display:grid; gap:10px;">
        <label>
          <span class="muted">Inicio</span>
          <input id="rcStageIni_${key}" type="date" />
        </label>

        <label>
          <span class="muted">Fin</span>
          <input id="rcStageFin_${key}" type="date" />
        </label>

        <button id="rcGuardar_${key}" class="btn btn-primary">Guardar fechas</button>

        <div id="rcStageMsg_${key}" class="muted" style="display:none; padding:8px 10px; border-radius:12px; border:1px solid rgba(255,255,255,.12);"></div>
        <div class="muted" style="opacity:.9;">
          Regla: la siguiente etapa inicia al día siguiente del fin anterior.
        </div>
      </div>
    </div>
  `;
}

export function bindRutaCriticaEvents() {
  // ---- DOM ----
  const tbody = document.getElementById("rcTbody");
  const chkAll = document.getElementById("rcChkAll");

  const btnVistaPrevia = document.getElementById("rcBtnVistaPrevia");

  const btnVerTodas = document.getElementById("rcBtnVerTodas");
  const btnCargaMasiva = document.getElementById("rcBtnCargaMasiva");

  const btnEditar = document.getElementById("rcBtnEditar");
  const btnEliminar = document.getElementById("rcBtnEliminar");
  const btnEliminarSel = document.getElementById("rcBtnEliminarSel");
  const btnLimpiar = document.getElementById("rcBtnLimpiar");

  const filtroLabel = document.getElementById("rcFiltroLabel");

  // Form tarea
  const selEtapa = document.getElementById("rcEtapa");
  const inpTarea = document.getElementById("rcTarea");
  const inpIni = document.getElementById("rcIni");
  const inpFin = document.getElementById("rcFin");
  const inpNotas = document.getElementById("rcNotas");
  const btnGuardarTarea = document.getElementById("rcBtnGuardarTarea");
  const btnNuevo = document.getElementById("rcBtnNuevo");

  const gateMsgTop = document.getElementById("rcGateMsgTop");
  const gateMsgRight = document.getElementById("rcGateMsgRight");

  // Bulk modal
  const bulkBackdrop = document.getElementById("rcBulkBackdrop");
  const bulkClose = document.getElementById("rcBulkClose");
  const bulkCancel = document.getElementById("rcBulkCancel");
  const bulkText = document.getElementById("rcBulkText");
  const bulkPreview = document.getElementById("rcBulkPreview");
  const bulkCommit = document.getElementById("rcBulkCommit");
  const bulkErrors = document.getElementById("rcBulkErrors");
  const bulkTbody = document.getElementById("rcBulkTbody");

  // Stage inputs
  const stPreIni = document.getElementById("rcStageIni_PRE");
  const stPreFin = document.getElementById("rcStageFin_PRE");
  const stProIni = document.getElementById("rcStageIni_PROD");
  const stProFin = document.getElementById("rcStageFin_PROD");
  const stPostIni = document.getElementById("rcStageIni_POST");
  const stPostFin = document.getElementById("rcStageFin_POST");

  const msgPre = document.getElementById("rcStageMsg_PRE");
  const msgPro = document.getElementById("rcStageMsg_PROD");
  const msgPost = document.getElementById("rcStageMsg_POST");

  const btnSavePre = document.getElementById("rcGuardar_PRE");
  const btnSavePro = document.getElementById("rcGuardar_PROD");
  const btnSavePost = document.getElementById("rcGuardar_POST");

  const btnVistaPre = document.getElementById("rcVista_PRE");
  const btnVistaPro = document.getElementById("rcVista_PROD");
  const btnVistaPost = document.getElementById("rcVista_POST");

  // ---- State ----
  let stages = loadStages(); // {pre:{ini,fin}, prod:{ini,fin}, post:{ini,fin}}
  let tasks = loadTasks();   // [{uid, etapa, tarea, ini, fin, notas, createdAt, updatedAt}]
  let filter = null;         // null = todas, else etapaLabel
  let selectedUid = null;
  let selectedSet = new Set(); // multi-select by uid
  let formMode = "create";      // create/edit
  let bulkParsed = [];

  // ---- Init ----
  hydrateStageInputsFromState();
  applyDateTypingSupport(); // permite dd/mm/aaaa escrito en inputs type=date
  renderAll();

  /* =========================================================
     ✅ CAMBIO QUIRÚRGICO (IMPLEMENTACIÓN REAL PARA DOCUMENTACIÓN)
     - Ahora Documentación puede llamar window.openRutaCriticaPreview()
       y usará ESTA implementación (ya con stages/tasks cargados).
  ========================================================= */
  window.__rcOpenPreviewImpl = function () {
    const gate = stageGate();
    if (!gate.ok) {
      alert(gate.message);
      return;
    }

    const projName =
      window?.appState?.project?.name ||
      document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
      "Proyecto";

    const data = tasks
      .slice()
      .sort((a, b) => cmpDate(a.ini, b.ini) || (a.tarea || "").localeCompare(b.tarea || ""))
      .map((t) => ({
        etapa: t.etapa,
        tarea: t.tarea,
        inicio: t.ini,
        fin: t.fin || t.ini,
      }));

    abrirVistaPreviaRutaCritica({ data, projectName: projName });
  };

  // ---- Stage events ----
  btnSavePre.addEventListener("click", () => saveStage("PREPRODUCCIÓN"));
  btnSavePro.addEventListener("click", () => saveStage("PRODUCCIÓN"));
  btnSavePost.addEventListener("click", () => saveStage("POSTPRODUCCIÓN"));

  btnVistaPre.addEventListener("click", () => setFilter("PREPRODUCCIÓN"));
  btnVistaPro.addEventListener("click", () => setFilter("PRODUCCIÓN"));
  btnVistaPost.addEventListener("click", () => setFilter("POSTPRODUCCIÓN"));

  // ---- Table events ----
  chkAll.addEventListener("change", () => {
    const rows = Array.from(tbody.querySelectorAll("tr[data-uid]"));
    if (chkAll.checked) {
      rows.forEach((r) => selectedSet.add(r.dataset.uid));
    } else {
      rows.forEach((r) => selectedSet.delete(r.dataset.uid));
    }
    // si el selectedUid ya no está, lo apagamos
    if (selectedUid && !selectedSet.has(selectedUid)) selectedUid = null;
    renderAll();
  });

  btnVerTodas.addEventListener("click", () => setFilter(null));
  btnLimpiar.addEventListener("click", () => {
    const ok = confirm("¿Borrar TODAS las tareas y fechas guardadas de Ruta Crítica (V1 local)?");
    if (!ok) return;
    stages = emptyStages();
    tasks = [];
    selectedUid = null;
    selectedSet = new Set();
    saveStages();
    saveTasks();
    hydrateStageInputsFromState();
    renderAll();
  });

  btnEditar.addEventListener("click", () => openEditSelected());
  btnEliminar.addEventListener("click", () => deleteSingleSelected());
  btnEliminarSel.addEventListener("click", () => deleteSelectedMany());

  // ---- Form events ----
  btnNuevo.addEventListener("click", () => resetForm());
  btnGuardarTarea.addEventListener("click", () => upsertTaskFromForm());

  // ---- Bulk events ----
  btnCargaMasiva.addEventListener("click", openBulkModal);
  bulkClose.addEventListener("click", closeBulkModal);
  bulkCancel.addEventListener("click", closeBulkModal);
  bulkBackdrop.addEventListener("click", (e) => { if (e.target === bulkBackdrop) closeBulkModal(); });
  bulkPreview.addEventListener("click", previewBulk);
  bulkCommit.addEventListener("click", commitBulk);

  // ---- Preview events ----
  btnVistaPrevia.addEventListener("click", () => {
    const gate = stageGate();
    if (!gate.ok) {
      alert(gate.message);
      return;
    }

    // ✅ CAMBIO QUIRÚRGICO:
    // alimentar la vista previa con lo que ya existe en Ruta Crítica (tasks),
    // en el formato EXACTO requerido: { etapa, tarea, inicio, fin }
    const projName =
      window?.appState?.project?.name ||
      document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
      "Proyecto";

    const data = tasks
      .slice()
      .sort((a, b) => cmpDate(a.ini, b.ini) || (a.tarea || "").localeCompare(b.tarea || ""))
      .map((t) => ({
        etapa: t.etapa,
        tarea: t.tarea,
        inicio: t.ini,
        fin: t.fin || t.ini,
      }));

    abrirVistaPreviaRutaCritica({ data, projectName: projName });
  });

  /* =========================
     Stages persistence
  ========================= */
  function emptyStages() {
    return {
      pre: { ini: "", fin: "" },
      prod: { ini: "", fin: "" },
      post: { ini: "", fin: "" },
    };
  }

  function loadStages() {
    try {
      const raw = localStorage.getItem(LS_STAGES);
      if (!raw) return emptyStages();
      const obj = JSON.parse(raw);
      return {
        pre: { ini: obj?.pre?.ini || "", fin: obj?.pre?.fin || "" },
        prod: { ini: obj?.prod?.ini || "", fin: obj?.prod?.fin || "" },
        post: { ini: obj?.post?.ini || "", fin: obj?.post?.fin || "" },
      };
    } catch {
      return emptyStages();
    }
  }

  function saveStages() {
    localStorage.setItem(LS_STAGES, JSON.stringify(stages));
  }

  function loadTasks() {
    try {
      const raw = localStorage.getItem(LS_TASKS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
  }

  function hydrateStageInputsFromState() {
    stPreIni.value = stages.pre.ini || "";
    stPreFin.value = stages.pre.fin || "";
    stProIni.value = stages.prod.ini || "";
    stProFin.value = stages.prod.fin || "";
    stPostIni.value = stages.post.ini || "";
    stPostFin.value = stages.post.fin || "";
  }

  function setStageMsg(el, msg, kind) {
    if (!msg) {
      el.style.display = "none";
      el.textContent = "";
      el.style.background = "";
      el.style.borderColor = "";
      return;
    }
    el.style.display = "block";
    el.textContent = msg;
    if (kind === "warn") {
      el.style.background = "rgba(255, 200, 0, .12)";
      el.style.borderColor = "rgba(255, 200, 0, .35)";
    } else if (kind === "ok") {
      el.style.background = "rgba(0, 255, 120, .10)";
      el.style.borderColor = "rgba(0, 255, 120, .25)";
    } else {
      el.style.background = "rgba(255, 120, 120, .10)";
      el.style.borderColor = "rgba(255, 120, 120, .30)";
    }
  }

  function saveStage(etapaLabel) {
    // leer inputs de la etapa
    let ini = "";
    let fin = "";

    if (etapaLabel === "PREPRODUCCIÓN") {
      ini = normalizeDateInput(stPreIni.value);
      fin = normalizeDateInput(stPreFin.value);
    } else if (etapaLabel === "PRODUCCIÓN") {
      ini = normalizeDateInput(stProIni.value);
      fin = normalizeDateInput(stProFin.value);
    } else {
      ini = normalizeDateInput(stPostIni.value);
      fin = normalizeDateInput(stPostFin.value);
    }

    // Validación básica
    if (!ini || !fin) {
      alert("Faltan fechas: inicio y fin son requeridas.");
      return;
    }
    if (cmpDate(ini, fin) > 0) {
      alert("La fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }

    // aplicar
    if (etapaLabel === "PREPRODUCCIÓN") {
      stages.pre = { ini, fin };

      // auto: PRODUCCIÓN inicio = día sig de pre fin si vacío
      const expectedProdIni = addDays(iniOrFin(stages.pre.fin), 1);
      if (!stages.prod.ini) {
        stages.prod.ini = expectedProdIni;
        stProIni.value = expectedProdIni;
      }
    }

    if (etapaLabel === "PRODUCCIÓN") {
      stages.prod = { ini, fin };

      // auto: POST inicio = día sig de prod fin si vacío
      const expectedPostIni = addDays(iniOrFin(stages.prod.fin), 1);
      if (!stages.post.ini) {
        stages.post.ini = expectedPostIni;
        stPostIni.value = expectedPostIni;
      }
    }

    if (etapaLabel === "POSTPRODUCCIÓN") {
      stages.post = { ini, fin };
    }

    // Guardar y rehidratar
    saveStages();
    hydrateStageInputsFromState();
    renderAll();
  }

  function iniOrFin(d) { return d; }

  /* =========================
     Gate de etapas (bloqueo)
  ========================= */
  function stageGate() {
    // debe existir pre/prod/post con ini/fin
    const { pre, prod, post } = stages;

    if (!pre.ini || !pre.fin || !prod.ini || !prod.fin || !post.ini || !post.fin) {
      return { ok: false, message: "Primero guarda las fechas de PRE / PRODUCCIÓN / POSTPRODUCCIÓN (inicio y fin)." };
    }

    // no overlap y orden interno
    if (cmpDate(pre.ini, pre.fin) > 0) return { ok: false, message: "PREPRODUCCIÓN: fin no puede ser antes de inicio." };
    if (cmpDate(prod.ini, prod.fin) > 0) return { ok: false, message: "PRODUCCIÓN: fin no puede ser antes de inicio." };
    if (cmpDate(post.ini, post.fin) > 0) return { ok: false, message: "POSTPRODUCCIÓN: fin no puede ser antes de inicio." };

    // Regla: prod.ini debe ser pre.fin + 1
    const expectedProdIni = addDays(pre.fin, 1);
    if (prod.ini !== expectedProdIni) {
      return {
        ok: false,
        message: `Revisar fechas: PRODUCCIÓN debe iniciar ${fmtDMY(expectedProdIni)} (día siguiente al fin de PRE). Actualmente: ${fmtDMY(prod.ini)}.`,
        warn: { stage: "PROD", expected: expectedProdIni, actual: prod.ini }
      };
    }

    // Regla: post.ini debe ser prod.fin + 1
    const expectedPostIni = addDays(prod.fin, 1);
    if (post.ini !== expectedPostIni) {
      return {
        ok: false,
        message: `Revisar fechas: POSTPRODUCCIÓN debe iniciar ${fmtDMY(expectedPostIni)} (día siguiente al fin de PRODUCCIÓN). Actualmente: ${fmtDMY(post.ini)}.`,
        warn: { stage: "POST", expected: expectedPostIni, actual: post.ini }
      };
    }

    // No overlap implícito por regla, pero igual validamos rangos globales
    if (cmpDate(prod.ini, pre.fin) <= 0) return { ok: false, message: "No overlap: PRODUCCIÓN debe iniciar después del fin de PRE." };
    if (cmpDate(post.ini, prod.fin) <= 0) return { ok: false, message: "No overlap: POST debe iniciar después del fin de PRODUCCIÓN." };

    return { ok: true };
  }

  function paintStageWarnings(gate) {
    // reset styles
    [stProIni, stPostIni].forEach((el) => {
      el.style.background = "";
      el.style.borderColor = "";
    });

    setStageMsg(msgPre, "", null);
    setStageMsg(msgPro, "", null);
    setStageMsg(msgPost, "", null);

    // Mensaje por etapa guardada OK (si ya están puestas)
    if (stages.pre.ini && stages.pre.fin) setStageMsg(msgPre, `Guardado: ${fmtDMY(stages.pre.ini)} → ${fmtDMY(stages.pre.fin)}`, "ok");
    if (stages.prod.ini && stages.prod.fin) setStageMsg(msgPro, `Guardado: ${fmtDMY(stages.prod.ini)} → ${fmtDMY(stages.prod.fin)}`, "ok");
    if (stages.post.ini && stages.post.fin) setStageMsg(msgPost, `Guardado: ${fmtDMY(stages.post.ini)} → ${fmtDMY(stages.post.fin)}`, "ok");

    if (gate.ok) return;

    if (gate.warn?.stage === "PROD") {
      stProIni.style.background = "rgba(255, 200, 0, .18)";
      stProIni.style.borderColor = "rgba(255, 200, 0, .55)";
      setStageMsg(msgPro, `⚠ Revisar: inicio esperado ${fmtDMY(gate.warn.expected)}. Actual: ${fmtDMY(gate.warn.actual)}.`, "warn");
    }

    if (gate.warn?.stage === "POST") {
      stPostIni.style.background = "rgba(255, 200, 0, .18)";
      stPostIni.style.borderColor = "rgba(255, 200, 0, .55)";
      setStageMsg(msgPost, `⚠ Revisar: inicio esperado ${fmtDMY(gate.warn.expected)}. Actual: ${fmtDMY(gate.warn.actual)}.`, "warn");
    }
  }

  function updateGateUI(gate) {
    if (gate.ok) {
      gateMsgTop.style.display = "none";
      gateMsgTop.textContent = "";
      gateMsgRight.style.display = "none";
      gateMsgRight.textContent = "";
      btnGuardarTarea.disabled = false;
      btnVistaPrevia.disabled = false;
      btnCargaMasiva.disabled = false;
      return;
    }

    const msg = gate.message || "Revisa las fechas de etapas.";
    gateMsgTop.style.display = "block";
    gateMsgTop.innerHTML = `<span style="color:#ffde8a;"><b>Bloqueado:</b></span> ${escapeHtml(msg)}`;

    gateMsgRight.style.display = "block";
    gateMsgRight.innerHTML = `<span style="color:#ffde8a;"><b>Bloqueado:</b></span> ${escapeHtml(msg)}`;

    btnGuardarTarea.disabled = true;
    btnVistaPrevia.disabled = true;
    btnCargaMasiva.disabled = true;
  }

  /* =========================
     Render
  ========================= */
  function renderAll() {
    // Normalizar tareas (por si hay legacy)
    tasks = (tasks || []).map((t) => ({
      uid: t.uid || mkUid(),
      etapa: normalizeEtapa(t.etapa) || "PREPRODUCCIÓN",
      tarea: (t.tarea || "").trim(),
      ini: normalizeDateInput(t.ini) || "",
      fin: normalizeDateInput(t.fin) || "",
      notas: (t.notas || "").trim(),
      createdAt: t.createdAt ?? Date.now(),
      updatedAt: t.updatedAt ?? Date.now(),
    }));
    saveTasks();

    const gate = stageGate();
    paintStageWarnings(gate);
    updateGateUI(gate);

    renderTable();
    updateActionButtons();
  }

  function renderTable() {
    tbody.innerHTML = "";

    // filtro
    const view = filter ? tasks.filter((t) => t.etapa === filter) : tasks.slice();

    // ordenar por fecha inicio
    view.sort((a, b) => {
      const c = cmpDate(a.ini, b.ini);
      if (c !== 0) return c;
      return (a.tarea || "").localeCompare(b.tarea || "");
    });

    // UI filtro label
    filtroLabel.innerHTML = `Filtro: <b>${filter ? escapeHtml(filter) : "todas"}</b>`;

    view.forEach((t) => {
      const tr = document.createElement("tr");
      tr.dataset.uid = t.uid;

      // selected row (para editar 1)
      if (t.uid === selectedUid) tr.classList.add("is-selected");

      const checked = selectedSet.has(t.uid) ? "checked" : "";

      tr.innerHTML = `
        <td style="text-align:center;">
          <input class="rcChkRow" type="checkbox" data-uid="${escapeAttr(t.uid)}" ${checked}/>
        </td>
        <td>${escapeHtml(t.etapa)}</td>
        <td>${escapeHtml(t.tarea)}</td>
        <td>${escapeHtml(fmtDMY(t.ini))}</td>
        <td>${escapeHtml(fmtDMY(t.fin))}</td>
        <td>${escapeHtml(t.notas)}</td>
      `;

      // click fila = seleccionar para editar (sin afectar check)
      tr.addEventListener("click", (e) => {
        const tag = (e.target?.tagName || "").toLowerCase();
        if (tag === "input") return;
        selectSingle(t.uid);
      });

      tbody.appendChild(tr);
    });

    // checkbox row listeners
    Array.from(tbody.querySelectorAll(".rcChkRow")).forEach((cb) => {
      cb.addEventListener("change", () => {
        const uid = cb.getAttribute("data-uid");
        if (!uid) return;
        if (cb.checked) selectedSet.add(uid);
        else selectedSet.delete(uid);

        // mantener selectedUid si existe
        if (selectedUid && !selectedSet.has(selectedUid)) {
          // ok, aún puede seguir en selectedUid (para edit), pero no está en seleccionados; lo dejamos
        }

        // actualizar chkAll según vista
        syncChkAllWithView();
        updateActionButtons();
      });
    });

    syncChkAllWithView();
  }

  function syncChkAllWithView() {
    const rows = Array.from(tbody.querySelectorAll("tr[data-uid]"));
    if (!rows.length) {
      chkAll.checked = false;
      chkAll.indeterminate = false;
      return;
    }
    const uids = rows.map((r) => r.dataset.uid);
    const selectedCount = uids.filter((u) => selectedSet.has(u)).length;
    chkAll.checked = selectedCount === uids.length;
    chkAll.indeterminate = selectedCount > 0 && selectedCount < uids.length;
  }

  function updateActionButtons() {
    btnEditar.disabled = !selectedUid;
    btnEliminar.disabled = !selectedUid;
    btnEliminarSel.disabled = selectedSet.size === 0;
  }

  function selectSingle(uid) {
    selectedUid = uid;
    // no forzamos checkbox, pero si quieres que al click también lo seleccione:
    // selectedSet.add(uid);

    Array.from(tbody.querySelectorAll("tr")).forEach((r) => r.classList.remove("is-selected"));
    const tr = tbody.querySelector(`tr[data-uid="${cssEscape(uid)}"]`);
    if (tr) tr.classList.add("is-selected");
    updateActionButtons();
  }

  function setFilter(etapa) {
    filter = etapa;
    renderAll();
  }

  /* =========================
     Form tarea: create/edit
  ========================= */
  function resetForm() {
    formMode = "create";
    selectedUid = null;
    inpTarea.value = "";
    inpIni.value = "";
    inpFin.value = "";
    inpNotas.value = "";
    selEtapa.value = "PREPRODUCCIÓN";
    renderAll();
  }

  function openEditSelected() {
    if (!selectedUid) return;
    const t = tasks.find((x) => x.uid === selectedUid);
    if (!t) return;
    formMode = "edit";
    selEtapa.value = t.etapa;
    inpTarea.value = t.tarea;
    inpIni.value = t.ini || "";
    inpFin.value = t.fin || "";
    inpNotas.value = t.notas || "";
  }

  function deleteSingleSelected() {
    if (!selectedUid) return;
    const t = tasks.find((x) => x.uid === selectedUid);
    const ok = confirm(`¿Eliminar tarea "${t?.tarea || "tarea"}"?`);
    if (!ok) return;
    tasks = tasks.filter((x) => x.uid !== selectedUid);
    selectedSet.delete(selectedUid);
    selectedUid = null;
    saveTasks();
    renderAll();
  }

  function deleteSelectedMany() {
    if (selectedSet.size === 0) return;
    const ok = confirm(`¿Eliminar ${selectedSet.size} tareas seleccionadas?`);
    if (!ok) return;
    tasks = tasks.filter((t) => !selectedSet.has(t.uid));
    selectedUid = null;
    selectedSet = new Set();
    saveTasks();
    renderAll();
  }

  function upsertTaskFromForm() {
    const gate = stageGate();
    if (!gate.ok) {
      alert(gate.message);
      return;
    }

    const etapa = normalizeEtapa(selEtapa.value) || "PREPRODUCCIÓN";
    const tarea = (inpTarea.value || "").trim();
    if (!tarea) {
      alert("Falta: Tarea.");
      return;
    }

    const ini = normalizeDateInput(inpIni.value);
    if (!ini) {
      alert("Falta: Fecha inicio.");
      return;
    }

    let fin = normalizeDateInput(inpFin.value);
    if (!fin) fin = ini; // regla: 1 día
    if (cmpDate(ini, fin) > 0) {
      alert("Fecha fin no puede ser anterior a inicio.");
      return;
    }

    // Candado: tarea dentro de rango de etapa
    const range = stageRange(etapa);
    if (!range) {
      alert("No hay rango válido para esa etapa. Guarda fechas de etapas primero.");
      return;
    }
    if (cmpDate(ini, range.ini) < 0 || cmpDate(fin, range.fin) > 0) {
      alert(`Candado: la tarea debe estar dentro del rango de ${etapa}: ${fmtDMY(range.ini)} → ${fmtDMY(range.fin)}.`);
      return;
    }

    const notas = (inpNotas.value || "").trim();

    if (formMode === "create" || !selectedUid) {
      const t = {
        uid: mkUid(),
        etapa,
        tarea,
        ini,
        fin,
        notas,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      tasks.push(t);
      saveTasks();
      // auto-select
      selectedUid = t.uid;
      selectedSet.add(t.uid);
      renderAll();
      return;
    }

    // edit
    const idx = tasks.findIndex((x) => x.uid === selectedUid);
    if (idx === -1) return;

    tasks[idx] = {
      ...tasks[idx],
      etapa,
      tarea,
      ini,
      fin,
      notas,
      updatedAt: Date.now(),
    };
    saveTasks();
    selectedSet.add(selectedUid);
    renderAll();
  }

  function stageRange(etapaLabel) {
    if (etapaLabel === "PREPRODUCCIÓN") return stages.pre.ini && stages.pre.fin ? { ini: stages.pre.ini, fin: stages.pre.fin } : null;
    if (etapaLabel === "PRODUCCIÓN") return stages.prod.ini && stages.prod.fin ? { ini: stages.prod.ini, fin: stages.prod.fin } : null;
    return stages.post.ini && stages.post.fin ? { ini: stages.post.ini, fin: stages.post.fin } : null;
  }

  /* =========================
     Bulk (carga masiva)
  ========================= */
  function openBulkModal() {
    const gate = stageGate();
    if (!gate.ok) {
      alert(gate.message);
      return;
    }
    bulkParsed = [];
    bulkTbody.innerHTML = "";
    bulkErrors.style.display = "none";
    bulkErrors.textContent = "";
    bulkCommit.disabled = true;
    bulkCommit.textContent = "Agregar 0 tareas";
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
    bulkCommit.textContent = "Agregar 0 tareas";

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
    bulkCommit.textContent = `Agregar ${bulkParsed.length} tareas`;
  }

  function commitBulk() {
    if (!bulkParsed.length) return;

    const withUids = bulkParsed.map((t) => ({
      uid: mkUid(),
      etapa: t.etapa,
      tarea: t.tarea,
      ini: t.ini,
      fin: t.fin,
      notas: t.notas,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    tasks.push(...withUids);
    saveTasks();
    closeBulkModal();
    renderAll();
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
    list.slice(0, 150).forEach((t, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(t.etapa)}</td>
        <td>${escapeHtml(t.tarea)}</td>
        <td>${escapeHtml(fmtDMY(t.ini))}</td>
        <td>${escapeHtml(fmtDMY(t.fin))}</td>
        <td>${escapeHtml(t.notas)}</td>
      `;
      bulkTbody.appendChild(tr);
    });

    if (list.length > 150) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" class="muted"><b>Nota:</b> solo se muestran 150 filas en preview, pero se agregarán todas.</td>`;
      bulkTbody.appendChild(tr);
    }
  }

  function parseBulkText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));

    const header = rows[0].map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("TAREA") || header.includes("INICIO");
    const start = hasHeader ? 1 : 0;

    // 5 cols:
    // 0 ETAPA | 1 TAREA | 2 INICIO | 3 FIN | 4 NOTAS
    const errors = [];
    const itemsOut = [];

    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;

      if (r.length < 4) {
        errors.push(`Fila ${rowNum}: faltan columnas (mínimo 4: ETAPA,TAREA,INICIO,FIN).`);
        continue;
      }

      const etapa = normalizeEtapa(r[0]);
      const tarea = (r[1] || "").trim();
      const ini = normalizeDateInput(r[2]);
      let fin = normalizeDateInput(r[3]);
      const notas = (r[4] || "").trim();

      if (!etapa) errors.push(`Fila ${rowNum}: ETAPA inválida "${r[0]}".`);
      if (!tarea) errors.push(`Fila ${rowNum}: TAREA vacía.`);
      if (!ini) errors.push(`Fila ${rowNum}: INICIO inválido "${r[2]}". (usa yyyy-mm-dd o dd/mm/aaaa)`);
      if (!fin) fin = ini; // si viene vacío o inválido -> 1 día
      if (ini && fin && cmpDate(ini, fin) > 0) errors.push(`Fila ${rowNum}: FIN no puede ser antes de INICIO.`);

      // Candado por rango
      if (etapa && ini && fin) {
        const range = stageRange(etapa);
        if (!range) {
          errors.push(`Fila ${rowNum}: No hay rango válido guardado para ${etapa}.`);
        } else {
          if (cmpDate(ini, range.ini) < 0 || cmpDate(fin, range.fin) > 0) {
            errors.push(`Fila ${rowNum}: fuera de rango de ${etapa} (${fmtDMY(range.ini)} → ${fmtDMY(range.fin)}).`);
          }
        }
      }

      const rowHasError = errors.some((e) => e.startsWith(`Fila ${rowNum}:`));
      if (!rowHasError) {
        itemsOut.push({ etapa, tarea, ini, fin, notas });
      }
    }

    return { items: itemsOut, errors };
  }

  /* =========================
     Vista previa (window)
     (queda intacta pero ya NO se usa)
  ========================= */
  function openPreviewWindow() {
    const gate = stageGate();
    if (!gate.ok) {
      alert(gate.message);
      return;
    }

    const projName =
      window?.appState?.project?.name ||
      document.querySelector("[data-project-name]")?.getAttribute("data-project-name") ||
      "Proyecto";

    const all = tasks.slice().sort((a, b) => cmpDate(a.ini, b.ini) || (a.tarea || "").localeCompare(b.tarea || ""));

    const html = buildPreviewHTML({ projectName: projName, stages, tasks: all });

    const w = window.open("", "_blank");
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  function buildPreviewHTML({ projectName, stages, tasks }) {
    // Agrupar por etapa
    const by = {
      "PREPRODUCCIÓN": [],
      "PRODUCCIÓN": [],
      "POSTPRODUCCIÓN": [],
    };
    tasks.forEach((t) => by[t.etapa]?.push(t));

    const stageLines = `
      <div class="stages">
        <div class="stage"><b>PREPRODUCCIÓN</b><span>${fmtDMY(stages.pre.ini)} → ${fmtDMY(stages.pre.fin)}</span></div>
        <div class="stage"><b>PRODUCCIÓN</b><span>${fmtDMY(stages.prod.ini)} → ${fmtDMY(stages.prod.fin)}</span></div>
        <div class="stage"><b>POSTPRODUCCIÓN</b><span>${fmtDMY(stages.post.ini)} → ${fmtDMY(stages.post.fin)}</span></div>
      </div>
    `;

    const renderTable = (etapa) => {
      const list = by[etapa] || [];
      if (!list.length) return `<div class="muted">Sin tareas</div>`;
      return `
        <table>
          <thead>
            <tr>
              <th style="width:140px;">Inicio</th>
              <th style="width:140px;">Fin</th>
              <th>Tarea</th>
              <th style="width:30%;">Notas</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((t) => `
              <tr>
                <td>${escapeHtml(fmtDMY(t.ini))}</td>
                <td>${escapeHtml(fmtDMY(t.fin))}</td>
                <td><b>${escapeHtml(t.tarea)}</b></td>
                <td>${escapeHtml(t.notas || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    };

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Ruta Crítica</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: Arial, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111; }
  .top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .title { font-size: 16px; font-weight: 900; margin: 0; }
  .sub { font-size: 11px; opacity:.85; margin: 4px 0 0; }
  .btn {
    border: 1px solid rgba(0,0,0,.2);
    border-radius: 10px;
    padding: 8px 10px;
    font-weight: 800;
    background: #fff;
    cursor: pointer;
  }
  .stages { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin: 12px 0 6px; }
  .stage { border: 1px solid rgba(0,0,0,.15); border-radius: 12px; padding: 10px; }
  .stage span { display:block; margin-top:6px; font-size: 12px; }
  h2 { margin: 18px 0 8px; font-size: 13px; font-weight: 900; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid rgba(0,0,0,.2); padding: 6px 8px; vertical-align: top; }
  th { background: #f3f3f3; text-align:left; }
  .muted { opacity:.75; font-size: 11px; }
  .page-break { break-before: page; }

  /* Ocultar el botón en impresión */
  @media print {
    #btnPrint { display: none !important; }
  }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="title">RUTA CRÍTICA</div>
      <div class="sub">${escapeHtml(projectName)}</div>
    </div>
    <button id="btnPrint" class="btn">EXPORTAR PDF</button>
  </div>

  ${stageLines}

  <h2>PREPRODUCCIÓN</h2>
  ${renderTable("PREPRODUCCIÓN")}

  <h2>PRODUCCIÓN</h2>
  ${renderTable("PRODUCCIÓN")}

  <h2>POSTPRODUCCIÓN</h2>
  ${renderTable("POSTPRODUCCIÓN")}

<script>
  document.getElementById('btnPrint').addEventListener('click', () => {
    window.print();
  });
</script>
</body>
</html>`;
  }

  /* =========================
     Date typing support
     - input type="date" ya deja calendar
     - pero si pegan dd/mm/aaaa, lo convertimos
  ========================= */
  function applyDateTypingSupport() {
    const allDateInputs = [
      stPreIni, stPreFin, stProIni, stProFin, stPostIni, stPostFin,
      inpIni, inpFin
    ].filter(Boolean);

    allDateInputs.forEach((el) => {
      el.addEventListener("blur", () => {
        const normalized = normalizeDateInput(el.value);
        if (normalized) el.value = normalized;
      });
    });
  }

  /* =========================
     Utils
  ========================= */
  function normalizeEtapa(v) {
    const s = norm(v);
    if (s === "PREPRODUCCION" || s === "PRE PRODUCCION") return "PREPRODUCCIÓN";
    if (s === "PRODUCCION") return "PRODUCCIÓN";
    if (s === "POSTPRODUCCION" || s === "POST PRODUCCION" || s === "POST-PRODUCCION") return "POSTPRODUCCIÓN";
    return null;
  }

  function mkUid() {
    return crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now());
  }

  function etapaKey(label) {
    if (label === "PREPRODUCCIÓN") return "PRE";
    if (label === "PRODUCCIÓN") return "PROD";
    return "POST";
  }

  // Normaliza a yyyy-mm-dd
  function normalizeDateInput(v) {
    const s = (v ?? "").toString().trim();
    if (!s) return "";
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // dd/mm/yyyy o dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const dd = String(m[1]).padStart(2, "0");
      const mm = String(m[2]).padStart(2, "0");
      const yyyy = m[3];
      const iso = `${yyyy}-${mm}-${dd}`;
      if (isValidISODate(iso)) return iso;
      return "";
    }
    return "";
  }

  function isValidISODate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
  }

  function cmpDate(a, b) {
    // a/b: yyyy-mm-dd
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  }

  function addDays(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function fmtDMY(iso) {
    if (!iso) return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
}

/* =======================
   Helpers globales
======================= */
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

// para querySelector seguro con UIDs raros
function cssEscape(s) {
  return (s ?? "").toString().replace(/"/g, '\\"');
}
