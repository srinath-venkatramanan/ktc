const fs = require('fs');

const kanSyllPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\syllabary\\syllabary_Kannada.json';
const tamSyllPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\syllabary\\syllabary_Tamil.json';
const scriptMapPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\script_mapping\\script_mapping.json';

const kanSyll = JSON.parse(fs.readFileSync(kanSyllPath));
const tamSyll = JSON.parse(fs.readFileSync(tamSyllPath));
const scriptMap = JSON.parse(fs.readFileSync(scriptMapPath));

const kanMap = scriptMap['kannada'];
const tamMap = scriptMap['tamil'];

const map = {};

// 1. Process Syllabary (compounds, vowels, consonants)
const syllCategories = ['compounds', 'vowels', 'consonants'];
syllCategories.forEach(cat => {
    if (kanSyll[cat] && tamSyll[cat]) {
        kanSyll[cat].forEach((k, i) => {
            if (k && tamSyll[cat][i]) {
                map[k] = tamSyll[cat][i];
            }
        });
    }
});

// 2. Process Script Mapping (Numerals)
if (kanMap.numerals && tamMap.numerals) {
    kanMap.numerals.forEach((k, i) => {
        if (k && tamMap.numerals[i]) {
            map[k] = tamMap.numerals[i];
        }
    });
}

// 3. Process Script Mapping (Others: symbols, om, aytham)
if (kanMap.others && tamMap.others) {
    const otherCats = ['symbols', 'om', 'aytham'];
    otherCats.forEach(sub => {
        if (kanMap.others[sub] && tamMap.others[sub]) {
            kanMap.others[sub].forEach((k, i) => {
                if (k && tamMap.others[sub][i]) {
                    map[k] = tamMap.others[sub][i];
                }
            });
        }
    });
}

// 4. Process Script Mapping (Vowel Signs & Virama)
if (kanMap.vowelsigns && tamMap.vowelsigns) {
    // vowelsigns is an object with 'main', 'modern', 'south', 'virama' etc.
    // flattened list of all available vowel signs?
    // Or just iterate sections.
    Object.keys(kanMap.vowelsigns).forEach(sub => {
        if (kanMap.vowelsigns[sub] && tamMap.vowelsigns[sub]) {
            kanMap.vowelsigns[sub].forEach((k, i) => {
                if (k && tamMap.vowelsigns[sub][i]) {
                    map[k] = tamMap.vowelsigns[sub][i];
                }
            });
        }
    });
}

// 5. Process Combining Signs (Ayogavaha, nukta etc)
if (kanMap.combiningsigns && tamMap.combiningsigns) {
    Object.keys(kanMap.combiningsigns).forEach(sub => {
        if (kanMap.combiningsigns[sub] && tamMap.combiningsigns[sub]) {
            kanMap.combiningsigns[sub].forEach((k, i) => {
                if (k && tamMap.combiningsigns[sub][i]) {
                    map[k] = tamMap.combiningsigns[sub][i];
                }
            });
        }
    });
}

// Write to file
const outPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\kan-translit-app\\src\\services\\aksharamukha-map.js';
const content = `export const aksharamukhaMap = ${JSON.stringify(map, null, 2)};`;

fs.writeFileSync(outPath, content);
console.log("Successfully wrote map to", outPath);
console.log("Map entries:", Object.keys(map).length);

