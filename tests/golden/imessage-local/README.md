# imessage-local

A [Spectrum](https://photon.codes/docs/spectrum-ts) project. Wired with: iMessage (local).

## Run

```sh
bun install
bun start
```

## Local iMessage mode

Requires:

- macOS only (reads `~/Library/Messages/chat.db` directly)
- Your terminal needs **Full Disk Access**: System Settings → Privacy & Security → Full Disk Access
- Reduced features: text + attachments only (no reactions, typing indicators, threaded replies, group ops)

## Where to go next

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Edit `src/index.ts` to replace the echo loop with real agent logic.
- Add more providers from `spectrum-ts/providers/*`.
