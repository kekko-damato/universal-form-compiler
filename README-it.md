# Compilatore (Universale)

> 🇬🇧 [English version available](README.md)

Estensione Chrome (Manifest V3) che compila automaticamente i form di **qualsiasi sito web** usando l'AI di OpenAI a partire dai documenti che carichi (PDF, DOCX). Pensata per ridurre il tempo di compilazione di moduli ripetitivi mantenendo l'utente sempre in controllo: nessun invio automatico, conferma esplicita prima di ogni azione.

## Caratteristiche

- **Attivazione on-demand**: l'estensione **non si auto-inietta** sui siti che visiti. Si attiva solo quando clicchi l'icona nella toolbar di Chrome. Nessun overhead quando non serve, massima privacy quando navighi normalmente.
- **Widget flottante minimal** monocromatico (tema chiaro/scuro), draggabile, con Shadow DOM così il CSS resta isolato dal sito ospite. Non si chiude cliccando fuori — solo con il bottone ×.
- **Persistenza documenti**: i PDF e DOCX caricati restano salvati tra sessioni in `chrome.storage.local` (fino a 10 MB). Puoi rinominarli, eliminarli, sceglierne uno specifico per la compilazione o usarli tutti insieme.
- **API key OpenAI** salvata nel browser (`chrome.storage.sync`), configurabile dal widget.
- **Modelli AI selezionabili** con costo per 1M token mostrato al momento della scelta:
  - GPT-4.1 (consigliato — migliore qualità/prezzo)
  - GPT-4.1 mini (economico, alta intensità d'uso)
  - GPT-4o mini (massima economia, qualità più bassa)
- **Compatibilità framework**:
  - Form HTML nativi (input/select/textarea/checkbox/radio)
  - Angular Material (mat-form-field, mat-select, mat-checkbox, mat-radio-group, mat-vertical-stepper)
  - Angular Reactive Forms (popola i `FormControl` direttamente via bridge MAIN world quando il framework è in dev mode)
  - Form generici React/Vue/Svelte (via setter nativo + dispatch eventi standard)
- **Cascade-aware**: gestisce correttamente i select dipendenti (es. Nazione → Regione → Provincia → Comune con fetch async delle opzioni dopo ogni selezione padre).
- **Bottone Pulisci**: svuota tutti i campi del form e rimuove temporaneamente i lock `disabled`/`readonly` per permettere la riscrittura.
- **Bottone Compila**:
  1. Sblocca preventivamente i campi compilabili
  2. Scansiona il form e classifica i campi per tipo/sezione
  3. Manda all'AI lo schema dei campi + il testo dei documenti
  4. Applica le risposte con regole anti-invenzione (matching deterministico per CF, P.IVA, IBAN, CAP, date)
  5. Per checkbox del tipo "X coincide con Y" copia automaticamente i valori della sezione di riferimento
  6. Second-pass focused sui campi rimasti vuoti
- **Mai cliccato Invia/Submit/Salva** — il controllo finale resta sempre tuo.
- **Log accordion** in fondo al widget: mostra in dettaglio cosa è stato compilato, da quale documento e con quale fonte testuale.

## Installazione (sviluppatore)

1. `git clone` di questo repository.
2. Apri Chrome → `chrome://extensions/`
3. Attiva "Modalità sviluppatore" (toggle in alto a destra).
4. Clicca "Carica estensione non pacchettizzata" → seleziona la cartella `Compilatore Universale`.
5. Pinna l'icona dell'estensione nella toolbar.
6. Apri un sito qualsiasi → clicca l'icona → si attiva la pillola del widget sulla pagina.
7. ⚙ → incolla la tua **OpenAI API key** → Test → Salva.

## Uso

1. Apri qualsiasi pagina web con un form da compilare.
2. Click sull'icona dell'estensione nella toolbar → appare la pillola "Compilatore" sulla pagina.
3. Click sulla pillola → si apre il widget.
4. (Prima volta) ⚙ → carica i documenti sorgente (PDF/DOCX). Restano salvati per le prossime volte.
5. Seleziona dal dropdown quale documento usare (o "Tutti").
6. Click su **Compila** → l'AI legge i documenti e popola i campi.
7. Verifica visivamente i dati prima di inviare il form manualmente.
8. Per ricominciare premi **Pulisci**.

## Quale modello AI scegliere?

| Modello | Quando usarlo | Costo per 1M token | Costo a Compila |
|---|---|---|---|
| **GPT-4.1** | Default consigliato. Migliore qualità su task strutturati. | $2.00 in / $8.00 out | ~$0.016 |
| **GPT-4.1 mini** | Per uso intensivo (10+ form al giorno). | $0.40 in / $1.60 out | ~$0.0032 |
| **GPT-4o mini** | Solo per test o massima economia. Qualità più bassa. | $0.15 in / $0.60 out | ~$0.0012 |

Una compilazione tipica = ~6000 input + ~500 output token.

## Architettura

```
Compilatore Universale/
├── manifest.json              # Manifest V3, on-demand injection (no content_scripts)
├── background.js              # Service worker: proxy OpenAI, inject content script su click icona
├── content/
│   ├── content.js             # Widget UI + scanner DOM + filler (isolated world)
│   ├── page-bridge.js         # Accesso framework internals (MAIN world, on-demand)
│   └── widget.css             # Wrapper container
├── popup/
│   ├── popup.html
│   └── popup.js               # Toggle widget dalla toolbar
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js             # Pagina opzioni completa (alternativa al widget)
├── lib/
│   ├── pdf.min.js             # PDF.js v3.11.174 (Mozilla, Apache-2.0)
│   ├── pdf.worker.min.js
│   └── mammoth.browser.min.js # Mammoth v1.6.0 (BSD-2)
└── icons/                     # 16, 48, 128
```

### Note tecniche

- **Manifest V3 + on-demand**: niente `content_scripts` nel manifest. `background.js` ascolta `chrome.action.onClicked` e usa `chrome.scripting.executeScript` per iniettare il widget solo quando l'utente lo richiede. Pin in toolbar ≈ feature flag personale.
- **Bridge isolated ↔ MAIN world**: `content.js` gira in isolated world (UI, parsing documenti, chiamate OpenAI), `page-bridge.js` gira in MAIN world per leggere lo stato dei framework JS della pagina (`__ngContext__` di Angular Ivy quando disponibile, fallback a DOM puro). Comunicano via `postMessage`.
- **Compatibilità minima**: Chrome 116+ (richiesta da `chrome.scripting.executeScript({world:'MAIN'})`).

## Privacy

- API key e documenti restano nel tuo browser, mai inviati a server esterni.
- Solo lo **schema dei campi** del form (label, tipo, opzioni — NO valori esistenti) e il **testo estratto dai documenti** vengono inviati a `api.openai.com` quando premi Compila.
- L'estensione non legge cookie, sessioni, password salvate o storage di altri siti.
- Nessuna telemetria, nessun analytics, nessuna chiamata di rete oltre a OpenAI.

## Limiti noti

- Dropdown custom React/Vue/altri framework potrebbero non rispondere ai setter nativi se il framework usa state management interno (Redux, Pinia, Zustand). Il fallback DOM li gestisce parzialmente.
- I campi `<input type="file">` non vengono mai compilati automaticamente per ragioni di sicurezza del browser (l'API non lo permette).
- Captcha, iframe cross-origin e contenuti dietro paywall/login non sono supportati.

## Aggiornare le librerie di terze parti

```bash
cd lib/
curl -L -o pdf.min.js              https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
curl -L -o pdf.worker.min.js       https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js
curl -L -o mammoth.browser.min.js  https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js
```

## Sicurezza

⚠ L'estensione, una volta attivata su una pagina, ha accesso al DOM di quella pagina. Per questo:
- Si attiva solo se clicchi tu l'icona (no auto-load invasivo).
- Non compilare form che contengono credenziali o dati che non vuoi mandare a OpenAI.
- L'API key è salvata in `chrome.storage.sync`: se hai sincronizzazione Chrome attiva, la key viene replicata sui tuoi dispositivi sincronizzati.

## Licenza

MIT.

## Contributing

Pull request benvenute. Per modifiche significative apri prima una issue per discutere il cambiamento.
