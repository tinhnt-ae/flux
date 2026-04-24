import fs from 'fs';
import os from 'os';
import path from 'path';
import legacyStore from '../config/store';

type FinConfig = {
  apiKey?: string;
  llmModel?: string;
  searxngUrl?: string;
};

const CONFIG_DIR = path.join(os.homedir(), '.fincli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function safeReadConfig(): FinConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as FinConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeWriteConfig(next: FinConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
}

export function getStoredApiKey(): string | undefined {
  const cfg = safeReadConfig();
  if (cfg.apiKey) return cfg.apiKey;
  const legacy = legacyStore.get('apiKey');
  return typeof legacy === 'string' ? legacy : undefined;
}

export function getApiKey(): string | undefined {
  return process.env.FACTSTREAM_API_KEY || getStoredApiKey();
}

export function setApiKey(apiKey: string): void {
  const cfg = safeReadConfig();
  safeWriteConfig({ ...cfg, apiKey });
  legacyStore.set('apiKey', apiKey);
}

export function ensureApiKeyOrExit(): string {
  const apiKey = getApiKey();
  if (apiKey) return apiKey;

  console.log('No API key found.\n');
  console.log('To get started:');
  console.log('1. Get your API key from FactStream');
  console.log('2. Run:');
  console.log('   flux config set-key YOUR_API_KEY\n');
  console.log('Then retry your command.');
  process.exit(1);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getStoredLlmModel(): string | undefined {
  const cfg = safeReadConfig();
  if (cfg.llmModel && typeof cfg.llmModel === 'string') return cfg.llmModel;
  return undefined;
}

export function setLlmModel(model: string): void {
  const cfg = safeReadConfig();
  safeWriteConfig({ ...cfg, llmModel: model });
}

// SearXNG instance URL — env > config > public fallback
const PUBLIC_SEARXNG_INSTANCES = [
  'https://priv.au',
  'https://search.2b9t.xyz',
  'https://searxng.world',
];

export function getSearxngUrl(): string {
  if (process.env.SEARXNG_URL) return process.env.SEARXNG_URL.replace(/\/$/, '');
  const cfg = safeReadConfig();
  if (cfg.searxngUrl) return cfg.searxngUrl.replace(/\/$/, '');
  // Round-robin across public instances using day-of-week to spread load
  const idx = new Date().getDay() % PUBLIC_SEARXNG_INSTANCES.length;
  return PUBLIC_SEARXNG_INSTANCES[idx];
}

export function setSearxngUrl(url: string): void {
  const cfg = safeReadConfig();
  safeWriteConfig({ ...cfg, searxngUrl: url });
}
