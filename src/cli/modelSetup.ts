import readline from 'readline';
import chalk from 'chalk';
import { getStableChatGptModels, runUseModel } from '../commands/model';
import { listAvailableModels } from '../services/llm';
import { getErrorMessage } from '../utils/errors';

export async function selectFromMenu(title: string, options: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIdx = 0;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const renderMenu = () => {
      console.clear();
      console.log(chalk.bold.cyan(`\n${title}\n`));
      options.forEach((opt, idx) => {
        if (idx === selectedIdx) {
          console.log(chalk.bgHex('#00ff99').black(`  ▶ ${opt}  `));
        } else {
          console.log(chalk.gray(`    ${opt}  `));
        }
      });
      console.log(chalk.gray('\nUse ↑↓ arrows to select, press Enter to confirm'));
    };

    renderMenu();

    const onKeyPress = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.name === 'up') {
        selectedIdx = selectedIdx === 0 ? options.length - 1 : selectedIdx - 1;
        renderMenu();
      } else if (key.name === 'down') {
        selectedIdx = (selectedIdx + 1) % options.length;
        renderMenu();
      } else if (key.name === 'return') {
        process.stdin.off('keypress', onKeyPress);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        resolve(options[selectedIdx]);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdin.off('keypress', onKeyPress);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        resolve(null);
      }
    };

    process.stdin.on('keypress', onKeyPress);
  });
}

export async function runModelSetupWizard(): Promise<void> {
  const providers = ['chatGPT', 'Claude (Comming soon...)', 'Grok (Comming soom...)', 'Local llms (comming soon...)'];
  const selectedProvider = await selectFromMenu('Set-up model - Chon Provider', providers);
  if (!selectedProvider || selectedProvider !== 'chatGPT') {
    console.log(chalk.yellow('Provider nay sap co. Vui long chon 1 (chatGPT).'));
    return;
  }

  let stableModels: string[] = [];
  try {
    stableModels = getStableChatGptModels(await listAvailableModels());
  } catch (error: unknown) {
    console.log(chalk.red(getErrorMessage(error, 'Khong the lay danh sach model.')));
    return;
  }

  if (stableModels.length === 0) {
    console.log(chalk.yellow('Khong co stable ChatGPT model nao duoc tra ve.'));
    return;
  }

  const preferred = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'];
  const options: string[] = [];
  for (const model of preferred) {
    const found = stableModels.find((candidate) => candidate === model);
    if (found && !options.includes(found)) options.push(found);
    if (options.length === 3) break;
  }
  for (const model of stableModels) {
    if (options.length === 3) break;
    if (!options.includes(model)) options.push(model);
  }

  const selectedModel = await selectFromMenu('Set-up model - Chon ChatGPT Model', options);
  if (!selectedModel) {
    console.log(chalk.yellow('Lua chon bi huy.'));
    return;
  }

  runUseModel(selectedModel);
}
