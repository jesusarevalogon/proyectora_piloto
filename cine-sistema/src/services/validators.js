// src/services/validators.js
// Validadores mínimos y seguros (V1/V2). Sin dependencias externas.

import {
  SOFT_LIMIT_BYTES,
  ALLOWED_MIME_DEFAULT,
  ALLOWED_MIME_LOGO,
  MIME,
} from "../utils/constants.js";

// -------------------------------
// Helpers
// -------------------------------
function toStr(x) {
  return x === null || x === undefined ? "" : String(x);
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function bytesToMB(bytes) {
  const n = Number(bytes || 0);
  return Math.round((n / (1024 * 1024)) * 100) / 100;
}

// -------------------------------
// File validators
// -------------------------------
/**
 * Valida que exista un File/Blob y tenga size/type razonables.
 * @param {File|Blob} file
 * @param {Object} opts
 * @param {string[]} opts.allowedMime
 * @param {number} opts.maxBytes
 * @param {boolean} opts.allowUnknownType
 */
export function validarArchivo(file, opts = {}) {
  const allowedMime = opts.allowedMime || ALLOWED_MIME_DEFAULT;
  const maxBytes =
    typeof opts.maxBytes === "number" && opts.maxBytes > 0
      ? opts.maxBytes
      : SOFT_LIMIT_BYTES;

  const allowUnknownType = !!opts.allowUnknownType;

  ensure(file, "No se recibió archivo.");
  ensure(typeof file.size === "number", "Archivo inválido (sin tamaño).");

  // Type puede venir vacío en algunos browsers/casos
  const type = toStr(file.type).trim();

  if (type) {
    ensure(
      allowedMime.includes(type),
      `Tipo de archivo no permitido: ${type}.`
    );
  } else if (!allowUnknownType) {
    // Si quieres permitir tipo vacío, pásalo en opts
    ensure(false, "No se pudo detectar el tipo de archivo.");
  }

  ensure(
    file.size <= maxBytes,
    `El archivo pesa ${bytesToMB(file.size)}MB y excede el límite (${bytesToMB(
      maxBytes
    )}MB).`
  );

  return true;
}

/**
 * Atajo: PDF estricto
 */
export function validarPDF(file, opts = {}) {
  return validarArchivo(file, {
    ...opts,
    allowedMime: [MIME.PDF],
  });
}

/**
 * Atajo: Imágenes para logo
 */
export function validarLogo(file, opts = {}) {
  return validarArchivo(file, {
    ...opts,
    allowedMime: ALLOWED_MIME_LOGO,
  });
}

// -------------------------------
// Data validators (Supabase)
// -------------------------------

/**
 * Valida que existan ids básicos para operar en V2.
 * No fuerza formato UUID/text exacto porque en tu BD
 * `projects.id` es text y `auth.users.id` es uuid.
 */
export function validarContextoV2({ userId, projectId, moduleKey } = {}) {
  ensure(isNonEmptyString(userId), "Falta userId (sesión).");
  ensure(isNonEmptyString(projectId), "Falta projectId (proyecto).");
  ensure(isNonEmptyString(moduleKey), "Falta moduleKey (módulo).");
  return true;
}

/**
 * Valida una ruta de storage relativa (sin .. ni protocolo).
 */
export function validarStoragePath(path) {
  const p = toStr(path).trim();
  ensure(p.length > 0, "Path de storage vacío.");

  // Evitar traversal y urls completas
  ensure(!p.includes(".."), "Path inválido (..).");
  ensure(!/^https?:\/\//i.test(p), "Path inválido (URL completa).");
  ensure(!p.startsWith("/"), "Path inválido (no debe iniciar con /).");

  return true;
}

/**
 * Valida que un objeto tenga estructura simple tipo diccionario.
 */
export function validarObjetoPlano(obj, { allowEmpty = true } = {}) {
  ensure(obj && typeof obj === "object" && !Array.isArray(obj), "Objeto inválido.");
  if (!allowEmpty) ensure(Object.keys(obj).length > 0, "Objeto vacío.");
  return true;
}

// Mantengo noop por compatibilidad si algún import viejo lo usa.
export function noop() {}
