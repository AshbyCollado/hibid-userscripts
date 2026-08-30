const fs = require('fs');
let content = fs.readFileSync('assets/index.ts-BuCXDImd.js', 'utf8');

// The mangled function currently starts at `function w(e){let t=e.trim().slice(0,60),n=e.toLocaleLowerCase().normalize(NFKD)`
let startIdx = content.indexOf('function w(e){');
let endIdx = content.indexOf('function oe(e){');

let before = content.substring(0, startIdx);
let after = content.substring(endIdx);

let newFunc = "function w(e){let t=e.trim().slice(0,60),n=e.toLocaleLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'');n=n.replace(/^\\s*lot\\s*#?\\s*[\\w-]+\\s*[-:|]\\s*/i,'').replace(/\\([^)]*\\)/g,' ').replace(/\\b(?:lot|pair|set)\\s+of\\s+\\d+\\b/gi,' ').replace(/\\b\\d+(?:\\.\\d+)?\\s*(?:\"|in(?:ch(?:es)?)?|cm|ft|')(?=\\s|$)/gi,' ').replace(/\\bx\\s*\\d+\\b/gi,' ').replace(/\\b\\d+\\s*pcs?\\b/gi,' ');for(let e of x)n=n.replace(RegExp(`\\\\b${e.split(` `).map(C).join(`[-\\\\s]+`)}\\\\b`,`gi`),` `);n=n.replace(/\\b(?:online\\s+)?auction\\s+(?:item|lot)\\b.*$/i,` `).replace(/[^a-z0-9\\s]/g,` `);let r=new Set(S),i=n.split(/\\s+/).filter(e=>e&&e!==`x`&&!r.has(e)).slice(0,6),a=i.join(` `);return i.length>=2?a:t}";

fs.writeFileSync('assets/index.ts-BuCXDImd.js', before + newFunc + after, 'utf8');
