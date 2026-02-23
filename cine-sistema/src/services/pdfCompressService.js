/* =========================================================
   src/services/pdfCompressService.js
   Compresión PDF en cliente (pdf.js -> render -> jpg -> pdf-lib)

   ✅ FIX CRÍTICO (para que NO truene en producción):
   - El import anterior de pdf-lib (dist/pdf-lib.min.js) NO expone PDFDocument como export ESM,
     por eso salía: "Cannot read properties of undefined (reading 'create')".
   - Ahora carga pdf-lib por ESM (+esm) y tiene fallback a UMD (window.PDFLib).

   ✅ Robustez extra:
   - Si canvas.toBlob devuelve null, aborta y regresa original.
   - Si el PDF requiere password / está raro, regresa original.
   - Si algo falla en cualquier punto, regresa original (sin romper Entrega).
========================================================= */

let _pdfjs = null;
let _pdfLib = null;

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;

  // pdf.js ESM (CDN)
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");

  // Worker ESM
  try {
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
  } catch {
    // si falla, pdf.js intentará modo sin worker (más lento pero funciona)
  }

  _pdfjs = pdfjs;
  return pdfjs;
}

function isProbablyPdf(name = "", mime = "") {
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  return m.includes("pdf") || n.endsWith(".pdf");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function canvasToJpegBytes(canvas, quality = 0.72) {
  const q = clamp(Number(quality || 0.72), 0.35, 0.92);

  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b || null), "image/jpeg", q);
    } catch {
      resolve(null);
    }
  });

  if (!blob) return null;

  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

async function loadPdfLib() {
  if (_pdfLib) return _pdfLib;

  // ✅ Opción 1 (preferida): ESM real con exports nombrados
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm");
    // mod.PDFDocument debe existir aquí
    if (mod && mod.PDFDocument) {
      _pdfLib = mod;
      return _pdfLib;
    }
  } catch {
    // seguimos a fallback
  }

  // ✅ Opción 2: UMD (window.PDFLib) por script tag
  try {
    if (window?.PDFLib?.PDFDocument) {
      _pdfLib = window.PDFLib;
      return _pdfLib;
    }

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-pdf-lib-umd="1"]');
      if (existing) {
        const t = setInterval(() => {
          if (window?.PDFLib?.PDFDocument) {
            clearInterval(t);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(t);
          reject(new Error("Timeout cargando pdf-lib UMD"));
        }, 12000);
        return;
      }

      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-pdf-lib-umd", "1");
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No pude cargar pdf-lib UMD"));
      document.head.appendChild(s);
    });

    if (window?.PDFLib?.PDFDocument) {
      _pdfLib = window.PDFLib;
      return _pdfLib;
    }
  } catch {
    // nada
  }

  throw new Error("No pude cargar pdf-lib (ESM ni UMD).");
}

/**
 * @param {Uint8Array} inputBytes
 * @param {Object} opts
 * @param {number} [opts.dpi=140]         DPI objetivo (120–160 recomendado)
 * @param {number} [opts.quality=0.72]    JPEG quality (0.6–0.8 recomendado)
 * @param {number} [opts.maxPages=220]    Guardia para PDFs enormes
 * @param {number} [opts.maxInputMB=60]   No intentamos si excede (por RAM/tiempo)
 */
export async function compressPdfBytes(inputBytes, opts = {}) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes || []);
  if (!bytes?.byteLength) return bytes;

  const dpi = Number(opts.dpi ?? 140);
  const quality = Number(opts.quality ?? 0.72);
  const maxPages = Number(opts.maxPages ?? 220);
  const maxInputMB = Number(opts.maxInputMB ?? 60);

  const inputMB = bytes.byteLength / (1024 * 1024);
  if (inputMB > maxInputMB) return bytes;

  // Cargar pdf.js
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    return bytes;
  }

  // Abrir documento
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes }).promise;
  } catch {
    // No es PDF válido, o requiere password, o está cifrado raro. No tocamos.
    return bytes;
  }

  const numPages = doc?.numPages || 0;
  if (!numPages || numPages > maxPages) return bytes;

  // Cargar pdf-lib
  let PDFLib;
  try {
    PDFLib = await loadPdfLib();
  } catch {
    return bytes;
  }

  const PDFDocument = PDFLib?.PDFDocument;
  if (!PDFDocument || typeof PDFDocument.create !== "function") {
    return bytes;
  }

  let outDoc;
  try {
    outDoc = await PDFDocument.create();
  } catch {
    return bytes;
  }

  // Escala: PDF “points” son 72dpi.
  const scale = clamp(dpi / 72, 1.2, 3.0);

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);

      // Tamaño base (scale 1)
      const vp1 = page.getViewport({ scale: 1 });
      const pageW = vp1.width;
      const pageH = vp1.height;

      // Render a canvas en alta resolución
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return bytes;

      // Fondo blanco para evitar transparencias
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Canvas -> JPG bytes
      const jpgBytes = await canvasToJpegBytes(canvas, quality);
      if (!jpgBytes?.byteLength) return bytes;

      // Insertar página nueva con tamaño original (en puntos)
      const outPage = outDoc.addPage([pageW, pageH]);

      // Embed jpg y dibujar full-page
      const jpg = await outDoc.embedJpg(jpgBytes);

      outPage.drawImage(jpg, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
      });

      // Limpieza canvas (ayuda RAM)
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch {
    return bytes;
  }

  let outBytes;
  try {
    outBytes = await outDoc.save({ useObjectStreams: true });
  } catch {
    return bytes;
  }

  const outU8 = new Uint8Array(outBytes);

  // Si no mejoró, devolver original
  if (outU8.byteLength >= bytes.byteLength * 0.98) return bytes;
  return outU8;
}

/**
 * “Maybe compress”: solo si pasa un umbral.
 * @param {Uint8Array} bytes
 * @param {Object} opts
 * @param {number} [opts.thresholdMB=4]   Comprimir si >= thresholdMB
 * @param {number} [opts.dpi=140]
 * @param {number} [opts.quality=0.72]
 */
export async function maybeCompressPdfBytes(bytes, opts = {}) {
  const thresholdMB = Number(opts.thresholdMB ?? 4);
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const mb = u8.byteLength / (1024 * 1024);
  if (mb < thresholdMB) return u8;

  // ✅ Seguridad: si algo falla, regresamos original (no rompemos Entrega)
  try {
    return await compressPdfBytes(u8, {
      dpi: opts.dpi ?? 140,
      quality: opts.quality ?? 0.72,
      maxPages: opts.maxPages ?? 220,
      maxInputMB: opts.maxInputMB ?? 60,
    });
  } catch {
    return u8;
  }
}

/**
 * Comprimir File (PDF) y devolver File listo para subir.
 * @param {File} file
 * @param {Object} opts
 */
export async function maybeCompressPdfFile(file, opts = {}) {
  if (!file) return { file, compressed: false, outBytes: 0 };

  const name = file.name || "archivo.pdf";
  const mime = file.type || "";
  if (!isProbablyPdf(name, mime)) return { file, compressed: false, outBytes: file.size || 0 };

  let inBytes;
  try {
    inBytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { file, compressed: false, outBytes: file.size || 0 };
  }

  let outBytes;
  try {
    outBytes = await maybeCompressPdfBytes(inBytes, opts);
  } catch {
    outBytes = inBytes;
  }

  // Si no cambió, no recreamos File
  if (outBytes.byteLength === inBytes.byteLength) {
    return { file, compressed: false, outBytes: outBytes.byteLength };
  }

  const outFile = new File([outBytes], name, { type: "application/pdf" });
  return { file: outFile, compressed: true, outBytes: outBytes.byteLength };
}
