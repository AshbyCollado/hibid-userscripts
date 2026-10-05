import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseAmazonMatch, evaluateAmazonCandidateEvidence, evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const scubaTitle = '$138 VEVOR Mini Scuba Tank 0.5L Portable Diving';
const scubaDescription = 'This set includes a mini tank, a hand pump for easy inflation, and a convenient carrying bag with a lanyard.';

test('description-included pump is a critical scuba-kit component', () => {
  const product = extractProductIdentity({ title: scubaTitle, description: scubaDescription });

  const withoutPump = evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Bag and Lanyard', product);
  assert.equal(withoutPump.accepted, false, JSON.stringify(withoutPump));
  assert.match(withoutPump.rejectionReasons.join(' '), /bundle-component-missing:.*pump/);

  assert.equal(
    evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L Diving Kit with Pump Bag and Lanyard', product).accepted,
    true,
  );

  const match = chooseAmazonMatch(product, [
    { asin: 'B0GGGLHRDN', title: 'VEVOR Mini Scuba Tank Kit with Bag and Lanyard', price: 44.37, used: false, sponsored: false, url: '' },
    { asin: 'B0GGG95SZ4', title: 'VEVOR Mini Scuba Tank Kit with Pump Bag and Lanyard', price: 103.23, used: true, sponsored: false, url: '' },
  ]);
  assert.equal(match, null);
});

test('bundle evidence ignores support, refilling, and explicit non-inclusion language', () => {
  const support = extractProductIdentity({
    title: scubaTitle,
    description: 'The tank supports refilling via a manual pump. Carrying bag included.',
  });
  assert.equal(evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Bag', support).accepted, true);

  const excluded = extractProductIdentity({
    title: scubaTitle,
    description: 'Carrying bag included; manual pump not included and sold separately.',
  });
  assert.equal(evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Bag', excluded).accepted, true);
});

test('description-included battery and title-only bundle nouns remain matchable', () => {
  const drill = extractProductIdentity({
    title: 'DeWalt 20V Cordless Drill',
    description: 'Included components: drill, battery, and charger.',
  });
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill with Battery and Charger', drill).accepted, true);
  assert.equal(evaluateRetailCandidate('DeWalt 20V Cordless Drill', drill).accepted, false);

  const titleBundle = extractProductIdentity('Sony PlayStation 5 Slim Console with Controller Bundle');
  assert.equal(evaluateRetailCandidate('Sony PlayStation 5 Slim Console with Controller', titleBundle).accepted, true);
});

test('negated description component does not create a bundle requirement', () => {
  for (const description of [
    'The package does not include a pump.',
    'The package never includes batteries.',
    'The package is without included pump.',
    'The pump and bag are not included.',
  ]) {
    const product = extractProductIdentity({ title: 'VEVOR Portable Air Compressor', description });
    assert.equal(evaluateRetailCandidate('VEVOR Portable Air Compressor', product).accepted, true, description);
  }
});

test('compatibility and refill prose does not invent included components', () => {
  for (const description of [
    'Compatible accessories include pump attachments.',
    'Supports refilling methods including a manual pump.',
  ]) {
    const product = extractProductIdentity({ title: 'VEVOR Portable Air Compressor', description });
    assert.equal(evaluateRetailCandidate('VEVOR Portable Air Compressor', product).accepted, true, description);
  }
});

test('primary nouns and manuals are not treated as required bundle components', () => {
  const product = extractProductIdentity({
    title: 'VEVOR 20V Cordless Drill',
    description: 'This set includes a drill, a manual, and the primary tool body.',
  });
  assert.equal(product.includedComponents, undefined);
  assert.equal(evaluateRetailCandidate('VEVOR 20V Cordless Drill', product).accepted, true);
});

test('affirmative description cover inclusion remains distinct from cover exclusion', () => {
  const product = extractProductIdentity({
    title: 'Rivera BM-100 Guitar Tube Combo Amplifier',
    description: 'This amplifier includes a black vinyl cover.',
  });
  assert.equal(evaluateRetailCandidate('Rivera BM-100 Guitar Tube Combo Amplifier with Black Vinyl Cover', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Rivera BM-100 Guitar Tube Combo Amplifier', product).accepted, false);
});

test('plural included components match singular title nouns', () => {
  const product = extractProductIdentity({
    title: 'VEVOR 20V Cordless Drill',
    description: 'Included components: batteries, stands, and chargers.',
  });
  assert.equal(
    evaluateRetailCandidate('VEVOR 20V Cordless Drill with Battery Stand and Charger', product).accepted,
    true,
  );
  assert.equal(evaluateRetailCandidate('VEVOR 20V Cordless Drill with Stand and Charger', product).accepted, false);
});

test('candidate exclusion wording cannot satisfy a required component', () => {
  const product = extractProductIdentity({ title: scubaTitle, description: scubaDescription });
  for (const suffix of [
    'with Bag and Lanyard, Pump Not Included',
    'with Bag and Lanyard, No Pump',
    'with Bag and Lanyard, Pump Sold Separately',
    'with Lanyard, Pump and Bag Not Included',
    'with Lanyard, Without Pump and Bag',
  ]) {
    assert.equal(evaluateRetailCandidate(`VEVOR Mini Scuba Tank 0.5L ${suffix}`, product).accepted, false, suffix);
  }
  assert.equal(evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Pump Bag and Lanyard, Batteries Not Included', product).accepted, true);
});

test('description exclusions keep affirmative components in preceding clauses', () => {
  for (const description of [
    'Includes pump and bag; lanyard not included.',
    'Includes pump and bag, lanyard not included.',
    'Includes pump and bag but lanyard not included.',
    'Includes pump and bag; compatible accessories include a lanyard.',
    'Pump not included; this set includes bag and lanyard.',
  ]) {
    const product = extractProductIdentity({ title: scubaTitle, description });
    const includesPump = description.startsWith('Includes pump');
    const complete = includesPump ? 'Pump and Bag' : 'Bag and Lanyard';
    const match = evaluateRetailCandidate(`VEVOR Mini Scuba Tank 0.5L with ${complete}`, product);
    assert.equal(match.accepted, true, `${description}: ${JSON.stringify(match)}`);
    const incomplete = evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Bag', product);
    assert.equal(incomplete.accepted, false, `${description}: ${JSON.stringify(incomplete)}`);
    assert.ok(incomplete.rejectionReasons.includes(`bundle-component-missing:${includesPump ? 'pump' : 'lanyard'}`));
  }
});

test('shared component negation stays within its clause', () => {
  for (const description of [
    'Includes pump and bag not included; includes a lanyard.',
    'Included components: pump and bag not included; included components: lanyard.',
  ]) {
    const product = extractProductIdentity({ title: scubaTitle, description });
    assert.deepEqual(product.includedComponents, [['lanyard']], description);
    assert.equal(evaluateRetailCandidate('VEVOR Mini Scuba Tank 0.5L with Lanyard', product).accepted, true, description);
  }
});

test('candidate comma and semicolon exclusions leave unrelated included components intact', () => {
  const product = extractProductIdentity({ title: scubaTitle, description: scubaDescription });
  for (const separator of [', ', '; ']) {
    const base = `VEVOR Mini Scuba Tank 0.5L with Pump Bag and Lanyard${separator}`;
    const complete = evaluateRetailCandidate(`${base}Batteries and Charger Not Included`, product);
    assert.equal(complete.accepted, true, JSON.stringify(complete));
    const excluded = evaluateRetailCandidate(`${base}Pump and Bag Not Included`, product);
    assert.equal(excluded.accepted, false, JSON.stringify(excluded));
    assert.ok(excluded.rejectionReasons.includes('bundle-component-excluded:pump'));
    assert.ok(excluded.rejectionReasons.includes('bundle-component-excluded:bag'));
    assert.ok(!excluded.rejectionReasons.includes('bundle-component-excluded:lanyard'));
  }
});

test('affirmative plural detail components resolve missing singleton title evidence', () => {
  const product = extractProductIdentity({ title: scubaTitle, description: scubaDescription });
  const title = 'VEVOR Mini Scuba Tank 0.5L Portable Diving';
  assert.equal(evaluateRetailCandidate(title, product).accepted, false);
  const candidate = {
    asin: 'B000000001', title, price: 120, used: false, sponsored: false, url: '', detailEnriched: true,
    matchText: `${title}. Included components: pumps, bags and lanyards. Batteries not included.`,
  };
  const complete = evaluateAmazonCandidateEvidence(candidate, product);
  assert.equal(complete.accepted, true, JSON.stringify(complete));
  const excluded = evaluateAmazonCandidateEvidence({
    ...candidate, matchText: `${title}. Included components: bags and lanyards. Pumps not included.`,
  }, product);
  assert.equal(excluded.accepted, false, JSON.stringify(excluded));
  assert.ok(excluded.rejectionReasons.includes('bundle-component-excluded:pump'));
});
