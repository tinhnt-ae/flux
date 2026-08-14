import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArgs } from '../services/agent';

test('parseToolArgs normalizes valid tool arguments', () => {
  assert.deepEqual(parseToolArgs('resolve_ticker', { name: ' Apple ' }), { name: 'Apple' });
  assert.deepEqual(parseToolArgs('get_financials', { tickers: ['aapl', 'MSFT', 123] }), { tickers: ['AAPL', 'MSFT'] });
  assert.deepEqual(parseToolArgs('get_news', { companies: ['Apple', 'Nvidia', null] }), { companies: ['Apple', 'Nvidia'] });
});

test('parseToolArgs rejects missing required arguments', () => {
  assert.equal(parseToolArgs('resolve_ticker', { name: '' }), null);
  assert.equal(parseToolArgs('get_financials', { tickers: [] }), null);
  assert.equal(parseToolArgs('get_news', { companies: 'Apple' }), null);
});
