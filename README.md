<p align="center"><img src="assets/logo.png" width="120" alt="Praxis logo"></p>

# Praxis

Discreet hotkeys and shortcuts for Windows, with a clean, minimal control window.

**Switch** is the headline: press **Pause** and Praxis mutes the sound, pauses media, hides what you were
looking at, and puts your chosen work app on your chosen screens. Press **Pause** again (or **Shift+Pause**,
"Return") and everything goes back exactly as it was: volume, mute, window positions and focus.

## Download & run

1. Download `dist/Praxis.exe` (or the `Praxis` artifact from the latest **windows-build** Actions run).
2. Double-click it. No installer and no admin rights needed. Praxis sits in the tray and opens the deck.
3. Windows SmartScreen may warn because the exe is unsigned. Click **More info → Run anyway**.

Settings and macros live in `%APPDATA%\Praxis\config.json`; the activity log is `%APPDATA%\Praxis\praxis.log`.

## Features

- **Switch:** set up in one card. Each screen can show its own app or a website (opened in its own browser
  window, closed again on return). Changes save as you make them.
- **Discreet:** neutral names, no notifications, optional hidden tray icon, history kept in memory only unless you
  choose otherwise. Rename `Praxis.exe` to anything you like.
- **Light:** about 26 MB of memory, no CPU use while idle, the control window only polls while it is open.
- **Fill screens:** pick an app and the screens (visual monitor picker). Praxis reuses open windows, launches more
  if needed, and maximises (or fully covers) one per screen.
- **Keep ready:** optionally starts the Switch app minimised at boot so switching is instant.
- **Audio:** mute, unmute or toggle speakers; set the volume or step it up/down; mute, unmute or toggle the
  microphone; media keys. Live volume slider and mute buttons in the deck header.
- **Windows:** minimise or *hide* the active window or matching apps (by `name.exe` or title words such as
  `Netflix`); minimise all; focus an app; politely close an app.
- **Launch:** apps, files, shortcuts, websites, hidden commands.
- **Input:** press key combos (`Win+Shift+S`), type text, clear the clipboard.
- **System:** lock the PC, turn monitors off, waits, notifications.
- **Shortcuts:** tiles you can reorder, a key recorder, line icons and colours, steps you can reorder or switch
  off, duplicate, import/export. Keys already taken by another app are flagged.
- **Tray menu:** run any shortcut, Return, pause keys, identify screens, quit.
- **Phone (opt-in):** run shortcuts from your phone on the same Wi-Fi.
- **Start with Windows** (per-user, no admin).

## Security notes

- The deck listens on `127.0.0.1` only, needs a random per-launch token on every API call, and rejects
  non-loopback `Host` headers (DNS-rebinding protection). Other websites cannot drive it.
- The phone remote deck is **off by default**. When enabled it needs a 6+ character PIN (stored salted and
  hashed), only accepts private-network clients, locks an address out for 5 minutes after 5 wrong PINs, and
  only shows macros you have ticked "Show on phone deck". It is plain HTTP, so only use it on networks you trust.
- "Run a command" steps run with your own permissions. Only import macro files you trust.
- Quitting Praxis while switched returns everything first, so no window is left hidden.
- Discreet is not invisible: Praxis still appears in Task Manager under its file name. It deliberately does not hide
  from Windows or antivirus tools.

## Tips and limits

- No Pause key on your laptop? Rebind Switch to anything (for example `Ctrl+Alt+Space` or `F13`-`F24` on a macro pad).
- Windows will not let a normal app control windows of apps running **as administrator**. Run Praxis elevated
  if you need that.
- Single-window apps (Spotify, for example) cannot fill more than one screen. Praxis fills what it can and logs the rest.
- Media play/pause is a toggle: if nothing was playing, pressing it may start playback (sound is muted anyway).

## Building

Any OS with Go 1.24+:

```bash
./build.sh
```

This vets, tests and cross-compiles `dist/Praxis.exe`. CI (`.github/workflows/windows.yml`) also builds on a
Windows runner and runs `--selftest`, which exercises the real Win32 integration (monitors, hotkey registration,
launching and maximising Notepad, undo, audio where a device exists, and the deck API).

To try the deck UI on Linux or macOS, `go run .` starts a simulation build (nothing is actually muted or moved).
