/* =========================================================
   src/modules/documentacion.js
   DOCUMENTACIÓN V2 (Supabase Storage + project_state)
   - Archivos: Supabase Storage (bucket: uploads)
   - Estado (metadata): project_state (via stateService)

   ✅ Catálogo fijo de documentos (con descripción)
   ✅ Por documento: Subir/Reemplazar | Vista previa | Eliminar
   ✅ Requeridos con * + leyenda
   ✅ Vista previa abre nueva ventana (PDF/imagen en <iframe>/<img>)
   ✅ Migración automática:
      - Si Supabase NO tiene estado para este módulo,
        intenta leer LS_DOCS ("DOCS_V1_ITEMS") y lo sube a Storage,
        guardando metadata en Supabase.

   ✅ AJUSTE QUIRÚRGICO SOLICITADO:
      - En Documentación solo se pueden subir PDFs o Imágenes
      - Si intentan subir otro tipo: bloquear y mostrar alerta
      - Logo mantiene su validación estricta (PNG/JPG/JPEG)
========================================================= */

import { loadModuleState, saveModuleState } from "../services/stateService.js";
import { supabase } from "../services/supabase.js";

const LS_DOCS = "DOCS_V1_ITEMS";
const MODULE_KEY = "documentacion"; // llave para project_state
const BUCKET = "uploads";

// =========================================================
// CATÁLOGO (A, B, C... como tu boceto)
// =========================================================
const DOCS_CATALOGO = [
  {
    code: "A",
    key: "resumen_ejecutivo",
    title: "Resumen Ejecutivo",
    required: true,
    desc: `Documento breve que incluya:
• Logline
• Premisa
• Estado actual del proyecto
• Formato (ficción/documental)
• Duración estimada
• Equipo base
• Necesidades generales de producción`,
  },
  {
    code: "B",
    key: "sinopsis_desarrollada",
    title: "5.2 Sinopsis Desarrollada",
    required: true,
    desc: `Sinopsis larga.
Extensión aproximada: 1 a 2 cuartillas.`,
  },
  {
    code: "C",
    key: "guion_argumento_documental",
    title: "5.3 Guion / Argumento Documental",
    required: true,
    desc: `Dependiendo del tipo de proyecto:
Ficción:
• Guion en formato profesional
• Extensión mínima: 60 cuartillas
Documental:
• Argumento documental
• Extensión mínima: 10 cuartillas`,
  },
  {
    code: "D",
    key: "propuesta_creativa_direccion",
    title: "5.4 Propuesta Creativa de Dirección",
    required: true,
    desc: `Máximo 5 cuartillas. Debe incluir:
• Enfoque narrativo
• Personajes
• Propuesta visual (imagen)
• Propuesta sonora
• Referencias cinematográficas
• Estrategias formales`,
  },
  {
    code: "E",
    key: "vision_tecnica_produccion",
    title: "5.5 Visión Técnica y Creativa de Producción",
    required: true,
    desc: `Extensión: 1 a 2 cuartillas. Debe incluir:
• Estrategia logística
• Estrategia de producción
• Principales riesgos
• Plan de mitigación`,
  },
  {
    code: "F",
    key: "equipo_propuesto",
    title: "5.6 Equipo Propuesto",
    required: true,
    desc: `Debe incluir:
• Lista de roles clave:
  - Dirección
  - Producción
  - Cinefotografía
  - Sonido
  - Edición
  - Diseño de Producción
  - Asistencia de Dirección
  - Diseño Sonoro
  - Corrección de Color
• Semblanzas breves (CV resumido)
• Generación a la que pertenece cada integrante`,
  },

  // ====== AJUSTES: estos 2 son internos (sin subir/eliminar) ======
  {
    code: "G",
    key: "ruta_critica_general",
    title: "5.7 Ruta Crítica General (Cronograma)",
    required: true,
    internalModule: "rutaCritica", // ✅ SOLO Vista previa
    desc: `Debe contemplar:
• Desarrollo
• Preproducción
• Rodaje
• Edición
• Postproducción
Las ventanas deben ser realistas.`,
  },
  {
    code: "H",
    key: "presupuesto",
    title: "5.8 Presupuesto",
    required: true,
    internalModule: "presupuesto", // ✅ SOLO Vista previa
    desc: `Tope máximo permitido: $1,500,000.00 MXN
Incluye aportación en especie de CENTRO hasta por $600,000.00 MXN (cámaras, ópticas, iluminación, tramoya, oficina, edición, mezcla 7.1.4, color).
Debe incluir:
• Resumen por etapas
• Presupuesto desglosado por cuentas (formato legible)`,
  },

  {
    code: "I",
    key: "esquema_financiero_ratificacion",
    title: "5.9 Esquema Financiero y Ratificación de Aportaciones",
    required: true,
    desc: `Debe incluir:
• Esquema financiero:
  - Fuentes confirmadas
  - Fuentes por confirmar
• Carta simple de intención de aportaciones (si existen)`,
  },
  {
    code: "J",
    key: "estado_derechos",
    title: "5.10 Estado de Derechos",
    required: true,
    desc: `Un párrafo firmado donde la persona responsable declare:
• Autoría
• Titularidad
• Que cuenta con autorización para desarrollar el proyecto
Nota: No se requieren contratos completos en esta etapa.`,
  },

  // =========================================================
  // ✅ NUEVOS OPCIONALES (V2)
  // =========================================================
  {
    code: "K",
    key: "portada_pdf_final",
    title: "Portada (1 página) para el PDF final (Opcional)",
    required: false,
    desc: `Documento de una (1) página que funcione como portada del PDF final.
Puede incluir:
• Título del proyecto
• Imagen representativa
• Nombre del director(a)
• Nombre del productor(a)
• Institución o convocatoria`,
  },
  {
    code: "L",
    key: "respaldo_presupuesto_cartas_cotizaciones",
    title: "Cartas Compromiso / Cotizaciones (Opcional)",
    required: false,
    desc: `Conjunto de documentos que respalden el presupuesto presentado.
Puede incluir:
• Cartas compromiso de colaboradores
• Cartas de intención de proveedores
• Cotizaciones de servicios o renta de equipo
• Cualquier documento que valide costos contemplados en el presupuesto

Sugerencia: sube un solo PDF consolidado o un ZIP con varios archivos.`,
  },

  {
    code: "M",
    key: "logo_proyecto",
    title: "6.1 Logo del Proyecto (Opcional)",
    required: false,
    desc: `Se podrá subir un logotipo del proyecto como material complementario.`,
  },
];

// =========================================================
// VIEW
// =========================================================
export function renderDocumentacionView() {
  return `
    <div class="card">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div>
          <h2 style="margin-bottom:6px;">Documentación</h2>
          <p class="muted" style="margin:0;">
            V2: archivos en Supabase Storage + metadata en la nube (project_state).
          </p>
          <div class="muted" style="margin-top:8px;">
            <b>*</b> = Documento obligatorio.
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center;">
          <button id="docBtnLimpiarTodo" class="btn btn-light">Limpiar todo</button>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:14px;">
        <table class="table" id="docTable">
          <thead>
            <tr>
              <th style="width:80px;">Código</th>
              <th style="min-width:280px;">Documento</th>
              <th>Descripción</th>
              <th style="width:420px;">Acciones</th>
              <th style="width:220px;">Archivo</th>
            </tr>
          </thead>
          <tbody id="docTbody"></tbody>
        </table>
      </div>
    </div>

    <!-- input file hidden (1 por módulo) -->
    <input id="docFileInput" type="file" style="display:none;" />

    <!-- ✅ Modal confirmación Logo (solo se usa para logo_proyecto) -->
    <div id="docLogoModalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal" style="max-width: 980px;">
        <div class="modal-header">
          <h3>Vista previa — Logo del Proyecto</h3>
          <button id="docLogoModalClose" class="modal-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="modal-body">
          <div class="muted" style="margin:0 0 10px; white-space:pre-line;">
            ✅ Requisito: solo PNG / JPG / JPEG.
            Nota (para que no se corte / se vea correcto en el export):
            • Deja “aire” alrededor del logo (zona segura).
            • Evita logos pegados a los bordes.
            • Recomendado: margen visible alrededor (4–8% del ancho).
          </div>

          <div style="display:grid; grid-template-columns: 1fr 320px; gap:14px; align-items:start;">
            <div style="border:1px solid rgba(0,0,0,.12); border-radius:14px; overflow:hidden; background:#fff;">
              <div style="padding:12px; border-bottom:1px solid rgba(0,0,0,.08); font-weight:900;">
                Preview (fondo blanco)
              </div>
              <div style="padding:14px;">
                <div style="border:1px dashed rgba(0,0,0,.20); border-radius:12px; padding:14px; background:linear-gradient(45deg, rgba(0,0,0,.03), rgba(0,0,0,.01));">
                  <img id="docLogoModalImg" alt="Logo" style="max-width:100%; height:auto; display:block;" />
                </div>
              </div>
            </div>

            <div style="border:1px solid rgba(0,0,0,.12); border-radius:14px; background:#fff; overflow:hidden;">
              <div style="padding:12px; border-bottom:1px solid rgba(0,0,0,.08); font-weight:900;">
                Información
              </div>
              <div class="muted" style="padding:12px;">
                <div><b>Archivo:</b> <span id="docLogoMetaName"></span></div>
                <div style="margin-top:6px;"><b>Tipo:</b> <span id="docLogoMetaType"></span></div>
                <div style="margin-top:6px;"><b>Peso:</b> <span id="docLogoMetaSize"></span></div>
                <div style="margin-top:6px;"><b>Resolución:</b> <span id="docLogoMetaRes"></span></div>
                <div id="docLogoWarn" style="margin-top:10px; display:none; color:#b85c00; font-weight:800;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button id="docLogoModalChange" class="btn btn-light">Cambiar archivo</button>
          <button id="docLogoModalConfirm" class="btn btn-primary">Confirmar y guardar</button>
        </div>
      </div>
    </div>
  `;
}

// =========================================================
// EVENTS
// =========================================================
export function bindDocumentacionEvents() {
  void (async () => {
    const tbody = document.getElementById("docTbody");
    const fileInput = document.getElementById("docFileInput");
    const btnLimpiarTodo = document.getElementById("docBtnLimpiarTodo");

    if (!tbody || !fileInput || !btnLimpiarTodo) return;

    // ✅ Modal logo
    const logoBackdrop = document.getElementById("docLogoModalBackdrop");
    const logoClose = document.getElementById("docLogoModalClose");
    const logoChange = document.getElementById("docLogoModalChange");
    const logoConfirm = document.getElementById("docLogoModalConfirm");
    const logoImg = document.getElementById("docLogoModalImg");
    const logoMetaName = document.getElementById("docLogoMetaName");
    const logoMetaType = document.getElementById("docLogoMetaType");
    const logoMetaSize = document.getElementById("docLogoMetaSize");
    const logoMetaRes = document.getElementById("docLogoMetaRes");
    const logoWarn = document.getElementById("docLogoWarn");

    // Estado: ahora guardamos metadata (NO dataUrl)
    // store[key] = { fileName, mime, path, updatedAt, width?, height?, sizeBytes? }
    let store = {};
    let pendingKey = null;

    // ✅ Logo pending (se sube solo tras confirmar)
    let pendingLogoPayload = null;

    // Cola de guardado
    let saveQueue = Promise.resolve();
    function queueSave() {
      saveQueue = saveQueue
        .then(() => saveStore())
        .catch((e) => console.warn("Error guardando Documentación:", e));
      return saveQueue;
    }

    // ====== INIT ======
    store = await loadStore();
    syncDocsToWindow(store);
    renderAll();

    // =========================================================
    // UI Events
    // =========================================================
    btnLimpiarTodo.addEventListener("click", () => {
      const ok = confirm("¿Borrar TODOS los archivos guardados en Documentación (nube + storage)?");
      if (!ok) return;

      // Borrado en background (sin bloquear UI)
      void (async () => {
        try {
          await deleteAllFilesInStore(store);
        } catch (e) {
          console.warn("No se pudo borrar todo en storage:", e);
        } finally {
          store = {};
          syncDocsToWindow(store);
          await queueSave();
          renderAll();
        }
      })();
    });

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const key = btn.getAttribute("data-key");
      const module = btn.getAttribute("data-module");

      // ====== módulos internos ======
      if (action === "internal-preview") {
        if (module === "rutaCritica") {
          if (typeof window.openRutaCriticaPreview === "function") window.openRutaCriticaPreview();
          else alert("La vista previa de Ruta Crítica no está disponible (window.openRutaCriticaPreview).");
        } else if (module === "presupuesto") {
          if (typeof window.openPresupuestoPreview === "function") window.openPresupuestoPreview();
          else alert("La vista previa de Presupuesto no está disponible (window.openPresupuestoPreview).");
        }
        return;
      }

      if (!key) return;

      if (action === "upload") {
        pendingKey = key;
        fileInput.value = "";

        // ✅ Candado: solo PDFs o imágenes (logo es caso especial)
        if (pendingKey === "logo_proyecto") fileInput.setAttribute("accept", "image/png,image/jpeg");
        else fileInput.setAttribute("accept", "application/pdf,image/*");

        fileInput.click();
        return;
      }

      if (action === "view") {
        const entry = store[key];
        if (!entry?.path) return;
        void openStoragePreview(entry);
        return;
      }

      if (action === "delete") {
        const entry = store[key];
        if (!entry?.path) return;

        const ok = confirm(`¿Eliminar archivo de "${getTitleByKey(key)}"?`);
        if (!ok) return;

        void (async () => {
          try {
            await deleteFromStorage(entry.path);
          } catch (e) {
            alert("No se pudo borrar en storage. Revisa consola.");
            console.warn(e);
            return;
          }
          delete store[key];
          syncDocsToWindow(store);
          await queueSave();
          renderAll();
        })();

        return;
      }
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file || !pendingKey) return;

      try {
        // ✅ Candado general: solo PDF o imagen (excepto logo, que es más estricto)
        if (pendingKey !== "logo_proyecto") {
          const errGeneral = validatePdfOrImageOnly(file);
          if (errGeneral) {
            alert(errGeneral);
            pendingKey = null;
            fileInput.value = "";
            return;
          }
        }

        // ✅ Logo: validación + modal preview obligatorio
        if (pendingKey === "logo_proyecto") {
          const err = validateLogoFileStrict(file);
          if (err) {
            alert(err);
            pendingKey = null;
            fileInput.value = "";
            return;
          }

          const dataUrl = await fileToDataURL(file);
          const meta = await getImageMetaFromDataUrl(dataUrl);

          const warn =
            meta?.width && meta.width < 600
              ? "⚠️ Ojo: el logo es pequeño (< 600px de ancho). Puede verse pixelado en el PDF."
              : "";

          pendingLogoPayload = {
            key: pendingKey,
            file, // guardamos el File real para subir después
            fileName: file.name,
            mime: file.type || "image/png",
            previewDataUrl: dataUrl,
            updatedAt: Date.now(),
            meta,
            warn,
          };

          openLogoConfirmModal(pendingLogoPayload);
          return; // no sube todavía
        }

        // ✅ Resto: sube directo
        await uploadAndSetEntry({ docKey: pendingKey, file });

        syncDocsToWindow(store);
        await queueSave();
        renderAll();
      } catch (err) {
        alert(err?.message || String(err));
      } finally {
        pendingKey = null;
        fileInput.value = "";
      }
    });

    // ============================
    // Modal Logo: events
    // ============================
    logoClose?.addEventListener("click", closeLogoConfirmModal);
    logoBackdrop?.addEventListener("click", (e) => {
      if (e.target === logoBackdrop) closeLogoConfirmModal();
    });

    logoChange?.addEventListener("click", () => {
      closeLogoConfirmModal();
      pendingKey = "logo_proyecto";
      fileInput.value = "";
      fileInput.setAttribute("accept", "image/png,image/jpeg");
      fileInput.click();
    });

    logoConfirm?.addEventListener("click", () => {
      if (!pendingLogoPayload?.file) return;

      void (async () => {
        try {
          await uploadAndSetEntry({
            docKey: pendingLogoPayload.key,
            file: pendingLogoPayload.file,
            extraMeta: {
              width: pendingLogoPayload.meta?.width ?? undefined,
              height: pendingLogoPayload.meta?.height ?? undefined,
              sizeBytes: pendingLogoPayload.meta?.sizeBytes ?? undefined,
            },
          });

          syncDocsToWindow(store);
          await queueSave();
          renderAll();
        } catch (e) {
          alert("No se pudo subir el logo. Revisa consola.");
          console.warn(e);
        } finally {
          closeLogoConfirmModal();
        }
      })();
    });

    function openLogoConfirmModal(payload) {
      if (!logoBackdrop) return;

      logoImg.src = payload.previewDataUrl;
      logoMetaName.textContent = payload.fileName || "logo";
      logoMetaType.textContent = payload.mime || "image/*";
      logoMetaSize.textContent = formatBytes(payload.meta?.sizeBytes ?? payload.file?.size ?? 0);
      logoMetaRes.textContent =
        payload.meta?.width && payload.meta?.height ? `${payload.meta.width} × ${payload.meta.height} px` : "-";

      if (payload.warn) {
        logoWarn.style.display = "block";
        logoWarn.textContent = payload.warn;
      } else {
        logoWarn.style.display = "none";
        logoWarn.textContent = "";
      }

      logoBackdrop.style.display = "flex";
    }

    function closeLogoConfirmModal() {
      if (!logoBackdrop) return;
      logoBackdrop.style.display = "none";
      pendingLogoPayload = null;
      try {
        logoImg.src = "";
      } catch {}
    }

    // =========================================================
    // Render
    // =========================================================
    function renderAll() {
      tbody.innerHTML = "";

      DOCS_CATALOGO.forEach((d) => {
        const entry = store[d.key];
        const hasFile = !!entry?.path;

        const requiredMark = d.required ? `<span style="color:#ffde8a; font-weight:900;">*</span>` : "";

        const tr = document.createElement("tr");

        const actionsHtml = d.internalModule
          ? `
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn btn-secondary"
                      data-action="internal-preview"
                      data-module="${escapeAttr(d.internalModule)}">
                Vista previa
              </button>
            </div>
          `
          : `
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn btn-primary" data-action="upload" data-key="${escapeAttr(d.key)}">
                ${hasFile ? "Reemplazar" : "Subir"}
              </button>

              <button class="btn btn-secondary" data-action="view" data-key="${escapeAttr(d.key)}" ${
                hasFile ? "" : "disabled"
              }>
                Vista previa
              </button>

              <button class="btn btn-danger" data-action="delete" data-key="${escapeAttr(d.key)}" ${
                hasFile ? "" : "disabled"
              }>
                Eliminar
              </button>
            </div>
          `;

        tr.innerHTML = `
          <td style="font-weight:900; opacity:.9;">
            ${escapeHtml(d.code)}
          </td>

          <td style="font-weight:800;">
            ${escapeHtml(d.title)} ${requiredMark}
          </td>

          <td class="muted" style="white-space:pre-line;">
            ${escapeHtml(d.desc)}
          </td>

          <td style="vertical-align:top;">
            ${actionsHtml}
          </td>

          <td class="muted" style="vertical-align:top;">
            ${
              d.internalModule
                ? `<span style="opacity:.8;">(Generado por el sistema)</span>`
                : hasFile
                ? `
                    <div style="font-weight:800;">${escapeHtml(entry.fileName || "Archivo")}</div>
                    <div style="opacity:.75; margin-top:6px;">Actualizado: ${escapeHtml(fmtDateTime(entry.updatedAt))}</div>
                  `
                : `<span style="opacity:.7;">Sin archivo</span>`
            }
          </td>
        `;

        tbody.appendChild(tr);
      });
    }

    // =========================================================
    // Storage + State
    // =========================================================
    function getSessionIds() {
      const userId = window?.appState?.user?.uid || null;
      const projectId = window?.appState?.profile?.projectId || null;
      return { userId, projectId };
    }

    async function loadStore() {
      const { userId, projectId } = getSessionIds();

      // Si no hay supabase o sesión completa, usa local (legacy)
      if (!supabase || !userId || !projectId) {
        return safeReadLocalDocs() || {};
      }

      // 1) nube: metadata
      const cloud = await loadModuleState({ userId, projectId, moduleKey: MODULE_KEY });
      if (cloud && typeof cloud === "object" && Object.keys(cloud).length) return cloud;

      // 2) migración desde localStorage V1 (dataUrl)
      const legacy = safeReadLocalDocs();
      if (legacy && typeof legacy === "object" && Object.keys(legacy).length) {
        try {
          const migrated = await migrateLegacyLocalToStorage(legacy);
          await saveModuleState({ userId, projectId, moduleKey: MODULE_KEY, data: migrated });
          return migrated;
        } catch (e) {
          console.warn("No se pudo migrar V1 a Storage. Usando local.", e);
          return legacy; // fallback (por si algo)
        }
      }

      return {};
    }

    async function saveStore() {
      const { userId, projectId } = getSessionIds();

      // Guardamos local SOLO como backup liviano (metadata). No guardes dataUrl ya.
      safeWriteLocalDocs(store);

      if (!supabase || !userId || !projectId) return;

      await saveModuleState({
        userId,
        projectId,
        moduleKey: MODULE_KEY,
        data: store,
      });
    }

    function safeReadLocalDocs() {
      try {
        const raw = localStorage.getItem(LS_DOCS);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }

    function safeWriteLocalDocs(obj) {
      try {
        localStorage.setItem(LS_DOCS, JSON.stringify(obj || {}));
      } catch {}
    }

    function syncDocsToWindow(obj) {
      try {
        if (!window.appState) window.appState = {};
        window.appState.docs = obj || {};
      } catch {}
    }

    // =========================================================
    // Core: Upload / Delete / Preview (Storage)
    // =========================================================
    async function uploadAndSetEntry({ docKey, file, extraMeta }) {
      const { userId, projectId } = getSessionIds();
      if (!supabase) throw new Error("Supabase no está inicializado.");
      if (!userId || !projectId) throw new Error("No hay sesión completa (userId/projectId).");

      // ✅ Candado extra: doble validación antes de subir
      if (docKey !== "logo_proyecto") {
        const err = validatePdfOrImageOnly(file);
        if (err) throw new Error(err);
      }

      // Si ya existe un archivo para este docKey, intenta borrarlo (limpieza)
      const prev = store?.[docKey];
      if (prev?.path) {
        try {
          await deleteFromStorage(prev.path);
        } catch (e) {
          // no bloqueamos por esto; seguimos
          console.warn("No se pudo borrar el archivo anterior, se intentará reemplazar igual:", e);
        }
      }

      const safeName = sanitizeFileName(file.name || "archivo");
      const ts = Date.now();
      const path = `${userId}/${projectId}/documentacion/${docKey}/${ts}_${safeName}`;

      // Upload
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (upErr) throw upErr;

      // Guardamos SOLO metadata
      store[docKey] = {
        fileName: file.name,
        mime: file.type || guessMimeFromName(file.name),
        path,
        updatedAt: Date.now(),
        ...(extraMeta || {}),
      };
    }

    async function deleteFromStorage(path) {
      if (!supabase) throw new Error("Supabase no está inicializado.");
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    }

    async function openStoragePreview(entry) {
      if (!supabase) {
        alert("Supabase no está disponible para vista previa.");
        return;
      }

      const name = entry.fileName || "Archivo";
      const mime = entry.mime || "";
      const path = entry.path;

      // Signed URL (1 hora)
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) {
        console.warn(error);
        alert("No se pudo generar la vista previa (signed URL).");
        return;
      }

      const url = data.signedUrl;
      openUrlPreview({ url, name, mime });
    }

    function openUrlPreview({ url, name, mime }) {
      const w = window.open("", "_blank");
      if (!w) {
        alert("No se pudo abrir la vista previa (pop-up bloqueado).");
        return;
      }

      const isPdf = (mime || "").includes("pdf") || /\.pdf$/i.test(name);
      const isImage = (mime || "").startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(name);

      const body = isPdf
        ? `<iframe src="${escapeAttr(url)}" style="width:100%; height:100vh; border:0;"></iframe>`
        : isImage
        ? `<div style="padding:16px;"><img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" style="max-width:100%; height:auto;" /></div>`
        : `<div style="padding:16px; font-family: Arial;">
             <p>No se puede previsualizar este tipo de archivo.</p>
             <a href="${escapeAttr(url)}" target="_blank" rel="noopener">Abrir</a>
           </div>`;

      w.document.open();
      w.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Vista previa - ${escapeHtml(name)}</title>
<style>
  body { margin:0; background:#0b0f14; color:#fff; }
  .top { padding:10px 12px; font-family: Arial; font-weight:800; background: rgba(255,255,255,.06); border-bottom: 1px solid rgba(255,255,255,.12);}
  .top span { opacity:.85; font-weight:600; }
</style>
</head>
<body>
  <div class="top">Vista previa: <span>${escapeHtml(name)}</span></div>
  ${body}
</body>
</html>`);
      w.document.close();
      w.focus();
    }

    async function deleteAllFilesInStore(obj) {
      if (!supabase) return;

      const paths = Object.values(obj || {})
        .map((x) => x?.path)
        .filter(Boolean);

      if (!paths.length) return;

      // Remove permite batch
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
    }

    // =========================================================
    // Migración V1 (dataUrl) -> Storage + metadata
    // =========================================================
    async function migrateLegacyLocalToStorage(legacy) {
      const migrated = {};

      for (const [docKey, entry] of Object.entries(legacy || {})) {
        // Si era metadata ya (path), se respeta
        if (entry?.path) {
          migrated[docKey] = entry;
          continue;
        }

        // Si era V1 dataUrl, subimos
        if (entry?.dataUrl) {
          try {
            const blob = dataUrlToBlob(entry.dataUrl);
            const fileName = entry.fileName || `${docKey}.bin`;
            const mime = entry.mime || guessMimeFromName(fileName);
            const file = new File([blob], fileName, { type: mime });

            // sube y crea metadata
            await uploadAndSetEntry({ docKey, file });

            // copia lo recién guardado en store (uploadAndSetEntry lo puso)
            migrated[docKey] = store[docKey];
          } catch (e) {
            console.warn("Error migrando doc:", docKey, e);
          }
        }
      }

      return migrated;
    }

    // =========================================================
    // Helpers
    // =========================================================
    function getTitleByKey(key) {
      return DOCS_CATALOGO.find((d) => d.key === key)?.title || key;
    }

    function fileToDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    }

    function dataUrlToBlob(dataUrl) {
      const parts = String(dataUrl || "").split(",");
      if (parts.length < 2) throw new Error("dataUrl inválido");
      const meta = parts[0];
      const b64 = parts[1];
      const mimeMatch = meta.match(/data:([^;]+);base64/);
      const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const binStr = atob(b64);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }

    function sanitizeFileName(name) {
      return String(name || "archivo")
        .replace(/[^\w.\-() ]+/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 140);
    }

    function guessMimeFromName(name) {
      const n = (name || "").toLowerCase();
      if (n.endsWith(".pdf")) return "application/pdf";
      if (n.endsWith(".png")) return "image/png";
      if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
      if (n.endsWith(".gif")) return "image/gif";
      if (n.endsWith(".webp")) return "image/webp";
      if (n.endsWith(".zip")) return "application/zip";
      return "application/octet-stream";
    }

    function fmtDateTime(ts) {
      if (!ts) return "";
      try {
        const d = new Date(ts);
        return d.toLocaleString("es-MX");
      } catch {
        return "";
      }
    }

    // ✅ Candado general: SOLO PDF o Imagen (para todos excepto logo)
    function validatePdfOrImageOnly(file) {
      const mime = (file?.type || "").toLowerCase();
      const name = (file?.name || "").toLowerCase();

      const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
      const isImage =
        (mime.startsWith("image/") && mime !== "image/svg+xml") ||
        /\.(png|jpg|jpeg|gif|webp)$/i.test(name);

      if (!isPdf && !isImage) {
        return "Archivo inválido: en Documentación solo se permiten PDFs o imágenes (PNG/JPG/JPEG/GIF/WEBP).";
      }

      return null;
    }

    // ✅ Logo strict validation (PNG/JPG/JPEG only) + max 5MB
    function validateLogoFileStrict(file) {
      const allowed = ["image/png", "image/jpeg"];
      const mime = (file?.type || "").toLowerCase();

      if (!allowed.includes(mime)) return "Logo inválido: solo se permite PNG / JPG / JPEG.";

      const maxBytes = 5 * 1024 * 1024;
      if ((file?.size || 0) > maxBytes) return "Logo demasiado pesado: máximo permitido 5 MB. Sube una versión más ligera.";

      return null;
    }

    async function getImageMetaFromDataUrl(dataUrl) {
      const sizeBytes = estimateDataUrlBytes(dataUrl);
      const img = await dataUrlToImage(dataUrl);
      return { width: img.width, height: img.height, sizeBytes };
    }

    function dataUrlToImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = dataUrl;
      });
    }

    function estimateDataUrlBytes(dataUrl) {
      try {
        const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return 0;
        const b64 = m[2] || "";
        const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
        return Math.floor((b64.length * 3) / 4) - padding;
      } catch {
        return 0;
      }
    }

    function formatBytes(bytes) {
      const b = Number(bytes || 0);
      if (!b) return "0 B";
      const kb = b / 1024;
      if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
      const mb = kb / 1024;
      return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
    }
  })();
}

/* =========================================================
   ✅ Estilos mínimos para el modal (si no existe en tu CSS)
========================================================= */
(function ensureDocLogoModalStylesOnce() {
  if (document.getElementById("docLogoModalStyles")) return;
  const st = document.createElement("style");
  st.id = "docLogoModalStyles";
  st.textContent = `
    .modal-backdrop{
      position:fixed; inset:0; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      z-index:99999; padding:16px;
    }
    .modal{
      width:min(980px, 96vw);
      background:#fff;
      border-radius:18px;
      overflow:hidden;
      box-shadow:0 20px 60px rgba(0,0,0,.35);
      border:1px solid rgba(0,0,0,.12);
    }
    .modal-header{
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 14px;
      background:rgba(0,0,0,.03);
      border-bottom:1px solid rgba(0,0,0,.08);
    }
    .modal-close{
      border:0; background:transparent; cursor:pointer;
      font-size:18px; font-weight:900; line-height:1;
      padding:6px 10px; border-radius:10px;
    }
    .modal-close:hover{ background:rgba(0,0,0,.06); }
    .modal-body{ padding:14px; }
    .modal-footer{
      display:flex; gap:10px; justify-content:flex-end;
      padding:12px 14px;
      background:rgba(0,0,0,.03);
      border-top:1px solid rgba(0,0,0,.08);
    }
  `;
  document.head.appendChild(st);
})();

// =========================================================
// Helpers globales
// =========================================================
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
