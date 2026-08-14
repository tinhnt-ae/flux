import { Command } from 'commander';
import { run as runGet } from '../commands/getFinancials';
import { run as runLogin } from '../commands/login';
import { run as runInsight } from '../commands/insight';
import { run as runCompare } from '../commands/compare';
import { run as runTrend } from '../commands/trend';
import { run as runTweet } from '../commands/tweet';
import { run as runAsk } from '../commands/ask';
import { runSetKey } from '../commands/config';
import { runCurrentModel, runListModels, runListStableModels, runUseModel } from '../commands/model';
import { ensureApiKeyOrExit } from '../utils/config';
import { getErrorMessage } from '../utils/errors';
import type { CompareOptions, QuoteOptions } from '../types/domain';
import { runModelSetupWizard } from './modelSetup';
import { printInitScreen } from './screen';

export function createProgram(): Command {
  const program = new Command();

  program.name('flux').description('FactStream financials CLI').version('0.1.0');

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
      runListModels().catch((error: unknown) => {
        console.error(getErrorMessage(error, 'Unable to list models.'));
        process.exit(1);
      });
    });

  modelCommand
    .command('list-stable')
    .description('List stable ChatGPT models only')
    .action(() => {
      runListStableModels().catch((error: unknown) => {
        console.error(getErrorMessage(error, 'Unable to list stable models.'));
        process.exit(1);
      });
    });

  modelCommand
    .command('setup')
    .description('Interactive setup: choose provider then choose stable model')
    .action(async () => {
      try {
        await runModelSetupWizard();
      } catch (error: unknown) {
        console.error(getErrorMessage(error, 'Setup model failed.'));
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
    .action((tickers: string[], options: CompareOptions) => runCompare(tickers, options));

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
    .action((ticker: string, options: QuoteOptions) => {
      runGet(ticker, options).catch(() => process.exit(1));
    });

  program
    .argument('[ticker]')
    .option('--history', 'Show historical data')
    .option('--json', 'Print raw JSON response')
    .description('Fetch financials for a ticker')
    .action((ticker: string | undefined, options: QuoteOptions) => {
      if (!ticker) {
        printInitScreen();
        return;
      }
      ensureApiKeyOrExit();
      runGet(ticker, options).catch(() => process.exit(1));
    });

  return program;
}
