import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs";

// IMPORTANT: PDF.js worker (ESM)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs"; // :contentReference[oaicite:1]{index=1}

const $ = (id) => document.getElementById(id);

const pdfFile = $("pdfFile");
const toScript = $("toScript");
const ocrLang = $("ocrLang");
const ocrQuality = $("ocrQuality");
const convertBtn = $("convertBtn");
const statusEl = $("status");
const bar = $("bar");
const downloadArea = $("downloadArea");

// A4 in points
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;

// OCR tuning
const OCR_SCALE_FAST = 1.25;   // faster
const OCR_SCALE_BETTER = 1.75; // better but slower

let fileBytes = null;

pdfFile.addEventListener("change", async (e) => {
  downloadArea.innerHTML = "";
  const f = e.target.files?.[0];
  if (!f) {
    convertBtn.disabled = true;
    fileBytes = null;
    statusEl.textContent = "Load a PDF to begin.";
    bar.value = 0;
    return;
  }
  fileBytes = await f.arrayBuffer();
  convertBtn.disabled = false;
  statusEl.textContent = `Ready: ${f.name}`;
  bar.value = 0;
});

convertBtn.addEventListener("click", async () => {
  if (!fileBytes) return;

  convertBtn.disabled = true;
  downloadArea.innerHTML = "";
  bar.value = 0;

  try {
    await convertPdfToTamilPdf(new Uint8Array(fileBytes));
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Error: ${err?.message || err}`;
  } finally {
    convertBtn.disabled = false;
  }
});

function setProgress(pct, msg) {
  bar.value = Math.max(0, Math.min(100, pct));
  if (msg) statusEl.textContent = msg;
}

async function convertPdfToTamilPdf(inputPdfBytes) {
  setProgress(1, "Loading PDF…");
  const loadingTask = pdfjsLib.getDocument({ data: inputPdfBytes });
  const pdf = await loadingTask.promise;

  const numPages = pdf.numPages;
  if (numPages > 25) {
    throw new Error(`This demo is tuned for <= 25 pages. Your file has ${numPages}.`);
  }

  // Prepare OCR worker (reused for all OCR pages)
  const worker = await createOcrWorker(ocrLang.value);

  // Load Tamil font (required for proper Tamil output in pdf-lib)
  setProgress(3, "Loading Tamil font…");
  const tamilFontBytes = await fetch("./assets/NotoSansTamil-Regular.ttf").then(r => {
    if (!r.ok) throw new Error("Tamil font missing: put assets/NotoSansTamil-Regular.ttf in your repo.");
    return r.arrayBuffer();
  });

  // Create output PDF
  const outPdf = await PDFLib.PDFDocument.create();
  // Register fontkit BEFORE embedding custom font (fixes your error) :contentReference[oaicite:2]{index=2}
  outPdf.registerFontkit(window.fontkit);

  const tamilFont = await outPdf.embedFont(tamilFontBytes, { subset: true });

  // Convert each page
  for (let pageNo = 1; pageNo <= numPages; pageNo++) {
    const pctBase = 5 + Math.floor(((pageNo - 1) / numPages) * 85);
    setProgress(pctBase, `Reading page ${pageNo}/${numPages}…`);

    const page = await pdf.getPage(pageNo);

    // 1) Try text layer
    let extracted = await extractTextFromPage(page);

    // 2) If no text layer, OCR
    if (!extracted || extracted.trim().length < 5) {
      setProgress(pctBase, `Page ${pageNo}: no text layer → OCR… (this is the slow step)`);
      extracted = await ocrPageToText(page, worker);
    }

    // 3) Transliterate Kannada -> TamilExtended/Tamil
    setProgress(pctBase + 2, `Page ${pageNo}: Transliteration…`);
    const tamilText = transliterateKannadaToTamil(extracted, toScript.value);

    // 4) Write to output PDF with formatting
    setProgress(pctBase + 4, `Page ${pageNo}: Writing Tamil PDF…`);
    addFormattedTamilPage(outPdf, tamilFont, tamilText);
  }

  // Cleanup OCR worker
  await worker.terminate();

  setProgress(95, "Finalizing PDF…");
  const outBytes = await outPdf.save();

  setProgress(100, "Done! Download below.");
  renderDownload(outBytes, `kannada-to-${toScript.value.toLowerCase()}.pdf`);
}

function transliterateKannadaToTamil(text, outScript) {
  // Aksharamukha global provides convert() in the browser build
  // From script: "Kannada"  To script: "TamilExtended" or "Tamil"
  try {
    return window.Aksharamukha.convert(text, "Kannada", outScript);
  } catch (e) {
    // Fallback: return original so user sees something instead of blank.
    console.warn("Aksharamukha convert failed:", e);
    return text;
  }
}

async function extractTextFromPage(page) {
  // Robust extraction: group by y (lines), then sort by x
  const content = await page.getTextContent();
  const items = content?.items || [];
  if (!items.length) return "";

  // Convert items -> { str, x, y }
  const mapped = items
    .filter(it => (it.str || "").trim().length > 0)
    .map(it => {
      const t = it.transform; // [a,b,c,d,e,f]  e=x, f=y
      return { str: it.str, x: t[4], y: t[5] };
    });

  if (!mapped.length) return "";

  // Sort by y desc, x asc
  mapped.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  // Group into lines by y tolerance
  const lines = [];
  const Y_TOL = 2.5;
  for (const it of mapped) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - it.y) > Y_TOL) {
      lines.push({ y: it.y, parts: [it] });
    } else {
      last.parts.push(it);
    }
  }

  // Build text line by line
  const outLines = lines.map(line => {
    line.parts.sort((a, b) => a.x - b.x);
    return line.parts.map(p => p.str).join(" ").replace(/\s+/g, " ").trim();
  });

  return outLines.join("\n").trim();
}

async function createOcrWorker(lang) {
  // Reuse one worker: big speed-up vs per-page create
  const worker = await Tesseract.createWorker({
    logger: (m) => {
      // m.progress: 0..1 for some steps
      if (m?.status && typeof m.progress === "number") {
        const pct = Math.floor(5 + m.progress * 80);
        setProgress(Math.min(94, pct), `OCR: ${m.status} (${Math.round(m.progress * 100)}%)`);
      }
    }
  });

  await worker.loadLanguage(lang);
  await worker.initialize(lang);

  // Helpful defaults for scanned pages (you can tweak later)
  await worker.setParameters({
    // Try to treat it like a block of text
    tessedit_pageseg_mode: "6",
  });

  return worker;
}

async function ocrPageToText(page, worker) {
  const viewportBase = page.getViewport({ scale: 1.0 });

  const scale = (ocrQuality.value === "better") ? OCR_SCALE_BETTER : OCR_SCALE_FAST;
  const viewport = page.getViewport({ scale });

  // Render to canvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  // White background improves OCR
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Run OCR
  const { data } = await worker.recognize(canvas);
  const txt = (data?.text || "").trim();

  // Free memory
  canvas.width = 1;
  canvas.height = 1;

  return txt;
}

function addFormattedTamilPage(outPdf, font, tamilText) {
  // We may need multiple A4 pages if text is long
  const paragraphs = normalizeToParagraphs(tamilText);

  let page = outPdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  const maxWidth = A4.w - (MARGIN * 2);

  for (const para of paragraphs) {
    const lines = wrapText(para, font, FONT_SIZE, maxWidth);

    // blank line between paragraphs
    if (lines.length === 0) {
      y -= LINE_HEIGHT;
      continue;
    }

    for (const line of lines) {
      if (y - LINE_HEIGHT < MARGIN) {
        page = outPdf.addPage([A4.w, A4.h]);
        y = A4.h - MARGIN;
      }
      page.drawText(line, {
        x: MARGIN,
        y: y - FONT_SIZE,
        size: FONT_SIZE,
        font
      });
      y -= LINE_HEIGHT;
    }

    y -= Math.floor(LINE_HEIGHT * 0.35);
  }
}

function normalizeToParagraphs(text) {
  // Keep line breaks (Veda text often uses them meaningfully)
  // Convert multiple blank lines into paragraph separators.
  const cleaned = (text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  // Split by blank lines
  return cleaned.split(/\n\s*\n/g).map(p => p.trim());
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let line = words[0];

  for (let i = 1; i < words.length; i++) {
    const test = line + " " + words[i];
    const w = font.widthOfTextAtSize(test, fontSize);
    if (w <= maxWidth) {
      line = test;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);

  return lines;
}

function renderDownload(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  downloadArea.innerHTML = `
    <a href="${url}" download="${filename}">Download converted Tamil PDF</a>
    <div class="small">
      Tip: If OCR is slow, keep “OCR quality = Fast” and ensure your scan is clear (good contrast).
      For best accuracy on Veda sounds, use <b>TamilExtended</b>.
    </div>
  `;
}
