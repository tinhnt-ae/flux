import chalk from 'chalk';
import { getApiKey } from '../utils/config';
import { renderHeader } from '../ui/layout';

export function hasLlmKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
}

export function printInitScreen(): void {
  renderHeader();
  process.stdout.write(`${chalk.bold.white('Tips to get started')}\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} Ask anything, e.g. ${chalk.italic.gray('"Analyze Apple growth with latest news"')}\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} Type ${chalk.cyan('/')} to open the command palette\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/set-key')}      Configure FactStream API key\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/model-setup')}  Pick your LLM model\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/help')}         Show all slash commands\n`);
  process.stdout.write('\n');
}

export function printKeyStatus(): void {
  const missing: string[] = [];
  if (!getApiKey()) missing.push('FactStream API key');
  if (!hasLlmKey()) missing.push('LLM API key');

  if (missing.length === 0) return;

  console.log(chalk.yellow.bold('Missing required keys:'));
  for (const name of missing) console.log(chalk.yellow(`- ${name}`));
  console.log(`\n${chalk.bold.white('To configure:')}`);
  if (missing.includes('FactStream API key')) {
    console.log(chalk.cyan('1. Run: flux config set-key YOUR_FACTSTREAM_KEY'));
  }
  if (missing.includes('LLM API key')) {
    console.log(chalk.cyan('2. Set env: OPENAI_API_KEY=YOUR_LLM_KEY (or LLM_API_KEY)'));
  }
  console.log(chalk.gray('You can stay in the CLI, configure keys, then ask again.\n'));
}
