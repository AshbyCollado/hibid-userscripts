import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAnalysisActivityPhase,
  isScrapeActivityPhase,
  isToolbarActivityUpdate,
  toolbarActivityPresentation,
} from '../src/core/activity.js';

test('toolbar activity uses a visible spinner badge and prioritizes scraping', () => {
  const analysis = { kind: 'analysis' as const, active: true, phase: 'retail', message: 'Checking Amazon prices', current: 12, total: 40 };
  const scrape = { kind: 'scrape' as const, active: true, phase: 'hydrating', message: 'Reading descriptions', current: 25, total: 100 };
  assert.equal(toolbarActivityPresentation({ analysis }).badgeText, '↻');
  assert.match(toolbarActivityPresentation({ analysis }).title, /researching prices \(12\/40\)/);
  assert.match(toolbarActivityPresentation({ analysis, scrape }).title, /scraping \(25\/100\)/);
});

test('toolbar activity restores ending alerts after work finishes', () => {
  const idle = toolbarActivityPresentation({}, 3);
  assert.equal(idle.badgeText, '3');
  assert.match(idle.title, /3 watched lots ending within one hour/);
  assert.equal(toolbarActivityPresentation({}).badgeText, '');
});

test('toolbar activity validates messages and busy phases', () => {
  assert.equal(isToolbarActivityUpdate({ kind: 'analysis', active: true, phase: 'retail', message: 'Working', current: 1, total: 2 }), true);
  assert.equal(isToolbarActivityUpdate({ kind: 'analysis', active: 'yes', phase: 'retail', message: 'Working', current: 1, total: 2 }), false);
  assert.equal(isAnalysisActivityPhase('scanning'), true);
  assert.equal(isAnalysisActivityPhase('complete'), false);
  assert.equal(isScrapeActivityPhase('validating'), true);
  assert.equal(isScrapeActivityPhase('completed'), false);
});
