import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectorsAreOperational,
  londonHour,
  validateDrinksResult,
} from './deployed-api-contract.mjs';

test('collector hours follow Europe/London across GMT and BST', () => {
  assert.equal(londonHour(new Date('2026-01-15T08:00:00Z')), 8);
  assert.equal(collectorsAreOperational(new Date('2026-01-15T07:59:59Z')), false);
  assert.equal(collectorsAreOperational(new Date('2026-01-15T08:00:00Z')), true);
  assert.equal(londonHour(new Date('2026-07-15T07:00:00Z')), 8);
  assert.equal(collectorsAreOperational(new Date('2026-07-15T06:59:59Z')), false);
  assert.equal(collectorsAreOperational(new Date('2026-07-15T07:00:00Z')), true);
  assert.equal(collectorsAreOperational(new Date('2026-07-15T22:59:59Z')), true);
  assert.equal(collectorsAreOperational(new Date('2026-07-15T23:00:00Z')), false);
});

test('accepts complete available and unavailable drinks contracts', () => {
  assert.doesNotThrow(() => validateDrinksResult({
    status: 'available',
    drinks: [{ productId: 42 }],
  }));
  assert.doesNotThrow(() => validateDrinksResult({
    status: 'unavailable',
    reason: 'no-orderable-menus',
    drinks: [],
  }));
});

test('rejects partial, contradictory, and unknown drinks contracts', () => {
  assert.throws(
    () => validateDrinksResult({ status: 'available', drinks: [], partial: true }),
    /partial menu/,
  );
  assert.throws(
    () => validateDrinksResult({ status: 'unavailable', reason: 'no-orderable-menus', drinks: [{}] }),
    /contained drinks/,
  );
  assert.throws(
    () => validateDrinksResult({ status: 'unavailable', reason: 'surprise', drinks: [] }),
    /invalid availability status/,
  );
});
