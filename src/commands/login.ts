import { setApiKey } from '../utils/config';

export function run(apiKey: string) {
  setApiKey(apiKey);
  console.log('API key saved.');
}
