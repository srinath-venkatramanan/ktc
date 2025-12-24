
// src/services/ocrService.js
import Tesseract from 'tesseract.js';

/**
 * Recognizes text from an image blob using Google Cloud Vision API.
 * @param {Blob|File} image - The image to process.
 * @param {string} apiKey - Google Cloud API Key.
 * @returns {Promise<string>} - The recognized text.
 */
async function recognizeTextGCV(image, apiKey) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onerror = () => {
            reader.abort();
            reject(new DOMException("Problem parsing input file."));
        };

        reader.onload = async () => {
            try {
                const base64Content = reader.result.split(',')[1];
                const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        requests: [{
                            image: {
                                content: base64Content
                            },
                            features: [{
                                type: 'DOCUMENT_TEXT_DETECTION' // Optimized for dense text/documents
                            }]
                        }]
                    })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(`GCV API Error: ${errData.error?.message || response.statusText}`);
                }

                const data = await response.json();
                // GCV returns fullTextAnnotation for the whole block
                const fullText = data.responses[0]?.fullTextAnnotation?.text || '';
                resolve(fullText);
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsDataURL(image);
    });
}

/**
 * Recognizes text from an image blob using Tesseract.js or GCV if key provided.
 * @param {Blob|File} image - The image to process.
 * @param {string} lang - Language code (default 'kan').
 * @param {Function} progressCallback - Optional callback for progress updates.
 * @param {string} [apiKey] - Optional Google Cloud Vision API Key.
 * @returns {Promise<string>} - The recognized text.
 */
export async function recognizeText(image, lang = 'kan', progressCallback, apiKey = null) {
    // 1. Try Google Cloud Vision if API Key is present
    if (apiKey) {
        try {
            console.log("Using Google Cloud Vision API...");
            if (progressCallback) progressCallback(0.5); // Fake progress for API call
            const text = await recognizeTextGCV(image, apiKey);
            if (progressCallback) progressCallback(1.0);
            return text;
        } catch (error) {
            console.error("GCV Failed, falling back to local OCR:", error);
            // Fallthrough to Tesseract
        }
    }

    // 2. Fallback to Tesseract
    try {
        console.log("Using local Tesseract OCR...");
        const { data: { text } } = await Tesseract.recognize(
            image,
            lang,
            {
                logger: m => {
                    if (progressCallback && m.status === 'recognizing text') {
                        progressCallback(m.progress);
                    }
                    console.log(m);
                }
            }
        );
        return text;
    } catch (error) {
        console.error('OCR Error:', error);
        throw error;
    }
}
