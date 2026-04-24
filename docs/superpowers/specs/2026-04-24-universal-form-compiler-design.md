# Universal Form Compiler (UFC) — Design Spec

**Status:** Draft for review
**Date:** 2026-04-24
**Author:** brainstorming session with vdamato@rdditalia.com
**Supersedes:** Smart Form Compiler V2 (Bando Disegni+ 2025)

## 1. Visione e scope

### Cos'è
Estensione Chrome Manifest V3 che compila automaticamente qualsiasi form web partendo da un file JSON cifrato con i dati dell'utente. Usa OpenAI (GPT-4o / 4.1 family) per la comprensione semantica dei campi e del mapping dati→campo.

### Obiettivo di copertura
Coprire il 95%+ dei form reali, inclusi:
- HTML nativi (tutti i `type` di `input`, `textarea`, `select`, `radio`, `checkbox`, `file`)
- UI libraries comuni (Material UI, Ant Design, Bootstrap, Chakra, Semantic UI)
- Shadow DOM aperti e iframe same-origin
- Wizard multi-step (auto-navigate tra step)
- Campi condizionali dinamici (rilevati via `MutationObserver`)
- Rich text editor (TinyMCE, Quill, CKEditor, Draft.js, Slate, ProseMirror)
- Autocomplete/combobox async (Select2, Chosen, MUI Autocomplete)
- Date/time picker (flatpickr, pikaday, MUI DatePicker)

### Non-obiettivi
- Bypassare captcha (reCAPTCHA/hCaptcha/Turnstile rilevati e skippati con avviso)
- Submit finali automatici (sempre in mano all'utente)
- Essere un password manager completo (gestisce password in modo sicuro ma non sostituisce 1Password/Bitwarden)
- Iframe cross-origin (limitazione browser insuperabile in modo etico)
- Signature pad, canvas drawing (rilevati e skippati)

### Principi di design
1. **Sicurezza di default** — dati cifrati a riposo, segreti mai inviati all'AI, submit mai automatico, **valori utente mai inviati all'AI durante il matching** (vedi §3 Flow C)
2. **Trasparenza** — dry-run obbligatorio: l'utente vede il mapping proposto prima che la compilazione avvenga
3. **Isolamento modulare** — ogni componente ha una responsabilità, comunica via interfacce chiare, testabile in isolamento
4. **Costo consapevole** — l'utente vede i costi stimati; può abilitare una cache opt-in per azzerare i costi su siti ricorrenti

## 2. Architettura a blocchi

```
┌─────────────────────────────────────────────────────────────────┐
│ popup/  (UI — vanilla TypeScript + CSS)                         │
│   ├── unlock-view      — master password prompt                 │
│   ├── setup-wizard     — first-run: create vault + import data  │
│   ├── main-view        — "Compile this form" + settings         │
│   └── dry-run-view     — preview mapping, edit, confirm         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ background/ (service worker)                                    │
│   ├── orchestrator     — coordinates flows between popup/content│
│   ├── ai-client        — OpenAI API, tool use, retry, budgeting │
│   └── cache            — site-fingerprint → field-mapping cache │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ content/ (injected into target pages)                           │
│   ├── form-scanner     — enumerates fields, Shadow DOM, iframes │
│   ├── widget-detector  — classifies widget type per field       │
│   ├── form-filler      — sets values + synthetic events         │
│   ├── mutation-watcher — detects dynamic field appearance       │
│   └── overlay          — in-page colored borders + status bar   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ lib/ (shared utilities)                                         │
│   ├── crypto           — AES-256-GCM + Argon2id (or PBKDF2)     │
│   ├── vault            — encrypted JSON store (chrome.storage)  │
│   ├── importer         — DOCX/CSV/YAML → canonical JSON via AI  │
│   ├── canonical-schema — JSON schema + sensitive-fields registry│
│   └── field-taxonomy   — known widget detectors + strategies    │
└─────────────────────────────────────────────────────────────────┘
```

### Responsabilità per modulo

| Modulo | Responsabilità | Interfaccia chiave |
|---|---|---|
| `popup/*` | UI, orchestrazione utente, visualizzazione dry-run | messaggi a `background` |
| `background/orchestrator` | Coordina flussi import/fill/cache | `chrome.runtime.onMessage` |
| `background/ai-client` | Tutte le chiamate a OpenAI; tool use; retry | `resolveMapping(fields, availableKeys): Mapping[]` |
| `background/cache` | Lookup/save fingerprint→mapping | `get(fingerprint)`, `put(fingerprint, map)` |
| `content/form-scanner` | Scansione DOM, Shadow DOM, iframe | `scan(): FieldDescriptor[]` |
| `content/widget-detector` | Classifica widget type per FieldDescriptor | `classify(field): WidgetType` |
| `content/form-filler` | Applica valori, dispatcha eventi sintetici | `fill(mapping): FillResult[]` |
| `content/overlay` | UI in-page, bordi colorati, toolbar | imperative API |
| `lib/crypto` | Primitive crittografiche | `encrypt`, `decrypt`, `deriveKey` |
| `lib/vault` | Store cifrato + session key | `unlock`, `lock`, `read`, `write` |
| `lib/importer` | Normalizza input utente → JSON canonico | `import(rawText, format): CanonicalData` |
| `lib/canonical-schema` | Schema + sensitive-field list | static module |
| `lib/field-taxonomy` | Detectors + fill strategies per widget | registry of strategies |

## 3. Data flow

### Flow A — First-time setup (setup wizard)

1. Utente apre il popup per la prima volta (no vault esistente)
2. Wizard step 1 — "Crea nuovo vault": utente imposta **master password** (min 12 caratteri, entropia misurata)
3. Wizard step 2 — "Importa dati": utente carica file (DOCX / CSV / YAML) oppure compila un form guidato
4. Importer estrae testo dal file e invia ad OpenAI con istruzione "mappa questi dati nello schema canonico {schema}". La risposta viene validata con Zod:
   - Chiavi conformi allo schema: accettate
   - Chiavi fuori schema ma plausibili: finiscono in `custom.<key>`
   - Tipi invalidi (es. data malformata): segnalati all'utente nel review step
   - Se mancano chiavi obbligatorie che l'utente aveva indicato nel raw file (es. email citata ma non parsata): secondo round con prompt mirato
5. Wizard step 3 — Review/edit: utente vede il JSON risultante in un form leggibile, può correggere/aggiungere/rimuovere
6. JSON cifrato con la chiave derivata dalla master password → salvato in `chrome.storage.local`
7. Chiave derivata tenuta in memoria nel service worker fino a timeout sessione

### Flow B — Unlock

1. Utente apre il popup
2. Se sessione attiva: vai al main view
3. Se sessione scaduta: prompt master password
4. Decrypt vault → chiave in memoria
5. Main view

### Flow C — Compilation di un form

1. Utente su pagina target → apre popup → click "Compile this form"
2. Background manda messaggio a content script → `form-scanner.scan()`
3. Scanner ritorna `FieldDescriptor[]`:
   ```typescript
   interface FieldDescriptor {
     id: string;                  // selector stabile
     type: HTMLInputType | 'shadow-dom-internal' | 'iframe-internal';
     widget: WidgetType;          // classificato da widget-detector
     labels: { text: string, source: 'label'|'aria-label'|'placeholder'|'title' }[];
     attributes: {
       name?: string; id?: string; autocomplete?: string;
       placeholder?: string; 'aria-label'?: string; title?: string;
     };
     options?: string[];          // per select/radio/combobox
     validation?: { required?: boolean; pattern?: string; min?: number; max?: number };
     context: { nearbyText: string; formTitle?: string };
     frame?: { type: 'iframe'|'shadow'; depth: number };
   }
   ```
4. Orchestrator:
   a. Se cache abilitata: calcola fingerprint del form, tenta lookup
   b. Se cache hit: usa mapping cached → salta AI
   c. Se cache miss o cache disabilitata:
      - Divide i campi in **sensitive** e **non-sensitive**
      - Per i sensitive: matching locale deterministico (via `autocomplete="cc-number"`, `type="password"`, pattern noti); se non c'è match certo, marcati rossi
      - Per i non-sensitive: chiamata AI con `FieldDescriptor[]` + **lista delle chiavi canoniche disponibili** (es. `["person.first_name", "contact.email", "company.vat_number", ...]`). **I valori non vengono mai inviati all'AI**, solo le chiavi. L'AI ritorna `{field_id, canonical_key, confidence}`. La sostituzione `canonical_key → value` è fatta localmente dall'orchestrator.
      - Motivazione: privacy (valori utente non escono mai), costo token (meno payload), sicurezza (anche dati non classificati "sensibili" come data di nascita o indirizzo restano locali)
5. Dry-run view mostra:
   - Certi (confidence ≥ 0.8): verde
   - Incerti (0.5 ≤ confidence < 0.8): giallo, l'utente deve confermare o correggere
   - Non trovati (confidence < 0.5 o widget non supportato): rosso, segnalati come skipped
   - Sensibili: valore mascherato (`••••••`) nella preview, mai mostrato in chiaro per errore
6. Utente conferma → `form-filler.fill(mapping)`:
   - Per ogni mapping: risolve `canonical_key` → valore dal vault in memoria; trova elemento via selettore; applica valore tramite strategia del widget; dispatcha eventi sintetici
   - Bordo colorato applicato al campo (verde/giallo/rosso) per feedback visuale
7. `mutation-watcher` attivo: se compaiono nuovi campi dopo un fill, li scansiona, richiede mapping aggiuntivo all'AI, li compila
8. Se wizard multi-step:
   - Rileva pulsante "Avanti" (euristiche: testo `next|avanti|continua|proceed|step`, tipo bottone, non `submit` finale)
   - Click → attendi nuovo step visibile → ripeti dal punto 3
   - Pulsante "Invia finale" (testo `submit|invia|conferma|send|finalize` E ultima pagina del wizard): **mai cliccato automaticamente**; overlay mostra "Ready to submit — review and click Submit yourself"

### Flow D — Cache (opt-in)

- **Fingerprint:** hash SHA-256 di `(hostname + normalized_path + sorted(field_selectors) + sorted(field_labels))`
- **Mapping cached:** `{ fingerprint → { field_selector → canonical_field_key } }`
- Su fill riuscito: salva nel cache
- Su visita successiva con fingerprint identico: usa mapping cached, zero chiamate AI
- Su correzione utente: overwrite entry
- Cache invalidata automaticamente se fingerprint cambia (sito aggiornato)
- Storage: dentro lo stesso vault cifrato (sezione `cache`)

### Flow E — Settings / key management

- API key OpenAI: inserita in settings, salvata **dentro il vault cifrato**, mai in chrome.storage in chiaro
- Scelta modello: dropdown con short-list curata (default `gpt-4o-mini`; alternative: `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`). Lista finalizzata a fase di implementazione in base ai modelli disponibili.
- Budget AI mensile: soglia configurabile (default $10/mese); al raggiungimento, blocca e notifica
- Session timeout: default 30 min di inattività; configurabile 5 min – 8h
- Cache toggle: on/off, con messaggio chiaro sul trade-off privacy/costo
- Delete vault: doppia conferma, cancella tutto

## 4. Schema JSON canonico + cifratura

### Schema canonico

```json
{
  "version": 1,
  "person": {
    "first_name": "string",
    "last_name": "string",
    "middle_name": "string?",
    "full_name": "string?",
    "gender": "M|F|X|prefer_not_to_say?",
    "birth_date": "YYYY-MM-DD?",
    "birth_city": "string?",
    "birth_country": "string?",
    "nationality": "string?",
    "tax_code": "string?",
    "ssn": "string?"
  },
  "contact": {
    "email": "string",
    "email_secondary": "string?",
    "phone": "string?",
    "phone_mobile": "string?",
    "pec": "string?",
    "website": "string?"
  },
  "addresses": {
    "primary": { "street": "", "number": "", "unit": "", "city": "", "state_province": "", "postal_code": "", "country": "" },
    "billing": "Address?",
    "shipping": "Address?"
  },
  "company": {
    "legal_name": "string?",
    "trade_name": "string?",
    "vat_number": "string?",
    "tax_code": "string?",
    "legal_form": "string?",
    "rea_number": "string?",
    "founded_date": "YYYY-MM-DD?",
    "employees": "number?",
    "annual_revenue": "number?",
    "address": "Address?"
  },
  "banking": {
    "iban": "string?",
    "swift_bic": "string?",
    "bank_name": "string?",
    "account_holder": "string?"
  },
  "credentials": {
    "[site_hostname]": { "username": "string", "password": "string" }
  },
  "payment_cards": [
    { "label": "string", "number": "string", "expiry": "MM/YY",
      "cvv": "string", "holder": "string", "type": "visa|mc|amex|..." }
  ],
  "documents": {
    "passport_number": "string?",
    "id_card_number": "string?",
    "driver_license_number": "string?"
  },
  "custom": {
    /* free-form: chiavi arbitrarie definite dall'utente */
  }
}
```

Lo schema è documentato come JSON Schema Draft-07 per validazione runtime (via Zod).

### Sensitive fields registry

Campi esclusi dal matching AI anche per le sole chiavi (matching fatto solo localmente con pattern deterministici):
- `credentials.*.password`
- `payment_cards[*].number`
- `payment_cards[*].cvv`
- `banking.iban`
- `documents.passport_number`
- `documents.id_card_number`
- `documents.driver_license_number`
- `person.tax_code` *(configurabile — default: non sensibile in IT perché richiesto in molti form pubblici; l'utente può promuoverlo)*
- `person.ssn`

**Nota:** nel flusso C step 4.c si è già specificato che i valori di **tutti** i campi (sensibili o meno) non escono mai dal browser — all'AI vanno solo le chiavi canoniche. La distinzione "sensitive vs non-sensitive" riguarda se la **chiave** viene nemmeno menzionata all'AI:
- Non-sensitive: chiave inclusa nella lista `availableKeys` inviata all'AI
- Sensitive: chiave esclusa; matching tentato solo con pattern deterministici sul frontend

Per i sensitive, il matching deterministico usa:
- `input[type="password"]` → `credentials[host].password` (host ricavato da `window.location.hostname`)
- `input[autocomplete="cc-number"]` → `payment_cards[0].number` (o prompt utente se più carte)
- `input[autocomplete="cc-csc"]` → `payment_cards[0].cvv`
- Pattern regex su label/name: `/iban/i`, `/passport/i`, `/social.security/i`, ecc.

Se non c'è match certo su un campo sensibile → marcato rosso, mai passato all'AI, utente compila a mano.

### Cifratura

| Parametro | Valore |
|---|---|
| Cipher | AES-256-GCM |
| KDF | Argon2id (64 MiB memory, 3 iterations, 4 parallelism) — fallback PBKDF2-SHA256 con 600k iterations se Argon2 non disponibile nell'ambiente browser |
| Salt | 32 byte random, uno per vault, salvato in chiaro nel blob |
| IV | 12 byte random, generato ad ogni encrypt, salvato con il blob |
| Auth tag | 16 byte (GCM standard) |
| Output | JSON `{ v: 1, kdf: "argon2id"|"pbkdf2", kdfParams, salt, iv, ciphertext, tag }` base64-encoded, salvato in `chrome.storage.local` |
| Password | mai salvata; chiave derivata tenuta in memoria nel service worker |
| Session timeout | cancella chiave dopo N min di inattività |
| Rate limit | max 5 tentativi di unlock in 5 minuti, poi lockout 30s exponential backoff |

## 5. Gestione campi complessi (Tier C)

### Campi HTML nativi
Tutti i `type` di `input` (text, email, password, number, tel, url, date, datetime-local, month, week, time, color, range, search, hidden=skip), `textarea`, `select` (singolo e multiplo), `radio`, `checkbox`, `file`.

### Widget custom — detector + strategy

| Widget | Detector | Strategy |
|---|---|---|
| **MUI Select** | `[role="combobox"]` + classe `MuiSelect-*` | Click → attendi `listbox` → cerca option per text match → click |
| **Ant Design Select** | `.ant-select` + `[role="combobox"]` | Come MUI con selettori `.ant-select-item-option` |
| **Bootstrap select (select2)** | `.select2-container` | Click → type query in search → wait for results → click match |
| **Chakra Menu** | `[data-chakra-component]` | Click trigger → wait `[role="menu"]` → click item |
| **Custom combobox generico** | `[role="combobox"]` o `[role="listbox"]` | Pattern generico: click → find options → click |
| **Date picker flatpickr** | `.flatpickr-input` | Scrittura diretta nel campo + dispatch `input`/`change` |
| **Date picker MUI** | `.MuiDatePicker-*` o `data-testid` MUI | Preferibile: scrittura diretta nel campo testo; fallback: navigazione calendario |
| **Rich text — Quill** | `.ql-editor` | Usa API di Quill se accessibile via `window`, altrimenti `innerHTML` + input event |
| **Rich text — TinyMCE** | `.tox-edit-area` | `tinymce.get(id).setContent(html)` se globale disponibile; fallback iframe traversal |
| **Rich text — CKEditor** | `.cke_editable` o `.ck-editor__editable` | CKEditor global API |
| **Rich text — Draft.js / Slate / ProseMirror** | Marker class / attributi | Fallback: focus → `document.execCommand('insertText', ...)` + events |
| **File upload (`input[type=file]`)** | native | **Non-auto**: overlay mostra path dal JSON, utente seleziona manualmente |
| **Drag-drop upload zone** | heuristic: `[class*="dropzone"]`, `ondrop` | Stesso trattamento del file upload |
| **Signature pad** | canvas + library classes | Non supportato — overlay avvisa |
| **Autocomplete async (Select2/Chosen)** | `.select2-container`, `.chosen-container` | Open → type query → attendi risposta async → click match |
| **Multi-select / tag input** | `select[multiple]`, tag libraries | Loop sui valori |
| **Captcha** (reCAPTCHA / hCaptcha / Turnstile) | iframe src match | Skippato, overlay avvisa "risolvi manualmente" |
| **Shadow DOM aperto** | `element.shadowRoot` not null | Scanner ricorre dentro |
| **Shadow DOM chiuso** | `shadowRoot` null nonostante slot | Non penetrabile — overlay avvisa |
| **Iframe same-origin** | `iframe.contentDocument` accessibile (same-origin policy check) | Scanner ricorre |
| **Iframe cross-origin** | `contentDocument` null | Skippato, overlay avvisa |

### Campi dinamici — MutationObserver

- Registrato sul `document.body` prima della compilazione
- Config: `{ childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] }`
- Ogni mutation che aggiunge elementi con input/form → debounced (300ms), poi:
  - Ri-scan solo dei nuovi campi
  - Se nuovi campi mappabili a dati non ancora usati → richiesta AI incrementale con solo i nuovi campi
  - Auto-fill dei nuovi, con dry-run incrementale se configurato

### Synthetic events

Ogni fill dispatcha in ordine: `focus`, `keydown`, `keypress`, `input`, `keyup`, `change`, `blur`.

Per React: usa `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)` per bypassare il wrapper di React.

Per Vue 3 / Angular: dispatch di `input` event standard è sufficiente.

## 6. Error handling, UX edge cases, testing

### Errori gestiti

| Situazione | Comportamento |
|---|---|
| Master password errata | Errore UI, rate limit 5 tentativi / 5 min, poi lockout esponenziale |
| OpenAI API down / 5xx | Retry con backoff (1s → 2s → 4s); dopo 3 fallimenti mostra "AI non disponibile" |
| OpenAI rate limit (429) | Retry con `Retry-After` header; se assente: backoff 10s/30s/60s |
| API key non configurata | Redirect a settings con call-to-action |
| Budget AI esaurito | Blocca chiamate, notifica "budget raggiunto, estendi in settings" |
| Campo non mappabile (confidence < 0.5) | Marca rosso nel dry-run, skippato di default, utente può forzare |
| Widget non supportato | Marca rosso, skippato, elencato nella sintesi finale "Non compilati" |
| Anti-bot visibile (Cloudflare challenge) | Rileva `.cf-turnstile`, avvisa, non procede |
| Popup chiuso durante compilazione | Compilazione continua (guidata da content script + background); overlay in-page resta |
| File upload path non esistente | Skip + avviso |
| Shadow DOM chiuso contiene il form | Avviso "form non accessibile, compila manualmente" |

### UX edge cases

- **Prima apertura:** wizard 3-step (crea vault → master password → import dati)
- **Vault presente ma mai usato in sessione:** popup apre su unlock view
- **Cambio modello OpenAI mid-session:** salvato in settings, applicato alla prossima chiamata
- **Revoca/reset:** pulsante "Cancella vault" con doppia conferma + richiesta master password corrente
- **Export/backup:** esporta file `vault.ufc` (blob cifrato così com'è), l'utente lo salva dove vuole
- **Import/restore:** importa `vault.ufc`, richiede la master password usata al momento del backup
- **Più account sullo stesso sito (es. personale + lavoro):** gestito via `credentials[site].username/password`; se ci sono più entry per lo stesso host, il dry-run mostra uno switch

### Testing strategy

- **Unit tests (Vitest):** per `crypto`, `vault`, `canonical-schema` (validazione), `importer` (con AI mockata), `widget-detector`, `field-taxonomy`
- **Integration tests:** fixture HTML di 20-30 form rappresentativi (Google Forms, Typeform-like, MUI demo, Ant demo, Bootstrap demo, wizard, form dinamico, Shadow DOM, iframe same-origin). Run full pipeline `scan → fill` con AI mockata deterministica.
- **E2E tests (Playwright):** compilazione end-to-end su 3-5 siti pubblici di demo (es. `mui.com/material-ui/react-text-field/`), AI mockata
- **Golden tests per AI prompt:** fixture `(fields, availableKeys) → expected_mapping`; detecta regressioni quando cambiamo il prompt o quando il modello si aggiorna
- **Manual QA checklist:** prima di ogni release, lista di siti reali da validare (incluso `2025disegnipiu.it` come regression del caso d'uso originale)

### Struttura finale della cartella

```
Compiler V2/
├── _legacy/                           # backup V2 attuale (da cancellare dopo milestone 1)
├── manifest.json                      # MV3 riscritto
├── package.json
├── tsconfig.json
├── vite.config.ts                     # rollup/vite + plugin crx
├── src/
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── views/                     # unlock, setup, main, dry-run
│   │   └── styles/
│   ├── content/
│   │   ├── form-scanner.ts
│   │   ├── widget-detector.ts
│   │   ├── form-filler.ts
│   │   ├── mutation-watcher.ts
│   │   └── overlay.ts
│   ├── background/
│   │   ├── service-worker.ts
│   │   ├── orchestrator.ts
│   │   ├── ai-client.ts
│   │   └── cache.ts
│   ├── lib/
│   │   ├── crypto.ts
│   │   ├── vault.ts
│   │   ├── importer.ts
│   │   ├── canonical-schema.ts
│   │   ├── field-taxonomy.ts
│   │   └── messages.ts                # tipi messaggi popup↔bg↔content
│   └── types/
│       ├── canonical.ts
│       ├── field.ts
│       └── mapping.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   │   └── fixtures/                  # HTML snapshots
│   └── e2e/
├── docs/
│   ├── superpowers/specs/             # questo doc
│   ├── user-guide.md
│   └── ai-prompts/                    # prompt template versionati
└── dist/                              # output build, caricato in Chrome
```

### Stack tecnico

- **TypeScript** per tipi forti (fondamentale per lo schema canonico e le interfacce fra moduli)
- **Vite** + `@crxjs/vite-plugin` per build MV3
- **Vitest** per unit test
- **Playwright** per E2E
- **Zod** per validazione runtime dello schema canonico
- **mammoth.js** (già presente) per estrazione testo da DOCX nell'importer
- **js-yaml** per parsing YAML nell'importer
- Nessun framework UI pesante nel popup (vanilla TS + CSS modules) — mantiene il bundle sotto 200KB

## 7. Milestone di alto livello (input per writing-plans)

Queste **non sono il piano di implementazione** (quello verrà nella fase successiva), ma la sequenza logica delle milestone. Ordinamento rivisto perché AI client è dipendenza dell'importer.

1. **M0 — Setup infrastruttura:** backup `_legacy/`, init TypeScript/Vite, manifest V3 minimale, CI locale
2. **M1 — Crypto + Vault:** `lib/crypto`, `lib/vault`, test unitari, popup unlock/setup password
3. **M2 — AI client minimale:** wrapper OpenAI base (completion + tool use), retry, error handling, mock per test
4. **M3 — Schema canonico + Importer:** `canonical-schema` (Zod), importer AI-driven da DOCX/CSV/YAML; setup wizard completo (integra M1+M2+M3)
5. **M4 — Form scanner base:** `form-scanner` per HTML nativo + metadata extraction; overlay base
6. **M5 — Orchestrator + mapping base:** dialogo popup↔bg↔content, chiamata AI per mapping HTML nativo
7. **M6 — Form filler base + Dry-run UI:** fill di HTML nativo + synthetic events; dry-run view con conferma
8. **M7 — Widget detector + strategie custom:** MUI, Ant, Bootstrap, date picker, rich text (da più usati a meno)
9. **M8 — Shadow DOM + iframe same-origin:** traversal ricorsivo dello scanner
10. **M9 — Wizard multi-step + MutationObserver:** navigazione step, campi dinamici
11. **M10 — Cache opt-in + fingerprinting**
12. **M11 — Settings, budget, export/import vault**
13. **M12 — Testing completo (golden, E2E, integration fixtures)**
14. **M13 — QA finale + rimozione `_legacy/`**

## 8. Open questions / da decidere in fase di implementazione

- **Modelli OpenAI definitivi nel dropdown:** da verificare al momento dell'implementazione quali sono disponibili e quali hanno il miglior rapporto qualità/prezzo per questo task
- **Argon2 in browser:** verificare se `@node-rs/argon2-wasm` o una libreria simile funziona dentro un service worker MV3; se no, PBKDF2 è il fallback ufficiale
- **Budget tracking:** se usare solo la metrica token-counting locale o leggere l'usage API di OpenAI (richiede org-admin key, improbabile)
- **i18n UI:** italiano per MVP; struttura predisposta per EN ma non implementata inizialmente
