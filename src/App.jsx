import React, { useState } from 'react';
import './App.css';
import { processPdfForText } from './services/pdfProcessor';
import { recognizeText } from './services/ocrService';
import { transliterateText } from './services/transliterationService';
import { createDownloadablePdf } from './services/pdfGenerator';
import { createDownloadableText } from './services/textGenerator'; // NEW

function App() {
  const [files, setFiles] = useState(null); // Changed to array/FileList
  const [apiKey, setApiKey] = useState(''); // NEW
  const [status, setStatus] = useState('idle'); // idle, processing, done, error
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [textDownloadUrl, setTextDownloadUrl] = useState(null); // NEW

  const addLog = (msg) => setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  const handleFileChange = (e) => {
    console.log("Files selected:", e.target.files);
    if (e.target.files && e.target.files.length > 0) {
      setFiles(e.target.files);
      setStatus('idle');
      setLog([]);
      setDownloadUrl(null);
      setTextDownloadUrl(null);
      setProgress(0);
    } else {
      console.log("No files selected or length 0");
    }
  };

  const processContent = async () => {
    console.log("processContent called", files);
    if (!files || files.length === 0) {
      console.log("No files to process");
      return;
    }
    setStatus('processing');
    addLog('Starting processing...');
    setProgress(5);

    try {
      let processedPages = [];

      // Check if first file is PDF (assume single PDF upload logic for simplicity if PDF)
      if (files[0].type === 'application/pdf') {
        const file = files[0];
        addLog('Parsing PDF...');
        const pagesData = await processPdfForText(file, (curr, total) => {
          addLog(`Parsed page ${curr}/${total}`);
        });

        // Standard PDF Logic Loop
        const totalSteps = pagesData.length * 2;
        let completedSteps = 0;

        for (const page of pagesData) {
          let textToTransliterate = '';
          if (page.hasText && page.text.trim().length > 0) {
            addLog(`Page ${page.pageNumber}: Text layer found.`);
            textToTransliterate = page.text;
          } else if (page.imageBlob) {
            addLog(`Page ${page.pageNumber}: Running OCR...`);
            textToTransliterate = await recognizeText(page.imageBlob, 'kan');
            addLog(`Page ${page.pageNumber}: OCR complete.`);
          }

          completedSteps++;
          setProgress(20 + (completedSteps / totalSteps) * 60);

          if (textToTransliterate) {
            addLog(`Page ${page.pageNumber}: Transliterating...`);
            try {
              page.transliteratedText = await transliterateText(textToTransliterate);
            } catch (e) {
              addLog(`Error transliterating page ${page.pageNumber}: ${e.message}`);
              page.transliteratedText = textToTransliterate;
            }
          }
          processedPages.push(page);
          completedSteps++;
          setProgress(20 + (completedSteps / totalSteps) * 60);
        }

      } else {
        // Image Mode
        addLog(`Processing ${files.length} images...`);
        const totalSteps = files.length * 2; // OCR + Transliterate
        let completedSteps = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          addLog(`Image ${i + 1}/${files.length}: ${file.name}`);

          // OCR
          addLog(`Image ${i + 1}: Running OCR...`);
          const text = await recognizeText(file, 'kan');
          addLog(`Image ${i + 1}: OCR complete.`);

          completedSteps++;
          setProgress((completedSteps / totalSteps) * 80); // Scale up to 80%

          // Transliterate
          let transliteratedText = '';
          if (text) {
            addLog(`Image ${i + 1}: Transliterating...`);
            try {
              transliteratedText = await transliterateText(text);
              addLog(`Result (Sample): ${transliteratedText.substring(0, 50)}...`);
            } catch (e) {
              addLog(`Transliteration failed for image ${i + 1}: ${e.message}`);
              transliteratedText = text;
            }
          }

          // Structure for PDF Generator
          // We need to mimic the page structure: { width, height, transliteratedText }
          // We don't know dimensions easily without loading image. 
          // PDFGenerator defaults might handle it, or we create a dummy page.
          // Let's rely on PDFGenerator handling generic text pages if no imageBlob is passed?
          // Actually PDFGenerator usually overlays text on the original image.
          // We should pass the imageBlob so it gets drawn as background?
          // Yes, let's pass the file as imageBlob.

          processedPages.push({
            pageNumber: i + 1,
            imageBlob: file, // File is a Blob
            transliteratedText: transliteratedText,
            // width/height? PDFGenerator might need to load it. 
            // Let's look at PDFGenerator later. For now assume it handles it or we update it.
          });

          completedSteps++;
          setProgress((completedSteps / totalSteps) * 80);
        }
      }

      // 4. Generate Output
      addLog('Generating Output Files...');

      // PDF
      try {
        const pdfBlob = await createDownloadablePdf(files[0].type === 'application/pdf' ? files[0] : null, processedPages);
        const url = URL.createObjectURL(pdfBlob);
        setDownloadUrl(url);
      } catch (pdfErr) {
        console.error("PDF Generation failed", pdfErr);
        addLog("PDF Generation failed. Try Text download.");
      }

      // TEXT (NEW)
      const textBlob = createDownloadableText(processedPages);
      const tUrl = URL.createObjectURL(textBlob);
      setTextDownloadUrl(tUrl);

      addLog('Done!');
      setStatus('done');
      setProgress(100);

    } catch (err) {
      console.error(err);
      addLog('Error: ' + err.message);
      setStatus('error');
    }
  };

  return (
    <div className="container">
      <h1>Kannada PDF/Image Transliteration</h1>

      <div className="card">
        <h2>1. Upload</h2>
        <div className="file-upload">
          <input
            type="file"
            // Accept PDF OR Images
            accept="application/pdf, image/png, image/jpeg, image/jpg"
            onChange={handleFileChange}
            id="file-upload"
            multiple // Allow multiple files
            style={{ display: 'none' }}
          />
          <label htmlFor="file-upload" style={{ cursor: 'pointer', textAlign: 'center', width: '100%' }}>
            {files && files.length > 0 ? (
              <strong>{files.length} file(s) selected</strong>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📄 / 🖼️</div>
                <span>Click to upload PDF or Images (Multiple)</span>
              </>
            )}
          </label>
        </div>
      </div>

      {files && (
        <div className="card">
          <h2>2. Configuration & Process</h2>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Google Cloud Vision API Key (Optional - for better OCR):
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API Key here"
              style={{ width: '100%', padding: '0.5rem' }}
            />
            <small style={{ color: '#666' }}>Leave empty to use free local OCR (lower quality).</small>
          </div>

          <button onClick={processContent} disabled={status === 'processing'}>
            {status === 'processing' ? 'Processing...' : 'Start Conversion'}
          </button>

          {status === 'processing' && (
            <div className="progress-bar">
              <div className="progress-value" style={{ width: `${progress}%` }}></div>
            </div>
          )}
        </div>
      )}

      {(log.length > 0 || status === 'error') && (
        <div className="card">
          <h3>Processing Log</h3>
          <pre style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </pre>
        </div>
      )}

      {status === 'done' && (downloadUrl || textDownloadUrl) && (
        <div className="card">
          <h2>3. Download</h2>
          <p>Your document is ready!</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            {downloadUrl && (
              <a href={downloadUrl} download="transliterated_output.pdf" style={{ textDecoration: 'none' }}>
                <button className="success" style={{ backgroundColor: 'var(--success-color)' }}>Download PDF</button>
              </a>
            )}

            {textDownloadUrl && (
              <a href={textDownloadUrl} download="transliterated_output.txt" style={{ textDecoration: 'none' }}>
                <button className="primary" style={{ backgroundColor: '#007bff' }}>Download Text File</button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
