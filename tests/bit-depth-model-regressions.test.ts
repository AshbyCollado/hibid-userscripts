import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';

test('bit depth does not become the inferred model or a standalone sold query', () => {
  for (const spec of ['8-bit', '16-bit', '24-bit', '32-bit', '64-bit', '16bit', '24-bits', '32-bit-depth', '32-bit-float', '32-bit-floating-point']) {
    const title = `Alesis Midiverb II ${spec} Digital Multi-effects Rack Processor - Studio / Guitar`;
    const identity = extractProductIdentity(title);
    const queries = buildEbaySoldQueryVariants(identity);
    assert.notEqual(identity.model?.toLowerCase(), spec, title);
    assert.notEqual(identity.model2?.toLowerCase(), spec, title);
    assert.ok(!queries.some(query => query.toLowerCase() === spec || query.toLowerCase() === `alesis ${spec}`), title);
    assert.match(queries[0], /midiverb ii/i);
    assert.ok(queries[0].includes(spec), title);
  }
});

test('floating-point bit depth does not displace a field recorder model', () => {
  for (const spec of ['32-bit-float', '32-bit Float', '32-bit-floating-point']) {
    const identity = extractProductIdentity(`Zoom F3 ${spec} Field Recorder`);
    assert.equal(identity.model, 'F3', spec);
    assert.equal(identity.model2, null, spec);
    assert.ok(!buildEbaySoldQueryVariants(identity).some(query => /^(?:zoom )?32-bit/i.test(query)));
  }
});

test('bit-depth exclusion preserves genuine models and generation-bearing titles', () => {
  for (const [title, model] of [
    ['Pelican 1490 Protective Case', '1490'],
    ['Onkyo TX-SR304 Multi-Channel AV Receiver', 'TX-SR304'],
    ['ASUS B850-A Motherboard', 'B850-A'],
    ['Bosch 11316EVS Demolition Hammer', '11316EVS'],
    ['Nagra IV-S Tape Recorder', 'IV-S'],
    ['Canon EOS R6 Mark II Camera', 'R6'],
    ['Canon EOS R6 II Camera', 'R6'],
    ['Nikon D5300 Camera VR II', 'D5300'],
  ]) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model?.toLowerCase(), model.toLowerCase(), title);
    assert.match(buildEbaySoldQueryVariants(identity)[0], /./);
  }
});
