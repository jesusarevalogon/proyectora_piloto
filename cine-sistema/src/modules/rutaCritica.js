/* =========================================================
   src/modules/rutaCritica.js
   RUTA CRÍTICA (SERVER - Supabase)

   ✅ Etapas fijas: DESARROLLO | PREPRODUCCIÓN | RODAJE | EDICIÓN | POSTPRODUCCIÓN
   ✅ UI:
      - Resumen (arriba izq): fechas inicio/fin + botón Vista (filtro)
      - Panel derecho: crear/editar tarea
      - Tabla: tareas ordenadas por fecha inicio + multi-selección
      - Carga masiva (TSV/CSV) estilo presupuesto
      - Vista previa (arriba derecha) -> abre ventana (sin print)
        y adentro botón EXPORTAR PDF (print) oculto en impresión

   ✅ Reglas Etapas:
      - Guardar etapas en servidor (Supabase)
      - No overlap
      - La etapa siguiente inicia AL DÍA SIGUIENTE del fin anterior:
        * Si inicio siguiente vacío -> autocompleta
        * Si inicio siguiente existe y NO coincide -> warning amarillo + bloqueo
      - Si etapas inválidas -> NO permite tareas ni vista previa

   ✅ Reglas Tareas:
      - No se pueden crear fuera del rango de su etapa (bloqueo total)
      - Si falta fecha fin -> igualar a inicio (1 día)
      - Ordenadas por fecha inicio

   🔒 Sin localStorage: TODO vive en servidor.

   ✅ NUEVO (AJUSTE QUIRÚRGICO SOLICITADO):
      - Barra de búsqueda (texto) para coincidencias en tareas (Etapa / Tarea / Notas)
      - Filtro simple de etapa (select) + respeta los botones "Vista"
      - Paginado 20 en 20 + botón "Ver todas"
========================================================= */

// ✅ CAMBIO QUIRÚRGICO: importar el service de vista previa tipo Excel
import { abrirVistaPreviaRutaCritica } from "../services/rutaCriticaPreview.js";
import { loadModuleState, saveModuleState } from "../services/stateService.js";

const ETAPAS = ["DESARROLLO", "PREPRODUCCIÓN", "RODAJE", "EDICIÓN", "POSTPRODUCCIÓN"];

// ✅ Server keys
const MODULE_KEY = "rutaCritica";

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

  const filtroEtapasOptions = [
    `<option value="">Todas las etapas</option>`,
    ...ETAPAS.map((e) => `<option value="${escapeAttr(e)}">${escapeHtml(e)}</option>`),
  ].join("");

  return `
    <div class="grid">
      <div class="card">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
          <div>
            <h2 style="margin-bottom:6px;">Ruta Crítica</h2>
            <p class="muted" style="margin:0;">Servidor: se guarda en Supabase (no localStorage).</p>
          </div>

          <div>
            <button id="rcBtnVistaPrevia" class="btn btn-secondary">VISTA PREVIA</button>
            <div id="rcGateMsgTop" class="muted" style="margin-top:8px; display:none;"></div>
          </div>
        </div>

        <div class="rc-stages" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:12px; margin-top:14px;">
          ${renderStageCard("DESARROLLO")}
          ${renderStageCard("PREPRODUCCIÓN")}
          ${renderStageCard("RODAJE")}
          ${renderStageCard("EDICIÓN")}
          ${renderStageCard("POSTPRODUCCIÓN")}
        </div>

        <div class="rc-actions" style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
          <button id="rcBtnVerTodas" class="btn btn-light">Ver todas</button>
          <button id="rcBtnCargaMasiva" class="btn btn-secondary">Carga masiva</button>
          <div style="flex:1;"></div>
          <div class="muted" id="rcFiltroLabel">Filtro: <b>todas</b></div>
        </div>

        <!-- ✅ NUEVO: Buscador + filtro + pestañas (paginado / todos) -->
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:10px 0 12px;">
          <div style="flex:1; min-width:220px;">
            <input id="rcSearchInput" type="text" placeholder="Buscar (etapa, tarea, notas)…"
                   style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); outline:none;" />
          </div>

          <div style="min-width:220px;">
            <select id="rcFilterEtapa" style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12);">
              ${filtroEtapasOptions}
            </select>
          </div>

          <div style="display:flex; gap:8px; align-items:center;">
            <button id="rcTabPaged" class="btn btn-light">Paginado (20)</button>
            <button id="rcTabAll" class="btn btn-light">Ver todas</button>
          </div>
        </div>

        <!-- ✅ NUEVO: Controles paginado -->
        <div id="rcPagerBar" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:-2px 0 10px;">
          <button id="rcPagePrev" class="btn btn-light">←</button>
          <div class="muted" id="rcPageInfo">Página 1 / 1</div>
          <button id="rcPageNext" class="btn btn-light">→</button>
          <div style="flex:1"></div>
          <div class="muted" id="rcResultsInfo">0 resultados</div>
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
DESARROLLO	Investigación referencias	2026-02-01	2026-02-03	-
PREPRODUCCIÓN	Renta equipo A	2026-02-04	2026-02-06	confirmar proveedor"></textarea>

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
  if (label === "DESARROLLO") return "DEV";
  if (label === "PREPRODUCCIÓN") return "PRE";
  if (label === "RODAJE") return "ROD";
  if (label === "EDICIÓN") return "EDI";
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

export async function bindRutaCriticaEvents() {
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

  // ✅ NUEVO: UI buscador/filtro/paginado
  const inpSearch = document.getElementById("rcSearchInput");
  const selFilterEtapa = document.getElementById("rcFilterEtapa");
  const btnTabPaged = document.getElementById("rcTabPaged");
  const btnTabAll = document.getElementById("rcTabAll");
  const pagerBar = document.getElementById("rcPagerBar");
  const btnPagePrev = document.getElementById("rcPagePrev");
  const btnPageNext = document.getElementById("rcPageNext");
  const pageInfo = document.getElementById("rcPageInfo");
  const resultsInfo = document.getElementById("rcResultsInfo");

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
  const stDevIni = document.getElementById("rcStageIni_DEV");
  const stDevFin = document.getElementById("rcStageFin_DEV");
  const stPreIni = document.getElementById("rcStageIni_PRE");
  const stPreFin = document.getElementById("rcStageFin_PRE");
  const stRodIni = document.getElementById("rcStageIni_ROD");
  const stRodFin = document.getElementById("rcStageFin_ROD");
  const stEdiIni = document.getElementById("rcStageIni_EDI");
  const stEdiFin = document.getElementById("rcStageFin_EDI");
  const stPostIni = document.getElementById("rcStageIni_POST");
  const stPostFin = document.getElementById("rcStageFin_POST");

  const msgDev = document.getElementById("rcStageMsg_DEV");
  const msgPre = document.getElementById("rcStageMsg_PRE");
  const msgRod = document.getElementById("rcStageMsg_ROD");
  const msgEdi = document.getElementById("rcStageMsg_EDI");
  const msgPost = document.getElementById("rcStageMsg_POST");

  const btnSaveDev = document.getElementById("rcGuardar_DEV");
  const btnSavePre = document.getElementById("rcGuardar_PRE");
  const btnSaveRod = document.getElementById("rcGuardar_ROD");
  const btnSaveEdi = document.getElementById("rcGuardar_EDI");
  const btnSavePost = document.getElementById("rcGuardar_POST");

  const btnVistaDev = document.getElementById("rcVista_DEV");
  const btnVistaPre = document.getElementById("rcVista_PRE");
  const btnVistaRod = document.getElementById("rcVista_ROD");
  const btnVistaEdi = document.getElementById("rcVista_EDI");
  const btnVistaPost = document.getElementById("rcVista_POST");

  // ---- Server identity ----
  const userId = window?.appState?.user?.uid;
  const projectId = window?.appState?.profile?.projectId;
  if (!userId || !projectId) {
    throw new Error("Ruta Crítica: no hay userId/projectId en appState. (Este módulo ya no usa localStorage).");
  }

  /* =========================
     Server persistence helpers (FIX: debounce + cola)
  ========================= */
  function emptyStages() {
    return {
      dev: { ini: "", fin: "" },
      pre: { ini: "", fin: "" },
      rod: { ini: "", fin: "" },
      edi: { ini: "", fin: "" },
      post: { ini: "", fin: "" },
    };
  }

  async function loadFromServer() {
    const serverState = await loadModuleState({ userId, projectId, moduleKey: MODULE_KEY });
    const stagesIn = serverState?.stages;
    const tasksIn = serverState?.tasks;

    const stagesOut = stagesIn
      ? {
          dev: { ini: stagesIn?.dev?.ini || "", fin: stagesIn?.dev?.fin || "" },
          pre: { ini: stagesIn?.pre?.ini || "", fin: stagesIn?.pre?.fin || "" },
          rod: { ini: stagesIn?.rod?.ini || "", fin: stagesIn?.rod?.fin || "" },
          edi: { ini: stagesIn?.edi?.ini || "", fin: stagesIn?.edi?.fin || "" },
          post: { ini: stagesIn?.post?.ini || "", fin: stagesIn?.post?.fin || "" },
        }
      : emptyStages();

    const tasksOut = Array.isArray(tasksIn) ? tasksIn : [];
    return { stagesOut, tasksOut };
  }

  // ✅ Evita guardar mientras estamos cargando/hidratando UI
  let isHydrating = true;

  // ✅ Debounce + cola (para no spamear upserts)
  let saveTimer = null;
  let pendingPayload = null;

  // Serializa escrituras: si llegan varias, se encolan en orden
  let saveInFlight = Promise.resolve();

  function cloneSafe(obj) {
    try {
      return structuredClone(obj);
    } catch {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function queueSaveToServer() {
    if (isHydrating) return;

    pendingPayload = {
      stages: cloneSafe(stages),
      tasks: cloneSafe(tasks),
    };

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaveToServer, 250);
  }

  function flushSaveToServer() {
    if (!pendingPayload) return;

    const payload = pendingPayload;
    pendingPayload = null;

    saveInFlight = saveInFlight
      .then(() =>
        saveModuleState({
          userId,
          projectId,
          moduleKey: MODULE_KEY,
          data: payload,
        })
      )
      .catch((e) => {
        console.error("[rutaCritica] saveModuleState failed:", e);
      });
  }

  // compat: mismas firmas que antes
  function saveStages() {
    queueSaveToServer();
  }
  function saveTasks() {
    queueSaveToServer();
  }

  // ---- State ----
  let stages = emptyStages(); // {dev:{ini,fin}, pre:{ini,fin}, rod:{ini,fin}, edi:{ini,fin}, post:{ini,fin}}
  let tasks = []; // [{uid, etapa, tarea, ini, fin, notas, createdAt, updatedAt}]
  let filter = null; // null = todas, else etapaLabel
  let selectedUid = null;
  let selectedSet = new Set(); // multi-select by uid
  let formMode = "create"; // create/edit
  let bulkParsed = [];

  // ✅ NUEVO: estado UI (busqueda / filtro select / paginado)
  const PAGE_SIZE = 20;
  let uiSearch = "";
  let uiFilterEtapa = ""; // "" => todas
  let uiViewAll = false; // false => paginado (20)
  let uiPage = 0; // 0-based

  if (pagerBar) pagerBar.style.display = uiViewAll ? "none" : "flex";
  setTabButtons();

  // ---- Init: cargar server ----
  try {
    const loaded = await loadFromServer();
    stages = loaded.stagesOut;
    tasks = loaded.tasksOut;
  } catch (e) {
    throw new Error(`No pude cargar Ruta Crítica desde servidor: ${e?.message || String(e)}`);
  }

  hydrateStageInputsFromState();
  applyDateTypingSupport(); // permite dd/mm/aaaa escrito en inputs type=date
  renderAll();
  isHydrating = false;

  /* =========================================================
     ✅ CAMBIO QUIRÚRGICO (IMPLEMENTACIÓN REAL PARA DOCUMENTACIÓN)
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
  btnSaveDev.addEventListener("click", () => saveStage("DESARROLLO"));
  btnSavePre.addEventListener("click", () => saveStage("PREPRODUCCIÓN"));
  btnSaveRod.addEventListener("click", () => saveStage("RODAJE"));
  btnSaveEdi.addEventListener("click", () => saveStage("EDICIÓN"));
  btnSavePost.addEventListener("click", () => saveStage("POSTPRODUCCIÓN"));

  btnVistaDev.addEventListener("click", () => setFilter("DESARROLLO"));
  btnVistaPre.addEventListener("click", () => setFilter("PREPRODUCCIÓN"));
  btnVistaRod.addEventListener("click", () => setFilter("RODAJE"));
  btnVistaEdi.addEventListener("click", () => setFilter("EDICIÓN"));
  btnVistaPost.addEventListener("click", () => setFilter("POSTPRODUCCIÓN"));

  // ---- Table events ----
  chkAll.addEventListener("change", () => {
    const rows = Array.from(tbody.querySelectorAll("tr[data-uid]"));
    if (chkAll.checked) {
      rows.forEach((r) => selectedSet.add(r.dataset.uid));
    } else {
      rows.forEach((r) => selectedSet.delete(r.dataset.uid));
    }
    if (selectedUid && !selectedSet.has(selectedUid)) selectedUid = null;
    renderAll();
  });

  btnVerTodas.addEventListener("click", () => setFilter(null));
  btnLimpiar.addEventListener("click", () => {
    const ok = confirm("¿Borrar TODAS las tareas y fechas guardadas de Ruta Crítica (servidor)?");
    if (!ok) return;
    stages = emptyStages();
    tasks = [];
    selectedUid = null;
    selectedSet = new Set();
    saveStages();
    saveTasks();
    flushSaveToServer(); // ✅ inmediato al limpiar
    hydrateStageInputsFromState();

    // ✅ reset UI listado
    uiSearch = "";
    uiFilterEtapa = "";
    uiViewAll = false;
    uiPage = 0;
    if (inpSearch) inpSearch.value = "";
    if (selFilterEtapa) selFilterEtapa.value = "";
    if (pagerBar) pagerBar.style.display = "flex";
    setTabButtons();

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
  bulkBackdrop.addEventListener("click", (e) => {
    if (e.target === bulkBackdrop) closeBulkModal();
  });
  bulkPreview.addEventListener("click", previewBulk);
  bulkCommit.addEventListener("click", commitBulk);

  // ---- Preview events ----
  btnVistaPrevia.addEventListener("click", () => {
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
  });

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
    const { totalPages } = getFilteredAndPagedView();
    uiPage = Math.min(Math.max(0, totalPages - 1), uiPage + 1);
    renderTable();
  });

  function setTabButtons() {
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

  function hydrateStageInputsFromState() {
    stDevIni.value = stages.dev.ini || "";
    stDevFin.value = stages.dev.fin || "";
    stPreIni.value = stages.pre.ini || "";
    stPreFin.value = stages.pre.fin || "";
    stRodIni.value = stages.rod.ini || "";
    stRodFin.value = stages.rod.fin || "";
    stEdiIni.value = stages.edi.ini || "";
    stEdiFin.value = stages.edi.fin || "";
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
    let ini = "";
    let fin = "";

    if (etapaLabel === "DESARROLLO") {
      ini = normalizeDateInput(stDevIni.value);
      fin = normalizeDateInput(stDevFin.value);
    } else if (etapaLabel === "PREPRODUCCIÓN") {
      ini = normalizeDateInput(stPreIni.value);
      fin = normalizeDateInput(stPreFin.value);
    } else if (etapaLabel === "RODAJE") {
      ini = normalizeDateInput(stRodIni.value);
      fin = normalizeDateInput(stRodFin.value);
    } else if (etapaLabel === "EDICIÓN") {
      ini = normalizeDateInput(stEdiIni.value);
      fin = normalizeDateInput(stEdiFin.value);
    } else {
      ini = normalizeDateInput(stPostIni.value);
      fin = normalizeDateInput(stPostFin.value);
    }

    if (!ini || !fin) {
      alert("Faltan fechas: inicio y fin son requeridas.");
      return;
    }
    if (cmpDate(ini, fin) > 0) {
      alert("La fecha fin no puede ser anterior a la fecha inicio.");
      return;
    }

    if (etapaLabel === "DESARROLLO") {
      stages.dev = { ini, fin };

      const expectedPreIni = addDays(iniOrFin(stages.dev.fin), 1);
      if (!stages.pre.ini) {
        stages.pre.ini = expectedPreIni;
        stPreIni.value = expectedPreIni;
      }
    }

    if (etapaLabel === "PREPRODUCCIÓN") {
      stages.pre = { ini, fin };

      const expectedRodIni = addDays(iniOrFin(stages.pre.fin), 1);
      if (!stages.rod.ini) {
        stages.rod.ini = expectedRodIni;
        stRodIni.value = expectedRodIni;
      }
    }

    if (etapaLabel === "RODAJE") {
      stages.rod = { ini, fin };

      const expectedEdiIni = addDays(iniOrFin(stages.rod.fin), 1);
      if (!stages.edi.ini) {
        stages.edi.ini = expectedEdiIni;
        stEdiIni.value = expectedEdiIni;
      }
    }

    if (etapaLabel === "EDICIÓN") {
      stages.edi = { ini, fin };

      const expectedPostIni = addDays(iniOrFin(stages.edi.fin), 1);
      if (!stages.post.ini) {
        stages.post.ini = expectedPostIni;
        stPostIni.value = expectedPostIni;
      }
    }

    if (etapaLabel === "POSTPRODUCCIÓN") {
      stages.post = { ini, fin };
    }

    saveStages();
    hydrateStageInputsFromState();
    renderAll();
  }

  function iniOrFin(d) {
    return d;
  }

  /* =========================
     Gate de etapas (bloqueo)
  ========================= */
  function stageGate() {
    const { dev, pre, rod, edi, post } = stages;

    if (
      !dev.ini ||
      !dev.fin ||
      !pre.ini ||
      !pre.fin ||
      !rod.ini ||
      !rod.fin ||
      !edi.ini ||
      !edi.fin ||
      !post.ini ||
      !post.fin
    ) {
      return { ok: false, message: "Primero guarda las fechas de DESARROLLO / PRE / RODAJE / EDICIÓN / POST (inicio y fin)." };
    }

    if (cmpDate(dev.ini, dev.fin) > 0) return { ok: false, message: "DESARROLLO: fin no puede ser antes de inicio." };
    if (cmpDate(pre.ini, pre.fin) > 0) return { ok: false, message: "PREPRODUCCIÓN: fin no puede ser antes de inicio." };
    if (cmpDate(rod.ini, rod.fin) > 0) return { ok: false, message: "RODAJE: fin no puede ser antes de inicio." };
    if (cmpDate(edi.ini, edi.fin) > 0) return { ok: false, message: "EDICIÓN: fin no puede ser antes de inicio." };
    if (cmpDate(post.ini, post.fin) > 0) return { ok: false, message: "POSTPRODUCCIÓN: fin no puede ser antes de inicio." };

    const expectedPreIni = addDays(dev.fin, 1);
    if (pre.ini !== expectedPreIni) {
      return {
        ok: false,
        message: `Revisar fechas: PREPRODUCCIÓN debe iniciar ${fmtDMY(expectedPreIni)} (día siguiente al fin de DESARROLLO). Actualmente: ${fmtDMY(pre.ini)}.`,
        warn: { stage: "PRE", expected: expectedPreIni, actual: pre.ini },
      };
    }

    const expectedRodIni = addDays(pre.fin, 1);
    if (rod.ini !== expectedRodIni) {
      return {
        ok: false,
        message: `Revisar fechas: RODAJE debe iniciar ${fmtDMY(expectedRodIni)} (día siguiente al fin de PRE). Actualmente: ${fmtDMY(rod.ini)}.`,
        warn: { stage: "ROD", expected: expectedRodIni, actual: rod.ini },
      };
    }

    const expectedEdiIni = addDays(rod.fin, 1);
    if (edi.ini !== expectedEdiIni) {
      return {
        ok: false,
        message: `Revisar fechas: EDICIÓN debe iniciar ${fmtDMY(expectedEdiIni)} (día siguiente al fin de RODAJE). Actualmente: ${fmtDMY(edi.ini)}.`,
        warn: { stage: "EDI", expected: expectedEdiIni, actual: edi.ini },
      };
    }

    const expectedPostIni = addDays(edi.fin, 1);
    if (post.ini !== expectedPostIni) {
      return {
        ok: false,
        message: `Revisar fechas: POSTPRODUCCIÓN debe iniciar ${fmtDMY(expectedPostIni)} (día siguiente al fin de EDICIÓN). Actualmente: ${fmtDMY(post.ini)}.`,
        warn: { stage: "POST", expected: expectedPostIni, actual: post.ini },
      };
    }

    if (cmpDate(pre.ini, dev.fin) <= 0) return { ok: false, message: "No overlap: PREPRODUCCIÓN debe iniciar después del fin de DESARROLLO." };
    if (cmpDate(rod.ini, pre.fin) <= 0) return { ok: false, message: "No overlap: RODAJE debe iniciar después del fin de PRE." };
    if (cmpDate(edi.ini, rod.fin) <= 0) return { ok: false, message: "No overlap: EDICIÓN debe iniciar después del fin de RODAJE." };
    if (cmpDate(post.ini, edi.fin) <= 0) return { ok: false, message: "No overlap: POST debe iniciar después del fin de EDICIÓN." };

    return { ok: true };
  }

  function paintStageWarnings(gate) {
    [stPreIni, stRodIni, stEdiIni, stPostIni].forEach((el) => {
      el.style.background = "";
      el.style.borderColor = "";
    });

    setStageMsg(msgDev, "", null);
    setStageMsg(msgPre, "", null);
    setStageMsg(msgRod, "", null);
    setStageMsg(msgEdi, "", null);
    setStageMsg(msgPost, "", null);

    if (stages.dev.ini && stages.dev.fin) setStageMsg(msgDev, `Guardado: ${fmtDMY(stages.dev.ini)} → ${fmtDMY(stages.dev.fin)}`, "ok");
    if (stages.pre.ini && stages.pre.fin) setStageMsg(msgPre, `Guardado: ${fmtDMY(stages.pre.ini)} → ${fmtDMY(stages.pre.fin)}`, "ok");
    if (stages.rod.ini && stages.rod.fin) setStageMsg(msgRod, `Guardado: ${fmtDMY(stages.rod.ini)} → ${fmtDMY(stages.rod.fin)}`, "ok");
    if (stages.edi.ini && stages.edi.fin) setStageMsg(msgEdi, `Guardado: ${fmtDMY(stages.edi.ini)} → ${fmtDMY(stages.edi.fin)}`, "ok");
    if (stages.post.ini && stages.post.fin) setStageMsg(msgPost, `Guardado: ${fmtDMY(stages.post.ini)} → ${fmtDMY(stages.post.fin)}`, "ok");

    if (gate.ok) return;

    if (gate.warn?.stage === "PRE") {
      stPreIni.style.background = "rgba(255, 200, 0, .18)";
      stPreIni.style.borderColor = "rgba(255, 200, 0, .55)";
      setStageMsg(msgPre, `⚠ Revisar: inicio esperado ${fmtDMY(gate.warn.expected)}. Actual: ${fmtDMY(gate.warn.actual)}.`, "warn");
    }

    if (gate.warn?.stage === "ROD") {
      stRodIni.style.background = "rgba(255, 200, 0, .18)";
      stRodIni.style.borderColor = "rgba(255, 200, 0, .55)";
      setStageMsg(msgRod, `⚠ Revisar: inicio esperado ${fmtDMY(gate.warn.expected)}. Actual: ${fmtDMY(gate.warn.actual)}.`, "warn");
    }

    if (gate.warn?.stage === "EDI") {
      stEdiIni.style.background = "rgba(255, 200, 0, .18)";
      stEdiIni.style.borderColor = "rgba(255, 200, 0, .55)";
      setStageMsg(msgEdi, `⚠ Revisar: inicio esperado ${fmtDMY(gate.warn.expected)}. Actual: ${fmtDMY(gate.warn.actual)}.`, "warn");
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
    tasks = (tasks || []).map((t) => ({
      uid: t.uid || mkUid(),
      etapa: normalizeEtapa(t.etapa) || "DESARROLLO",
      tarea: (t.tarea || "").trim(),
      ini: normalizeDateInput(t.ini) || "",
      fin: normalizeDateInput(t.fin) || "",
      notas: (t.notas || "").trim(),
      createdAt: t.createdAt ?? Date.now(),
      updatedAt: t.updatedAt ?? Date.now(),
    }));

    // ❌ FIX: NO guardar aquí (evita spam de upserts)
    // saveTasks();

    const gate = stageGate();
    paintStageWarnings(gate);
    updateGateUI(gate);

    renderTable();
    updateActionButtons();
  }

  // ✅ NUEVO: view final (filtro por botones + filtro select + búsqueda + paginado)
  function getFilteredAndPagedView() {
    // 1) filtro por botones "Vista" (filter)
    let view = filter ? tasks.filter((t) => t.etapa === filter) : tasks.slice();

    // 2) filtro select etapa (uiFilterEtapa) (se combina con el anterior)
    if (uiFilterEtapa) view = view.filter((t) => t.etapa === uiFilterEtapa);

    // 3) búsqueda
    const q = norm(uiSearch);
    if (q) {
      view = view.filter((t) => {
        const hay = [t.etapa, t.tarea, t.notas].filter(Boolean).map(norm).join(" | ");
        return hay.includes(q);
      });
    }

    // 4) orden
    view.sort((a, b) => {
      const c = cmpDate(a.ini, b.ini);
      if (c !== 0) return c;
      return (a.tarea || "").localeCompare(b.tarea || "");
    });

    const total = view.length;

    if (uiViewAll) {
      return { filtered: view, pageItems: view, total, totalPages: 1, page: 0 };
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(uiPage, totalPages - 1));
    uiPage = safePage;

    const start = safePage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageItems = view.slice(start, end);

    return { filtered: view, pageItems, total, totalPages, page: safePage };
  }

  function renderTable() {
    tbody.innerHTML = "";

    const { pageItems, total, totalPages, page } = getFilteredAndPagedView();

    // etiqueta de filtro: respeta lo existente, agregando el select si aplica
    const labelA = filter ? escapeHtml(filter) : "todas";
    const labelB = uiFilterEtapa ? escapeHtml(uiFilterEtapa) : "todas";
    const labelSearch = uiSearch ? ` + búsqueda` : "";
    filtroLabel.innerHTML = `Filtro: <b>${labelA}</b> | Select: <b>${labelB}</b>${labelSearch}`;

    pageItems.forEach((t) => {
      const tr = document.createElement("tr");
      tr.dataset.uid = t.uid;

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

      tr.addEventListener("click", (e) => {
        const tag = (e.target?.tagName || "").toLowerCase();
        if (tag === "input") return;
        selectSingle(t.uid);
      });

      tbody.appendChild(tr);
    });

    Array.from(tbody.querySelectorAll(".rcChkRow")).forEach((cb) => {
      cb.addEventListener("change", () => {
        const uid = cb.getAttribute("data-uid");
        if (!uid) return;
        if (cb.checked) selectedSet.add(uid);
        else selectedSet.delete(uid);

        if (selectedUid && !selectedSet.has(selectedUid)) {
          // mantenemos selectedUid para edit, aunque no esté checked
        }

        syncChkAllWithView();
        updateActionButtons();
      });
    });

    syncChkAllWithView();

    // ✅ UI: info de resultados y paginado
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

    updateActionButtons();
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

    Array.from(tbody.querySelectorAll("tr")).forEach((r) => r.classList.remove("is-selected"));
    const tr = tbody.querySelector(`tr[data-uid="${cssEscape(uid)}"]`);
    if (tr) tr.classList.add("is-selected");
    updateActionButtons();
  }

  function setFilter(etapa) {
    filter = etapa;

    // ✅ sincroniza select también para que sea consistente (sin obligar, pero ayuda)
    if (selFilterEtapa) {
      if (etapa) {
        uiFilterEtapa = etapa;
        selFilterEtapa.value = etapa;
      } else {
        uiFilterEtapa = "";
        selFilterEtapa.value = "";
      }
    }

    uiPage = 0;
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
    selEtapa.value = "DESARROLLO";
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

    const etapa = normalizeEtapa(selEtapa.value) || "DESARROLLO";
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
    if (!fin) fin = ini;
    if (cmpDate(ini, fin) > 0) {
      alert("Fecha fin no puede ser anterior a inicio.");
      return;
    }

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
      selectedUid = t.uid;
      selectedSet.add(t.uid);
      renderAll();
      return;
    }

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
    if (etapaLabel === "DESARROLLO") return stages.dev.ini && stages.dev.fin ? { ini: stages.dev.ini, fin: stages.dev.fin } : null;
    if (etapaLabel === "PREPRODUCCIÓN") return stages.pre.ini && stages.pre.fin ? { ini: stages.pre.ini, fin: stages.pre.fin } : null;
    if (etapaLabel === "RODAJE") return stages.rod.ini && stages.rod.fin ? { ini: stages.rod.ini, fin: stages.rod.fin } : null;
    if (etapaLabel === "EDICIÓN") return stages.edi.ini && stages.edi.fin ? { ini: stages.edi.ini, fin: stages.edi.fin } : null;
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
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));

    const header = rows[0].map((h) => norm(h));
    const hasHeader = header.includes("ETAPA") || header.includes("TAREA") || header.includes("INICIO");
    const start = hasHeader ? 1 : 0;

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
      if (!fin) fin = ini;
      if (ini && fin && cmpDate(ini, fin) > 0) errors.push(`Fila ${rowNum}: FIN no puede ser antes de INICIO.`);

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
     Date typing support
  ========================= */
  function applyDateTypingSupport() {
    const allDateInputs = [
      stDevIni,
      stDevFin,
      stPreIni,
      stPreFin,
      stRodIni,
      stRodFin,
      stEdiIni,
      stEdiFin,
      stPostIni,
      stPostFin,
      inpIni,
      inpFin,
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
    if (s === "DESARROLLO") return "DESARROLLO";
    if (s === "PREPRODUCCION" || s === "PRE PRODUCCION") return "PREPRODUCCIÓN";
    if (s === "PRODUCCION" || s === "PRODUCCION" || s === "PRODUCCION " || s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION" || s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION" || s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION" || s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION" || s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "PRODUCCION") return "RODAJE";
    if (s === "RODAJE") return "RODAJE";
    if (s === "EDICION") return "EDICIÓN";
    if (s === "POSTPRODUCCION" || s === "POST PRODUCCION" || s === "POST-PRODUCCION") return "POSTPRODUCCIÓN";
    return null;
  }

  function mkUid() {
    return crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now());
  }

  function normalizeDateInput(v) {
    const s = (v ?? "").toString().trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

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
    return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
  }

  function cmpDate(a, b) {
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

function cssEscape(s) {
  return (s ?? "").toString().replace(/"/g, '\\"');
}
