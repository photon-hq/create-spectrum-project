import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  providers: [
    // ⚠ Local iMessage mode requirements:
    //    • macOS only (reads ~/Library/Messages/chat.db directly)
    //    • Your terminal needs Full Disk Access:
    //      System Settings → Privacy & Security → Full Disk Access
    //    • Reduced features: text + attachments only
    //      (no reactions, typing indicators, threaded replies, group ops)
    imessage.config({ local: true }),
  ],
});

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  if (message.content.type === "text") {
    await space.send(`echo: ${message.content.text}`);
  }
}
