import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../utils/config';

test('normalizeConfig keeps only non-empty string config fields', () => {
  assert.deepEqual(
    normalizeConfig({
      apiKey: 'fact-key',
      llmModel: 'gpt-4o-mini',
      searxngUrl: 'https://search.example',
      ignored: 'value'
    }),
    {
      apiKey: 'fact-key',
      llmModel: 'gpt-4o-mini',
      searxngUrl: 'https://search.example'
    }
  );

  assert.deepEqual(
    normalizeConfig({
      apiKey: '',
      llmModel: 123,
      searxngUrl: null
    }),
    {
      apiKey: undefined,
      llmModel: undefined,
      searxngUrl: undefined
    }
  );
});
