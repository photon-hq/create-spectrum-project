# create-spectrum-project

Scaffolds a new [Spectrum](https://photon.codes/docs/spectrum-ts/introduction) project: providers wired up, dependencies installed, and a runnable echo loop on the first command.

## Interactive

```sh
bunx create-spectrum-project my-app
# or
npm create spectrum-project@latest my-app
# or
pnpm create spectrum-project my-app
# or
yarn create spectrum-project my-app
```

You'll be asked for:

- Which interface (terminal sandbox, iMessage, or WhatsApp Business)
- Your package manager (auto-detected)
- Whether to install dependencies and initialize git

The generated project includes `src/index.ts` with the selected providers wired in, a `package.json` pinned to the current `spectrum-ts` release, a ready-to-fill `.env` (plus a tracked `.env.example`) for any required credentials, and an echo loop that runs on `bun start`.

## Non-interactive

Pass flags to skip prompts. Run `create-spectrum-project --help` for the full list.

```
Usage: create-spectrum-project [directory] [options]

Options:
  --providers <list>   Comma-separated keys: terminal, imessage, whatsapp-business
  --pm <m>             bun | npm | pnpm | yarn (default: detected)
  --no-install         Skip dependency install
  --no-git             Skip git init
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

Examples:

```sh
# iMessage, no prompts, all defaults
bunx create-spectrum-project -y

# Terminal sandbox (dev TUI, no credentials)
bunx create-spectrum-project my-app --providers terminal

# iMessage + WhatsApp on pnpm, skip git
bunx create-spectrum-project my-app --providers imessage,whatsapp-business --pm pnpm --no-git
```

## Requirements

Bun 1.3+ or Node 20+.

## License

MIT
