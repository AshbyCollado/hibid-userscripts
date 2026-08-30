import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv, csvCell, spreadsheetSafeText } from '../src/core/csv.js';

test('watchlist CSV neutralizes spreadsheet formulas after optional whitespace', () => {
  for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("https://example.com")', '\t+1']) {
    assert.equal(spreadsheetSafeText(value).startsWith("'"), true, value);
  }
  assert.equal(spreadsheetSafeText('Ordinary lot title'), 'Ordinary lot title');
  assert.equal(spreadsheetSafeText('https://hibid.com/lot/1'), 'https://hibid.com/lot/1');
});

test('CSV quoting preserves commas, quotes, and line breaks without executable cells', () => {
  const csv = buildCsv([
    ['title', 'note'],
    ['Receiver, boxed', 'He said "works"'],
    ['=DANGEROUS()', 'line one\nline two']
  ]);
  assert.equal(csv, '"title","note"\r\n"Receiver, boxed","He said ""works"""\r\n"\'=DANGEROUS()","line one\nline two"');
  assert.equal(csvCell(null), '""');
});
