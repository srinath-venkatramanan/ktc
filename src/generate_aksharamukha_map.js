const fs = require('fs');

const kanPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\syllabary\\syllabary_Kannada.json';
const tamPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\syllabary\\syllabary_Tamil.json';

const kan = JSON.parse(fs.readFileSync(kanPath));
const tam = JSON.parse(fs.readFileSync(tamPath));

console.log('Kannada Keys:', Object.keys(kan));
console.log('Tamil Keys:', Object.keys(tam));

const categories = ['compounds', 'vowels', 'consonants'];
let valid = true;

categories.forEach(cat => {
    if (!kan[cat] || !tam[cat]) {
        console.log(`Missing category: ${cat}`);
        return;
    }
    console.log(`${cat}: Kannada ${kan[cat].length}, Tamil ${tam[cat].length}`);
    if (kan[cat].length !== tam[cat].length) {
        console.log(`MISMATCH in length for ${cat}`);
        valid = false;
    }
    // Print first few replacements
    console.log(`First 5 replacements for ${cat}:`);
    for (let i = 0; i < 5; i++) {
        console.log(`${kan[cat][i]} -> ${tam[cat][i]}`);
    }
});

if (valid) {
    console.log("Lengths match. Generating replacement map...");
    const map = {};
    categories.forEach(cat => {
        kan[cat].forEach((k, i) => {
            map[k] = tam[cat][i];
        });
    });

    // Write to file
    const outPath = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\kan-translit-app\\src\\services\\aksharamukha-map.js';
    const content = `export const aksharamukhaMap = ${JSON.stringify(map, null, 2)};`;

    // We can't use 'export' in node script to verify, but we can write it.
    // fs.writeFileSync(outPath, content);
    console.log("Map would have", Object.keys(map).length, "entries.");
}
