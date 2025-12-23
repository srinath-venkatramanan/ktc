// app.js (ES module)

const pdfFile = document.getElementById("pdfFile");
const convertBtn = document.getElementById("convertBtn");
const toScriptEl = document.getElementById("toScript");
const ocrLangEl = document.getElementById("ocrLang");
const statusEl = document.getElementById("status");
const barEl = document.getElementById("bar");
const downloadArea = document.getElementById("downloadArea");

// Globals from CDN scripts
const { PDFDocument, StandardFonts } = window.PDFLib;
const pdfjsLib = window.pdfjsLib;
const fontkit = window.fontkit;

// Aksharamukha global (be defensive about name)
const AksharamukhaGlobal =
  window.Aksharamukha || window.aksharamukha || window.AksharamukhaLib || null;

function setStatus(msg, pct = null) {
  statusEl.textContent = msg;
  if (pct !== null) {
    barEl.value = Math.max(0, Math.min(100, pct));
  }
}

function resetUI() {
  downloadArea.innerHTML = "";
  barEl.value = 0;
}

pdfFile.addEventListener("change", () => {
  resetUI();
  if (pdfFile.files?.[0]) {
    convertBtn.disabled = false;
    setStatus("Ready. Click Convert to start.", 0);
  } else {
    convertBtn.disabled = true;
    setStatus("Load a PDF to begin.", 0);
  }
});

convertBtn.addEventListener("click", async () => {
  resetUI();

  const file = pdfFile.files?.[0];
  if (!file) return;

  try {
    convertBtn.disabled = true;

    // Load input bytes for both PDF.js and pdf-lib output
    const inputBytes = new Uint8Array(await file.arrayBuffer());

    setStatus("Opening PDF…", 2);

    // PDF.js document for extraction + rendering
    const loadingTask = pdfjsLib.getDocument({ data: inputBytes });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    // Create OCR worker once (reused across pages)
    const ocrLang = ocrLangEl.value; // "kan" or "eng"
    setStatus(`Initializing OCR (${ocrLang})…`, 4);

    const worker = await Tesseract.createWorker({
      logger: (m) => {
        // m.progress is 0..1 for OCR stage
        if (m.status && typeof m.progress === "number") {
          // we don't want the bar to jump wildly; keep it subtle per page
          // overall progress is handled per-page below
        }
      },
    });

    await worker.loadLanguage(ocrLang);
    await worker.initialize(ocrLang);

    // Collect transliterated text per page (string)
    const outPagesText = [];

    for (let pageNo = 1; pageNo <= numPages; pageNo++) {
      const basePct = 5 + Math.floor(((pageNo - 1) / numPages) * 80);
      setStatus(`Reading page ${pageNo}/${numPages}…`, basePct);

      const page = await pdf.getPage(pageNo);

      // Try text extraction first
      const text = await extractTextFromPdfJsPage(page);

      let pageText = normalizeExtractedText(text);

      // If no text layer (or too little), OCR it
      if (!hasUsefulText(pageText)) {
        setStatus(`Page ${pageNo}: no text layer found → running OCR…`, basePct);

        const canvas = await renderPageToCanvas(page, 2.0); // scale 2x for OCR
        const ocrResult = await worker.recognize(canvas);
        pageText = normalizeExtractedText(ocrResult?.data?.text || "");

        // Cleanup canvas to free memory
        canvas.width = 1;
        canvas.height = 1;
      }

      // Transliterate Kannada → Tamil/TamilExtended
      const toScript = toScriptEl.value; // "TamilExtended" or "Tamil"
      setStatus(`Transliterating page ${pageNo}/${numPages} → ${toScript}…`, basePct + 2);

      const tamilText = transliterateKannadaToTamil(pageText, toScript);

      outPagesText.push(tamilText);

      const pct = 5 + Math.floor((pageNo / numPages) * 80);
      setStatus(`Done page ${pageNo}/${numPages}.`, pct);
    }

    setStatus("Finalizing output PDF…", 90);

    // Build a new formatted PDF with a proper Tamil font
    const outPdfBytes = await buildTamilPdf(outPagesText);

    // OCR worker cleanup
    await worker.terminate();

    setStatus("Done! Preparing download…", 100);

    const blob = new Blob([outPdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const outName = file.name.replace(/\.pdf$/i, "") + " - Tamil.pdf";
    downloadArea.innerHTML = `
      <a class="btn" href="${url}" download="${escapeHtml(outName)}">Download Tamil PDF</a>
      <div class="hint">Tip: If OCR is slow, try fewer pages or ensure scans are clear (straight, high contrast).</div>
    `;
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err?.message || String(err)}`, 0);
  } finally {
    convertBtn.disabled = false;
  }
});

/* ----------------------------
   PDF.js text extraction
----------------------------- */
async function extractTextFromPdfJsPage(page) {
  const textContent = await page.getTextContent();
  // Items contain strings + positioning; simplest is to join with spaces/newlines.
  // We'll try to insert newlines when y-position changes significantly.
  const items = textContent.items || [];
  if (!items.length) return "";

  let out = "";
  let lastY = null;

  for (const it of items) {
    const s = it.str || "";
    // transform[5] is Y in PDF.js text item transform
    const y = it.transform?.[5];

    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 6) {
      out += "\n";
    } else if (out && !out.endsWith("\n")) {
      out += " ";
    }

    out += s;
    if (y !== undefined) lastY = y;
  }
  return out;
}

function normalizeExtractedText(s) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function hasUsefulText(s) {
  if (!s) return false;
  // If it’s only a few characters, treat it as “no text layer”
  // (some scanned PDFs include tiny garbage text)
  const letters = s.replace(/[\s\d\p{P}]/gu, "");
  return letters.length >= 15;
}

/* ----------------------------
   OCR rendering
----------------------------- */
async function renderPageToCanvas(page, scale = 2.0) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  // White background helps OCR
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });

  await renderTask.promise;
  return canvas;
}

/* ----------------------------
   Transliteration
----------------------------- */
function transliterateKannadaToTamil(input, toScript) {
  if (!input) return "";

  if (!AksharamukhaGlobal) {
    // fallback: return original if Aksharamukha not loaded
    return input;
  }

  // Aksharamukha API shapes differ between builds; handle common ones.
  // Most commonly: Aksharamukha.transliterate(text, from, to)
  // From script for Kannada is usually "Kannada"
  try {
    if (typeof AksharamukhaGlobal.transliterate === "function") {
      return AksharamukhaGlobal.transliterate(input, "Kannada", toScript);
    }
    if (typeof AksharamukhaGlobal.convert === "function") {
      return AksharamukhaGlobal.convert(input, "Kannada", toScript);
    }
  } catch (e) {
    console.warn("Aksharamukha transliteration failed:", e);
  }
  return input;
}

/* ----------------------------
   Output PDF formatting
----------------------------- */
async function buildTamilPdf(pageTexts) {
  const pdfDoc = await PDFDocument.create();

  // REQUIRED for custom fonts:
  pdfDoc.registerFontkit(fontkit);

  // Load Tamil font from your repo
  // Put the file at: /fonts/NotoSansTamil-Regular.ttf
  const fontBytes = await fetchBinary("fonts/NotoSansTamil-Regular.ttf");
  const tamilFont = await pdfDoc.embedFont(fontBytes, { subset: true });

  // Layout settings
  const fontSize = 12;
  const lineHeight = Math.round(fontSize * 1.35);
  const margin = 48;

  // A4 size in PDF points: 595.28 × 841.89 (approx)
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  for (let i = 0; i < pageTexts.length; i++) {
    const txt = pageTexts[i] || "";

    // We may need multiple PDF pages for one input page if text is long
    const paragraphs = txt.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
    if (!paragraphs.length) {
      // still output an empty page so counts match
      const p = pdfDoc.addPage([pageWidth, pageHeight]);
      p.drawText("(No text found on this page)", {
        x: margin,
        y: pageHeight - margin - fontSize,
        size: fontSize,
        font: tamilFont,
      });
      continue;
    }

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const maxWidth = pageWidth - margin * 2;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const para = paragraphs[pIdx];

      const wrapped = wrapText(para, tamilFont, fontSize, maxWidth);
      for (const line of wrapped) {
        y -= lineHeight;
        if (y < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin - lineHeight;
        }
        page.drawText(line, {
          x: margin,
          y,
          size: fontSize,
          font: tamilFont,
        });
      }

      // paragraph spacing
      y -= Math.round(lineHeight * 0.6);
      if (y < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
    }
  }

  return await pdfDoc.save();
}

function wrapText(text, font, size, maxWidth) {
  // Preserve single newlines as forced breaks if present
  const forcedLines = text.split("\n").map((s) => s.trim());

  const linesOut = [];
  for (const forced of forcedLines) {
    if (!forced) {
      linesOut.push("");
      continue;
    }

    const words = forced.split(/\s+/g);
    let line = "";

    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(test, size);
      if (width <= maxWidth) {
        line = test;
      } else {
        if (line) linesOut.push(line);
        // If a single word is too long, hard-split it
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          const parts = hardSplitWord(w, font, size, maxWidth);
          linesOut.push(...parts.slice(0, -1));
          line = parts[parts.length - 1] || "";
        } else {
          line = w;
        }
      }
    }
    if (line) linesOut.push(line);
  }
  return linesOut;
}

function hardSplitWord(word, font, size, maxWidth) {
  const out = [];
  let cur = "";
  for (const ch of [...word]) {
    const test = cur + ch;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      cur = test;
    } else {
      if (cur) out.push(cur);
      cur = ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ----------------------------
   Helpers
----------------------------- */
async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}. Put the font file in your repo at that path.`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
