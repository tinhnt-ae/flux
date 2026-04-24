import chalk from 'chalk';

export function renderStepText(text: string): void {
  process.stdout.write(`${chalk.gray(text)}\n`);
}

export function renderStepOk(text: string): void {
  process.stdout.write(`${chalk.green('[ OK ]')} ${chalk.white(text)}\n`);
}

export function renderStepFail(text: string): void {
  process.stdout.write(`${chalk.red('[FAIL]')} ${chalk.white(text)}\n`);
}

export async function pauseStep(minMs: number = 200, maxMs: number = 500): Promise<void> {
  const wait = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, wait));
}
