import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateRetailIdentity } from '../src/background/retail-identity.js';
import { evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('retail message validation preserves description-derived matching constraints', () => {
  const fixtures = [
    { title: 'VEVOR Mini Scuba Tank 0.5L', description: 'Includes a hand pump, bag and lanyard.', wrong: 'VEVOR Mini Scuba Tank 0.5L with Bag and Lanyard', right: 'VEVOR Mini Scuba Tank 0.5L with Pump Bag and Lanyard' },
    { title: 'VEVOR Gas Chainsaw 25.4cc 12 inch', description: 'The chainsaw has a 1.2HP engine.', wrong: 'VEVOR Gas Chainsaw 25.4cc 12 inch 1HP', right: 'VEVOR Gas Chainsaw 25.4cc 12 inch 1.2HP' },
    { title: 'VEVOR Pool Pump Motor 1.5HP', description: 'This motor uses a 56Y frame.', wrong: 'VEVOR Pool Pump Motor 1.5HP 56J Frame', right: 'VEVOR Pool Pump Motor 1.5HP 56Y Frame' },
    { title: 'VEVOR 2200W Demolition Hammer', description: 'The demolition hammer operates at 1350 BPM.', wrong: 'VEVOR 2200W Demolition Hammer 1400 BPM', right: 'VEVOR 2200W Demolition Hammer 1350 BPM' },
  ];
  for (const fixture of fixtures) {
    const identity = extractProductIdentity(fixture);
    const transported = validateRetailIdentity(JSON.parse(JSON.stringify(identity)));
    assert.deepEqual(transported.discriminators, identity.discriminators);
    assert.deepEqual(transported.includedComponents, identity.includedComponents);
    assert.equal(evaluateRetailCandidate(fixture.wrong, transported).accepted, false, fixture.wrong);
    assert.equal(evaluateRetailCandidate(fixture.right, transported).accepted, true, fixture.right);
  }
});

test('retail validation keeps title constraints and rejects malformed or oversized evidence', () => {
  const identity = extractProductIdentity('VEVOR Pool Pump Motor 1.5HP 56Y');
  const minimal = validateRetailIdentity({ ...identity, discriminators: {} });
  assert.deepEqual(minimal.discriminators.motorFrames, ['56y']);
  for (const includedComponents of [false, [[]], [{ pump: true }], Array(65).fill(['pump']), [['p'.repeat(61)]]]) {
    assert.throws(() => validateRetailIdentity({ ...identity, includedComponents }), /Malformed retail identity/);
  }
  for (const horsepower of ['1.5hp', [null], Array(65).fill('1.5hp'), ['x'.repeat(121)]]) {
    assert.throws(() => validateRetailIdentity({ ...identity, discriminators: { horsepower } }), /Malformed retail identity/);
  }
  const safe = validateRetailIdentity({ ...identity, statedRetail: 99999, authorization: 'private', cookie: 'private' });
  assert.equal('statedRetail' in safe, false);
  assert.doesNotMatch(JSON.stringify(safe), /private|authorization|cookie/);
});

test('both cache and live retail handlers use the shared boundary validator', async () => {
  const background = await readFile('src/background/index.ts', 'utf8');
  assert.match(background, /import \{ retailQuery, validateRetailIdentity \} from '\.\/retail-identity\.js'/);
  assert.match(background, /lookupAmazonNow\(validateRetailIdentity\(/);
  assert.match(background, /lookupAmazonCached\(validateRetailIdentity\(identity\)\)/);
});
