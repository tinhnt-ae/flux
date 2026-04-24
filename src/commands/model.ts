import chalk from 'chalk';
import Table from 'cli-table3';
import { getActiveLlmModel, listAvailableModels } from '../services/llm';
import { setLlmModel } from '../utils/config';

export function getStableChatGptModels(models: string[]): string[] {
  // Keep only broadly stable chat models and exclude preview/experimental families.
  const stable = models.filter((id) => {
    const low = id.toLowerCase();
    const isChatFamily = low.startsWith('gpt-') || low.startsWith('o1') || low.startsWith('o3') || low.startsWith('o4');
    const isPreview = /preview|beta|experimental|realtime|audio|vision|transcribe|image/.test(low);
    return isChatFamily && !isPreview;
  });
  return [...new Set(stable)].sort((a, b) => a.localeCompare(b));
}

export async function runListModels(): Promise<void> {
  const models = await listAvailableModels();
  if (models.length === 0) {
    console.log(chalk.yellow('No models returned by provider.'));
    return;
  }

  const active = getActiveLlmModel();
  const table = new Table({
    head: [chalk.green('#'), chalk.green('Model'), chalk.green('Status')],
    colWidths: [6, 44, 14],
    style: { head: [], border: [] }
  });

  models.forEach((m, idx) => {
    table.push([
      String(idx + 1),
      m,
      m === active ? chalk.hex('#00ff99')('active') : ''
    ]);
  });

  console.log(chalk.bold('\nAvailable ChatGPT Models\n'));
  console.log(table.toString());
  console.log(`\nCurrent model: ${chalk.cyan(active)}`);
}

export async function runListStableModels(): Promise<void> {
  const models = getStableChatGptModels(await listAvailableModels());
  if (models.length === 0) {
    console.log(chalk.yellow('No stable ChatGPT models available from provider.'));
    return;
  }

  const active = getActiveLlmModel();
  const table = new Table({
    head: [chalk.green('#'), chalk.green('Stable ChatGPT Model'), chalk.green('Status')],
    colWidths: [6, 44, 14],
    style: { head: [], border: [] }
  });

  models.forEach((m, idx) => {
    table.push([
      String(idx + 1),
      m,
      m === active ? chalk.hex('#00ff99')('active') : ''
    ]);
  });

  console.log(chalk.bold('\nStable ChatGPT Models\n'));
  console.log(table.toString());
  console.log(`\nCurrent model: ${chalk.cyan(active)}`);
}

export function runUseModel(model: string): void {
  const next = model.trim();
  if (!next) {
    console.log(chalk.red('Model name cannot be empty.'));
    return;
  }
  setLlmModel(next);
  console.log(chalk.green(`LLM model set to: ${next}`));
  console.log(chalk.gray('Tip: unset LLM_MODEL env var if you want config model to take effect.'));
}

export function runCurrentModel(): void {
  console.log(`Current model: ${chalk.cyan(getActiveLlmModel())}`);
}
