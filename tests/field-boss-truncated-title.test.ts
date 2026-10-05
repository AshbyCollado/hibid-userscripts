import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAmazonCandidateEvidence, evaluateRetailCandidate, extractProductDiscriminators, extractProductIdentity, scoreRetailCandidate } from '../src/intelligence/us-deal-intelligence';

const fieldBossTitle = 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 11';

test('recovers the loader as a secondary package component, not the tractor model', () => {
  const title = 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 11';
  const description = 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, 3-point, PTO, Diesel Engine, 3 Speed Transmission, & Manual(s) - Hour Meter Reads 249.3 at time of photos…tractor will be used some between photos and pickup.';
  const identity = extractProductIdentity(title, description);

  assert.match(identity.name, /WFE 1155GA Loader/);
  assert.doesNotMatch(identity.name, /Manual/i);
  assert.equal(identity.model, null);
  assert.equal(identity.model2, '1155GA');
  assert.deepEqual(identity.discriminators.wattages, []);
});

test('recovers loader continuations across punctuation, suffixes, and parentheticals', () => {
  for (const description of [
    'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, 3-point, PTO. Sold as is.',
    'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA-2 Loader,PTO.',
    'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader (with bucket),PTO.',
    'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader & bucket,PTO.',
  ]) {
    assert.match(extractProductIdentity(fieldBossTitle, description).name, /WFE 1155GA(?:-2)? Loader(?: (?:\(with bucket\)|& bucket))?/);
  }
});

test('package connector spelling does not change primary and secondary models', () => {
  for (const connector of ['w/', 'with']) {
    const title = `White Farm Equipment (WFE) Field Boss 31 ${connector} WFE 1155GA Loader`;
    const description = `White Farm Equipment (WFE) Field Boss 31 ${connector} WFE 1155GA Loader, PTO.`;
    const identity = extractProductIdentity(title, description);
    assert.match(identity.name, /WFE 1155GA Loader/);
    assert.equal(identity.model, null);
    assert.equal(identity.model2, '1155GA');
  }
});

test('package subject matching protects the tractor from component and variant false positives', () => {
  const identity = extractProductIdentity(fieldBossTitle, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, PTO.');

  assert.equal(evaluateRetailCandidate('White Farm Equipment Field Boss 31 1155GA Loader', identity).accepted, true);
  for (const candidate of [
    'White Farm Equipment Field Boss 37 tractor',
    'White Farm Equipment 1155GA Loader',
    '1155GA Loader Mounting Bracket',
  ]) {
    assert.equal(evaluateRetailCandidate(candidate, identity).accepted, false, candidate);
  }
});

test('matching-prefix auction boilerplate cannot become a recovered model', () => {
  for (const tail of ['sold as is auction reference ABC123 pickup only', 'pickup location ABC123']) {
    const identity = extractProductIdentity(
      fieldBossTitle,
      `White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader ${tail}`,
    );
    assert.match(identity.name, /WFE 1155GA Loader$/);
    assert.equal(identity.model, null);
    assert.equal(identity.model2, '1155GA');
    assert.doesNotMatch(identity.name, /ABC123/);
  }
});

test('package guard remains hard through score and Amazon detail fallback', () => {
  const identity = extractProductIdentity(fieldBossTitle, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, PTO.');
  for (const candidate of ['White Farm Equipment Field Boss 37 1155GA Loader', 'White Farm Equipment 1155GA Loader']) {
    assert.equal(scoreRetailCandidate(candidate, identity), 0, candidate);
    for (const detailEnriched of [false, true]) {
      assert.equal(evaluateAmazonCandidateEvidence({
        title: candidate,
        matchText: 'Fits White Farm Equipment Field Boss 31 tractor',
        detailEnriched,
        price: 9,
      }, identity).accepted, false, `${candidate} detail=${detailEnriched}`);
    }
  }
});

test('component and scattered-token false positives do not satisfy the package subject', () => {
  const identity = extractProductIdentity(fieldBossTitle, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, PTO.');
  for (const candidate of [
    'White Farm Equipment Field Boss 37 tractor with 31HP engine',
    'White Farm Equipment Field Boss 31 WFE 1155G Loader Mounting Bracket',
  ]) {
    assert.equal(evaluateRetailCandidate(candidate, identity).accepted, false, candidate);
  }
});

test('package completeness is retained for secondary battery components', () => {
  const identity = extractProductIdentity('DeWalt DCD791 drill w/ DCB205 battery', 'DeWalt DCD791 drill w/ DCB205 battery');
  assert.equal(evaluateRetailCandidate('DeWalt DCD791 drill', identity).accepted, false);
  assert.equal(evaluateRetailCandidate('DeWalt DCD791 drill with DCB205 battery', identity).accepted, true);
});

test('package matching tolerates descriptive words and model punctuation', () => {
  for (const connector of ['w/', 'with']) {
    const identity = extractProductIdentity(`DeWalt DCD791 drill ${connector} DCB205 battery`);
    for (const candidate of [
      'DeWalt DCD791 Cordless Drill DCB205 Kit',
      'DeWalt DCD791 drill DCB-205 Kit',
      'DeWalt 20V MAX DCD791 Brushless Cordless Drill with DCB205 Battery',
    ]) {
      // The battery itself must still be evidenced, not merely a model in a kit title.
      const withBattery = /battery/i.test(candidate) ? candidate : `${candidate} with Battery`;
      assert.equal(evaluateRetailCandidate(withBattery, identity).accepted, true, withBattery);
      assert.ok(scoreRetailCandidate(withBattery, identity) > 0, withBattery);
    }
  }
});

test('package identities cannot bypass accessory, documentation or exclusion guards', () => {
  const cases = [
    ...['w/', 'with'].flatMap((connector) => {
      const identity = extractProductIdentity(`DeWalt DCD791 drill ${connector} DCB205 battery`);
      return [
        'Replacement case for DeWalt DCD791 drill and DCB205 battery',
        'DeWalt DCD791 drill DCB205 battery service manual',
        'DeWalt DCD791 drill with DCB205 battery not included',
        'DeWalt DCD791 drill without DCB205 battery',
        'Replacement DCB205 battery for DeWalt DCD791 drill',
        'DeWalt DCD791 drill with DCB205 battery charger only',
      ].map((title) => ({ title, identity }));
    }),
    ...[
      'Replacement hydraulic valve for White Farm Equipment Field Boss 31 WFE 1155GA Loader',
      'White Farm Equipment Field Boss 31 with WFE 1155GA Loader not included',
      'White Farm Equipment Field Boss 31 tractor without WFE 1155GA Loader',
      'White Farm Equipment Field Boss 31 tractor, WFE 1155GA loader sold separately',
      'Parts only for White Farm Equipment Field Boss 31 WFE 1155GA Loader',
      'White Farm Equipment Field Boss 31 WFE 1155GA Loader parts only',
      'White Farm Equipment Field Boss 31 WFE 1155GA Loader manual',
      'White Farm Equipment Field Boss 31 with WFE 1155GA-2 Loader',
    ].map((title) => ({
      title,
      identity: extractProductIdentity(fieldBossTitle, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, PTO.'),
    })),
    {
      title: 'DeWalt DCD791 drill with DCB205-2 battery',
      identity: extractProductIdentity('DeWalt DCD791 drill with DCB205 battery'),
    },
  ];
  for (const { title, identity } of cases) {
    assert.equal(evaluateRetailCandidate(title, identity).accepted, false, title);
    assert.equal(scoreRetailCandidate(title, identity), 0, title);
    for (const detailEnriched of [false, true]) {
      assert.equal(evaluateAmazonCandidateEvidence({
        title, matchText: identity.name, detailEnriched, price: 9,
      }, identity).accepted, false, `${title} detail=${detailEnriched}`);
    }
  }
});

test('a battery charger mention is not battery evidence, but details may establish a separate included battery', () => {
  const identity = extractProductIdentity('DeWalt DCD791 drill with DCB205 battery');
  const title = 'DeWalt DCD791 drill with DCB205 battery charger';
  assert.equal(evaluateRetailCandidate(title, identity).accepted, false);
  assert.equal(scoreRetailCandidate(title, identity), 0);
  assert.equal(evaluateAmazonCandidateEvidence({ title, matchText: identity.name, detailEnriched: false, price: 9 }, identity).accepted, false);
  assert.equal(evaluateAmazonCandidateEvidence({
    title, matchText: 'DeWalt DCD791 drill with DCB205 battery and charger', detailEnriched: true, price: 9,
  }, identity).accepted, true);
});

test('included manuals do not turn complete equipment into documentation-only matches', () => {
  const identity = extractProductIdentity(fieldBossTitle, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 1155GA Loader, PTO.');
  for (const candidate of [
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader and manual',
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader, manual included',
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader no manuals',
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader, manuals not included',
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader manual transmission',
    'White Farm Equipment Field Boss 31 with WFE 1155GA Loader not for parts',
  ]) assert.equal(evaluateRetailCandidate(candidate, identity).accepted, true, candidate);
});

test('retains real wattage units while excluding standalone w slash', () => {
  assert.deepEqual(extractProductDiscriminators('31W lamp').wattages, ['31w']);
  assert.deepEqual(extractProductDiscriminators('31W / 12V lamp').wattages, ['31w']);
  assert.deepEqual(extractProductDiscriminators('31 W / 12V lamp').wattages, ['31w']);
  assert.deepEqual(extractProductDiscriminators('31 w/ 12V lamp').wattages, []);
});

test('unrelated auction boilerplate cannot replace a clipped title', () => {
  const identity = extractProductIdentity(
    fieldBossTitle,
    'See photos and pickup instructions. This lot is sold as-is; auction reference 321617955.',
  );

  assert.equal(identity.name, 'White Farm Equipment (WFE) Field Boss 31 w/ WFE 11');
  assert.equal(identity.model, null);
});
