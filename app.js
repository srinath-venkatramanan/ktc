// src/app.js

import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";

import { createWorker } from "tesseract.js";

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// Aksharamukha.js (npm package "aksharamukha")
import Aksharamukha from "aksharamukha";

// -----------------------
// CONFIG
// -----------------------
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// OCR tuning: higher scale => better OCR but slower
const OCR_RENDER_SCALE = 2.0;

// Tesseract settings
const TESS_LANG = "kan"; // Kannada (kan) :contentReference[oaicite:3]{index=3}
const TESS_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0"; // public hosted traineddata
// If you want faster but less accurate, try a different tessdata source later.

// Output PDF formatting
const PDF_FONT_URL = "/fonts/NotoSansTamil-Regular.ttf";
const FONT_SIZE = 13;
const PAGE_MARGIN = 42;
const LINE_GAP = 5;

// -----------------------
// UI helpers
// -----------------------
const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
  console.log(msg);
}

function setDownload(blob, filename) {
  const link = $("downloadLink");
  if (!link) return;
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.display = "inline-block";
  link.textContent = `Download: ${filename}`;
}

// -----------------------
// Lazy singletons
// -----------------------
let aksh = null;
async function getAksharamukha() {
  if (aksh) return aksh;
  setStatus("Loading transliteration engine (Aksharamukha)...");
  aksh = await Aksharamukha.new(); // WASM init
  return aksh;
}

let ocrWorker = null;
async function getOcrWorker(progressCb) {
  if (ocrWorker) return ocrWorker;

  setStatus("Initializing OCR engine (Tesseract)...");
  ocrWorker = await createWorker({
    logger: (m) => {
      if (m?.status && typeof m.progress === "number") {
        progressCb?.(m.status, m.progress);
      }
    },
  });

  await ocrWorker.loadLanguage(TESS_LANG);
  await ocrWorker.initialize(TESS_LANG);

  // Helpful defaults for scanned pages
  await ocrWorker.setParameters({
    // Improve recognition for block text
    tessedit_pageseg_mode: "6",
  });

  return ocrWorker;
}

// -----------------------
// PDF text extraction (text-layer)
// -----------------------
async function extractTextLayer(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  const items = content.items || [];
  const text = items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
  return text;
}

// -----------------------
// Render PDF page -> canvas for OCR
// -----------------------
async function renderPageToCanvas(pdf, pageNum, scale = OCR_RENDER_SCALE) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// -----------------------
// OCR a canvas (Kannada)
// -----------------------
async function ocrCanvasToText(canvas, pageNum, totalPages) {
  const worker = await getOcrWorker((status, progress) => {
    const pct = Math.round(progress * 100);
    setStatus(`OCR page ${pageNum}/${totalPages}: ${status} (${pct}%)`);
  });

  // Tesseract accepts canvas directly
  const { data } = await worker.recognize(canvas);
  const text = (data?.text || "").replace(/\s+\n/g, "\n").trim();
  return text;
}

// -----------------------
// Kannada -> Tamil transliteration
// -----------------------
async function kannadaToTamil(text) {
  const engine = await getAksharamukha();
  // Aksharamukha.js uses same script names as the main tool
  // Source: Kannada, Target: Tamil
  const out = await engine.process("Kannada", "Tamil", text);
  return out;
}

// -----------------------
// Build output PDF with proper Tamil font
// -----------------------
async function buildTamilPdf(pagesTamilText) {
  setStatus("Building output PDF...");

  const pdfDoc = await PDFDocument.create();

  // IMPORTANT: fixes your error about embedFont needing fontkit :contentReference[oaicite:4]{index=4}
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await fetch(PDF_FONT_URL).then((r) => {
    if (!r.ok) throw new Error(`Failed to load font at ${PDF_FONT_URL}`);
    return r.arrayBuffer();
  });

  const tamilFont = await pdfDoc.embedFont(fontBytes, { subset: true });

  for (let i = 0; i < pagesTamilText.length; i++) {
    const pageText = pagesTamilText[i] || "";

    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();

    const maxWidth = width - PAGE_MARGIN * 2;
    let cursorY = height - PAGE_MARGIN;

    const paragraphs = pageText
      .split(/\n{2,}/g)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      const lines = wrapTextToLines(para, tamilFont, FONT_SIZE, maxWidth);

      for (const line of lines) {
        // New page if needed
        const lineHeight = FONT_SIZE + LINE_GAP;
        if (cursorY - lineHeight < PAGE_MARGIN) {
          // Start a new page
          const newPage = pdfDoc.addPage();
          cursorY = newPage.getSize().height - PAGE_MARGIN;
          // Continue on new page
          newPage.drawText(line, {
            x: PAGE_MARGIN,
            y: cursorY - FONT_SIZE,
            size: FONT_SIZE,
            font: tamilFont,
            color: rgb(0, 0, 0),
          });
          cursorY -= lineHeight;
          // Swap "page" reference for rest of paragraph
          // (simple trick: redirect variable)
          // eslint-disable-next-line no-param-reassign
          pageText; // no-op
        } else {
          page.drawText(line, {
            x: PAGE_MARGIN,
            y: cursorY - FONT_SIZE,
            size: FONT_SIZE,
            font: tamilFont,
            color: rgb(0, 0, 0),
          });
          cursorY -= lineHeight;
        }
      }

      // Paragraph spacing
      cursorY -= FONT_SIZE * 0.5;
      if (cursorY < PAGE_MARGIN) {
        cursorY = height - PAGE_MARGIN;
        pdfDoc.addPage();
      }
    }
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

function wrapTextToLines(text, font, fontSize, maxWidth) {
  // Keep punctuation and spacing decent
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let current = "";

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, fontSize);

    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // If one word is too long, hard-break it
      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        lines.push(...hardBreakLongWord(w, font, fontSize, maxWidth));
        current = "";
      } else {
        current = w;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function hardBreakLongWord(word, font, fontSize, maxWidth) {
  const parts = [];
  let buf = "";
  for (const ch of word) {
    const candidate = buf + ch;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      buf = candidate;
    } else {
      if (buf) parts.push(buf);
      buf = ch;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

// -----------------------
// Main conversion flow
// -----------------------
async function convertPdf(file) {
  $("downloadLink").style.display = "none";
  $("outputText").value = "";

  setStatus("Reading PDF...");
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const totalPages = pdf.numPages;

  const tamilPages = [];

  for (let p = 1; p <= totalPages; p++) {
    setStatus(`Page ${p}/${totalPages}: checking text layer...`);

    // 1) Try text-layer extraction
    let extracted = await extractTextLayer(pdf, p);

    // Heuristic: if very little text, treat as scan
    if (!extracted || extracted.length < 10) {
      setStatus(`Page ${p}/${totalPages}: no text layer → rendering for OCR...`);
      const canvas = await renderPageToCanvas(pdf, p, OCR_RENDER_SCALE);

      extracted = await ocrCanvasToText(canvas, p, totalPages);
      if (!extracted || extracted.length < 2) {
        extracted = "";
      }
    } else {
      setStatus(`Page ${p}/${totalPages}: text layer found.`);
    }

    setStatus(`Page ${p}/${totalPages}: converting Kannada → Tamil...`);
    const tamil = extracted ? await kannadaToTamil(extracted) : "";

    tamilPages.push(tamil);

    // Live preview (append)
    $("outputText").value += `--- Page ${p} ---\n${tamil}\n\n`;
  }

  // Build output PDF
  const outBlob = await buildTamilPdf(tamilPages);
  setDownload(outBlob, `tamil_${file.name.replace(/\.pdf$/i, "")}.pdf`);

  setStatus("Done ✅");
}

// -----------------------
// Wire up UI
// -----------------------
function init() {
  const fileInput = $("pdfFile");
  const btn = $("convertBtn");

  if (!fileInput || !btn) {
    console.error(
      "Missing required elements: pdfFile, convertBtn (and status/outputText/downloadLink recommended)."
    );
    return;
  }

  btn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      setStatus("Please choose a PDF file first.");
      return;
    }

    btn.disabled = true;
    try {
      await convertPdf(file);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err?.message || String(err)}`);
    } finally {
      btn.disabled = false;
    }
  });
}

init();