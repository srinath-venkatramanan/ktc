
// src/services/pdfProcessor.js
import * as pdfjsLib from 'pdfjs-dist';
// Use the modern Vite import for worker
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function processPdfForText(file, onProgress) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const pagesData = [];

    for (let i = 1; i <= numPages; i++) {
        if (onProgress) onProgress(i, numPages);

        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const hasText = textContent.items.length > 0;

        let text = '';
        let imageBlob = null;

        if (hasText) {
            // Simple text extraction
            text = textContent.items.map(item => item.str).join(' ');
        } else {
            // Prepare for OCR: Render to canvas
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        }

        pagesData.push({
            pageNumber: i,
            hasText,
            text,
            imageBlob, // If hasText is false, this will be populated
            width: page.view.slice(2)[0], // approx width ??? view is [x, y, w, h] - actually usually [0,0,w,h]
            height: page.view.slice(2)[1]
        });
    }
    return pagesData;
}
