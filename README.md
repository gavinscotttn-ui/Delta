<p align="center"><img src="assets/logo.png" width="120" alt="Praxis logo"></p>

# Praxis

Global hotkeys, macros and a **panic button** for Windows, driven from a stream-deck style control deck.

Watching Netflix and need to look busy *instantly*? Press **Pause** (the default Panic hotkey):
Praxis mutes the speakers, pauses the media, minimises the video, and fills your chosen screens
with your chosen app (Excel, Outlook, whatever). Press Pause again, or **Shift+Pause**, and everything
goes back exactly how it was: volume, mute state, window positions, the lot.

## Download & run

1. Download `dist/Praxis.exe` (or the `Praxis` artifact from the latest **windows-build** Actions run).
2. Double-click it. No installer and no admin rights needed. Praxis sits in the tray and opens the deck.
3. Windows SmartScreen may warn because the exe is unsigned. Click **More info → Run anyway**.

Settings and macros live in `%APPDATA%\Praxis\config.json`; the activity log is `%APPDATA%\Praxis\praxis.log`.

## Features

- **Panic / toggle macros:** one key engages, the same key restores. Every change is recorded and undone in reverse.
- **Fill screens:** pick an app and the screens (visual monitor picker). Praxis reuses open windows, launches more
  if needed, and maximises (or fully covers) one per screen.
- **Pre-launch:** optionally starts panic apps minimised at boot so the panic is instant.
- **Audio:** mute, unmute or toggle speakers; set the volume or step it up/down; mute, unmute or toggle the
  microphone; media keys. Live volume slider and mute buttons in the deck header.
- **Windows:** minimise or *hide* the active window or matching apps (by `name.exe` or title words such as
  `Netflix`); minimise all; focus an app; politely close an app.
- **Launch:** apps, files, shortcuts, websites, hidden commands.
- **Input:** press key combos (`Win+Shift+S`), type text, clear the clipboard.
- **System:** lock the PC, turn monitors off, waits, notifications.
- **Deck:** big drag-to-reorder tiles, hotkey recorder, templates, per-step enable/disable, duplicate, test,
  import/export, an "identify screens" overlay, pause-all-hotkeys, and an activity log. Hotkeys that clash with
  another app are flagged on the tile.
- **Tray menu:** run any macro, restore everything, pause hotkeys, identify screens, quit.
- **Phone remote deck (opt-in):** run macros from your phone on the same Wi-Fi.
- **Start with Windows** (per-user, no admin).

## Security notes

- The deck listens on `127.0.0.1` only, needs a random per-launch token on every API call, and rejects
  non-loopback `Host` headers (DNS-rebinding protection). Other websites cannot drive it.
- The phone remote deck is **off by default**. When enabled it needs a 6+ character PIN (stored salted and
  hashed), only accepts private-network clients, locks an address out for 5 minutes after 5 wrong PINs, and
  only shows macros you have ticked "Show on phone deck". It is plain HTTP, so only use it on networks you trust.
- "Run a command" steps run with your own permissions. Only import macro files you trust.
- Quitting Praxis while a panic is active restores everything first, so no window is left hidden.

## Tips and limits

- No Pause key on your laptop? Rebind Panic to anything (for example `Ctrl+Alt+Space` or `F13`-`F24` on a macro pad).
- Windows will not let a normal app control windows of apps running **as administrator**. Run Praxis elevated
  if you need that.
- Single-window apps (Spotify, for example) cannot fill more than one screen. Praxis fills what it can and logs the rest.
- Media play/pause is a toggle: if nothing was playing, pressing it may start playback (you're muted anyway).

## Building

Any OS with Go 1.24+:

```bash
./build.sh
```

This vets, tests and cross-compiles `dist/Praxis.exe`. CI (`.github/workflows/windows.yml`) also builds on a
Windows runner and runs `--selftest`, which exercises the real Win32 integration (monitors, hotkey registration,
launching and maximising Notepad, undo, audio where a device exists, and the deck API).

To try the deck UI on Linux or macOS, `go run .` starts a simulation build (nothing is actually muted or moved).
