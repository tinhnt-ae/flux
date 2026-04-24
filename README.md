# Flux — Financial Intelligence CLI

AI-powered financial analysis CLI. Ask questions in plain English, get structured analysis backed by real financial data and live news.

```
◆ FLUX  Financial Intelligence CLI  v0.1.0
  Powered by AI · stock analysis, financials, and live news
```

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Setup](#setup)
- [Interactive Shell](#interactive-shell)
- [Slash Commands](#slash-commands)
- [Model Management](#model-management)
- [Direct CLI Commands](#direct-cli-commands)
- [Configuration Reference](#configuration-reference)
- [Architecture](#architecture)

---

## Requirements

- Node.js 18+
- A FactStream API key
- An OpenAI API key (or compatible LLM endpoint)

---

## Installation

```bash
git clone <repo>
cd flux
npm install
npm run build
npm link          # makes `flux` available globally
```

---

## Setup

### 1. FactStream API key

```bash
flux config set-key YOUR_FACTSTREAM_KEY
```

Or via environment variable:

```bash
export FACTSTREAM_API_KEY=YOUR_FACTSTREAM_KEY
```

### 2. LLM API key

```bash
export OPENAI_API_KEY=YOUR_OPENAI_KEY
```

Also supported: `LLM_API_KEY` as an alias.

### 3. (Optional) `.env` file

Create a `.env` in the project root:

```env
FACTSTREAM_API_KEY=your_factstream_key
OPENAI_API_KEY=your_openai_key
LLM_MODEL=gpt-4o-mini
```

Config priority: **environment variables → `.env` → `~/.fincli/config.json`**

---

## Interactive Shell

Run without arguments to enter the interactive shell:

```bash
flux
```

The shell starts with a header and quick-start tips, then drops into a persistent prompt:

```
flux>
```

Type any natural language financial query and press Enter:

```
flux> Analyze Apple growth with latest news
flux> Compare Tesla vs Nvidia profitability
flux> Why has Microsoft stock risen recently?
```

### Input hints

- Press `↑` / `↓` on an **empty prompt** to cycle through suggested queries
- Start typing `/` to filter and pick a slash command
- Type `exit`, `quit`, or `:q` to leave
- Press **Escape** then **Enter twice** to exit

---

## Slash Commands

Type `/` and press Enter to open the interactive command palette. Use `↑` `↓` to navigate, `Enter` to select, `Esc` to cancel.

You can also type a partial command and press Enter to open a filtered palette (e.g. `/model` shows only model-related commands).

| Command          | Description                               |
| ---------------- | ----------------------------------------- |
| `/help`          | Show all slash commands                   |
| `/set-key`       | Set FactStream API key                    |
| `/llm-key-help`  | Instructions for setting `OPENAI_API_KEY` |
| `/model-setup`   | Interactive model selection wizard        |
| `/model-list`    | List all available models                 |
| `/model-stable`  | List stable models only                   |
| `/model-current` | Show the active model                     |
| `/model-use`     | Pick a model by name                      |
| `/examples`      | Show example analysis queries             |

---

## Model Management

### Via slash commands (interactive shell)

```
flux> /model-setup
```

Arrow-key wizard: pick provider → pick model → saved automatically.

### Via CLI subcommands

```bash
flux model list              # All available models
flux model list-stable       # Stable ChatGPT models only
flux model current           # Show active model
flux model use gpt-4o-mini   # Set active model
```

Default model: `gpt-4o-mini`

Supported providers: OpenAI (ChatGPT). Claude, Grok, and local LLMs coming soon.

---

## Direct CLI Commands

### Ask — main analysis command

```bash
flux ask "<natural language query>"
```

**Examples:**

```bash
flux ask "Analyze Apple"
flux ask "Analyze Apple growth with latest news"
flux ask "Is Google profitable?"
flux ask "Compare Amazon and Walmart cashflow"
flux ask "Why has Microsoft stock risen recently?"
flux ask "Compare TSLA vs NVDA"
```

**What happens:**

1. LLM parses entities (company names or tickers) and intent
2. Company names are resolved to exchange tickers via Yahoo Finance
3. Financial statements are fetched from FactStream (latest + previous quarter)
4. News is fetched from SearXNG if the query mentions news/context
5. LLM generates a structured analysis streamed to the terminal
6. Output includes: Market Brief snapshot + full Analysis section

**Off-topic or unrecognized input** is caught gracefully — the CLI prints a hint and returns to the prompt without running the pipeline.

### Config

```bash
flux config set-key YOUR_API_KEY   # Store FactStream API key
```

### Legacy commands

These use the FactStream API directly without LLM analysis:

```bash
flux quote AAPL
flux insight AAPL
flux compare AAPL MSFT --period quarter
flux trend AAPL
flux tweet AAPL
```

---

## Configuration Reference

Settings are stored in `~/.fincli/config.json`:

```json
{
  "apiKey": "your-factstream-key",
  "llmModel": "gpt-4o-mini"
}
```

| Variable             | Source                | Description                                                  |
| -------------------- | --------------------- | ------------------------------------------------------------ |
| `FACTSTREAM_API_KEY` | env / `.env` / config | FactStream API key                                           |
| `OPENAI_API_KEY`     | env / `.env`          | OpenAI API key                                               |
| `LLM_API_KEY`        | env / `.env`          | Alias for `OPENAI_API_KEY`                                   |
| `LLM_MODEL`          | env / `.env` / config | Model to use (default: `gpt-4o-mini`)                        |
| `LLM_BASE_URL`       | env / `.env`          | Override API base URL (default: `https://api.openai.com/v1`) |

---

## Architecture

```
src/
├── index.ts              # CLI entrypoint, interactive shell, slash commands
├── commands/
│   ├── ask.ts            # Main analysis pipeline
│   ├── config.ts         # Config subcommands
│   ├── model.ts          # Model management subcommands
│   ├── getFinancials.ts  # Legacy financials command
│   ├── insight.ts        # Legacy insight command
│   ├── compare.ts        # Legacy compare command
│   ├── trend.ts          # Legacy trend command
│   └── tweet.ts          # Legacy tweet command
├── services/
│   ├── llm.ts            # LLM calls: entity parsing, streaming analysis
│   ├── factstream.ts     # FactStream API client
│   ├── resolver.ts       # Company name → ticker resolution (Yahoo Finance)
│   └── news.ts           # News fetch via SearXNG
├── ui/
│   ├── layout.ts         # Header, divider, analysis header
│   ├── stream.ts         # StreamWriter: typewriter output with word-wrap
│   └── fluxLoader.ts     # Braille spinner + Flux bouncing animation
└── utils/
    ├── config.ts         # API key storage, model config (conf)
    ├── format.ts         # Currency and number formatting
    ├── growth.ts         # Percentage change helpers
    ├── parser.ts         # LLM response normalisation, metric extraction
    └── data.ts           # Safe field access helpers
```

### Ask pipeline (`commands/ask.ts`)

```
flux ask "query"
       │
       ▼
parseEntityIntent()     ← LLM: extract entities + off_topic flag
       │
       ├─ off_topic? → print hint, return
       ├─ no entities? → print hint, return
       │
       ▼
resolveTicker()         ← Yahoo Finance search (company → ticker)
       │
       ├─ no tickers resolved? → print hint, return
       │
       ▼
buildMinimalDataset()   ← FactStream: latest + previous quarter
fetchNewsParallel()     ← SearXNG (if include_news)
       │
       ▼
renderTickerInsightBlock()  ← Market Brief: revenue, income, FCF, trends
       │
       ▼
analyzeDataStream()     ← LLM streaming → StreamWriter typewriter output
```

### Key UI behaviors

- **StreamWriter**: character-by-character output with `thinkingMode` — variable delays after punctuation simulate reasoning pace
- **FluxLoader** `.start()`: braille spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` for quick steps
- **FluxLoader** `.animate()`: bouncing `[ Flux ]` animation for long-running analysis
- **Inline palette**: `/` opens a non-clearing overlay with `↑↓` navigation, no full-screen takeover
- **Word-wrap**: StreamWriter tracks column position and breaks at word boundaries using terminal width
