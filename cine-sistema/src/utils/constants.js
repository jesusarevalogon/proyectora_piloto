// src/utils/constants.js
// Constantes centrales del sistema (V1/V2). Seguro para usar en Local + Supabase.

// ===============================
// Storage / Supabase
// ===============================
export const STORAGE_BUCKET = "uploads";

// Carpeta base dentro del bucket (si quieres usar raíz, deja "")
export const STORAGE_ROOT = ""; // e.g. "app" si luego quieres /app/...

// ===============================
// Module Keys (project_state.module_key)
// ===============================
export const MODULE_KEYS = Object.freeze({
  DOCUMENTACION: "documentacion",
  PRESUPUESTO: "presupuesto",
  RUTA_CRITICA: "ruta_critica",
  ENTREGA: "entrega",
});

// ===============================
// LocalStorage keys (fallback / compat)
// ===============================
export const LS_KEYS = Object.freeze({
  DOCS_V1: "DOCS_V1_ITEMS",
  BUDGET_V1_ITEMS: "BUDGET_V1_ITEMS",
  LOCAL_SESSION_V1: "LOCAL_SESSION_V1",
});

// ===============================
// Límites / tipos de archivo
// ===============================
// Límite real lo impone Supabase bucket (en tu screenshot aparece 50MB).
// Aquí dejamos un “soft limit” para warnings y validación opcional.
export const SOFT_LIMIT_MB = 50;
export const SOFT_LIMIT_BYTES = SOFT_LIMIT_MB * 1024 * 1024;

export const MIME = Object.freeze({
  PDF: "application/pdf",
  PNG: "image/png",
  JPG: "image/jpeg",
});

// Para el módulo Documentación (general)
export const ALLOWED_MIME_DEFAULT = Object.freeze([
  MIME.PDF,
  MIME.PNG,
  MIME.JPG,
]);

// Para logo_proyecto (solo imágenes)
export const ALLOWED_MIME_LOGO = Object.freeze([
  MIME.PNG,
  MIME.JPG,
]);

// ===============================
// Catálogo de keys usados en Storage/Documentación V2
// (coinciden con tu documentacion.js)
// ===============================
export const DOC_KEYS = Object.freeze({
  RESUMEN_EJECUTIVO: "resumen_ejecutivo",
  SINOPSIS_DESARROLLADA: "sinopsis_desarrollada",
  GUION_ARGUMENTO_DOCUMENTAL: "guion_argumento_documental",
  PROPUESTA_CREATIVA_DIRECCION: "propuesta_creativa_direccion",
  VISION_TECNICA_PRODUCCION: "vision_tecnica_produccion",
  EQUIPO_PROPUESTO: "equipo_propuesto",
  RUTA_CRITICA_GENERAL: "ruta_critica_general", // (vista previa del módulo Ruta)
  PRESUPUESTO: "presupuesto", // (vista previa del módulo Presupuesto)
  ESQUEMA_FINANCIERO_RATIFICACION: "esquema_financiero_ratificacion",
  ESTADO_DERECHOS: "estado_derechos",
  LOGO_PROYECTO: "logo_proyecto",

  // V2 (para Entrega)
  PORTADA_PDF_FINAL: "portada_pdf_final",
  RESPALDO_PRESUPUESTO_CARTAS_COT: "respaldo_presupuesto_cartas_cotizaciones",
});

// ===============================
// Helpers mínimos (sin dependencias)
// ===============================
export function joinPath(...parts) {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== "")
    .map((p) => String(p).replace(/^\/+|\/+$/g, ""))
    .join("/");
}

export function safeFileName(name) {
  return String(name || "archivo")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

// Mantengo noop por compatibilidad si algún import viejo lo usa.
export function noop() {}
