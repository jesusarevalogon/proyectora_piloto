/* =========================================================
   src/modules/documentacion.js
   DOCUMENTACIÓN V1 (localStorage)

   ✅ Catálogo fijo de documentos (con descripción)
   ✅ Por documento: Subir/Reemplazar | Vista previa | Eliminar
   ✅ Requeridos con * + leyenda
   ✅ Vista previa abre nueva ventana (PDF/imagen en <iframe>/<img>)
   ✅ Persistencia en localStorage (dataURL)

   🔧 AJUSTE QUIRÚRGICO SOLICITADO:
   - 5.7 Ruta Crítica General (Cronograma)  => SOLO "Vista previa" (abre vista del módulo Ruta Crítica)
   - 5.8 Presupuesto                       => SOLO "Vista previa" (abre vista del módulo Presupuesto)
   - No permite subir / eliminar en esos 2 casos
========================================================= */

const LS_DOCS = "DOCS_V1_ITEMS";

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

  // Opcional
  {
    code: "K",
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
            V1: se guarda en este navegador (localStorage).
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
  `;
}

// =========================================================
// EVENTS
// =========================================================
export function bindDocumentacionEvents() {
  const tbody = document.getElementById("docTbody");
  const fileInput = document.getElementById("docFileInput");
  const btnLimpiarTodo = document.getElementById("docBtnLimpiarTodo");

  let store = loadStore(); // { [key]: { fileName, mime, dataUrl, updatedAt } }
  let pendingKey = null;

  renderAll();

  btnLimpiarTodo.addEventListener("click", () => {
    const ok = confirm("¿Borrar TODOS los archivos guardados en Documentación (V1 local)?");
    if (!ok) return;
    store = {};
    saveStore();
    renderAll();
  });

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const key = btn.getAttribute("data-key");
    const module = btn.getAttribute("data-module");

    // ====== AJUSTE: vista previa interna ======
    if (action === "internal-preview") {
      if (module === "rutaCritica") {
        // Preferente: función global que tú expongas desde Ruta Crítica
        if (typeof window.openRutaCriticaPreview === "function") {
          window.openRutaCriticaPreview();
        } else {
          alert("La vista previa de Ruta Crítica no está disponible (window.openRutaCriticaPreview).");
        }
      } else if (module === "presupuesto") {
        if (typeof window.openPresupuestoPreview === "function") {
          window.openPresupuestoPreview();
        } else {
          alert("La vista previa de Presupuesto no está disponible (window.openPresupuestoPreview).");
        }
      }
      return;
    }

    if (!key) return;

    if (action === "upload") {
      pendingKey = key;
      fileInput.value = "";
      fileInput.click();
      return;
    }

    if (action === "view") {
      const entry = store[key];
      if (!entry?.dataUrl) return;
      openFilePreview(entry);
      return;
    }

    if (action === "delete") {
      const entry = store[key];
      const ok = confirm(`¿Eliminar archivo de "${getTitleByKey(key)}"?`);
      if (!ok) return;
      delete store[key];
      saveStore();
      renderAll();
      return;
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || !pendingKey) return;

    // Guardar como dataURL (base64)
    try {
      const dataUrl = await fileToDataURL(file);
      store[pendingKey] = {
        fileName: file.name,
        mime: file.type || guessMimeFromName(file.name),
        dataUrl,
        updatedAt: Date.now(),
      };
      saveStore();
      renderAll();
    } catch (err) {
      alert(err?.message || String(err));
    } finally {
      pendingKey = null;
      fileInput.value = "";
    }
  });

  // =========================================================
  // Render
  // =========================================================
  function renderAll() {
    store = loadStore();
    tbody.innerHTML = "";

    DOCS_CATALOGO.forEach((d) => {
      const entry = store[d.key];
      const hasFile = !!entry?.dataUrl;

      const requiredMark = d.required ? `<span style="color:#ffde8a; font-weight:900;">*</span>` : "";

      const tr = document.createElement("tr");

      // Acciones:
      // - Si d.internalModule => SOLO Vista previa interna
      // - else => Subir/Reemplazar + Vista previa + Eliminar
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

            <button class="btn btn-secondary" data-action="view" data-key="${escapeAttr(d.key)}" ${hasFile ? "" : "disabled"}>
              Vista previa
            </button>

            <button class="btn btn-danger" data-action="delete" data-key="${escapeAttr(d.key)}" ${hasFile ? "" : "disabled"}>
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
  // Storage
  // =========================================================
  function loadStore() {
    try {
      const raw = localStorage.getItem(LS_DOCS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveStore() {
    localStorage.setItem(LS_DOCS, JSON.stringify(store));
  }

  // =========================================================
  // Preview
  // =========================================================
  function openFilePreview(entry) {
    const w = window.open("", "_blank");
    if (!w) {
      alert("No se pudo abrir la vista previa (pop-up bloqueado).");
      return;
    }

    const name = entry.fileName || "Archivo";
    const url = entry.dataUrl;

    const isPdf = (entry.mime || "").includes("pdf") || /\.pdf$/i.test(name);
    const isImage = (entry.mime || "").startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(name);

    const body = isPdf
      ? `<iframe src="${escapeAttr(url)}" style="width:100%; height:100vh; border:0;"></iframe>`
      : isImage
        ? `<div style="padding:16px;"><img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" style="max-width:100%; height:auto;" /></div>`
        : `<div style="padding:16px; font-family: Arial;">
             <p>No se puede previsualizar este tipo de archivo.</p>
             <a href="${escapeAttr(url)}" download="${escapeAttr(name)}">Descargar</a>
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

  function guessMimeFromName(name) {
    const n = (name || "").toLowerCase();
    if (n.endsWith(".pdf")) return "application/pdf";
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".webp")) return "image/webp";
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
}

// =========================================================
// Helpers globales (mismo estilo que tus otros módulos)
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
