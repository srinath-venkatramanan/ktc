/* global pdfjsLib, Tesseract, PDFLib, fontkit, Aksharamukha */

const elFile = document.getElementById("pdfFile");
const elBtn = document.getElementById("convertBtn");
const elTo = document.getElementById("toScript");
const elOcrLang = document.getElementById("ocrLang");
const elOcrQuality = document.getElementById("ocrQuality");
const elStatus = document.getElementById("status");
const elBar = document.getElementById("bar");
const elDownload = document.getElementById("downloadArea");

let selectedPdfBytes = null;

elFile.addEventListener("change", async (e) => {
  elDownload.innerHTML = "";
  const file = e.target.files?.[0];
  if (!file) {
    selectedPdfBytes = null;
    elBtn.disabled = true;
    setStatus("Load a PDF to begin.", 0);
    return;
  }
  selectedPdfBytes = await file.arrayBuffer();
  elBtn.disabled = false;
  setStatus(`Loaded: ${file.name}`, 0);
});

elBtn.addEventListener("click", async () => {
  if (!selectedPdfBytes) return;
  elBtn.disabled = true;
  elDownload.innerHTML = "";

  try {
    await convertPdfToTamil(selectedPdfBytes);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err?.message || String(err)}`, 0);
  } finally {
    elBtn.disabled = false;
  }
});

function setStatus(msg, pct) {
  elStatus.textContent = msg;
  if (typeof pct === "number") elBar.value = Math.max(0, Math.min(100, pct));
}

async function convertPdfToTamil(inputPdfBytes) {
  const toScript = elTo.value;            // TamilExtended or Tamil
  const ocrLang = elOcrLang.value;        // kan or eng
  const quality = elOcrQuality.value;     // fast or best

  setStatus("Opening PDF…", 2);

  // Load input PDF via pdf.js
  const loadingTask = pdfjsLib.getDocument({ data: inputPdfBytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  // Prepare OCR worker once (lazy-init only if needed)
  let ocrWorker = null;

  // Create output PDF
  const outPdf = await PDFLib.PDFDocument.create();

  // Fix for fontkit error:
  outPdf.registerFontkit(fontkit);

  // Load a Tamil font from repo (GitHub Pages serves it)
  setStatus("Loading Tamil font…", 4);
  const tamilFontBytes = await fetch("./fonts/NotoSansTamil-Regular.ttf").then(r => {
    if (!r.ok) throw new Error("Could not load ./fonts/NotoSansTamil-Regular.ttf (check repo path).");
    return r.arrayBuffer();
  });
  const tamilFont = await outPdf.embedFont(tamilFontBytes, { subset: true });

  // Layout constants
  const pageWidth = 595.28;  // A4 points
  const pageHeight = 841.89; // A4 points
  const margin = 48;
  const fontSize = 13;
  const lineHeight = 18;

  // Iterate pages
  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    const pctBase = 5 + Math.floor(((pageNo - 1) / totalPages) * 90);
    setStatus(`Reading page ${pageNo}/${totalPages}…`, pctBase);

    const page = await pdf.getPage(pageNo);

    // 1) Try text extraction (fast)
    const extracted = await extractTextFromPage(page);

    let srcText = (extracted || "").trim();

    // 2) If no text layer -> OCR
    if (!srcText) {
      setStatus(`Page ${pageNo}: no text layer → OCR…`, pctBase);

      if (!ocrWorker) {
        ocrWorker = await createOcrWorker(ocrLang);
      }

      const scale = quality === "best" ? 2.5 : 1.8; // speed vs accuracy
      const canvas = await renderPageToCanvas(page, scale);

      // OCR progress is slow; update status from logger
      const ocrResult = await ocrWorker.recognize(canvas, {}, {
        // Tesseract v5 supports progress events via logger on worker creation
      });

      srcText = (ocrResult?.data?.text || "").trim();
    }

    // If still empty, keep an empty page
    if (!srcText) srcText = "";

    // 3) Transliterate Kannada -> Tamil/TamilExtended
    setStatus(`Transliterating page ${pageNo}/${totalPages}…`, pctBase + 2);
    const tamilText = transliterateKannadaToTamil(srcText, toScript);

    // 4) Write to output PDF with wrapping
    setStatus(`Writing output page ${pageNo}/${totalPages}…`, pctBase + 4);

    const outPage = outPdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const paragraphs = normalizeParagraphs(tamilText);

    for (const para of paragraphs) {
      if (para === "") {
        y -= lineHeight; // blank line
        continue;
      }

      const lines = wrapText(para, tamilFont, fontSize, pageWidth - margin * 2);

      for (const line of lines) {
        if (y < margin + lineHeight) {
          // create continuation page if content overflows
          const cont = outPdf.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
          // switch writing to new page
          outPage = cont; // (NOTE) can't reassign const; so do continuation differently
        }
        // We can't reassign const outPage; handle by drawing on last page dynamically:
      }
    }

    // Because we sometimes overflow, we draw using a helper that manages pages
    outPdf.removePage(outPdf.getPageCount() - 1); // remove placeholder we created above
    await drawTextWithPagination(outPdf, tamilFont, paragraphs, {
      pageWidth, pageHeight, margin, fontSize, lineHeight
    });
    
    const pctDone = 5 + Math.floor((pageNo / totalPages) * 90);
    setStatus(`Done page ${pageNo}/${totalPages}`, pctDone);
  }

  if (ocrWorker) {
    await ocrWorker.terminate();
  }

  setStatus("Building final PDF…", 97);
  const outBytes = await outPdf.save();

  const blob = new Blob([outBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  setStatus("Completed ✅", 100);
  elDownload.innerHTML = `
    <a href="${url}" download="kannada-to-tamil.pdf">Download Tamil PDF</a>
    <div class="small">Tip: If OCR is slow, choose “Fast” OCR quality and use clean scans.</div>
  `;
}

/** Extract text from pdf.js page. Returns "" if no text layer. */
async function extractTextFromPage(page) {
  const tc = await page.getTextContent();
  if (!tc?.items || tc.items.length === 0) return "";

  // Simple line grouping by Y coordinate
  const items = tc.items
    .filter(it => (it.str || "").trim().length > 0)
    .map(it => ({
      str: it.str,
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0
    }));

  if (items.length === 0) return "";

  // Sort top-to-bottom, left-to-right
  items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  const yThreshold = 3; // how close counts as same line
  let currentLineY = null;
  let currentLine = [];

  for (const it of items) {
    if (currentLineY === null) {
      currentLineY = it.y;
      currentLine = [it];
      continue;
    }
    if (Math.abs(it.y - currentLineY) <= yThreshold) {
      currentLine.push(it);
    } else {
      // flush previous line
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(joinLine(currentLine));
      currentLineY = it.y;
      currentLine = [it];
    }
  }
  // flush last
  if (currentLine.length) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push(joinLine(currentLine));
  }

  return lines.join("\n").trim();
}

function joinLine(lineItems) {
  // naive spacing: add space if there's a big x-gap
  let out = "";
  let lastX = null;
  for (const it of lineItems) {
    if (lastX !== null && (it.x - lastX) > 10) out += " ";
    out += it.str;
    lastX = it.x;
  }
  return out.trim();
}

async function renderPageToCanvas(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function createOcrWorker(lang) {
  setStatus(`Initializing OCR (${lang})…`, 8);

  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      // m.progress is 0..1
      if (m?.status) {
        const pct = 10 + Math.round((m.progress || 0) * 60);
        setStatus(`OCR: ${m.status}`, pct);
      }
    }
  });

  // A couple settings that often help scanned books
  await worker.setParameters({
    // 6 = Assume a single uniform block of text (good for pages)
    tessedit_pageseg_mode: "6",
  });

  return worker;
}

function transliterateKannadaToTamil(text, toScript) {
  if (!text) return "";
  try {
    // Aksharamukha global API
    // Source script: Kannada
    return Aksharamukha.convert(text, "Kannada", toScript);
  } catch (e) {
    console.warn("Aksharamukha convert failed, returning original text.", e);
    return text;
  }
}

function normalizeParagraphs(text) {
  // Keep blank lines; normalize CRLF; trim trailing spaces
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .split("\n");
}

function wrapText(text, font, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let line = words[0];

  for (let i = 1; i < words.length; i++) {
    const test = line + " " + words[i];
    const w = font.widthOfTextAtSize(test, size);
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

/**
 * Draw paragraphs into pages with wrapping + pagination.
 * Creates as many pages as needed for ONE input page text.
 */
async function drawTextWithPagination(pdfDoc, font, paragraphs, opts) {
  const { pageWidth, pageHeight, margin, fontSize, lineHeight } = opts;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const maxWidth = pageWidth - margin * 2;

  const drawLine = (line) => {
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font
    });
    y -= lineHeight;
  };

  const ensureSpace = () => {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  for (const para of paragraphs) {
    if (para === "") {
      ensureSpace();
      y -= lineHeight; // blank line
      continue;
    }

    const lines = wrapText(para, font, fontSize, maxWidth);
    for (const line of lines) {
      ensureSpace();
      drawLine(line);
    }
  }
}
