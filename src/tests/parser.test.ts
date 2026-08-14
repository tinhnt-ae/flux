import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntent, normalizeIntentV2 } from '../utils/parser';

test('normalizeIntent falls back to tickers from query and clamps periods', () => {
  const parsed = normalizeIntent({ analysis_type: 'growth', periods: 99 }, 'Compare AAPL vs MSFT');

  assert.deepEqual(parsed.tickers, ['AAPL', 'MSFT']);
  assert.equal(parsed.analysis_type, 'growth');
  assert.equal(parsed.periods, 8);
});

test('normalizeIntentV2 rejects malformed entities and defaults request metadata', () => {
  const parsed = normalizeIntentV2({
    entities: [
      { name: 'Apple', type: 'company' },
      { name: 'bad', type: 'person' },
      { nope: true }
    ],
    request_type: 'news',
    include_news: false
  });

  assert.deepEqual(parsed.entities, [{ name: 'Apple', type: 'company' }]);
  assert.equal(parsed.request_type, 'news');
  assert.equal(parsed.include_news, false);
  assert.equal(parsed.off_topic, false);
});
