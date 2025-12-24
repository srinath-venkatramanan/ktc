import { aksharamukhaMap } from './aksharamukha-map.js';

// Use local proxy/api
const API_ENDPOINT = '/api/transliterate';

// Pre-compute regex for local transliteration
// Sort keys by length descending to match longest substrings first (greedy match)
const sortedKeys = Object.keys(aksharamukhaMap).sort((a, b) => b.length - a.length);

// Escape special regex characters
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Create the giant regex pattern
const regexPattern = new RegExp(sortedKeys.map(escapeRegExp).join('|'), 'g');

function localTransliterate(text) {
    if (!text) return '';
    return text.replace(regexPattern, (match) => aksharamukhaMap[match]);
}

/**
 * Transliterates text from source script to target script using Aksharamukha.
 * @param {string} text - The text to transliterate.
 * @param {string} source - Source script (e.g., 'Kannada').
 * @param {string} target - Target script (e.g., 'Tamil').
 * @returns {Promise<string>} - The transliterated text.
 */
export async function transliterateText(text, source = 'Kannada', target = 'Tamil') {
    if (!text || !text.trim()) return '';

    // If source is Kannada and target is Tamil, try local FIRST for consistency and speed?
    // Or prefer API? 
    // User said API is unstable. Local is "robust". 
    // Using local maps derived from Aksharamukha = high fidelity + speed.
    // Let's use local as primary if available, effectively making it "Offline First".

    if (source === 'Kannada' && target === 'Tamil') {
        try {
            return localTransliterate(text);
        } catch (e) {
            console.error("Local transliteration error:", e);
            // Fallthrough to API?
        }
    }

    const params = new URLSearchParams();
    params.append('text', text);
    params.append('target', target);
    params.append('source', source);
    params.append('nativize', true);

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        const result = await response.text();
        return result;

    } catch (error) {
        console.warn(`Transliteration API failed (${error.message}).`);
        // If we didn't try local yet (because different languages?), we can't do much.
        throw error;
    }
}
