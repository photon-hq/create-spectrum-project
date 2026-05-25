// Preloaded by bunfig.toml before any test file. Keep minimal — most setup
// belongs next to the tests it serves.

// Strip ANSI so any logger output we capture is stable across terminals.
process.env.FORCE_COLOR = "0";
