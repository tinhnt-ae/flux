import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractQuarterLabel,
  findQuarterArray,
  getField,
  getLatestPrev,
  parseNumberLike
} from '../utils/data';

test('parseNumberLike handles currency, suffixes, negatives, and wrappers', () => {
  assert.equal(parseNumberLike('$1,250.50'), 1250.5);
  assert.equal(parseNumberLike('2.5B'), 2500000000);
  assert.equal(parseNumberLike('(42M)'), -42000000);
  assert.equal(parseNumberLike({ value: 123 }), 123);
  assert.equal(parseNumberLike('not-a-number'), null);
});

test('financial field helpers detect quarter arrays and nested metric fields', () => {
  const data = {
    payload: {
      quarters: [
        {
          period_end: '2026-03-31',
          values: { revenue: '$10B' },
          metrics: { net_income: 2500000000 }
        },
        {
          period: 'Q4 2025',
          revenue: 8000000000
        }
      ]
    }
  };

  const quarters = findQuarterArray(data);
  assert.equal(quarters?.length, 2);
  assert.equal(getField(quarters?.[0], ['revenue']), '$10B');
  assert.equal(extractQuarterLabel(quarters?.[0]), 'Q1 2026');

  const latestPrev = getLatestPrev(data);
  assert.equal(latestPrev.latest, quarters?.[0]);
  assert.equal(latestPrev.prev, quarters?.[1]);
});
