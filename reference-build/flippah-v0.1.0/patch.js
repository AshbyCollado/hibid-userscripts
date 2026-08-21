const fs = require('fs');
let content = fs.readFileSync('assets/index.ts-BuCXDImd.js', 'utf8');

content = content.replace(
  't.searchParams.set(`q`,e.trim())',
  't.searchParams.set(`keywords`,e.trim())'
);

fs.writeFileSync('assets/index.ts-BuCXDImd.js', content, 'utf8');
