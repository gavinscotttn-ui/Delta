# Astra

An offline workspace for service-desk work: reply templates, step-by-step workflows, guides and a few small tools, made to sit open on a second monitor. It runs entirely in the browser and makes no network requests of its own. The optional AI assistant also runs on your computer: it downloads once, when you press **Add the AI assistant**, and then works with no internet.

- **Triage**: paste a customer email or ticket (on Home or the Triage page). Astra pulls out the sender, company, contact number, numbers mentioned, ticket refs, postcode, equipment, IPs and MACs (from the newest message only, never guessed), spots the symptom, suggests a priority quoting the customer's own words, finds the guide and workflow, checks the evidence Gamma needs against the raise-a-fault guide, and drafts the ticket note and a message asking for anything missing. The email's contact, ticket ref, company and postcode then fill in templates, replies, quick lines and fault reports until the next email is triaged; nothing about the customer is saved. A number port, new phone system, faulty equipment or engineer visit brings up its form or email: the LOA opens already filled in with the losing provider and numbers from the email.
- **Replies**: customer emails for 64 situations (faults, changes and how-to questions) at every stage of a ticket: first reply, steps to try, raised with Gamma, progress, sorry for the delay, escalated, engineer needed (with the call-out charges), engineer booked, fixed please check, chasers and closing. Friendly or formal, full email or short message, and for faults that need it a version for the customer's IT team: over 1,500 replies, each built from the guides and the team's own wording and checked by the tests (spelling, grammar, and no price, number or code that is not in the guides). Details from the last email triaged fill in; anything not known yet is left out rather than shown as a blank. Triage writes the reply for the pasted email, asking only for the details the email did not give.
- **Our terms, exactly**: a Terms & Conditions guide quotes each figure with its clause (90 days' written notice to cancel, £180 aborted visit, call-outs from £85 per hour, £45 cease charge, equipment upwards of £300, billing errors credited for up to three months, diverts to UK numbers). Tests check every figure against the T&Cs document itself, and that no reply quotes any other charge.
- **Raise a fault** (in Triage, Toolkit and `Ctrl K`): the report Gamma or Openreach need, filled from the email triaged. A Horizon call fault asks for what Gamma's raise-a-fault guide lists (at least three calls, each with date and time, calling and destination numbers, handset make and model and what happened, plus the access investigation and codec for quality faults). A broadband or line fault records the first-line checks from Gamma's guide and will not read as ready until the customer has accepted the call-out charges (T&Cs 4.2). Says what is still missing, and copies the text for the supplier's form.
- **Home**, for a second monitor: a clock and search, quick lines (type to find any line, Enter copies the first, starred lines shown otherwise), a box to paste an email for triage, your systems, pinned templates, workflows and recent copies, each one click from the clipboard again.
- **Workflows**: ticks and the working note are kept while Astra is open, through Esc and a switch of page; **Restart** clears them.
- **Gaps**: questions Astra could not answer are listed in Settings, so you know which guide to write next.
- **Templates** with `{contact}`, `{ticket}`, `{supplier_ref}`, `{date}`-style fields that fill from the last email triaged, or are asked for when copying (`{contact}` greets by first name, or "Mr Carter" for "Mr John Carter"). Wording is never rewritten. Calendar-invite templates (Openreach appointment, port dates) also download as a real `.ics` invite at the right date and slot.
- **Workflows**: editable checklists with a copyable run note.
- **Knowledge**: fault guides, how-tos and reference written from the supplier documents, with a **Fault finder** row for the common problems. Every guide links to the exact page it came from. URLs, commands and dial codes copy when clicked.
- **Library**: every supplier document (72 documents, including the Gamma training library, with Word originals where supplied), searchable page by page, and ready to open at the right page or download.
- **Audio converter** (Toolkit): any audio the browser can read (MP3, M4A, WAV, OGG, FLAC, or the sound from a video) to μ-law WAV (8 kHz mono, the Gamma Horizon format, the default), A-law, 8-bit, 16-bit or 16 kHz WAV, G.722 or raw, with five volume levels and an optional phone-line filter. A sharp filter stops high notes folding back as false tones. Flags files over Horizon's 5 MB or 625 seconds and can trim them with a fade. Listen plays exactly what callers will hear. Every format is checked against ffmpeg in the tests.
- **UK number lookup** (Toolkit and Ctrl K): valid or not, the kind of number, the area of a landline, the network a mobile range was given to, and dialling codes from a place name, from Google's libphonenumber data.
- **Cancellation notice** (Toolkit): the date written notice was received gives the date the 90 days' notice ends (T&Cs 10.2, counted from the day it is received), and with the contract start, whether that falls inside the minimum term, where early termination fees apply (10.3). Copies a sentence for the customer. The cancellation reply's progress update takes the same date and states when the notice ends.
- **QR codes** (Toolkit, or `qr` in `Ctrl K`): Wi-Fi details, a web link, a phone number, an email or plain text, made on this computer. Shows exactly what the code scans as; copy the image straight into an email, or download it as PNG or SVG. Nothing typed is saved, so a Wi-Fi password stays on the screen only. Every code size is checked in the tests by a separate QR reader.
- **Password or PIN** (Toolkit): passwords made with the browser's secure random numbers, with characters that look alike left out by default and only symbols that survive SIP and web forms, read out in the phonetic alphabet underneath. PINs never repeat or run (1111, 1234, 1212). Never saved.
- **Spell it out** (Toolkit): a MAC address, reference, postcode or password in the phonetic alphabet, in order, to read over the phone.
- **Toolkit**: MAC address formats (for assigning handsets), IP subnet calculator, SIP response and ISDN cause code lookup, date calculator, days between, text cleaner, ticket note stamp, UK phone formatter, appointment window. Type a code, MAC or IP into `Ctrl K` or Ask and it is answered straight away.
- **Customer forms** (top of Toolkit): fill the letter of authority from the email triaged and download it as a ready Word file (losing provider address and email filled in, numbers checked and formatted, extra numbers on the continuation sheet, both pages numbered); download the CRF; copy the email that goes with each. Also on `Ctrl K` ("loa", "crf"). After replacing the blank LOA in `library/company/`, run `npm run forms`.
- **Keyboard**: `Alt 1` to `Alt 9` and `Alt 0` open each page, `?` lists every shortcut.
- **First-run setup**: a new workspace asks three short questions (your name and initials for signing, theme and text size, whether to use the privacy screen or add the AI assistant). Each can be skipped; Settings can run it again.
- **Themes**: Match this computer, Dark, Light and High contrast, plus a larger text size. Applied before the page draws, so it never flashes, and included in backups.
- **Ask**: type a question in your own words. It finds the best guide and shows its steps, answers lookups (a dial code, a profile rule, a port, a price) straight from the reference tables, and links the document pages. Works fully offline. Optionally a small language model running on your computer writes the answer too: see [docs/ASSISTANT.md](docs/ASSISTANT.md).
- **Search** everything, including the text inside every document, with `Ctrl K`. Quick links to your portals with `Alt` + key. `Alt` shortcuts work while typing in a box.
- **Quick line shortcuts**: type `;close5` and a space (or `;ack`, `;chase`, `;final`, `;vm`, `;resolved`, `;notice` and 16 more) in any text area in Astra and it becomes the quick line, with the triaged email's details filled in; undo takes it back. Set or change a line's shortcut on the Templates page. In the extension it can work in Zoho Desk too, once switched on in Settings (see the permissions below).
- **Quick lines**: 180 ready-made sentences (acknowledging, chasing, closing at 5pm, engineer visits, ticket notes and more) that copy in one click from Templates, Home, `Ctrl K` or Astra Lite. Star the ones you use most; add, edit or delete your own. The ticket, customer, your name and today's date fill in by themselves, and only a detail Astra cannot know is asked for.
- **Voxone (VOIP Unlimited)**: 41 how-tos and references written from VOIP Unlimited's own help articles (users and leavers, groups and permissions, handsets and resets, queues and IVRs, blocking, feature codes, recording, statistics, Teams and CRM), each linked to the article page it comes from. Questions that name Horizon or Voxone are answered from that platform only; when a question names neither and both apply, Ask says so.
- **Astra Lite**, in the browser toolbar (extension only): one search box over replies, templates, guides, your systems, UK numbers and SIP or ISDN cause codes, on top of whatever site you are on. `Alt Q` opens it (change the key at `edge://extensions/shortcuts` or `chrome://extensions/shortcuts`); arrows and Enter copy or open; `Alt` + key opens a system. **Keep open** moves it into the browser's side panel, where it stays beside the ticket while you copy and paste. It uses the same workspace as the new tab, including your name for signing, and never changes it. Open it over a selected phone number or code and the answer is already showing; over a selected customer email, it suggests the reply.
- **Triage with Astra** on the right-click menu (extension only): select a customer's email in any page, such as a ticket in Zoho Desk, right-click and choose it. Astra opens beside the page with the email already triaged.

## Use it

**As your new tab page (Microsoft Edge, Chrome and other Chromium browsers)**

1. Download or clone this repository, and keep the folder somewhere permanent (Documents, not Downloads).
2. Open `edge://extensions` (in Chrome, `chrome://extensions`) and switch on **Developer mode** (bottom left in Edge, top right in Chrome).
3. Choose **Load unpacked** and select this folder.
4. Open a new tab. If the browser asks whether to keep the new tab page an extension set, keep it.
5. To keep **Astra Lite** one click away, open the Extensions menu (the puzzle piece) in the toolbar and choose to show Astra there.

If **Developer mode** cannot be switched on, the browser is managed by your organisation: use the plain page below, or ask IT to allow it.

Moving the folder or deleting it will break the extension, so keep it somewhere permanent. To update, pull the latest files and press the reload icon on the extension.

**As a plain page**: open `index.html` in a browser. Nothing to install.

**What the extension is allowed to do**, and why. None gives access to any website's content. Loaded with **Load unpacked**, none of them asks anything:

- `unlimitedStorage`: room for the optional AI model on this computer.
- `storage`: hands text from the right-click menu to the Astra tab, in memory only, deleted as soon as it is read.
- `contextMenus`: the **Triage with Astra** item on the right-click menu.
- `activeTab` and `scripting`: read the text you selected on the page in front, with its line breaks, and nothing else. Only at the moment you choose **Triage with Astra** or open Astra Lite from the toolbar or its key, and only on that page. There is no other access to any page.
- `sidePanel`: Astra Lite in the side panel.
- `optional_host_permissions` (Zoho only, `https://*.zoho.eu/*` and `https://*.zoho.com/*`): asked for only when you switch on **Quick line shortcuts → In Zoho Desk too** in Settings. A small script then runs on Zoho's pages, reads only the few characters just before the cursor in the box you are typing in, and turns a shortcut such as `;close5` into the quick line. Nothing is sent anywhere. Switching it off removes the script, the access and the copy of your lines it used.

## Your data

Everything you add or change is saved in the browser profile (`localStorage`), not in these files. The extension and the plain page are separate storage areas, so use **Settings → Export backup** and **Import backup** to move between them, to another browser or to another computer. Clearing browser data erases the workspace, so export now and then.

Built-in content updates are additive: when new built-in templates, workflows or guides are added to the repository, they appear in an existing workspace once. Anything you have edited or deleted is left alone. **Settings → Reset** restores the built-ins and removes your changes.

## About the documents

The library holds supplier guides as supplied, minus anything internal or branded by another provider. Some supplier guides include manufacturer default logins (for example a router's factory admin password). Anyone who can open Astra or this repository can read them, so keep the repository private.

## Privacy

- No analytics, telemetry, fonts, CDNs or sync.
- **By default Astra makes no network requests.** Google search and portal shortcuts leave the device only when you click them. Shortcuts must be HTTPS.
- **The optional AI assistant runs on this computer.** Settings → **Add the AI assistant** downloads the model once from Hugging Face, checks every file against its published SHA-256, stores it in the browser and switches the assistant on. After that it runs with no internet; what you type is never sent anywhere and no account or key is needed. The browser's security policy allows Hugging Face and nothing else, and Astra contacts it only for that download. See `docs/ASSISTANT.md`.
- The page's Content Security Policy allows only the page itself and Hugging Face (for the model download you start): the browser refuses any other address.

## Development

No build step. Plain HTML, CSS and JavaScript.

```
index.html          page shell (also the extension's new tab page)
popup.html          Astra Lite, the toolbar popup (js/popup.js, css/popup.css)
manifest.json       Chromium extension manifest (Manifest V3; permissions listed above)
css/astra.css       all styles, colour tokens at the top
js/app.js           application
js/contract.js      contract dates from the T&Cs (90 days' notice, minimum term)
js/faults.js        supplier fault reports: what each supplier needs, from the guides
js/qr.js            QR codes (ISO/IEC 18004), and the Wi-Fi, phone and email text phones read
js/passwords.js     passwords and PINs from secure random numbers
js/phonetic.js      spelling text out in the phonetic alphabet
js/expand.js        quick line shortcuts (;close5), in Astra and, with js/expand-content.js, on Zoho Desk
js/kb-core.js       guide rendering and searching inside documents
js/assistant-core.js  the Ask engine: matching, lookups, prompt building, answer checking
js/local-ai.js      the on-device AI assistant (client) and js/local-llm.worker.js (runs the model)
vendor/             Transformers.js + ONNX Runtime Web, unchanged copies
models/             optional: models installed from disk with npm run model (Settings installs into the browser instead)
js/ask-view.js      the Ask page
js/library/         generated: document list and page text (npm run library)
library/            the documents themselves, and manifest.json describing them
tools/              build-library.mjs and transcripts for image-only PDFs
js/seed/            built-in content (templates, workflows, guides, shortcuts, profile)
assets/             logo and icons
tests/              browser smoke tests
docs/               how to add guides and documents
```

Tests drive the real page with Playwright, check every guide's sources and copyable codes against the documents, and run an accessibility audit (axe):

```
npm install
npx playwright install chromium
npm test
```

See [docs/ADDING-CONTENT.md](docs/ADDING-CONTENT.md) for adding guides, templates, workflows and documents.
