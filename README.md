# create-spectrum-app

Scaffold a new [Spectrum](https://photon.codes/docs/spectrum-ts/introduction) project in seconds.

```sh
bunx create-spectrum-app my-app
# or
npm create spectrum-app@latest my-app
```

Prompts for:

- Which providers to wire up (terminal, iMessage, WhatsApp Business)
- Package manager (auto-detected)
- Whether to install dependencies and initialize git

Generates a working `src/index.ts` with the selected providers, a `package.json` pinned to the current `spectrum-ts` release, and a runnable echo loop.

## Status

Pre-release.

## License

MIT
