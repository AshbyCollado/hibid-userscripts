import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductDiscriminators, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('chainsaw engine displacement and horsepower reject conflicting Amazon identity', () => {
  const product = extractProductIdentity({
    title: '$83 VEVOR Gas Chainsaw 25.4cc 12" Saw',
    description: 'The VEVOR Gas Chainsaw has a robust 25.4CC 1.2HP engine and a 12-inch guide bar.',
  });
  const wrong = evaluateRetailCandidate('VEVOR Gas Powered Chainsaw 12 Inch 25.4CC 1HP 2 Stroke Engine Gas Chainsaw', product);
  assert.equal(wrong.accepted, false, JSON.stringify(wrong));
  assert.match(wrong.rejectionReasons.join(' '), /horsepower/);
  assert.equal(evaluateRetailCandidate('VEVOR Gas Powered Chainsaw 12 Inch 25.4CC 1.2HP 2 Stroke Engine', product).accepted, true);
});

test('pool motor frame and horsepower reject a nearby frame/spec variant', () => {
  const product = extractProductIdentity({
    title: '$160 VEVOR 1.5 HP Pool Pump Motor, 56Y',
    description: 'This VEVOR pool pump motor uses a robust 56Y frame and operates at 115V (12.8 Amps) and 230V (6.4 Amps), 3450 RPM, with a 1.1 service factor.',
  });
  const wrong = evaluateRetailCandidate('VEVOR 1.5 HP Pool Pump Motor, 56J Frame, 115V (13.6 Amps)/230V (6.8 Amps) 3450 RPM, 1.3 Service Factor', product);
  assert.equal(wrong.accepted, false, JSON.stringify(wrong));
  assert.match(wrong.rejectionReasons.join(' '), /motorFrames/);
  assert.equal(evaluateRetailCandidate('VEVOR 1.5 HP Pool Pump Motor, 56Y Frame, 115V 12.8 Amps/230V 6.4 Amps 3450 RPM', product).accepted, true);
});

test('demolition hammer impact rate rejects a near BPM variant despite matching wattage', () => {
  const product = extractProductIdentity({
    title: '$117 VEVOR 2200W Demolition Jack Hammer, 1350 BPM',
    description: 'The 2200W demolition jack hammer operates at 1350 BPM and includes two chisels in a case.',
  });
  const wrong = evaluateRetailCandidate('VEVOR Demolition Jack Hammer MAX 2200W Electric Jackhammer Heavy Duty 1400 BPM Concrete Breaker 4pcs Chisels W/Case', product);
  assert.equal(wrong.accepted, false, JSON.stringify(wrong));
  assert.match(wrong.rejectionReasons.join(' '), /impactRates/);
  assert.equal(evaluateRetailCandidate('VEVOR 2200W Demolition Jack Hammer 1350 BPM Concrete Breaker with Chisels and Case', product).accepted, true);
});

test('industrial discriminators stay scoped away from accessory and health BPM claims', () => {
  assert.deepEqual(extractProductDiscriminators('Compatible pump accessory includes 25.4cc replacement motor'), {
    capacities: [], cubicCapacities: [], weightLimits: [], resolutions: [], dimensions: [], platformVariants: [],
    memoryTypes: [], frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [], packageCounts: [],
    colors: [], materials: [], productFamilies: [], variantLabels: [], volumes: [], modeCounts: [], featureCounts: [],
  });
  assert.deepEqual(extractProductDiscriminators('Health monitor reading 135 BPM'), {
    capacities: [], cubicCapacities: [], weightLimits: [], resolutions: [], dimensions: [], platformVariants: [],
    memoryTypes: [], frequencies: [], refreshRates: [], storageTypes: [], networkStandards: [], voltages: [], wattages: [],
    batteryCapacities: [], lensRanges: [], gpuModels: [], cpuModels: [], editions: [], seriesSignatures: [], packageCounts: [],
    colors: [], materials: [], productFamilies: [], variantLabels: [], volumes: [], modeCounts: [], featureCounts: [],
  });
});

test('bare motor frame codes retain their suffix without requiring the word frame', () => {
  const product = extractProductIdentity('VEVOR Pool Pump Motor 1.5HP 56Y');
  assert.equal(evaluateRetailCandidate('VEVOR Pool Pump Motor 1.5HP 56J', product).accepted, false);
  assert.equal(evaluateRetailCandidate('VEVOR Pool Pump Motor 1.5HP 56Y', product).accepted, true);
  assert.equal(extractProductDiscriminators('56Y display stand').motorFrames, undefined);
});

test('bare motor measurements are not treated as frame codes', () => {
  assert.equal(extractProductDiscriminators('24V 12A motor').motorFrames, undefined);
  assert.deepEqual(extractProductDiscriminators('56Y frame motor 24V 12A').motorFrames, ['56y']);

  const product = extractProductIdentity('VEVOR 24V Pool Pump Motor');
  assert.equal(evaluateRetailCandidate('VEVOR 24Volt 12A Pool Pump Motor', product).accepted, true);
});

test('negated engine specifications do not contradict the affirmative horsepower', () => {
  for (const description of [
    'The chainsaw has a 1.2HP engine, not a 1HP engine.',
    'The chainsaw has a 1.2HP engine; not a 1HP engine.',
    'The chainsaw does not have a 1HP engine, but has a 1.2HP engine.',
    'The chainsaw has a 1.2HP engine and not a 1HP engine.',
    'The chainsaw does not have a 1HP engine and a 2HP engine, but has a 1.2HP engine.',
  ]) {
    const product = extractProductIdentity({ title: 'VEVOR Gas Chainsaw 25.4cc 12 Inch Saw', description });
    assert.deepEqual(product.discriminators.horsepower, ['1.2hp'], description);
    const correct = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1.2HP Engine', product);
    assert.equal(correct.accepted, true, `${description}: ${JSON.stringify(correct)}`);
    const wrong = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1HP Engine', product);
    assert.equal(wrong.accepted, false, `${description}: ${JSON.stringify(wrong)}`);
    assert.match(wrong.rejectionReasons.join(' '), /attribute-conflict:horsepower/);
  }
});

test('trailing compatibility text retains the actual engine spec without adopting accessory specs', () => {
  for (const description of [
    'The chainsaw has a 1.2HP engine compatible with replacement chains.',
    'The chainsaw has a 1.2HP engine, compatible with replacement chains.',
    'The chainsaw has a 1.2HP engine and is compatible with replacement chains for a 1HP engine.',
    'The chainsaw has a 1.2HP engine compatible with replacement chains for a 1HP engine.',
    'The chainsaw has a 1.2HP engine, compatible with replacement chains and a 1HP motor.',
    'The chainsaw is compatible with replacement chains and has a 1.2HP engine.',
  ]) {
    const product = extractProductIdentity({ title: 'VEVOR Gas Chainsaw 25.4cc 12 Inch Saw', description });
    assert.deepEqual(product.discriminators.horsepower, ['1.2hp'], description);
    const correct = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1.2HP Engine', product);
    assert.equal(correct.accepted, true, `${description}: ${JSON.stringify(correct)}`);
    const wrong = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1HP Engine', product);
    assert.equal(wrong.accepted, false, `${description}: ${JSON.stringify(wrong)}`);
    assert.match(wrong.rejectionReasons.join(' '), /attribute-conflict:horsepower/);
  }
});

test('candidate spec clauses ignore negated alternatives and retain affirmative conflicts', () => {
  const product = extractProductIdentity('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1.2HP Engine');
  const correct = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1.2HP Engine, not a 1HP engine', product);
  assert.equal(correct.accepted, true, JSON.stringify(correct));
  const wrong = evaluateRetailCandidate('VEVOR Gas Chainsaw 25.4cc 12 Inch Saw 1HP Engine compatible with replacement chains', product);
  assert.equal(wrong.accepted, false, JSON.stringify(wrong));
  assert.match(wrong.rejectionReasons.join(' '), /attribute-conflict:horsepower/);
});
