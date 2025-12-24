const fs = require('fs');
const scriptMap = JSON.parse(fs.readFileSync('C:/Users/User/.gemini/antigravity/scratch/aksharamukha-source/aksharamukha-back/resources/script_mapping/script_mapping.json'));

const kan = scriptMap['kannada'];
if (kan) {
    console.log("Kannada Keys:", Object.keys(kan));
    if (kan.combiningsigns) {
        console.log("Kannada Combining:", Object.keys(kan.combiningsigns));
    }
} else {
    console.log("No kannada key found");
}

const tam = scriptMap['tamil'];
if (tam) {
    console.log("Tamil Keys:", Object.keys(tam));
    if (tam.combiningsigns) {
        console.log("Tamil Combining:", Object.keys(tam.combiningsigns));
    }
}
