import { getConfigPath, setApiKey } from '../utils/config';

export function runSetKey(apiKey: string): void {
  setApiKey(apiKey);
  console.log('API key saved.');
  console.log(`Config path: ${getConfigPath()}`);
}
