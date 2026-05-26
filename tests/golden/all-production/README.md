# all-production

A [Spectrum](https://photon.codes/docs/spectrum-ts) project. Wired with: iMessage, WhatsApp Business.

## Environment

Before running, copy `.env.example` to `.env` and fill in the values:

```sh
cp .env.example .env
```

From your project Settings on the [Photon dashboard](https://photon.codes):

- `PROJECT_ID`
- `PROJECT_SECRET`

## Run

```sh
bun install
bun start
```

## Where to go next

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Edit `src/index.ts` to replace the echo loop with real agent logic.
- Add more providers from `spectrum-ts/providers/*`.
