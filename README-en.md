# Compiler (Universal)

> 🇮🇹 [Versione italiana disponibile](README.md)

A Chrome extension (Manifest V3) that automatically fills web forms on **any website** using OpenAI, based on documents you upload (PDF, DOCX). Designed to cut down repetitive form-filling time while keeping the user always in control: no automatic submissions, explicit confirmation before every action.

## Features

- **On-demand activation**: the extension does **not auto-inject** itself into the sites you visit. It activates only when you click its toolbar icon. Zero overhead when you don't need it, maximum privacy when browsing normally.
- **Floating minimal widget**, monochrome (light/dark theme), draggable, with a Shadow DOM so the CSS stays isolated from the host site. It does not close on outside clicks — only via the × button.
- **Document persistence**: PDFs and DOCX files you upload are kept across sessions in `chrome.storage.local` (up to 10 MB). You can rename them, delete them, pick a specific one for filling, or use them all together.
- **OpenAI API key** stored in the browser (`chrome.storage.sync`), configurable from the widget.
- **Selectable AI models** with per-1M-token cost shown at selection time:
  - GPT-4.1 (recommended — best quality/price ratio)
  - GPT-4.1 mini (cheap, intensive use)
  - GPT-4o mini (most economical, lower quality)
- **Framework compatibility**:
  - Native HTML forms (input/select/textarea/checkbox/radio)
  - Angular Material (mat-form-field, mat-select, mat-checkbox, mat-radio-group, mat-vertical-stepper)
  - Angular Reactive Forms (populates `FormControl` directly via a MAIN-world bridge when the framework is in dev mode)
  - Generic React/Vue/Svelte forms (via native setter + standard event dispatch)
- **Cascade-aware**: handles dependent selects correctly (e.g. Country → Region → Province → City with async option fetching after each parent selection).
- **Clear button**: empties all form fields and temporarily removes `disabled`/`readonly` locks to allow rewriting.
- **Fill button**:
  1. Pre-unlocks fillable fields
  2. Scans the form and classifies fields by type/section
  3. Sends the field schema + document text to the AI
  4. Applies responses with anti-hallucination rules (deterministic matching for tax IDs, IBAN, postal codes, dates)
  5. For "X same as Y" checkboxes, automatically copies values from the reference section
  6. Second pass focused on fields left empty
- **Never clicks Submit/Send/Save** — the final action always stays with you.
- **Accordion log** at the bottom of the widget: shows in detail what was filled, from which document, and with what textual source.

## Installation (developer)

1. `git clone` this repository.
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top-right toggle).
4. Click "Load unpacked" → select the `Compilatore Universale` folder.
5. Pin the extension icon to the toolbar.
6. Open any website → click the icon → the widget pill activates on the page.
7. ⚙ → paste your **OpenAI API key** → Test → Save.

## Usage

1. Open any web page with a form to fill.
2. Click the extension icon in the toolbar → the "Compiler" pill appears on the page.
3. Click the pill → the widget opens.
4. (First time) ⚙ → upload your source documents (PDF/DOCX). They stay saved for next time.
5. From the dropdown, pick which document to use (or "All").
6. Click **Fill** → the AI reads the documents and populates the fields.
7. Visually verify the data before submitting the form manually.
8. To start over, press **Clear**.

## Which AI model to choose?

| Model | When to use it | Cost per 1M tokens | Cost per Fill |
|---|---|---|---|
| **GPT-4.1** | Recommended default. Best quality on structured tasks. | $2.00 in / $8.00 out | ~$0.016 |
| **GPT-4.1 mini** | For intensive use (10+ forms/day). | $0.40 in / $1.60 out | ~$0.0032 |
| **GPT-4o mini** | Only for testing or maximum economy. Lower quality. | $0.15 in / $0.60 out | ~$0.0012 |

A typical fill = ~6000 input + ~500 output tokens.

## Architecture

```
Compilatore Universale/
├── manifest.json              # Manifest V3, on-demand injection (no content_scripts)
├── background.js              # Service worker: OpenAI proxy, content-script injection on icon click
├── content/
│   ├── content.js             # Widget UI + DOM scanner + filler (isolated world)
│   ├── page-bridge.js         # Framework internals access (MAIN world, on-demand)
│   └── widget.css             # Wrapper container
├── popup/
│   ├── popup.html
│   └── popup.js               # Toolbar widget toggle
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js             # Full options page (alternative to the widget)
├── lib/
│   ├── pdf.min.js             # PDF.js v3.11.174 (Mozilla, Apache-2.0)
│   ├── pdf.worker.min.js
│   └── mammoth.browser.min.js # Mammoth v1.6.0 (BSD-2)
└── icons/                     # 16, 48, 128
```

### Technical notes

- **Manifest V3 + on-demand**: no `content_scripts` declared in the manifest. `background.js` listens to `chrome.action.onClicked` and uses `chrome.scripting.executeScript` to inject the widget only when the user requests it. Pinning the icon to the toolbar works as a personal feature flag.
- **Isolated ↔ MAIN world bridge**: `content.js` runs in the isolated world (UI, document parsing, OpenAI calls). `page-bridge.js` runs in the MAIN world to read the page's framework state (`__ngContext__` of Angular Ivy when available, falling back to plain DOM). They communicate via `postMessage`.
- **Minimum compatibility**: Chrome 116+ (required by `chrome.scripting.executeScript({world:'MAIN'})`).

## Privacy

- API key and documents stay in your browser; never sent to any external server.
- Only the **field schema** of the form (label, type, options — NOT existing values) and the **text extracted from your documents** are sent to `api.openai.com` when you press Fill.
- The extension does not read cookies, sessions, saved passwords, or storage from other sites.
- No telemetry, no analytics, no network calls beyond OpenAI.

## Known limitations

- Custom React/Vue dropdowns from other frameworks may not respond to native setters if the framework uses internal state management (Redux, Pinia, Zustand). The DOM fallback handles them partially.
- `<input type="file">` fields are never filled automatically for browser security reasons (the API does not allow it).
- CAPTCHAs, cross-origin iframes, and content behind paywalls/login gates are not supported.

## Updating third-party libraries

```bash
cd lib/
curl -L -o pdf.min.js              https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
curl -L -o pdf.worker.min.js       https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js
curl -L -o mammoth.browser.min.js  https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js
```

## Security

⚠ Once activated on a page, the extension has access to that page's DOM. So:
- It activates only if you click its icon (no invasive auto-load).
- Don't fill forms that contain credentials or data you don't want to send to OpenAI.
- The API key is stored in `chrome.storage.sync`: if you have Chrome Sync enabled, the key is replicated across your synced devices.

## License

MIT.

## Contributing

Pull requests welcome. For significant changes, please open an issue first to discuss the proposed change.
