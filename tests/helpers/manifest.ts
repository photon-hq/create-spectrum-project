import type { Manifest } from "~/scaffold.ts";

/**
 * Fixture manifest mirroring spectrum-ts@1.13.0's published manifest at the
 * time create-spectrum-project v1 was written. Tests use this so they're not
 * coupled to whatever the live manifest happens to be on any given run.
 *
 * Keep in sync with the bundled `FALLBACK_MANIFEST` in src/scaffold.ts so
 * "what tests assert" matches "what users get when offline".
 */
export const FIXTURE_MANIFEST: Manifest = [
  {
    key: "imessage",
    import: "imessage",
    path: "spectrum-ts/providers/imessage",
    label: "iMessage",
  },
  {
    key: "slack",
    import: "slack",
    path: "spectrum-ts/providers/slack",
    label: "Slack",
  },
  {
    key: "telegram",
    import: "telegram",
    path: "spectrum-ts/providers/telegram",
    label: "Telegram",
  },
  {
    key: "terminal",
    import: "terminal",
    path: "spectrum-ts/providers/terminal",
    label: "Terminal",
  },
  {
    key: "whatsapp-business",
    import: "whatsappBusiness",
    path: "spectrum-ts/providers/whatsapp-business",
    label: "WhatsApp Business",
  },
];
