
// src/services/pdfGenerator.js
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// Use local font from npm package (importing as URL)
import fontUrl from '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff';

export async function createDownloadablePdf(originalFile, processedPages) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Fetch and embed the font
    console.log(`Fetching font from ${fontUrl}...`);
    const fontResponse = await fetch(fontUrl);
    if (!fontResponse.ok) {
        throw new Error(`Failed to fetch font from ${fontUrl}: ${fontResponse.status} ${fontResponse.statusText}`);
    }
    const fontBytes = await fontResponse.arrayBuffer();
    const customFont = await pdfDoc.embedFont(fontBytes);

    // Process pages
    for (const pageData of processedPages) {
        let page;
        let pWidth, pHeight;

        // If we have an imageBlob, embed it
        if (pageData.imageBlob) {
            const imgBytes = await pageData.imageBlob.arrayBuffer();
            let embeddedImage;
            // Determine image type
            if (pageData.imageBlob.type === 'image/png') {
                embeddedImage = await pdfDoc.embedPng(imgBytes);
            } else {
                // Assume JPEG for others (jpg, jpeg)
                embeddedImage = await pdfDoc.embedJpg(imgBytes);
            }

            const { width, height } = embeddedImage.scale(1);
            pWidth = width;
            pHeight = height;

            page = pdfDoc.addPage([width, height]);
            page.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });

            // Draw a semi-transparent overlay box for text? 
            // Or just draw text at top/bottom?
            // User likely wants to READ the tamil. 
            // Let's simple-overlay text at the top for now, or just add a NEW blank page with text following it?
            // "transliterate and convert to pdf". 
            // Let's add the text as an overlay with a white background box to make it readable.

            // Overlay removed to avoid clutter. Text is added on the next page.

            // Actually, let's behave like a scanner: Image Page -> Text Page.
            // Or better: Text Page.
            // If user uploading disjoint images, likely they want one PDF.
            // Let's add the text on a SEPARATE page to avoid layout issues.
            const textPage = pdfDoc.addPage();
            const { width: tpW, height: tpH } = textPage.getSize();
            const text = pageData.transliteratedText || '';

            textPage.drawText(text, {
                x: 50,
                y: tpH - 50,
                size: 12,
                font: customFont,
                color: rgb(0, 0, 0),
                maxWidth: tpW - 100,
                lineHeight: 14,
            });

        } else {
            // Text-only page (from PDF source originally)
            page = pdfDoc.addPage();
            pWidth = page.getWidth();
            pHeight = page.getHeight();

            const text = pageData.transliteratedText || '';
            page.drawText(text, {
                x: 50,
                y: pHeight - 50,
                size: 12,
                font: customFont,
                color: rgb(0, 0, 0),
                maxWidth: pWidth - 100,
                lineHeight: 14,
            });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}
