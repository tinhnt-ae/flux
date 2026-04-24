import chalk from 'chalk';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 80;

const FLUX_WORD = 'Flux';
const FLUX_TRACK = 14;   // inner width between the brackets
const FLUX_MS = 90;

function formatFluxFrame(pos: number): string {
  const left = ' '.repeat(pos);
  const right = ' '.repeat(Math.max(0, FLUX_TRACK - pos - FLUX_WORD.length));
  return chalk.hex('#28d7ff')(`[ ${left}${chalk.bold(FLUX_WORD)}${right} ]`);
}

export class FluxLoader {
  private timer: NodeJS.Timeout | null = null;
  private stepText = '';
  private spinIdx = 0;
  private fluxPos = 0;
  private fluxDir: 1 | -1 = 1;
  private mode: 'spinner' | 'flux' = 'spinner';
  private readonly interactive = Boolean(process.stdout.isTTY);

  /** Default step loader: braille spinner + label */
  start(stepText: string): void {
    this.stop();
    this.stepText = stepText;
    this.mode = 'spinner';
    this.spinIdx = 0;

    if (!this.interactive) {
      process.stdout.write(`${chalk.gray(stepText)}\n`);
      return;
    }

    this._renderSpinner();
    this.timer = setInterval(() => {
      this.spinIdx = (this.spinIdx + 1) % SPINNER_FRAMES.length;
      this._renderSpinner();
    }, SPINNER_MS);
  }

  /** Flux-style bouncing animation for long-running tasks */
  animate(stepText: string): void {
    this.stop();
    this.stepText = stepText;
    this.mode = 'flux';
    this.fluxPos = 0;
    this.fluxDir = 1;

    if (!this.interactive) {
      process.stdout.write(`${chalk.gray(stepText)}\n`);
      return;
    }

    this._renderFlux();
    this.timer = setInterval(() => {
      const max = FLUX_TRACK - FLUX_WORD.length;
      if (this.fluxPos >= max) this.fluxDir = -1;
      if (this.fluxPos <= 0) this.fluxDir = 1;
      this.fluxPos += this.fluxDir;
      this._renderFlux();
    }, FLUX_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ok(message: string): void {
    this.stop();
    this._clearLine();
    process.stdout.write(`${chalk.hex('#00ff99')('✔')} ${chalk.white(message)}\n`);
  }

  fail(message: string): void {
    this.stop();
    this._clearLine();
    process.stdout.write(`${chalk.red('✖')} ${chalk.white(message)}\n`);
  }

  private _renderSpinner(): void {
    const frame = chalk.hex('#28d7ff')(SPINNER_FRAMES[this.spinIdx]);
    process.stdout.write(`\r${frame} ${chalk.gray(this.stepText)}`);
  }

  private _renderFlux(): void {
    process.stdout.write(`\r${formatFluxFrame(this.fluxPos)}  ${chalk.gray(this.stepText)}`);
  }

  private _clearLine(): void {
    if (this.interactive) {
      process.stdout.write('\r\x1b[2K');
    }
  }
}

