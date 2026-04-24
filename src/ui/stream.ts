type StreamWriterOptions = {
  showCursor?: boolean;
  cursorChar?: string;
  typingMs?: number;
  thinkingMode?: boolean; // variable pauses between tokens
};

export class StreamWriter {
  private started = false;
  private readonly showCursor: boolean;
  private readonly cursorChar: string;
  private readonly typingMs: number;
  private cursorVisible = false;
  private typingTimer: NodeJS.Timeout | null = null;
  private buffer = '';
  private currentCol = 0;

  private readonly thinkingMode: boolean;
  private lastCharWasPunct = false;

  constructor(options?: StreamWriterOptions) {
    this.showCursor = Boolean(options?.showCursor) && Boolean(process.stdout.isTTY);
    this.cursorChar = options?.cursorChar ?? '▌';
    this.typingMs = options?.typingMs ?? 22;
    this.thinkingMode = options?.thinkingMode ?? true;
  }

  write(chunk: string): void {
    if (!this.started) {
      this.started = true;
    }
    this.buffer += chunk;
    this.startTyping();
  }

  async end(): Promise<void> {
    await this.flush();
    this.stopTyping();
    if (this.showCursor && this.cursorVisible) {
      process.stdout.write('\b \b');
      this.cursorVisible = false;
    }
    if (this.started) { process.stdout.write('\n'); this.currentCol = 0; }
  }

  async abort(): Promise<void> {
    this.buffer = '';
    this.stopTyping();
    if (this.showCursor && this.cursorVisible) {
      process.stdout.write('\b \b');
      this.cursorVisible = false;
    }
    if (this.started) { process.stdout.write('\n'); this.currentCol = 0; }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (this.buffer.length === 0) {
          resolve();
          return;
        }
        setTimeout(wait, this.typingMs);
      };
      wait();
    });
  }

  private termCols(): number {
    const cols = process.stdout.columns;
    return cols && Number.isFinite(cols) && cols > 20 ? cols - 2 : 78;
  }

  /** Length of visible chars in the next word (up to the next space/newline). */
  private nextWordLength(): number {
    let i = 0;
    let len = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i];
      if (ch === ' ' || ch === '\n' || ch === '\r') break;
      if (ch === '\u001b') {
        const rest = this.buffer.slice(i);
        const m = rest.match(/^\u001b\[[0-9;]*m/);
        if (m) { i += m[0].length; continue; }
      }
      len++;
      i++;
    }
    return len;
  }

  private emitChar(ch: string): void {
    if (this.showCursor && this.cursorVisible) {
      process.stdout.write('\b \b');
      this.cursorVisible = false;
    }

    if (ch === '\n' || ch === '\r\n') {
      process.stdout.write('\n');
      this.currentCol = 0;
    } else if (ch.startsWith('\u001b')) {
      // ANSI escape — no column change
      process.stdout.write(ch);
    } else if (ch === ' ') {
      const cols = this.termCols();
      const nextLen = this.nextWordLength();
      if (nextLen > 0 && this.currentCol + 1 + nextLen > cols) {
        // Next word won't fit — wrap here instead of writing the space
        process.stdout.write('\n');
        this.currentCol = 0;
      } else {
        process.stdout.write(' ');
        this.currentCol++;
      }
    } else {
      const cols = this.termCols();
      if (this.currentCol >= cols) {
        process.stdout.write('\n');
        this.currentCol = 0;
      }
      process.stdout.write(ch);
      this.currentCol++;
    }

    if (this.showCursor && ch !== '\n') {
      process.stdout.write(this.cursorChar);
      this.cursorVisible = true;
    }
  }

  private scheduleNext(): void {
    if (this.buffer.length === 0) {
      this.typingTimer = null;
      return;
    }
    const unit = this.nextUnit();
    // Empty unit means either buffer is empty OR we're waiting for the rest
    // of a split ANSI sequence — distinguish the two cases.
    if (!unit) {
      if (this.buffer.length > 0) {
        // Incomplete ANSI sequence — poll again shortly
        this.typingTimer = setTimeout(() => this.scheduleNext(), this.typingMs);
      } else {
        this.typingTimer = null;
      }
      return;
    }

    let delay = this.typingMs;
    if (this.thinkingMode) {
      const ch = unit[0];
      if (this.lastCharWasPunct) {
        // pause after sentence-ending punctuation
        delay = 180 + Math.random() * 120;
      } else if (ch === ' ') {
        delay = this.typingMs + Math.random() * 18;
      } else if (ch === ',' || ch === ';' || ch === ':') {
        delay = 60 + Math.random() * 40;
      } else {
        delay = this.typingMs + Math.random() * 12;
      }
      this.lastCharWasPunct = (ch === '.' || ch === '!' || ch === '?');
    }

    this.emitChar(unit);
    this.typingTimer = setTimeout(() => this.scheduleNext(), delay);
  }

  private startTyping(): void {
    if (this.typingTimer) return;
    this.typingTimer = setTimeout(() => this.scheduleNext(), this.typingMs);
  }

  private stopTyping(): void {
    if (!this.typingTimer) return;
    clearTimeout(this.typingTimer);
    this.typingTimer = null;
  }

  private nextUnit(): string {
    if (this.buffer.length === 0) return '';
    if (this.buffer[0] !== '\u001b') {
      const ch = this.buffer[0];
      this.buffer = this.buffer.slice(1);
      return ch;
    }

    // Complete CSI sequence — emit atomically
    const match = this.buffer.match(/^\u001b\[[0-9;]*m/);
    if (match) {
      this.buffer = this.buffer.slice(match[0].length);
      return match[0];
    }

    // ESC byte is present but sequence is incomplete (split across stream chunks).
    // If the buffer could still become a valid CSI sequence, wait for more data.
    if (this.buffer.length === 1 || this.buffer[1] === '[') {
      return ''; // signal: hold, don't emit yet
    }

    // Unrecognised escape — emit the lone ESC and move on
    const ch = this.buffer[0];
    this.buffer = this.buffer.slice(1);
    return ch;
  }

}
