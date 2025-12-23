import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.449/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.449/build/pdf.worker.mjs";

const $ = (id) => document.getElementById(id);

const pdfFile = $("pdfFile");
const convertBtn = $("convertBtn");
const statusEl = $("status");
const bar = $("bar");
const downloadArea = $("downloadArea");
const toScriptEl = $("toScript");
const ocrLangEl = $("ocrLang");

let ak = null;

function setStatus(msg, pct = null) {
  statusEl.textContent = msg;
  if (pct !== null) bar.value = Math.max(0, Math.min(100, pct));
}

function clearDownload() {
  downloadArea.innerHTML = "";
}

async function ensureAksharamukha() {
  if (ak) return ak;
  setStatus("Loading transliteration engine…");
  ak = await window.Aksharamukha.new(); // IMPORTANT: must await
  return ak;
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isMeaningfulText(text) {
  const t = (text || "").replace(/\s+/g, "");
  return t.length >= 20; // heuristic: treat as text-based PDF if enough chars
}

async function extractTextFromPage(page) {
  const content = await page.getTextContent();
  const strings = content.items.map((it) => it.str);
  return normalizeNewlines(strings.join(" "));
}

async function renderPageToCanvas(page, scale = 2.0) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function ocrCanvas(canvas, lang, onProgress) {
  const worker = await window.Tesseract.createWorker({
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        onProgress(m.progress);
      }
    },
    // Force Kannada traineddata from jsDelivr (fast + reliable)
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/",
  });

  try {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const { data } = await worker.recognize(canvas);
    return normalizeNewlines(data.text || "");
  } finally {
    await worker.terminate();
  }
}

async function transliterateKannadaToTamil(text, toScript) {
  const engine = await ensureAksharamukha();
  // FROM: Kannada, TO: TamilExtended (recommended) or Tamil
  return await engine.process("Kannada", toScript, text);
}

async function loadTamilFontBytes() {
  // Put a Tamil-capable font file at fonts/NotoSansTamil-Regular.ttf
  const res = await fetch("./fonts/NotoSansTamil-Regular.ttf");
  if (!res.ok) throw new Error("Tamil font missing: fonts/NotoSansTamil-Regular.ttf");
  return new Uint8Array(await res.arrayBuffer());
}

function wrapText(text, maxCharsPerLine) {
  // Simple wrapping (works well for mantra-style text with spaces/newlines)
  const lines = [];
  const paras = normalizeNewlines(text).split("\n");
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }

    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length <= maxCharsPerLine) line = candidate;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function buildOutputPdf(pagesTamilText, originalName) {
  const fontBytes = await loadTamilFontBytes();

  const pdfDoc = await window.PDFLib.PDFDocument.create();
  const font = await pdfDoc.embedFont(fontBytes);

  const pageSize = window.PDFLib.PageSizes.A4;
  const margin = 48;
  const fontSize = 13;
  const lineHeight = fontSize * 1.45;

  const maxWidth = pageSize[0] - margin * 2;
  // crude char estimate; we’ll keep it safe so text doesn’t overflow too often
  const maxCharsPerLine = Math.floor(maxWidth / (fontSize * 0.55));

  for (let i = 0; i < pagesTamilText.length; i++) {
    const text = pagesTamilText[i];
    const lines = wrapText(text, maxCharsPerLine);

    let page = pdfDoc.addPage(pageSize);
    let y = pageSize[1] - margin;

    // header
    const header = `Page ${i + 1}`;
    page.drawText(header, { x: margin, y: y, size: 10, font });
    y -= lineHeight;

    for (const line of lines) {
      if (y < margin + lineHeight) {
        page = pdfDoc.addPage(pageSize);
        y = pageSize[1] - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, maxWidth });
      y -= lineHeight;
    }
  }

  const bytes = await pdfDoc.save();
  const outName = (originalName || "converted.pdf").replace(/\.pdf$/i, "") + "_tamil.pdf";
  return { bytes, outName };
}

pdfFile.addEventListener("change", () => {
  clearDownload();
  convertBtn.disabled = !pdfFile.files?.length;
  if (pdfFile.files?.length) setStatus("Ready. Click Convert.", 0);
});

convertBtn.addEventListener("click", async () => {
  clearDownload();
  bar.value = 0;

  const file = pdfFile.files?.[0];
  if (!file) return;

  const toScript = toScriptEl.value;
  const ocrLang = ocrLangEl.value;

  try {
    convertBtn.disabled = true;

    setStatus("Reading PDF…", 2);
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const numPages = pdf.numPages;
    const tamilPages = [];

    await ensureAksharamukha();

    for (let p = 1; p <= numPages; p++) {
      setStatus(`Processing page ${p}/${numPages}…`, Math.round((p - 1) * 100 / numPages));
      const page = await pdf.getPage(p);

      // 1) try text extraction
      let extracted = await extractTextFromPage(page);

      // 2) if not enough text, do OCR
      if (!isMeaningfulText(extracted)) {
        setStatus(`Page ${p}: no text layer found → running OCR…`, Math.round((p - 1) * 100 / numPages));
        const canvas = await renderPageToCanvas(page, 2.2);

        const ocrText = await ocrCanvas(canvas, ocrLang, (prog) => {
          const base = (p - 1) * 100 / numPages;
          const span = 100 / numPages;
          setStatus(`OCR page ${p}/${numPages}…`, Math.round(base + prog * span));
        });

        extracted = ocrText;
      }

      // 3) transliterate
      setStatus(`Transliterating page ${p}/${numPages}…`, Math.round((p - 0.3) * 100 / numPages));
      const tamil = await transliterateKannadaToTamil(extracted, toScript);
      tamilPages.push(tamil);
    }

    setStatus("Creating output PDF…", 98);
    const { bytes, outName } = await buildOutputPdf(tamilPages, file.name);

    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    downloadArea.innerHTML = `
      <div><b>Done!</b> Download your converted PDF:</div>
      <a href="${url}" download="${outName}">⬇️ ${outName}</a>
    `;

    setStatus("Completed ✅", 100);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || err}`, 0);
  } finally {
    convertBtn.disabled = false;
  }
});
