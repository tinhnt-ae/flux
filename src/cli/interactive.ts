import readline from 'readline';
import chalk from 'chalk';
import { run as runAsk } from '../commands/ask';
import { runSetKey } from '../commands/config';
import { runCurrentModel, runListModels, runListStableModels, runUseModel } from '../commands/model';
import { getErrorMessage } from '../utils/errors';
import { runModelSetupWizard } from './modelSetup';
import { printInitScreen, printKeyStatus } from './screen';

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

function printSlashCommands(filter: string = ''): void {
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

export async function startInteractiveCli(): Promise<void> {
  printInitScreen();
  printKeyStatus();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 200,
    completer: (line: string) => {
      const lowered = (line || '').toLowerCase();
      if (lowered.startsWith('/')) {
        const slashHits = SLASH_COMMANDS.map((cmd) => cmd.name).filter((cmd) => cmd.startsWith(lowered));
        return [slashHits.length > 0 ? slashHits : SLASH_COMMANDS.map((cmd) => cmd.name), line];
      }
      const hits = INTERACTIVE_SUGGESTIONS.filter((cmd) => cmd.toLowerCase().startsWith(lowered));
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

  async function showInlinePalette(filter: string = ''): Promise<string | null> {
    const filtered = filter
      ? SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(filter.toLowerCase()))
      : [...SLASH_COMMANDS];
    if (filtered.length === 0) return null;

    const maxVisible = Math.min(filtered.length, 8);
    let selectedIdx = 0;
    let scrollOffset = 0;
    const hintLine = 1;
    const totalLines = maxVisible + hintLine;
    const nameWidth = filtered.reduce((max, cmd) => Math.max(max, cmd.name.length), 0) + 2;

    const clearLines = (lineCount: number) => {
      for (let i = 0; i < lineCount; i++) {
        process.stdout.write('\x1b[A\x1b[2K');
      }
    };

    const renderMenu = (isFirst: boolean) => {
      if (!isFirst) clearLines(totalLines);
      const visible = filtered.slice(scrollOffset, scrollOffset + maxVisible);
      for (let i = 0; i < maxVisible; i++) {
        if (i < visible.length) {
          const cmd = visible[i];
          const absIdx = scrollOffset + i;
          const name = cmd.name.padEnd(nameWidth);
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
        clearLines(totalLines);
        paletteActive = false;
        resolve(result);
      };

      const onPaletteKey = (_: string, key: readline.Key) => {
        if (!key) return;
        if (key.name === 'up') {
          selectedIdx = selectedIdx <= 0 ? filtered.length - 1 : selectedIdx - 1;
          if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;
          else if (selectedIdx >= scrollOffset + maxVisible) scrollOffset = selectedIdx - maxVisible + 1;
          renderMenu(false);
        } else if (key.name === 'down') {
          selectedIdx = (selectedIdx + 1) % filtered.length;
          if (selectedIdx < scrollOffset) scrollOffset = 0;
          else if (selectedIdx >= scrollOffset + maxVisible) scrollOffset = selectedIdx - maxVisible + 1;
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

    const matched = SLASH_COMMANDS.find((cmd) => cmd.name === lowered);
    if (!matched) {
      const choices = SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(lowered));
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
        } catch (error: unknown) {
          console.log(chalk.red(getErrorMessage(error, 'Unable to list models.')));
        }
        rl.prompt();
        return;
      }

      if (lower === 'model list-stable') {
        try {
          await runListStableModels();
        } catch (error: unknown) {
          console.log(chalk.red(getErrorMessage(error, 'Unable to list stable models.')));
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
      } catch (error: unknown) {
        console.log(getErrorMessage(error, 'Request failed.'));
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
