import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLotCondition, buildConditionPresentation } from '../src/intelligence/us-deal-intelligence.js';

test('lot-scoped untested text overrides Good when Functional is absent', () => {
  const assessment = assessLotCondition([
    'Lot contains a Yamaha Natural Sound Stereo Cassette Deck K-420.',
    'See photos for details. Untested. Local pickup or client-arranged shipping.',
    'Notes: Untested',
    'Condition: Good',
  ].join('\n'));
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.damaged, false);
  assert.ok(assessment.cautions.includes('untested'));
  const presentation = buildConditionPresentation(assessment);
  assert.deepEqual({ label: presentation.label, tone: presentation.tone }, { label: 'Good · untested', tone: 'warning' });
});

test('explicit not-tested condition remains visible despite brand-new notes without Functional', () => {
  const assessment = assessLotCondition([
    'Condition: Open Box - Not Tested',
    'Notes: Some pins appear slightly bent - May need repairs but I\'m unsure - Otherwise brand new.',
  ].join('\n'));
  assert.equal(assessment.positive, false);
  assert.equal(assessment.damaged, false);
  assert.ok(assessment.cautions.includes('not tested'));
  assert.ok(assessment.cautions.includes('possible bent pins'));
  assert.ok(assessment.cautions.includes('possible repair'));
});

test('a separate negated phrase cannot cancel structured untested evidence', () => {
  const assessment = assessLotCondition([
    'Condition: Good',
    'Notes: Not untested; seller says it was tested previously.',
    'Untested',
  ].join('\n'));
  assert.equal(assessment.positive, false);
});

test('a solely negated untested phrase does not suppress a positive condition', () => {
  const assessment = assessLotCondition([
    'Condition: Good',
    'Notes: Not untested; tested and working.',
  ].join('\n'));
  assert.equal(assessment.positive, true);
});

test('Buda Ninja oven notes override a contradictory Functional Yes field', () => {
  const assessment = assessLotCondition([
    'Condition: Open Box - Tested',
    'Damaged?: Unknown',
    'Functional?: Yes',
    'Missing Parts?: No',
    'Notes: Used will need to be cleaned Will not fully function turns off and on Not in box',
  ].join('\n'));
  assert.equal(assessment.partsOnly, true);
  assert.equal(assessment.positive, false);
  assert.ok(assessment.partsReasons.includes('stated not fully functioning'));
  const presentation = buildConditionPresentation(assessment);
  assert.equal(presentation.label, 'Functional issue');
  assert.equal(presentation.tone, 'danger');
});

test('fully functional and negated defect language remain positive', () => {
  for (const notes of ['Fully functional; tested and working.', 'Not a partially functional unit; works correctly.']) {
    const assessment = assessLotCondition(`Condition: Open Box - Tested\nFunctional?: Yes\nNotes: ${notes}`);
    assert.equal(assessment.partsOnly, false, notes);
    assert.equal(assessment.positive, true, notes);
  }
});

test('McAllen Craftsman missing closing clamps override New(other) without declaring parts-only', () => {
  const assessment = assessLotCondition([
    'Retail Price: $60',
    'Notes: Sold as is missing the clamps to close box',
    'Condition: New(other)',
    'Damaged?: Unknown',
    'In Packaging?: Yes',
    'Brand: CRAFTSMAN',
    'Model: CMST17825',
  ].join('\n'));
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.damaged, false);
  assert.ok(assessment.cautions.includes('missing hardware'));
  const presentation = buildConditionPresentation(assessment);
  assert.equal(presentation.label, 'New · hardware missing');
  assert.equal(presentation.tone, 'danger');
});

test('missing clamps and latches retain per-occurrence negation', () => {
  for (const notes of [
    'Missing a latch.', 'The clamps are missing.', 'Missing both closing latches.',
    'Not missing clamps, but missing the latch.',
    'Not missing clamps; missing latches.',
  ]) {
    const assessment = assessLotCondition(`Condition: New\nNotes: ${notes}`);
    assert.equal(assessment.positive, false, notes);
    assert.ok(assessment.cautions.includes('missing hardware'), notes);
    assert.equal(assessment.partsOnly, false, notes);
  }
  for (const notes of [
    'Not missing clamps.', 'No missing latches.', 'Without missing clamps.',
    'No clamps missing.', 'The clamps are not missing.', 'Includes closing clamps.',
    'Replacement latches are available separately.',
  ]) {
    const assessment = assessLotCondition(`Condition: New\nNotes: ${notes}`);
    assert.equal(assessment.positive, true, notes);
    assert.equal(assessment.cautions.includes('missing hardware'), false, notes);
  }
});

test('shipping boilerplate about missing closure hardware is not lot condition', () => {
  const assessment = assessLotCondition('Condition: New\nShipping: Replacement clamps for boxes with missing latches cost extra.');
  assert.equal(assessment.positive, true);
  assert.equal(assessment.cautions.includes('missing hardware'), false);
});
