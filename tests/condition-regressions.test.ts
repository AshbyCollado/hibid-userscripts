import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLotCondition, buildConditionPresentation, computeAccountVerdict } from '../src/intelligence/us-deal-intelligence.js';

const budaDescription = [
  'Condition: Open Box - Not Tested',
  'Damaged?: Unknown',
  'Functional?: Unable to Test',
  'Missing Parts?: No',
  'Notes: Some pins appear slightly bent - May need repairs but I\'m unsure - Otherwise brand new.',
].join('\n');

test('structured Buda uncertainty survives new-in-box marketing language', () => {
  const assessment = assessLotCondition(budaDescription);
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.damaged, false);
  assert.ok(assessment.cautions.includes('not tested'));
  assert.ok(assessment.cautions.includes('possible bent pins'));
  assert.ok(assessment.cautions.includes('possible repair'));
  assert.deepEqual(assessment.damageReasons, []);
});

test('condition presentation surfaces open-box untested status and uncertain repair risk', () => {
  const presentation = buildConditionPresentation(assessLotCondition({
    title: 'ASUS B850-A',
    description: budaDescription,
  }));
  assert.deepEqual({ label: presentation.label, tone: presentation.tone }, { label: 'Open box · untested', tone: 'warning' });
  assert.match(presentation.title, /Functional: Unable to Test/);
  assert.match(presentation.title, /possible bent pins/);
  assert.match(presentation.title, /possible repair/);
});

test('negative damage and missing-parts answers remain non-damage', () => {
  const assessment = assessLotCondition('Condition: New - Factory Sealed\nDamaged?: No\nFunctional?: Yes\nMissing Parts?: No');
  assert.equal(assessment.damaged, false);
  assert.equal(assessment.partsOnly, false);
  assert.deepEqual(assessment.damageReasons, []);
});

test('seller notes about missing hardware override a contradictory no-missing-parts checkbox', () => {
  const assessment = assessLotCondition('Condition: New Open Box\nNotes: Missing hardware\nDamaged?: No\nMissing Parts?: No');
  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.positive, false);
  assert.ok(assessment.cautions.includes('missing hardware'));
  const presentation = buildConditionPresentation(assessment);
  assert.deepEqual({ label: presentation.label, tone: presentation.tone }, { label: 'Open box · hardware missing', tone: 'danger' });
  assert.match(presentation.title, /Missing parts: No/);
  assert.match(presentation.title, /missing hardware/);

  const complete = assessLotCondition('Condition: New Open Box\nNotes: No missing hardware\nMissing Parts?: No');
  assert.ok(!complete.cautions.includes('missing hardware'));
});

test('HiBid repair-risk notes suppress positive condition without making the lot parts-only', () => {
  const notes = [
    'Makes loud noise may need repair',
    "May need repairs motor. Sounds like it's going out.",
  ];

  for (const note of notes) {
    const assessment = assessLotCondition(`Condition: Used\nFunctional?: Yes\nNotes: ${note}`);
    assert.equal(assessment.positive, false);
    assert.equal(assessment.partsOnly, false);
    assert.ok(assessment.cautions.includes('possible repair'));

    const presentation = buildConditionPresentation(assessment);
    assert.match(presentation.label, /repair risk/);
    assert.equal(presentation.tone, 'warning');
    assert.match(presentation.title, /possible repair/);
  }
});

test('negated repair notes do not trigger repair risk', () => {
  const assessment = assessLotCondition('Condition: Used\nFunctional?: Yes\nNotes: No repairs needed; motor is fine.');
  assert.equal(assessment.positive, true);
  assert.equal(assessment.partsOnly, false);
  assert.ok(!assessment.cautions.includes('possible repair'));

  const presentation = buildConditionPresentation(assessment);
  assert.doesNotMatch(presentation.label, /repair risk/);
});

test('open-box tested flag does not bury a seller motor-repair warning', () => {
  const assessment = assessLotCondition([
    'Brand: Bella',
    'Condition: Open Box - Tested',
    'Damaged?: Unknown',
    'Functional?: Yes',
    'Missing Parts?: No',
    "Notes: May need repairs motor. Sounds like it's going out. Used",
  ].join('\n'));
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.ok(assessment.cautions.includes('possible repair'));
  const presentation = buildConditionPresentation(assessment);
  assert.match(presentation.label, /repair risk/);
  assert.equal(presentation.tone, 'warning');
});

test('repair risk outside Notes uses the same caution and positive decision', () => {
  for (const description of [
    'Condition: Open Box - Tested\nFunctional?: Yes\nMakes loud noise may need repair',
    'Condition: Open Box - Tested\nFunctional?: Yes\nDamage Description: Motor may need repair',
  ]) {
    const assessment = assessLotCondition(description);
    assert.equal(assessment.positive, false);
    assert.ok(assessment.cautions.includes('possible repair'));
  }
});

test('negated and auction-wide repair boilerplate do not describe this lot', () => {
  for (const note of [
    'Does not seem like it is failing; works fine.',
    'All items may need repair. This unit is fully functional.',
  ]) {
    const assessment = assessLotCondition(`Condition: Used\nFunctional?: Yes\nNotes: ${note}`);
    assert.equal(assessment.positive, true);
    assert.ok(!assessment.cautions.includes('possible repair'));
  }
});

test('account verdict does not advise raising on a possible-repair lot', () => {
  const condition = assessLotCondition('Condition: Open Box - Tested\nFunctional?: Yes\nNotes: Motor may need repair');
  const verdict = computeAccountVerdict({ status: 'OUTBID', condition, nextHammer: 20, allIn: 25, maxBid: 50, retail: 100 });
  assert.equal(verdict.kind, 'manual');
  assert.match(verdict.advice, /repair/i);
});
