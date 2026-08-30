const fs = require('fs');
let content = fs.readFileSync('assets/index.ts-BuCXDImd.js', 'utf8');

content = content.replace(
  'taxPct:i.taxPctOverride??s(i.stateCode)',
  'taxPct:t.settings.taxExempt?0:(i.taxPctOverride??s(i.stateCode))'
);

fs.writeFileSync('assets/index.ts-BuCXDImd.js', content, 'utf8');
