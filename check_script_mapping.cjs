const fs = require('fs');
const path = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\script_mapping\\script_mapping.json';
const data = JSON.parse(fs.readFileSync(path));

const kan = data['kannada'];
const tam = data['tamil'];

if (!kan || !tam) {
    console.log("Could not find kannada or tamil in script_mapping");
    process.exit(1);
}

const categories = ['numerals', 'others']; // 'others' usually has symbols

categories.forEach(cat => {
    if (kan[cat]) {
        console.log(`Kannada ${cat}:`, Object.keys(kan[cat]));
        if (typeof kan[cat] === 'object' && !Array.isArray(kan[cat])) {
            // It's likely an object with subcategories like 'symbols', 'om'
            Object.keys(kan[cat]).forEach(sub => {
                console.log(`  Kannada ${cat}.${sub}:`, kan[cat][sub]);
            });
        } else {
            console.log(`  Kannada ${cat} (Array):`, kan[cat]);
        }
    }

    if (tam[cat]) {
        if (typeof tam[cat] === 'object' && !Array.isArray(tam[cat])) {
            Object.keys(tam[cat]).forEach(sub => {
                console.log(`  Tamil ${cat}.${sub}:`, tam[cat][sub]);
            });
        } else {
            console.log(`  Tamil ${cat} (Array):`, tam[cat]);
        }
    }
});
