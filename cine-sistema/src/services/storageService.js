// src/services/storageService.js
// Wrapper simple para Supabase Storage (bucket uploads)
// V2: paths tipo: {userId}/{projectId}/{area}/{docKey}/{timestamp}_{filename}

import { supabase } from "./supabase.js";
import { STORAGE_BUCKET, STORAGE_ROOT, joinPath, safeFileName } from "../utils/constants.js";
import { validarStoragePath } from "./validators.js";

function ensureSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase no está configurado. Revisa window.__SUPABASE_CONFIG__ (index.html) o variables en Vercel."
    );
  }
}

function nowStamp() {
  return String(Date.now());
}

/**
 * Construye path estándar para documentos del proyecto.
 * @param {Object} p
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {string} p.area e.g. "documentacion" | "entrega" | "presupuesto" | "ruta_critica"
 * @param {string} [p.docKey] e.g. "equipo_propuesto"
 * @param {string} [p.filename] nombre original
 */
export function buildStoragePath({ userId, projectId, area, docKey = "", filename = "" }) {
  const safeName = filename ? safeFileName(filename) : "";
  const stamped = safeName ? `${nowStamp()}_${safeName}` : nowStamp();

  const p = joinPath(
    STORAGE_ROOT,
    userId,
    projectId,
    area,
    docKey,
    stamped
  );

  validarStoragePath(p);
  return p;
}

/**
 * Sube un archivo a Storage.
 * @param {Object} p
 * @param {File|Blob} p.file
 * @param {string} p.path ruta RELATIVA dentro del bucket
 * @param {string} [p.bucket]
 * @param {boolean} [p.upsert]
 * @param {string} [p.contentType]
 */
export async function uploadFile({ file, path, bucket = STORAGE_BUCKET, upsert = true, contentType } = {}) {
  ensureSupabase();
  validarStoragePath(path);

  const options = { upsert };
  if (contentType) options.contentType = contentType;

  const { data, error } = await supabase.storage.from(bucket).upload(path, file, options);
  if (error) throw error;

  // data.path suele venir como el path relativo
  return { path: data?.path || path };
}

/**
 * Elimina un archivo (o varios).
 */
export async function removeFiles({ paths = [], bucket = STORAGE_BUCKET } = {}) {
  ensureSupabase();
  if (!Array.isArray(paths) || paths.length === 0) return { removed: 0 };

  paths.forEach(validarStoragePath);

  const { data, error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;

  return { removed: Array.isArray(data) ? data.length : 0 };
}

/**
 * Descarga un archivo como Blob.
 */
export async function downloadFile({ path, bucket = STORAGE_BUCKET } = {}) {
  ensureSupabase();
  validarStoragePath(path);

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;

  return data; // Blob
}

/**
 * Public URL (sirve si bucket es public o policy lo permite).
 */
export function getPublicUrl({ path, bucket = STORAGE_BUCKET } = {}) {
  ensureSupabase();
  validarStoragePath(path);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

/**
 * Signed URL (recomendado si bucket privado).
 * @param {number} expiresIn segundos (default 60s)
 */
export async function createSignedUrl({ path, bucket = STORAGE_BUCKET, expiresIn = 60 } = {}) {
  ensureSupabase();
  validarStoragePath(path);

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;

  return data?.signedUrl || null;
}

/**
 * Lista archivos de una carpeta.
 */
export async function listFolder({ folderPath, bucket = STORAGE_BUCKET, limit = 100, offset = 0 } = {}) {
  ensureSupabase();
  const fp = String(folderPath || "").trim();
  if (fp) validarStoragePath(fp);

  const { data, error } = await supabase.storage.from(bucket).list(fp, {
    limit,
    offset,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) throw error;
  return data || [];
}

// Mantengo noop por compatibilidad
export function noop() {}
