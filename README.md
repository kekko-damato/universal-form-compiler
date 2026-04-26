# Universal Form Compiler

Estensione Chrome che compila automaticamente qualsiasi form web a partire dai tuoi dati personali (anagrafica, azienda, contatti…) usando OpenAI per il mapping semantico tra i campi del form e i tuoi dati canonici.

- **Multi-documento**: gestisci più "profili" (es. personale, aziendale, cliente A, cliente B) e scegli quello attivo per ogni form.
- **Anti-allucinazione**: l'AI non inventa email, telefoni, indirizzi o dati esterni. Se il dato non c'è nel documento, il campo resta vuoto.
- **Heuristic fast-path**: i campi standard (autocomplete, `name="email"`, `name="cognome"` ecc.) vengono mappati localmente senza chiamata AI → compilazione molto più rapida.
- **Tema chiaro / scuro / sistema**.
- **Privacy**: i dati restano in `chrome.storage.local`. L'AI riceve solo lo stretto necessario, con i path sensibili (IBAN, password, CVV, SSN) sempre rimossi prima dell'invio.

---

## Requisiti

- **Node.js ≥ 18** ([nodejs.org](https://nodejs.org))
- **Google Chrome** (o un browser Chromium-based: Brave, Edge, Arc)
- Una **API key OpenAI** ([platform.openai.com/api-keys](https://platform.openai.com/api-keys))

---

## Installazione

L'estensione non è ancora pubblicata sul Chrome Web Store; va caricata in modalità *developer* dopo aver fatto la build da sorgente.

### macOS

```bash
# 1. Clona il repository
git clone https://github.com/<tuo-utente>/universal-form-compiler.git
cd universal-form-compiler

# 2. Installa le dipendenze
npm install

# 3. Compila l'estensione
npm run build
```

Il comando `build` produce la cartella `dist/` con l'estensione pronta da caricare.

### Windows

Apri **PowerShell** o **CMD** nella cartella dove vuoi clonare:

```powershell
# 1. Clona il repository
git clone https://github.com/<tuo-utente>/universal-form-compiler.git
cd universal-form-compiler

# 2. Installa le dipendenze
npm install

# 3. Compila l'estensione
npm run build
```

> Se PowerShell blocca l'esecuzione di npm con errori del tipo `running scripts is disabled`, lancia una volta:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## Caricamento dell'estensione in Chrome (Mac e Windows)

1. Apri Chrome e vai su `chrome://extensions`
2. In alto a destra, attiva **"Modalità sviluppatore"** / *Developer mode*
3. Click su **"Carica estensione non pacchettizzata"** / *Load unpacked*
4. Seleziona la cartella **`dist/`** all'interno della repo (NON la root del progetto, **`dist/`** specificamente)
5. L'estensione apparirà nella barra. Pinnala (icona puzzle) per averla sempre visibile.

> Ogni volta che modifichi il codice e fai `npm run build`, ricarica l'estensione cliccando l'icona ↻ accanto alla card su `chrome://extensions`.

---

## Primo uso

Al primo click sull'icona dell'estensione si apre il **wizard di setup**:

1. **API Key OpenAI**: incollala (formato `sk-...`)
2. **Modello**: scegli (default `gpt-4o-mini`, economico e veloce)
3. **File dati**: carica un documento con i tuoi dati. Formati supportati:
   - **DOCX** (Word) — es. una scheda anagrafica
   - **CSV** (es. `Nome,Cognome,Email,...`)
   - **YAML** (struttura libera)
   - **TXT** (testo libero — l'AI lo normalizza)
4. L'AI normalizza i dati nello schema interno. Puoi rivederli/modificarli prima di salvare.
5. Fatto: l'estensione è pronta.

---

## Compilare un form

1. Apri qualsiasi pagina con un form (es. iscrizione, calcolo codice fiscale, anagrafica fornitore)
2. Click sull'icona dell'estensione
3. **"Compila form"**
4. L'estensione analizza i campi, propone un mapping coi tuoi dati e li scrive automaticamente. Vedrai:
   - **Identity card** in alto col profilo attivo
   - Bordi colorati sui campi del form (verde = compilato, giallo = da rivedere, rosso = saltato/non disponibile)
   - Schermata **risultato** con eventuali avvisi: campi incerti, non compilabili, file da caricare a mano
   - Sezione collapsible **"Tutti i campi"** che mostra il valore esatto scritto in ogni campo

L'estensione **non inventa mai dati esterni** (email, telefono, indirizzo) non presenti nel documento. Se un campo è obbligatorio ma il dato non c'è, lo lascia vuoto e te lo segnala.

---

## Gestione documenti multipli

Da **Impostazioni → Documenti** puoi:

- Aggiungere altri documenti (`+ Nuovo documento`)
- Rinominare un documento (click sul nome)
- Re-importare un documento (sostituisce i dati senza creare duplicati)
- Eliminare un documento
- Scegliere il documento attivo (icona ✓)

Sul main view, se hai più documenti, appare un selettore inline per cambiare al volo prima di compilare.

---

## Tema

**Impostazioni → Tema**: chiaro, scuro, sistema. Il cambio si applica subito (la preferenza è salvata).

---

## Sviluppo

```bash
# Modalità watch (rebuild automatico ad ogni salvataggio)
npm run dev

# Test
npm test            # esegue tutti i test una volta
npm run test:watch  # watch mode

# Type check
npm run typecheck

# Build di produzione
npm run build
```

Lo stack:

- **TypeScript** + **Vite** (con `@crxjs/vite-plugin` per il bundling MV3)
- **Zod** per la validazione del canonical schema
- **Mammoth** per il parsing DOCX
- **Vitest** + **jsdom** per i test
- Niente framework UI: vanilla TS + CSS variables (palette tokens, dark/light)

Architettura:

```
src/
  background/        ← service worker MV3 (orchestrator, AI client, prompts, heuristics)
  content/           ← content script (form scanner, filler, overlay/widget in-pagina)
  popup/             ← UI dell'estensione (views, design system CSS)
  lib/               ← vault, importer, value-guards, canonical-schema (Zod)
  types/             ← discriminated union dei message types popup ↔ background
tests/unit/          ← test per ogni modulo critico
```

Compile flow ad alto livello:

1. **Phase 1 (locale)**: campi sensibili (IBAN, password, file) vengono identificati senza AI
2. **Phase 1b (heuristic fast-path)**: campi con `autocomplete="email"`, `name="cognome"`, ecc. vengono mappati localmente
3. **Phase 2 (AI Pass 1)**: i campi rimasti vanno all'AI per il mapping semantico (vede solo le chiavi canoniche, non i valori)
4. **Phase 3 (AI Pass 2)**: per i campi rimasti `uncertain` o `unmapped`, una seconda chiamata AI con i valori canonici (sensibili scrubbati) per composizioni / inferenze ammesse (es. genere dal nome)
5. **Validazione anti-hallucination**: ogni valore prodotto dall'AI Pass 2 viene controllato contro il canonical e rifiutato se non tracciabile
6. **Fill**: i valori vengono scritti nei campi della pagina dal content script

---

## Privacy & sicurezza

- I tuoi dati sono **solo in `chrome.storage.local`** del tuo profilo Chrome. Non vengono inviati ad alcun server tranne OpenAI per il mapping/normalizzazione.
- I path **sensibili** (IBAN, password, CVV, SSN, numero passaporto/CF) vengono **sempre rimossi** prima di mandare i dati all'AI Pass 2.
- L'API key OpenAI è salvata in chiaro in `chrome.storage.local` (single-user, profilo Chrome come boundary di sicurezza).
- L'estensione **non** raccoglie analytics, **non** invia telemetria, **non** ha backend proprio.

---

## Licenza

[MIT](LICENSE) — fai quello che vuoi, ma usalo a tuo rischio. Vedi la sezione *No warranty* della licenza.

---

## Contributi

Issues e PR benvenute. Per il setup di sviluppo:

```bash
npm install
npm run typecheck && npm test  # prima di ogni PR
```
