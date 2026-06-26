# create-spectrum-project

Scaffolds a new [Spectrum](https://photon.codes/docs/spectrum-ts/introduction) project: providers wired up, dependencies installed, and a runnable echo loop on the first command.

## Interactive

```sh
bun create spectrum-project@latest
# or
npm create spectrum-project@latest
# or
pnpm create spectrum-project@latest
# or
yarn create spectrum-project@latest
```

You'll be asked for:

- Which interface (terminal sandbox, iMessage, Telegram, or WhatsApp Business)
- Your package manager (auto-detected)
- Whether to install dependencies and initialize git
- Whether to install the `spectrum` agent skill (default: yes)

The generated project includes `src/index.ts` with the selected providers wired in, a `package.json` pinned to the current `spectrum-ts` release, an `AGENTS.md` + `CLAUDE.md` so AI coding agents have project context immediately, the `spectrum` skill from [`photon-hq/skills`](https://github.com/photon-hq/skills) installed locally, a ready-to-fill `.env` (plus a tracked `.env.example`) for any required credentials, and an echo loop that runs on `bun start`.

## Non-interactive

Pass flags to skip prompts. Run `bun create spectrum-project@latest --help` for the full list.

```
Usage: create-spectrum-project [directory] [options]

Options:
  --platforms <list>   Comma-separated keys: terminal, imessage, telegram, whatsapp-business
                       (alias: --providers)
  --pm <m>             bun | npm | pnpm | yarn (default: detected)
  --no-install         Skip dependency install
  --no-git             Skip git init
  --no-skills          Skip Spectrum skill install
  -y, --yes            Use defaults; skip interactive prompts
  --verbose            Stream install stdout/stderr
  -h, --help           Show help
  --version            Show version
```

Defaults (applied by `-y` and as fallbacks for any flag you don't set):

- Directory: `my-spectrum-app`
- Providers: `imessage` (first platform in the manifest)
- Package manager: detected from your shell, otherwise `bun`
- Install dependencies: yes
- Initialize git: yes
- Install Spectrum skill: yes

Examples:

```sh
# iMessage, no prompts, all defaults
bun create spectrum-project@latest -y

# Terminal sandbox (dev TUI, no credentials)
bun create spectrum-project@latest my-app --platforms terminal

# iMessage + WhatsApp on pnpm, skip git
bun create spectrum-project@latest my-app --platforms imessage,whatsapp-business --pm pnpm --no-git
```

## Requirements

Bun 1.3+ or Node 20+.

## License

MIT
