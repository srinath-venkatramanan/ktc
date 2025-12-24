const fs = require('fs');
const path = 'C:\\Users\\User\\.gemini\\antigravity\\scratch\\aksharamukha-source\\aksharamukha-back\\resources\\syllabary\\syllabary_Kannada.json';
const data = JSON.parse(fs.readFileSync(path));
console.log(Object.keys(data));
