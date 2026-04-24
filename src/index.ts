#!/usr/bin/env node
// Load .env early so env vars are available
import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import { ensureApiKeyOrExit, getApiKey } from './utils/config';
import { run as runGet } from './commands/getFinancials';
import { run as runLogin } from './commands/login';
import { run as runInsight } from './commands/insight';
import { run as runCompare } from './commands/compare';
import { run as runTrend } from './commands/trend';
import { run as runTweet } from './commands/tweet';
import { run as runAsk } from './commands/ask';
import { runSetKey } from './commands/config';
import { runListModels, runUseModel, runCurrentModel, getStableChatGptModels, runListStableModels } from './commands/model';
import { listAvailableModels } from './services/llm';
import { renderHeader, renderDivider } from './ui/layout';

const program = new Command();

program.name('flux').description('FactStream financials CLI').version('0.1.0');

const INTERACTIVE_SUGGESTIONS = [
  '/',
  'Analyze AAPL growth',
  'Compare AAPL vs MSFT',
  'set-up model',
  'model list',
  'model list-stable',
  'model current',
  'model use gpt-4o-mini',
  'exit'
];

type SlashCommand = {
  name: string;
  description: string;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'Show command list and usage examples' },
  { name: '/set-key', description: 'Set FactStream API key quickly' },
  { name: '/llm-key-help', description: 'Show how to set OPENAI_API_KEY / LLM_API_KEY' },
  { name: '/model-setup', description: 'Interactive model setup wizard' },
  { name: '/model-list', description: 'List available models' },
  { name: '/model-stable', description: 'List stable models only' },
  { name: '/model-current', description: 'Show active model' },
  { name: '/model-use', description: 'Pick a model by name' },
  { name: '/examples', description: 'Show ask query examples' }
];

function getSlashCommandOptions(filter: string = ''): string[] {
  const needle = filter.trim().toLowerCase();
  return SLASH_COMMANDS
    .filter((cmd) => !needle || cmd.name.toLowerCase().startsWith(needle))
    .map((cmd) => `${cmd.name}  -  ${cmd.description}`);
}

function extractSlashCommandName(option: string): string {
  return option.split('  -  ')[0].trim();
}

function printSlashCommands(filter: string = '') {
  const options = getSlashCommandOptions(filter);
  if (options.length === 0) {
    console.log(chalk.yellow('No slash commands matched. Try just "/" to view all commands.'));
    return;
  }
  console.log(chalk.bold.cyan('\nSlash commands\n'));
  for (const row of options) {
    const [name, description] = row.split('  -  ');
    console.log(`${chalk.cyan(name)} ${chalk.gray('-')} ${chalk.gray(description || '')}`);
  }
  console.log('');
}

function hasLlmKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
}

function printInitScreen() {
  renderHeader();
  process.stdout.write(`${chalk.bold.white('Tips to get started')}\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} Ask anything, e.g. ${chalk.italic.gray('"Analyze Apple growth with latest news"')}\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} Type ${chalk.cyan('/')} to open the command palette\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/set-key')}      Configure FactStream API key\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/model-setup')}  Pick your LLM model\n`);
  process.stdout.write(`  ${chalk.hex('#00ff99')('›')} ${chalk.cyan('/help')}         Show all slash commands\n`);
  process.stdout.write('\n');
}

function printKeyStatus() {
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

async function selectFromMenu(title: string, options: string[]): Promise<string | null> {
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

async function startInteractiveCli(): Promise<void> {
  printInitScreen();
  printKeyStatus();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 200,
    completer: (line: string) => {
      const lowered = (line || '').toLowerCase();
      if (lowered.startsWith('/')) {
        const slashHits = SLASH_COMMANDS.map((c) => c.name).filter((c) => c.startsWith(lowered));
        return [slashHits.length > 0 ? slashHits : SLASH_COMMANDS.map((c) => c.name), line];
      }
      const hits = INTERACTIVE_SUGGESTIONS.filter((c) => c.toLowerCase().startsWith(lowered));
      return [hits.length > 0 ? hits : INTERACTIVE_SUGGESTIONS, line];
    }
  });

  let escapeArmed = false;
  let emptyCount = 0;
  let suggestionIndex = -1;
  let paletteActive = false;

  const applySuggestion = (text: string) => {
    rl.write('', { ctrl: true, name: 'u' });
    rl.write(text);
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const onKeyPress = (_str: string, key: readline.Key) => {
    if (paletteActive) return;
    if (key && (key.name === 'up' || key.name === 'down')) {
      const current = (rl.line || '').trim();
      if (!current) {
        if (key.name === 'up') {
          suggestionIndex = (suggestionIndex + 1) % INTERACTIVE_SUGGESTIONS.length;
        } else {
          suggestionIndex = suggestionIndex <= 0 ? INTERACTIVE_SUGGESTIONS.length - 1 : suggestionIndex - 1;
        }
        applySuggestion(INTERACTIVE_SUGGESTIONS[suggestionIndex]);
      }
    }

    if (key && key.name === 'escape') {
      escapeArmed = true;
      emptyCount = 0;
      console.log(`\n${chalk.yellow('Escape detected. Press Enter twice to exit.')}`);
      rl.prompt();
    }
  };

  process.stdin.on('keypress', onKeyPress);

  rl.setPrompt(chalk.hex('#00ff99').bold('flux> '));
  rl.prompt();

  async function askInCli(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
  }

  async function runModelSetupWizard(): Promise<void> {
    const providers = ['chatGPT', 'Claude (Comming soon...)', 'Grok (Comming soom...)', 'Local llms (comming soon...)'];
    const selectedProvider = await selectFromMenu('Set-up model - Chon Provider', providers);
    if (!selectedProvider || selectedProvider !== 'chatGPT') {
      console.log(chalk.yellow('Provider nay sap co. Vui long chon 1 (chatGPT).'));
      return;
    }

    let stableModels: string[] = [];
    try {
      stableModels = getStableChatGptModels(await listAvailableModels());
    } catch (e: any) {
      console.log(chalk.red(e?.message || 'Khong the lay danh sach model.'));
      return;
    }

    if (stableModels.length === 0) {
      console.log(chalk.yellow('Khong co stable ChatGPT model nao duoc tra ve.'));
      return;
    }

    const preferred = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'];
    const options: string[] = [];
    for (const p of preferred) {
      const found = stableModels.find((m) => m === p);
      if (found && !options.includes(found)) options.push(found);
      if (options.length === 3) break;
    }
    for (const m of stableModels) {
      if (options.length === 3) break;
      if (!options.includes(m)) options.push(m);
    }

    const selectedModel = await selectFromMenu('Set-up model - Chon ChatGPT Model', options);
    if (!selectedModel) {
      console.log(chalk.yellow('Lua chon bi huy.'));
      return;
    }

    runUseModel(selectedModel);
  }

  async function showInlinePalette(filter: string = ''): Promise<string | null> {
    const filtered = filter
      ? SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(filter.toLowerCase()))
      : [...SLASH_COMMANDS];
    if (filtered.length === 0) return null;

    const MAX_VISIBLE = Math.min(filtered.length, 8);
    let selectedIdx = 0;
    let scrollOffset = 0;
    const HINT_LINE = 1;
    const TOTAL_LINES = MAX_VISIBLE + HINT_LINE;
    const NAME_WIDTH = filtered.reduce((m, c) => Math.max(m, c.name.length), 0) + 2;

    const clearLines = (n: number) => {
      for (let i = 0; i < n; i++) {
        process.stdout.write('\x1b[A\x1b[2K');
      }
    };

    const renderMenu = (isFirst: boolean) => {
      if (!isFirst) clearLines(TOTAL_LINES);
      const visible = filtered.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
      for (let i = 0; i < MAX_VISIBLE; i++) {
        if (i < visible.length) {
          const cmd = visible[i];
          const absIdx = scrollOffset + i;
          const name = cmd.name.padEnd(NAME_WIDTH);
          if (absIdx === selectedIdx) {
            process.stdout.write(`  ${chalk.bgHex('#00ff99').black(` ▶ ${name}`)}  ${chalk.white(cmd.description)}\n`);
          } else {
            process.stdout.write(`  ${chalk.gray(`   ${name}`)}  ${chalk.gray(cmd.description)}\n`);
          }
        } else {
          process.stdout.write('\n');
        }
      }
      process.stdout.write(chalk.gray('  ↑↓ navigate  ·  Enter select  ·  Esc cancel\n'));
    };

    return new Promise((resolve) => {
      paletteActive = true;
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      renderMenu(true);

      const done = (result: string | null) => {
        process.stdin.off('keypress', onPaletteKey);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        clearLines(TOTAL_LINES);
        paletteActive = false;
        resolve(result);
      };

      const onPaletteKey = (_: string, key: readline.Key) => {
        if (!key) return;
        if (key.name === 'up') {
          selectedIdx = selectedIdx <= 0 ? filtered.length - 1 : selectedIdx - 1;
          if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;
          else if (selectedIdx >= scrollOffset + MAX_VISIBLE) scrollOffset = selectedIdx - MAX_VISIBLE + 1;
          renderMenu(false);
        } else if (key.name === 'down') {
          selectedIdx = (selectedIdx + 1) % filtered.length;
          if (selectedIdx < scrollOffset) scrollOffset = 0;
          else if (selectedIdx >= scrollOffset + MAX_VISIBLE) scrollOffset = selectedIdx - MAX_VISIBLE + 1;
          renderMenu(false);
        } else if (key.name === 'return') {
          done(filtered[selectedIdx].name);
        } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
          done(null);
        }
      };

      process.stdin.on('keypress', onPaletteKey);
    });
  }

  async function runSlashCommand(rawInput: string): Promise<boolean> {
    const lowered = rawInput.trim().toLowerCase();
    if (!lowered.startsWith('/')) return false;

    const matched = SLASH_COMMANDS.find((c) => c.name === lowered);
    if (!matched) {
      const choices = SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(lowered));
      if (choices.length === 0) {
        console.log(chalk.yellow('Unknown slash command. Type "/" to open command list.'));
        return true;
      }
      const picked = await showInlinePalette(lowered);
      if (!picked) return true;
      return runSlashCommand(picked);
    }

    if (lowered === '/help' || lowered === '/') {
      printSlashCommands();
      return true;
    }
    if (lowered === '/examples') {
      console.log(chalk.bold.cyan('\nExamples\n'));
      console.log(chalk.gray('- ') + chalk.cyan('Analyze Apple growth with latest news'));
      console.log(chalk.gray('- ') + chalk.cyan('Compare TSLA vs NVDA profitability'));
      console.log(chalk.gray('- ') + chalk.cyan('Why did MSFT move this quarter?'));
      console.log('');
      return true;
    }
    if (lowered === '/set-key') {
      const key = await askInCli('Enter FactStream API key: ');
      if (!key) {
        console.log(chalk.yellow('No key entered.'));
        return true;
      }
      runSetKey(key);
      return true;
    }
    if (lowered === '/llm-key-help') {
      console.log(chalk.bold.cyan('\nLLM key setup\n'));
      console.log(chalk.gray('macOS/Linux: ') + chalk.cyan('export OPENAI_API_KEY=YOUR_KEY'));
      console.log(chalk.gray('or:          ') + chalk.cyan('export LLM_API_KEY=YOUR_KEY'));
      console.log('');
      return true;
    }
    if (lowered === '/model-setup') {
      await runModelSetupWizard();
      return true;
    }
    if (lowered === '/model-list') {
      await runListModels();
      return true;
    }
    if (lowered === '/model-stable') {
      await runListStableModels();
      return true;
    }
    if (lowered === '/model-current') {
      runCurrentModel();
      return true;
    }
    if (lowered === '/model-use') {
      const model = await askInCli('Enter model name (e.g. gpt-4o-mini): ');
      if (!model) {
        console.log(chalk.yellow('No model entered.'));
        return true;
      }
      runUseModel(model);
      return true;
    }

    return true;
  }

  await new Promise<void>((resolve) => {
    rl.on('line', async (line: string) => {
      const input = line.trim();

      if (input === '') {
        emptyCount += 1;
        if ((escapeArmed && emptyCount >= 2) || emptyCount >= 2) {
          console.log(chalk.green('Goodbye from FLUX.'));
          rl.close();
          return;
        }
        rl.prompt();
        return;
      }

      emptyCount = 0;
      suggestionIndex = -1;

      const lower = input.toLowerCase();

      if (lower === '/') {
        const picked = await showInlinePalette();
        if (picked) {
          await runSlashCommand(picked);
        }
        rl.prompt();
        return;
      }

      if (lower.startsWith('/')) {
        await runSlashCommand(lower);
        rl.prompt();
        return;
      }

      if (lower === 'escape' || lower === 'esc') {
        escapeArmed = true;
        console.log(chalk.yellow('Escape armed. Press Enter twice to exit.'));
        rl.prompt();
        return;
      }

      if (lower === 'exit' || lower === 'quit' || lower === ':q') {
        console.log(chalk.green('Goodbye from FLUX.'));
        rl.close();
        return;
      }

      if (lower === 'models' || lower === 'model list') {
        try {
          await runListModels();
        } catch (e: any) {
          console.log(chalk.red(e?.message || 'Unable to list models.'));
        }
        rl.prompt();
        return;
      }

      if (lower === 'model list-stable') {
        try {
          await runListStableModels();
        } catch (e: any) {
          console.log(chalk.red(e?.message || 'Unable to list stable models.'));
        }
        rl.prompt();
        return;
      }

      if (lower === 'set-up model' || lower === 'setup model' || lower === 'model setup') {
        await runModelSetupWizard();
        rl.prompt();
        return;
      }

      if (lower === 'model current') {
        runCurrentModel();
        rl.prompt();
        return;
      }

      if (lower.startsWith('model use ')) {
        const model = input.slice('model use '.length).trim();
        runUseModel(model);
        rl.prompt();
        return;
      }

      escapeArmed = false;
      try {
        await runAsk(input);
      } catch (e: any) {
        console.log(e?.message || 'Request failed.');
      }
      rl.prompt();
    });

    rl.on('close', () => {
      process.stdin.off('keypress', onKeyPress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve();
    });
  });
}

program.action(() => {
  printInitScreen();
});

program.hook('preAction', (_thisCommand, actionCommand) => {
  if (actionCommand === program) return;
  const root = actionCommand.parent;
  const parentName = root?.name();
  const commandName = actionCommand.name();
  const isConfigSetKey = parentName === 'config' && commandName === 'set-key';
  const isModelCommand = parentName === 'model' || commandName === 'model';
  const isLogin = commandName === 'login';
  if (!isConfigSetKey && !isLogin && !isModelCommand) {
    ensureApiKeyOrExit();
  }
});

const configCommand = program.command('config').description('Manage local FinCLI configuration');
configCommand
  .command('set-key')
  .argument('<key>')
  .description('Store FactStream API key locally')
  .action((key: string) => {
    runSetKey(key);
    console.log('Tip: export OPENAI_API_KEY=YOUR_LLM_KEY for flux ask mode.');
  });

const modelCommand = program.command('model').description('Manage ChatGPT model selection for flux ask');
modelCommand
  .command('list')
  .description('List available ChatGPT models')
  .action(() => {
    runListModels().catch((e: any) => {
      console.error(e?.message || 'Unable to list models.');
      process.exit(1);
    });
  });

modelCommand
  .command('list-stable')
  .description('List stable ChatGPT models only')
  .action(() => {
    runListStableModels().catch((e: any) => {
      console.error(e?.message || 'Unable to list stable models.');
      process.exit(1);
    });
  });

modelCommand
  .command('setup')
  .description('Interactive setup: choose provider then choose stable model')
  .action(async () => {
    const providers = ['chatGPT', 'Claude (Comming soon...)', 'Grok (Comming soom...)', 'Local llms (comming soon...)'];
    const selectedProvider = await selectFromMenu('Set-up model - Chon Provider', providers);
    if (!selectedProvider || selectedProvider !== 'chatGPT') {
      console.log(chalk.yellow('Provider nay sap co. Vui long chon 1 (chatGPT).'));
      return;
    }

    try {
      const stableModels = getStableChatGptModels(await listAvailableModels());
      if (stableModels.length === 0) {
        console.log(chalk.yellow('Khong co stable ChatGPT model nao duoc tra ve.'));
        return;
      }

      const preferred = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'];
      const options: string[] = [];
      for (const p of preferred) {
        const found = stableModels.find((m) => m === p);
        if (found && !options.includes(found)) options.push(found);
        if (options.length === 3) break;
      }
      for (const m of stableModels) {
        if (options.length === 3) break;
        if (!options.includes(m)) options.push(m);
      }

      const selectedModel = await selectFromMenu('Set-up model - Chon ChatGPT Model', options);
      if (!selectedModel) {
        console.log(chalk.yellow('Lua chon bi huy.'));
        return;
      }

      runUseModel(selectedModel);
    } catch (e: any) {
      console.error(e?.message || 'Setup model failed.');
      process.exitCode = 1;
    }
  });

modelCommand
  .command('use')
  .argument('<model>')
  .description('Set active model for ask command')
  .action((model: string) => runUseModel(model));

modelCommand
  .command('current')
  .description('Show current active model')
  .action(() => runCurrentModel());

program
  .command('ask')
  .argument('<query>')
  .description('Ask FinCLI to parse intent, fetch data, and analyze')
  .action((query: string) => {
    runAsk(query).catch(() => process.exit(1));
  });

program
  .command('login')
  .argument('<apiKey>')
  .description('Save API key')
  .action((apiKey: string) => runLogin(apiKey));

program
  .command('insight')
  .argument('<ticker>')
  .description('Show rule-based insights for a ticker')
  .action((ticker: string) => runInsight(ticker));

program
  .command('compare')
  .argument('<tickers...>')
  .description('Compare two or more tickers')
  .option('--period <type>', "Period type: 'quarter' (default) or 'annual'", 'quarter')
  .option('--align <mode>', "Align by 'fiscal' (default) or 'calendar'", 'fiscal')
  .description('Compare two or more tickers')
  .action((tickers: string[], options: any) => runCompare(tickers, options));

program
  .command('trend')
  .argument('<ticker>')
  .description('Show simple ASCII trend for revenue')
  .action((ticker: string) => runTrend(ticker));

program
  .command('tweet')
  .argument('<ticker>')
  .description('Short, shareable summary')
  .action((ticker: string) => runTweet(ticker));

program
  .command('quote')
  .argument('<ticker>')
  .option('--history', 'Show historical data')
  .option('--json', 'Print raw JSON response')
  .description('Fetch financials for a ticker')
  .action((ticker: string, options: any) => {
    runGet(ticker, options).catch(() => process.exit(1));
  });

program
  .argument('[ticker]')
  .option('--history', 'Show historical data')
  .option('--json', 'Print raw JSON response')
  .description('Fetch financials for a ticker')
  .action((ticker: string | undefined, options: any) => {
    if (!ticker) {
      printInitScreen();
      return;
    }
    ensureApiKeyOrExit();
    runGet(ticker, options).catch(() => process.exit(1));
  });

async function main() {
  if (process.argv.length <= 2) {
    await startInteractiveCli();
    return;
  }
  program.parse(process.argv);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
