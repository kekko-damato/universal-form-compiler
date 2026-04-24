# UFC Phase 1a — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up greenfield TypeScript Chrome extension (Manifest V3), initialize git, implement AES-256-GCM encrypted vault with master-password unlock UI. Produces a loadable Chrome extension that asks for master password, creates an encrypted vault on first run, unlocks on subsequent opens, and enforces session timeout.

**Architecture:** Vite + `@crxjs/vite-plugin` for MV3 bundling. TypeScript strict mode. Service worker as central authority for vault state (session key lives only in background memory, never in popup). Popup communicates with background via typed `chrome.runtime` messages. Crypto uses Web Crypto API (PBKDF2 + AES-GCM, no third-party deps).

**Tech Stack:** TypeScript 5, Vite 5, `@crxjs/vite-plugin` 2, Vitest 1, Zod 3, Web Crypto API (native).

**Reference spec:** [docs/superpowers/specs/2026-04-24-universal-form-compiler-design.md](../specs/2026-04-24-universal-form-compiler-design.md)

**Scope of Phase 1a:** Milestones M0 (infrastructure) and M1 (crypto + vault) from the spec. Phase 1a does **not** include: AI client, importer, form scanning, form filling, dry-run UI. Those are in Phase 1b and 1c.

---

## File Structure

### Created in Phase 1a

| File | Responsibility |
|---|---|
| `package.json` | Node dependencies + scripts |
| `tsconfig.json` | TypeScript strict config |
| `vite.config.ts` | Build config for MV3 |
| `vitest.config.ts` | Test runner config |
| `.gitignore` | Standard ignores |
| `manifest.json` | Chrome extension MV3 manifest |
| `src/types/messages.ts` | Typed message contract popup↔background |
| `src/lib/crypto.ts` | AES-256-GCM encrypt/decrypt + PBKDF2 key derivation |
| `src/lib/vault.ts` | Encrypted vault lifecycle: create, open, lock, session |
| `src/lib/storage.ts` | Thin wrapper over `chrome.storage.local` (mockable) |
| `src/background/service-worker.ts` | Message router + vault state holder |
| `src/popup/index.html` | Popup HTML shell |
| `src/popup/main.ts` | Popup entry (view router) |
| `src/popup/views/setup-password.ts` | First-run: create vault screen |
| `src/popup/views/unlock.ts` | Unlock existing vault screen |
| `src/popup/views/main.ts` | Post-unlock main screen (placeholder for 1b) |
| `src/popup/views/router.ts` | Trivial view router |
| `src/popup/styles/main.css` | Base styles |
| `tests/unit/crypto.test.ts` | Tests for crypto primitives |
| `tests/unit/vault.test.ts` | Tests for vault lifecycle |
| `tests/helpers/chrome-storage-mock.ts` | In-memory fake for tests |

### Moved in Phase 1a

| From | To |
|---|---|
| `assets/` → `_legacy/assets/` | backup (icons will be copied back during infra setup) |
| `background/`, `content/`, `lib/`, `popup/` (existing) → `_legacy/` | backup of V2 code |
| `manifest.json` (existing), `README.md` (existing) → `_legacy/` | backup |

### Unchanged in Phase 1a

Nothing — this is a greenfield rewrite in the same directory.

---

## Task 1: Backup V2 code and initialize git

**Files:**
- Create: `_legacy/` directory
- Move: everything currently in `Compiler V2/` except `docs/`, `.claude/` (if any), and `memory/` into `_legacy/`

- [ ] **Step 1: Move current V2 contents into `_legacy/`**

```bash
cd "/Users/kekko/Desktop/Lavoro/RDD-Italia/Bando Disegni/Compiler V2"
mkdir -p _legacy
# Move everything except docs/ and any hidden claude state
mv assets background content lib popup manifest.json README.md _legacy/ 2>/dev/null
ls -la
```

Expected: top-level now contains `_legacy/` and `docs/` only (plus any `.DS_Store` or dotfiles).

- [ ] **Step 2: Initialize git repository**

```bash
cd "/Users/kekko/Desktop/Lavoro/RDD-Italia/Bando Disegni/Compiler V2"
git init
git config user.email "vdamato@rdditalia.com"
git config user.name "Vincenzo Damato"
```

Expected: `Initialized empty Git repository in .../.git/`.

- [ ] **Step 3: Create `.gitignore`**

Create `.gitignore`:

```
node_modules/
dist/
.DS_Store
*.log
.env
.env.*
coverage/
.vite/
_legacy/
```

- [ ] **Step 4: First commit of backup + spec**

```bash
git add .gitignore docs/
git commit -m "chore: init repo with spec and plans, legacy code kept in _legacy (gitignored)"
```

Expected: `[main (root-commit) ...] chore: init repo...` (or `master` depending on git default).

---

## Task 2: Initialize Node project and install dependencies

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

Create `package.json`:

```json
{
  "name": "universal-form-compiler",
  "version": "0.1.0",
  "description": "Chrome extension that auto-fills any web form from an encrypted JSON vault using OpenAI",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.25",
    "@types/chrome": "^0.0.258",
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vite": "^5.1.0",
    "vitest": "^1.2.0",
    "@vitest/ui": "^1.2.0",
    "jsdom": "^24.0.0"
  },
  "dependencies": {
    "zod": "^3.22.4"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd "/Users/kekko/Desktop/Lavoro/RDD-Italia/Bando Disegni/Compiler V2"
npm install
```

Expected: `node_modules/` populated, no errors. If `@crxjs/vite-plugin` version doesn't resolve, run `npm install @crxjs/vite-plugin@beta` and update `package.json` accordingly.

- [ ] **Step 3: Verify installation**

```bash
npx vite --version
npx vitest --version
npx tsc --version
```

Expected: three version strings, all successful.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: init npm project with vite, vitest, crxjs, zod"
```

---

## Task 3: TypeScript configuration

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: Create `tsconfig.json`**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "node", "vitest/globals"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@tests/*": ["tests/*"]
    },
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist", "_legacy"]
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no output, exit code 0 (no files to check yet is fine; should not error).

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add strict TypeScript config"
```

---

## Task 4: Vite build config with MV3 plugin

**Files:**
- Create: `vite.config.ts`

- [ ] **Step 1: Create `vite.config.ts`**

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' assert { type: 'json' };
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

- [ ] **Step 2: Commit (manifest.json added in Task 6, build will be verified then)**

```bash
git add vite.config.ts
git commit -m "chore: add vite config with crx MV3 plugin"
```

---

## Task 5: Vitest configuration

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/helpers/chrome-storage-mock.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/helpers/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
});
```

- [ ] **Step 2: Create global test setup with chrome.storage mock**

Create `tests/helpers/setup.ts`:

```typescript
import { vi, beforeEach } from 'vitest';
import { createChromeStorageMock } from './chrome-storage-mock';

declare global {
  // eslint-disable-next-line no-var
  var chrome: typeof globalThis.chrome;
}

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: createChromeStorageMock(),
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      lastError: undefined,
    },
  };
});
```

- [ ] **Step 3: Create `tests/helpers/chrome-storage-mock.ts`**

Create `tests/helpers/chrome-storage-mock.ts`:

```typescript
export function createChromeStorageMock() {
  const store = new Map<string, unknown>();

  return {
    get: async (
      keys: string | string[] | null,
    ): Promise<Record<string, unknown>> => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        if (store.has(k)) result[k] = store.get(k);
      }
      return result;
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    },
    remove: async (keys: string | string[]): Promise<void> => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) store.delete(k);
    },
    clear: async (): Promise<void> => {
      store.clear();
    },
  };
}
```

- [ ] **Step 4: Create one sanity test to verify Vitest works**

Create `tests/helpers/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('vitest runs', () => {
    expect(2 + 2).toBe(4);
  });

  it('chrome.storage mock is available', async () => {
    await chrome.storage.local.set({ foo: 'bar' });
    const result = await chrome.storage.local.get('foo');
    expect(result).toEqual({ foo: 'bar' });
  });
});
```

- [ ] **Step 5: Run tests to verify infrastructure**

```bash
npm test
```

Expected: 2 tests passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "chore: add vitest config with chrome.storage mock and sanity test"
```

---

## Task 6: Manifest V3 + placeholder assets

**Files:**
- Create: `manifest.json`
- Copy: `_legacy/assets/icon16.png`, `icon48.png`, `icon128.png` to `src/assets/`

- [ ] **Step 1: Copy icons from legacy**

```bash
mkdir -p src/assets
cp _legacy/assets/icon16.png _legacy/assets/icon48.png _legacy/assets/icon128.png src/assets/
ls src/assets/
```

Expected: three PNG files listed.

- [ ] **Step 2: Create `manifest.json`**

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Universal Form Compiler",
  "version": "0.1.0",
  "description": "Auto-fill any web form from an encrypted JSON vault using OpenAI.",
  "author": "RDD Italia",
  "icons": {
    "16": "src/assets/icon16.png",
    "48": "src/assets/icon48.png",
    "128": "src/assets/icon128.png"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "Universal Form Compiler"
  },
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "permissions": [
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://api.openai.com/*"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Note: `host_permissions` limited to OpenAI API only for Phase 1a (content scripts come in 1c and we'll expand `<all_urls>` then).

- [ ] **Step 3: Commit**

```bash
git add manifest.json src/assets/
git commit -m "chore: add MV3 manifest and copy icons from legacy"
```

---

## Task 7: Minimal service worker and popup — verify extension loads

**Files:**
- Create: `src/background/service-worker.ts`
- Create: `src/popup/index.html`
- Create: `src/popup/main.ts`
- Create: `src/popup/styles/main.css`

- [ ] **Step 1: Create minimal service worker**

Create `src/background/service-worker.ts`:

```typescript
console.log('[UFC] service worker booted');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UFC] onInstalled');
});
```

- [ ] **Step 2: Create popup HTML shell**

Create `src/popup/index.html`:

```html
<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Universal Form Compiler</title>
    <link rel="stylesheet" href="./styles/main.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Create popup entry**

Create `src/popup/main.ts`:

```typescript
const app = document.getElementById('app');
if (app) {
  app.textContent = 'UFC popup OK';
}
```

- [ ] **Step 4: Create base CSS**

Create `src/popup/styles/main.css`:

```css
:root {
  --bg: #0f172a;
  --fg: #f1f5f9;
  --accent: #38bdf8;
  --error: #f87171;
  --muted: #64748b;
  --input-bg: #1e293b;
  --input-border: #334155;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 360px;
  min-height: 400px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
}

#app {
  padding: 16px;
}

button {
  font: inherit;
  cursor: pointer;
  padding: 10px 16px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--bg);
  border-radius: 6px;
  font-weight: 600;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary {
  background: transparent;
  color: var(--accent);
}

input[type="password"], input[type="text"], input[type="email"] {
  font: inherit;
  width: 100%;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--fg);
  border-radius: 6px;
}

input:focus {
  outline: none;
  border-color: var(--accent);
}

.error {
  color: var(--error);
  font-size: 13px;
  margin-top: 8px;
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

h1, h2, h3 {
  margin-bottom: 12px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}

.form-group {
  margin-bottom: 14px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
```

- [ ] **Step 5: Build and test load in Chrome**

```bash
npm run build
```

Expected: `dist/` created, no errors.

Then manually in Chrome:
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Click the extension icon in toolbar
6. Popup should show "UFC popup OK" on dark background
7. Service worker: click "Inspect views: service worker" link on the extension card, should see `[UFC] service worker booted` in console

Expected: all above work.

- [ ] **Step 6: Commit**

```bash
git add src/background src/popup
git commit -m "feat(infra): minimal service worker + popup shell, extension loads in Chrome"
```

---

## Task 8: Typed message contract

**Files:**
- Create: `src/types/messages.ts`

- [ ] **Step 1: Create message types**

Create `src/types/messages.ts`:

```typescript
// Discriminated union of all messages exchanged between popup and background.
// Each request has a matching response type.

export type VaultState =
  | { kind: 'no_vault' }
  | { kind: 'locked' }
  | { kind: 'unlocked' };

// --- Requests from popup to background ---

export type GetVaultStateRequest = { type: 'vault/getState' };
export type GetVaultStateResponse = { state: VaultState };

export type CreateVaultRequest = {
  type: 'vault/create';
  masterPassword: string;
};
export type CreateVaultResponse =
  | { ok: true }
  | { ok: false; error: string };

export type UnlockVaultRequest = {
  type: 'vault/unlock';
  masterPassword: string;
};
export type UnlockVaultResponse =
  | { ok: true }
  | { ok: false; error: string; attemptsRemaining?: number };

export type LockVaultRequest = { type: 'vault/lock' };
export type LockVaultResponse = { ok: true };

export type DeleteVaultRequest = {
  type: 'vault/delete';
  masterPassword: string;
};
export type DeleteVaultResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Discriminated union ---

export type PopupRequest =
  | GetVaultStateRequest
  | CreateVaultRequest
  | UnlockVaultRequest
  | LockVaultRequest
  | DeleteVaultRequest;

export type PopupResponse =
  | GetVaultStateResponse
  | CreateVaultResponse
  | UnlockVaultResponse
  | LockVaultResponse
  | DeleteVaultResponse;

// Helper to map request → response type at compile time.
export type ResponseFor<R extends PopupRequest> =
  R extends GetVaultStateRequest ? GetVaultStateResponse :
  R extends CreateVaultRequest ? CreateVaultResponse :
  R extends UnlockVaultRequest ? UnlockVaultResponse :
  R extends LockVaultRequest ? LockVaultResponse :
  R extends DeleteVaultRequest ? DeleteVaultResponse :
  never;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/messages.ts
git commit -m "feat(types): typed popup↔background message contract"
```

---

## Task 9: crypto.ts — PBKDF2 key derivation (TDD)

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `tests/unit/crypto.test.ts`

- [ ] **Step 1: Write failing test for `deriveKey`**

Create `tests/unit/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveKey, randomBytes } from '@/lib/crypto';

describe('deriveKey', () => {
  it('derives a 256-bit CryptoKey from a password + salt via PBKDF2', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('correct horse battery staple', salt, {
      iterations: 100_000,
    });
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('same password + salt derives the same key material', async () => {
    const salt = randomBytes(32);
    const k1 = await deriveKey('hunter2', salt, { iterations: 10_000 });
    const k2 = await deriveKey('hunter2', salt, { iterations: 10_000 });

    // Keys can't be directly compared, but we can test by encrypting
    // the same plaintext with the same IV and checking ciphertext matches.
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('test');
    const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, plaintext));
    const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, plaintext));
    expect(Array.from(c1)).toEqual(Array.from(c2));
  });

  it('different salts produce different keys', async () => {
    const s1 = randomBytes(32);
    const s2 = randomBytes(32);
    const k1 = await deriveKey('samepw', s1, { iterations: 10_000 });
    const k2 = await deriveKey('samepw', s2, { iterations: 10_000 });
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('test');
    const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, plaintext));
    const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, plaintext));
    expect(Array.from(c1)).not.toEqual(Array.from(c2));
  });
});

describe('randomBytes', () => {
  it('returns a Uint8Array of requested length', () => {
    const r = randomBytes(16);
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r.length).toBe(16);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/crypto'".

- [ ] **Step 3: Implement `deriveKey` and `randomBytes`**

Create `src/lib/crypto.ts`:

```typescript
export interface DeriveKeyOptions {
  iterations?: number;
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-512';
}

const DEFAULT_ITERATIONS = 600_000;

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  opts: DeriveKeyOptions = {},
): Promise<CryptoKey> {
  const { iterations = DEFAULT_ITERATIONS, hash = 'SHA-256' } = opts;

  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt'],
  );
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/unit/crypto.test.ts
git commit -m "feat(crypto): deriveKey via PBKDF2-SHA256 and randomBytes helper"
```

---

## Task 10: crypto.ts — encrypt/decrypt roundtrip (TDD)

**Files:**
- Modify: `src/lib/crypto.ts`
- Modify: `tests/unit/crypto.test.ts`

- [ ] **Step 1: Append failing tests for encrypt/decrypt**

Append to `tests/unit/crypto.test.ts`:

```typescript
import { encrypt, decrypt, type EncryptedBlob } from '@/lib/crypto';

describe('encrypt / decrypt', () => {
  it('encrypts and decrypts plaintext roundtrip', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('hello vault');

    const blob = await encrypt(key, plaintext);
    expect(blob.ciphertext).toBeInstanceOf(Uint8Array);
    expect(blob.iv).toBeInstanceOf(Uint8Array);
    expect(blob.iv.length).toBe(12);

    const decrypted = await decrypt(key, blob);
    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('different encryptions of same plaintext produce different ciphertexts (random IV)', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('same message');

    const b1 = await encrypt(key, plaintext);
    const b2 = await encrypt(key, plaintext);
    expect(Array.from(b1.iv)).not.toEqual(Array.from(b2.iv));
    expect(Array.from(b1.ciphertext)).not.toEqual(Array.from(b2.ciphertext));
  });

  it('decrypt with wrong key throws', async () => {
    const salt = randomBytes(32);
    const k1 = await deriveKey('right', salt, { iterations: 10_000 });
    const k2 = await deriveKey('wrong', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('secret');

    const blob = await encrypt(k1, plaintext);
    await expect(decrypt(k2, blob)).rejects.toThrow();
  });

  it('decrypt with tampered ciphertext throws', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('authentic');

    const blob = await encrypt(key, plaintext);
    // Flip a bit in ciphertext
    const tampered: EncryptedBlob = {
      iv: blob.iv,
      ciphertext: new Uint8Array(blob.ciphertext),
    };
    tampered.ciphertext[0] ^= 0x01;
    await expect(decrypt(key, tampered)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: FAIL, `encrypt` / `decrypt` not exported.

- [ ] **Step 3: Implement encrypt/decrypt**

Append to `src/lib/crypto.ts`:

```typescript
export interface EncryptedBlob {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  return { iv, ciphertext };
}

export async function decrypt(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.iv },
    key,
    blob.ciphertext,
  );
  return new Uint8Array(result);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/unit/crypto.test.ts
git commit -m "feat(crypto): AES-256-GCM encrypt/decrypt with random IV"
```

---

## Task 11: crypto.ts — base64 serialization for storage (TDD)

**Files:**
- Modify: `src/lib/crypto.ts`
- Modify: `tests/unit/crypto.test.ts`

- [ ] **Step 1: Append failing test**

Append to `tests/unit/crypto.test.ts`:

```typescript
import { toBase64, fromBase64 } from '@/lib/crypto';

describe('base64 helpers', () => {
  it('roundtrips Uint8Array through base64', () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
    const encoded = toBase64(original);
    expect(typeof encoded).toBe('string');
    const decoded = fromBase64(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles empty array', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('').length).toBe(0);
  });

  it('handles 32-byte random data', () => {
    const original = randomBytes(32);
    const roundtripped = fromBase64(toBase64(original));
    expect(Array.from(roundtripped)).toEqual(Array.from(original));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: FAIL, `toBase64`/`fromBase64` not exported.

- [ ] **Step 3: Implement base64 helpers**

Append to `src/lib/crypto.ts`:

```typescript
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  if (b64 === '') return new Uint8Array(0);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/crypto.test.ts
```

Expected: 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/unit/crypto.test.ts
git commit -m "feat(crypto): base64 helpers for storage serialization"
```

---

## Task 12: storage.ts — chrome.storage.local wrapper (TDD)

**Files:**
- Create: `src/lib/storage.ts`
- Create: `tests/unit/storage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/storage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readKey, writeKey, removeKey, clearAll } from '@/lib/storage';

describe('storage wrapper', () => {
  it('returns undefined for missing key', async () => {
    const val = await readKey<string>('missing');
    expect(val).toBeUndefined();
  });

  it('writes and reads a string value', async () => {
    await writeKey('foo', 'bar');
    expect(await readKey<string>('foo')).toBe('bar');
  });

  it('writes and reads a structured value', async () => {
    const payload = { a: 1, b: [2, 3], c: { d: 'x' } };
    await writeKey('complex', payload);
    expect(await readKey('complex')).toEqual(payload);
  });

  it('removes a key', async () => {
    await writeKey('gone', 'soon');
    await removeKey('gone');
    expect(await readKey('gone')).toBeUndefined();
  });

  it('clears all keys', async () => {
    await writeKey('a', 1);
    await writeKey('b', 2);
    await clearAll();
    expect(await readKey('a')).toBeUndefined();
    expect(await readKey('b')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/storage.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement storage wrapper**

Create `src/lib/storage.ts`:

```typescript
export async function readKey<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function writeKey<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeKey(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/storage.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts tests/unit/storage.test.ts
git commit -m "feat(storage): typed wrapper over chrome.storage.local"
```

---

## Task 13: vault.ts — vault blob format + createVault (TDD)

**Files:**
- Create: `src/lib/vault.ts`
- Create: `tests/unit/vault.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/vault.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createVault, hasVault, readVaultBlob, VAULT_STORAGE_KEY } from '@/lib/vault';
import { clearAll, readKey } from '@/lib/storage';

describe('vault: createVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('writes an encrypted blob under the vault key', async () => {
    await createVault('my master password 1234');
    const raw = await readKey<unknown>(VAULT_STORAGE_KEY);
    expect(raw).toBeDefined();
  });

  it('blob has required fields (v, kdf, kdfParams, salt, iv, ciphertext)', async () => {
    await createVault('pw');
    const blob = await readVaultBlob();
    expect(blob).not.toBeNull();
    expect(blob!.v).toBe(1);
    expect(blob!.kdf).toBe('pbkdf2');
    expect(typeof blob!.kdfParams.iterations).toBe('number');
    expect(typeof blob!.salt).toBe('string');
    expect(typeof blob!.iv).toBe('string');
    expect(typeof blob!.ciphertext).toBe('string');
  });

  it('hasVault() reflects presence', async () => {
    expect(await hasVault()).toBe(false);
    await createVault('pw');
    expect(await hasVault()).toBe(true);
  });

  it('createVault throws if password too short', async () => {
    await expect(createVault('short')).rejects.toThrow(/at least 12/i);
  });

  it('createVault throws if vault already exists', async () => {
    await createVault('pw1234567890abc');
    await expect(createVault('pw1234567890abc')).rejects.toThrow(/already exists/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement vault blob + createVault**

Create `src/lib/vault.ts`:

```typescript
import {
  deriveKey,
  encrypt,
  randomBytes,
  toBase64,
  fromBase64,
  type EncryptedBlob,
} from './crypto';
import { readKey, writeKey } from './storage';

export const VAULT_STORAGE_KEY = 'ufc_vault_v1';
export const MIN_MASTER_PASSWORD_LENGTH = 12;

const PBKDF2_ITERATIONS = 600_000;

export interface VaultBlob {
  v: 1;
  kdf: 'pbkdf2';
  kdfParams: { iterations: number; hash: 'SHA-256' };
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
}

export interface VaultData {
  version: 1;
  createdAt: string;  // ISO timestamp
  data: Record<string, unknown>; // canonical data added in Phase 1b
}

export async function hasVault(): Promise<boolean> {
  const raw = await readKey<VaultBlob>(VAULT_STORAGE_KEY);
  return raw !== undefined;
}

export async function readVaultBlob(): Promise<VaultBlob | null> {
  const raw = await readKey<VaultBlob>(VAULT_STORAGE_KEY);
  return raw ?? null;
}

export async function createVault(masterPassword: string): Promise<void> {
  if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(
      `Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`,
    );
  }
  if (await hasVault()) {
    throw new Error('Vault already exists');
  }

  const salt = randomBytes(32);
  const key = await deriveKey(masterPassword, salt, {
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256',
  });

  const initial: VaultData = {
    version: 1,
    createdAt: new Date().toISOString(),
    data: {},
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(initial));
  const encrypted = await encrypt(key, plaintext);

  const blob: VaultBlob = {
    v: 1,
    kdf: 'pbkdf2',
    kdfParams: { iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    salt: toBase64(salt),
    iv: toBase64(encrypted.iv),
    ciphertext: toBase64(encrypted.ciphertext),
  };
  await writeKey(VAULT_STORAGE_KEY, blob);
}
```

- [ ] **Step 4: Run — expect pass**

Use lower iterations for tests to speed them up; update `PBKDF2_ITERATIONS` check or add override. To keep this task focused, accept tests may take a few seconds. If test times out, adjust vitest config to increase timeout:

Append to `vitest.config.ts` inside `test:`:

```typescript
    testTimeout: 15000,
```

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: 5 tests passing (may take 5-10s due to real PBKDF2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault.ts tests/unit/vault.test.ts vitest.config.ts
git commit -m "feat(vault): createVault with PBKDF2-AES-GCM encryption"
```

---

## Task 14: vault.ts — openVault / decrypt + wrong password handling (TDD)

**Files:**
- Modify: `src/lib/vault.ts`
- Modify: `tests/unit/vault.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/vault.test.ts`:

```typescript
import { openVault, VaultLockedError, WrongPasswordError } from '@/lib/vault';

describe('vault: openVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('decrypts vault with correct password and returns VaultData', async () => {
    await createVault('correct password here');
    const data = await openVault('correct password here');
    expect(data.version).toBe(1);
    expect(data.data).toEqual({});
    expect(typeof data.createdAt).toBe('string');
  });

  it('throws WrongPasswordError on incorrect password', async () => {
    await createVault('correct password here');
    await expect(openVault('wrong password yes')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('throws VaultLockedError when no vault exists', async () => {
    await expect(openVault('any password')).rejects.toBeInstanceOf(
      VaultLockedError,
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: FAIL, `openVault` / errors not exported.

- [ ] **Step 3: Implement openVault + error classes**

Append to `src/lib/vault.ts`:

```typescript
import { decrypt } from './crypto';

export class VaultLockedError extends Error {
  constructor() {
    super('No vault found');
    this.name = 'VaultLockedError';
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong master password');
    this.name = 'WrongPasswordError';
  }
}

export async function openVault(masterPassword: string): Promise<VaultData> {
  const blob = await readVaultBlob();
  if (!blob) throw new VaultLockedError();

  const salt = fromBase64(blob.salt);
  const key = await deriveKey(masterPassword, salt, {
    iterations: blob.kdfParams.iterations,
    hash: blob.kdfParams.hash,
  });

  const encryptedBlob: EncryptedBlob = {
    iv: fromBase64(blob.iv),
    ciphertext: fromBase64(blob.ciphertext),
  };

  let plaintext: Uint8Array;
  try {
    plaintext = await decrypt(key, encryptedBlob);
  } catch {
    throw new WrongPasswordError();
  }

  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as VaultData;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault.ts tests/unit/vault.test.ts
git commit -m "feat(vault): openVault with typed errors for locked / wrong password"
```

---

## Task 15: vault.ts — writeVaultData (updates with existing key, re-encrypts) (TDD)

**Files:**
- Modify: `src/lib/vault.ts`
- Modify: `tests/unit/vault.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/unit/vault.test.ts`:

```typescript
import { writeVaultData } from '@/lib/vault';

describe('vault: writeVaultData', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('updates vault data and roundtrips via openVault', async () => {
    await createVault('my strong pw 123');
    const first = await openVault('my strong pw 123');
    expect(first.data).toEqual({});

    const updated: VaultData = {
      ...first,
      data: { foo: 'bar', n: 42 },
    };
    await writeVaultData(updated, 'my strong pw 123');

    const reopened = await openVault('my strong pw 123');
    expect(reopened.data).toEqual({ foo: 'bar', n: 42 });
  });

  it('writeVaultData with wrong password throws', async () => {
    await createVault('my strong pw 123');
    const d = await openVault('my strong pw 123');
    await expect(
      writeVaultData(d, 'different password!'),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
```

Note: The test imports `VaultData` at the top of the file — ensure that import exists:

Modify the top of `tests/unit/vault.test.ts` so imports include `type VaultData`:

```typescript
import type { VaultData } from '@/lib/vault';
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: FAIL, `writeVaultData` not exported.

- [ ] **Step 3: Implement writeVaultData**

Append to `src/lib/vault.ts`:

```typescript
/**
 * Re-encrypts the vault with fresh IV using the given master password.
 * Verifies the password by attempting decryption first.
 */
export async function writeVaultData(
  data: VaultData,
  masterPassword: string,
): Promise<void> {
  // Verify password by re-reading existing blob
  await openVault(masterPassword); // throws if wrong

  const blob = await readVaultBlob();
  if (!blob) throw new VaultLockedError();

  const salt = fromBase64(blob.salt);
  const key = await deriveKey(masterPassword, salt, {
    iterations: blob.kdfParams.iterations,
    hash: blob.kdfParams.hash,
  });

  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await encrypt(key, plaintext);

  const updated: VaultBlob = {
    ...blob,
    iv: toBase64(encrypted.iv),
    ciphertext: toBase64(encrypted.ciphertext),
  };
  await writeKey(VAULT_STORAGE_KEY, updated);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault.ts tests/unit/vault.test.ts
git commit -m "feat(vault): writeVaultData re-encrypts with fresh IV after password verification"
```

---

## Task 16: vault.ts — deleteVault (TDD)

**Files:**
- Modify: `src/lib/vault.ts`
- Modify: `tests/unit/vault.test.ts`

- [ ] **Step 1: Append failing test**

Append to `tests/unit/vault.test.ts`:

```typescript
import { deleteVault } from '@/lib/vault';

describe('vault: deleteVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('requires correct password and removes storage key', async () => {
    await createVault('pw very long here');
    expect(await hasVault()).toBe(true);

    await deleteVault('pw very long here');
    expect(await hasVault()).toBe(false);
  });

  it('wrong password throws and does not delete', async () => {
    await createVault('pw very long here');
    await expect(deleteVault('wrong pw is wrong')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(await hasVault()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: FAIL, `deleteVault` not exported.

- [ ] **Step 3: Implement deleteVault**

Append to `src/lib/vault.ts`:

```typescript
import { removeKey } from './storage';

export async function deleteVault(masterPassword: string): Promise<void> {
  await openVault(masterPassword); // verifies password; throws otherwise
  await removeKey(VAULT_STORAGE_KEY);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault.ts tests/unit/vault.test.ts
git commit -m "feat(vault): deleteVault requires password verification"
```

---

## Task 17: Session manager in service worker (in-memory key + timeout) (TDD)

**Files:**
- Create: `src/background/session.ts`
- Create: `tests/unit/session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSessionManager } from '@/background/session';

describe('session manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts locked', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('unlock stores password and reports unlocked', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('my password');
    expect(sm.getState()).toBe('unlocked');
    expect(sm.getPassword()).toBe('my password');
  });

  it('lock clears password', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    sm.lock();
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('auto-locks after timeout', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    expect(sm.getState()).toBe('unlocked');
    vi.advanceTimersByTime(60_001);
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('touch() resets the timeout', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    vi.advanceTimersByTime(30_000);
    sm.touch();
    vi.advanceTimersByTime(40_000);
    expect(sm.getState()).toBe('unlocked'); // 40s since touch < 60s
    vi.advanceTimersByTime(20_001);
    expect(sm.getState()).toBe('locked');
  });

  it('onStateChange callback fires on lock/unlock', () => {
    const cb = vi.fn();
    const sm = createSessionManager({ timeoutMs: 60_000, onStateChange: cb });
    sm.unlock('pw');
    expect(cb).toHaveBeenCalledWith('unlocked');
    sm.lock();
    expect(cb).toHaveBeenCalledWith('locked');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/session.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement session manager**

Create `src/background/session.ts`:

```typescript
export type SessionState = 'locked' | 'unlocked';

export interface SessionManagerOptions {
  timeoutMs: number;
  onStateChange?: (state: SessionState) => void;
}

export interface SessionManager {
  getState(): SessionState;
  getPassword(): string | null;
  unlock(password: string): void;
  lock(): void;
  touch(): void;
}

export function createSessionManager(
  opts: SessionManagerOptions,
): SessionManager {
  let password: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTimeout(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      lock();
    }, opts.timeoutMs);
  }

  function lock(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const wasUnlocked = password !== null;
    password = null;
    if (wasUnlocked) opts.onStateChange?.('locked');
  }

  function unlock(pw: string): void {
    password = pw;
    scheduleTimeout();
    opts.onStateChange?.('unlocked');
  }

  function touch(): void {
    if (password !== null) scheduleTimeout();
  }

  function getState(): SessionState {
    return password === null ? 'locked' : 'unlocked';
  }

  function getPassword(): string | null {
    return password;
  }

  return { getState, getPassword, unlock, lock, touch };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/session.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/background/session.ts tests/unit/session.test.ts
git commit -m "feat(session): in-memory session manager with configurable timeout"
```

---

## Task 18: Service worker message handler (vault commands)

**Files:**
- Modify: `src/background/service-worker.ts`

- [ ] **Step 1: Replace service worker with message handler**

Replace `src/background/service-worker.ts`:

```typescript
import {
  hasVault,
  createVault,
  openVault,
  deleteVault,
  WrongPasswordError,
  VaultLockedError,
} from '@/lib/vault';
import { createSessionManager } from './session';
import type {
  PopupRequest,
  PopupResponse,
  VaultState,
} from '@/types/messages';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const session = createSessionManager({
  timeoutMs: SESSION_TIMEOUT_MS,
  onStateChange: (state) => {
    console.log('[UFC] session', state);
  },
});

async function computeVaultState(): Promise<VaultState> {
  if (!(await hasVault())) return { kind: 'no_vault' };
  return session.getState() === 'unlocked'
    ? { kind: 'unlocked' }
    : { kind: 'locked' };
}

async function handleRequest(req: PopupRequest): Promise<PopupResponse> {
  switch (req.type) {
    case 'vault/getState':
      return { state: await computeVaultState() };

    case 'vault/create':
      try {
        await createVault(req.masterPassword);
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

    case 'vault/unlock':
      try {
        await openVault(req.masterPassword);
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          return { ok: false, error: 'Wrong master password' };
        }
        if (err instanceof VaultLockedError) {
          return { ok: false, error: 'No vault exists' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

    case 'vault/lock':
      session.lock();
      return { ok: true };

    case 'vault/delete':
      try {
        await deleteVault(req.masterPassword);
        session.lock();
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          return { ok: false, error: 'Wrong master password' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
  }
}

chrome.runtime.onMessage.addListener(
  (req: PopupRequest, _sender, sendResponse) => {
    // Refresh session activity on any message
    session.touch();

    handleRequest(req)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[UFC] message handler error', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });

    return true; // keep channel open for async response
  },
);

console.log('[UFC] service worker ready');
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat(background): wire vault commands to message handler with session"
```

---

## Task 19: Popup view router

**Files:**
- Create: `src/popup/views/router.ts`
- Create: `src/popup/views/main.ts` (placeholder)

- [ ] **Step 1: Create router**

Create `src/popup/views/router.ts`:

```typescript
export type ViewId = 'setup-password' | 'unlock' | 'main';

export interface ViewRenderer {
  render(container: HTMLElement): void | Promise<void>;
}

export interface Router {
  show(id: ViewId): Promise<void>;
}

export function createRouter(
  container: HTMLElement,
  views: Record<ViewId, () => ViewRenderer>,
): Router {
  return {
    async show(id: ViewId) {
      container.innerHTML = '';
      const view = views[id]();
      await view.render(container);
    },
  };
}
```

- [ ] **Step 2: Create placeholder main view**

Create `src/popup/views/main.ts`:

```typescript
import type { ViewRenderer } from './router';

export function createMainView(onLock: () => Promise<void>): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Vault unlocked</h1>
        <p class="muted">
          Phase 1a complete. Compile and import features arrive in Phase 1b/1c.
        </p>
        <div class="actions">
          <button id="lock-btn" class="secondary">Lock vault</button>
        </div>
      `;
      const btn = container.querySelector<HTMLButtonElement>('#lock-btn');
      btn?.addEventListener('click', async () => {
        await onLock();
      });
    },
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/popup/views/
git commit -m "feat(popup): view router + placeholder main view"
```

---

## Task 20: Popup — setup-password view

**Files:**
- Create: `src/popup/views/setup-password.ts`

- [ ] **Step 1: Create setup view**

Create `src/popup/views/setup-password.ts`:

```typescript
import type { ViewRenderer } from './router';
import type { CreateVaultRequest, CreateVaultResponse } from '@/types/messages';

const MIN_LEN = 12;

export function createSetupPasswordView(
  onCreated: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Crea il tuo vault</h1>
        <p class="muted">
          La master password cifra i tuoi dati in locale. Non può essere
          recuperata — se la dimentichi, i dati sono persi.
        </p>

        <div class="form-group">
          <label for="pw1">Master password (min ${MIN_LEN} caratteri)</label>
          <input id="pw1" type="password" autocomplete="new-password" />
        </div>

        <div class="form-group">
          <label for="pw2">Ripeti master password</label>
          <input id="pw2" type="password" autocomplete="new-password" />
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="create-btn" disabled>Crea vault</button>
        </div>
      `;

      const pw1 = container.querySelector<HTMLInputElement>('#pw1')!;
      const pw2 = container.querySelector<HTMLInputElement>('#pw2')!;
      const btn = container.querySelector<HTMLButtonElement>('#create-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      function validate(): string | null {
        if (pw1.value.length < MIN_LEN) {
          return `Almeno ${MIN_LEN} caratteri`;
        }
        if (pw1.value !== pw2.value) {
          return 'Le password non coincidono';
        }
        return null;
      }

      function update(): void {
        const problem = validate();
        btn.disabled = problem !== null;
        err.hidden = problem === null;
        err.textContent = problem ?? '';
      }

      pw1.addEventListener('input', update);
      pw2.addEventListener('input', update);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const req: CreateVaultRequest = {
          type: 'vault/create',
          masterPassword: pw1.value,
        };
        const res = (await chrome.runtime.sendMessage(req)) as CreateVaultResponse;
        if (res.ok) {
          await onCreated();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          btn.disabled = false;
        }
      });

      pw1.focus();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/popup/views/setup-password.ts
git commit -m "feat(popup): setup-password view with validation"
```

---

## Task 21: Popup — unlock view

**Files:**
- Create: `src/popup/views/unlock.ts`

- [ ] **Step 1: Create unlock view**

Create `src/popup/views/unlock.ts`:

```typescript
import type { ViewRenderer } from './router';
import type { UnlockVaultRequest, UnlockVaultResponse } from '@/types/messages';

export function createUnlockView(
  onUnlocked: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Vault bloccato</h1>
        <p class="muted">Inserisci la master password per sbloccare.</p>

        <div class="form-group">
          <label for="pw">Master password</label>
          <input id="pw" type="password" autocomplete="current-password" />
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="unlock-btn">Sblocca</button>
        </div>
      `;

      const pw = container.querySelector<HTMLInputElement>('#pw')!;
      const btn = container.querySelector<HTMLButtonElement>('#unlock-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      async function submit(): Promise<void> {
        if (pw.value.length === 0) return;
        btn.disabled = true;
        err.hidden = true;

        const req: UnlockVaultRequest = {
          type: 'vault/unlock',
          masterPassword: pw.value,
        };
        const res = (await chrome.runtime.sendMessage(req)) as UnlockVaultResponse;
        if (res.ok) {
          await onUnlocked();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          pw.value = '';
          pw.focus();
          btn.disabled = false;
        }
      }

      btn.addEventListener('click', () => {
        void submit();
      });
      pw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void submit();
      });

      pw.focus();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/popup/views/unlock.ts
git commit -m "feat(popup): unlock view with Enter-to-submit"
```

---

## Task 22: Popup main entry — wire router and boot

**Files:**
- Modify: `src/popup/main.ts`

- [ ] **Step 1: Replace popup entry with wiring**

Replace `src/popup/main.ts`:

```typescript
import { createRouter, type Router, type ViewRenderer } from './views/router';
import { createSetupPasswordView } from './views/setup-password';
import { createUnlockView } from './views/unlock';
import { createMainView } from './views/main';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  LockVaultRequest,
  LockVaultResponse,
} from '@/types/messages';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const req: GetVaultStateRequest = { type: 'vault/getState' };
  const res = (await chrome.runtime.sendMessage(req)) as GetVaultStateResponse;
  return res.state;
}

async function lockVault(): Promise<void> {
  const req: LockVaultRequest = { type: 'vault/lock' };
  await chrome.runtime.sendMessage<LockVaultRequest, LockVaultResponse>(req);
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

  let router: Router;

  async function routeByState(): Promise<void> {
    const state = await getVaultState();
    switch (state.kind) {
      case 'no_vault':
        await router.show('setup-password');
        return;
      case 'locked':
        await router.show('unlock');
        return;
      case 'unlocked':
        await router.show('main');
        return;
    }
  }

  const views: Record<string, () => ViewRenderer> = {
    'setup-password': () => createSetupPasswordView(routeByState),
    unlock: () => createUnlockView(routeByState),
    main: () =>
      createMainView(async () => {
        await lockVault();
        await routeByState();
      }),
  };

  router = createRouter(container, views as never);
  await routeByState();
}

void boot();
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: `dist/` rebuilt, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/popup/main.ts
git commit -m "feat(popup): wire router + state-driven view selection"
```

---

## Task 23: Rate limiting on unlock attempts (TDD)

**Files:**
- Create: `src/background/rate-limiter.ts`
- Create: `tests/unit/rate-limiter.test.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/types/messages.ts`

- [ ] **Step 1: Write failing tests for rate limiter**

Create `tests/unit/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createRateLimiter } from '@/background/rate-limiter';

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxAttempts within the window', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(rl.check()).toEqual({ allowed: true });
      rl.recordFailure();
    }
    expect(rl.check()).toEqual({
      allowed: false,
      lockoutMs: expect.any(Number),
      attemptsRemaining: 0,
    });
  });

  it('reports attemptsRemaining correctly', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    expect(rl.check().allowed).toBe(true);
    rl.recordFailure();
    expect(rl.check().allowed).toBe(true);
    rl.recordFailure();
    rl.recordFailure();
    const check = rl.check();
    expect(check.allowed).toBe(true);
    if (check.allowed) {
      expect(check.attemptsRemaining).toBe(2);
    }
  });

  it('resets on recordSuccess', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) rl.recordFailure();
    expect(rl.check().allowed).toBe(false);

    rl.recordSuccess();
    expect(rl.check().allowed).toBe(true);
  });

  it('drops old attempts after window', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) rl.recordFailure();
    expect(rl.check().allowed).toBe(false);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(rl.check().allowed).toBe(true);
  });

  it('exponential backoff across lockouts', () => {
    const rl = createRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      baseLockoutMs: 1000,
    });
    for (let i = 0; i < 3; i++) rl.recordFailure();
    const first = rl.check();
    expect(first.allowed).toBe(false);
    if (!first.allowed) expect(first.lockoutMs).toBe(1000);

    vi.advanceTimersByTime(1001);
    rl.recordFailure(); // triggers next lockout level
    const second = rl.check();
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.lockoutMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/rate-limiter.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement rate limiter**

Create `src/background/rate-limiter.ts`:

```typescript
export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  baseLockoutMs?: number; // default 30_000
}

export type CheckResult =
  | { allowed: true; attemptsRemaining: number }
  | { allowed: false; lockoutMs: number; attemptsRemaining: 0 };

export interface RateLimiter {
  check(): CheckResult;
  recordFailure(): void;
  recordSuccess(): void;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const baseLockoutMs = opts.baseLockoutMs ?? 30_000;
  let failures: number[] = []; // timestamps
  let lockoutLevel = 0;       // increments each time limit is hit

  function prune(): void {
    const cutoff = Date.now() - opts.windowMs;
    failures = failures.filter((t) => t > cutoff);
  }

  function check(): CheckResult {
    prune();
    const remaining = opts.maxAttempts - failures.length;
    if (remaining > 0) {
      return { allowed: true, attemptsRemaining: remaining };
    }
    const lockoutMs = baseLockoutMs * Math.pow(2, lockoutLevel);
    return { allowed: false, lockoutMs, attemptsRemaining: 0 };
  }

  function recordFailure(): void {
    prune();
    failures.push(Date.now());
    if (failures.length > opts.maxAttempts) {
      lockoutLevel++;
    }
  }

  function recordSuccess(): void {
    failures = [];
    lockoutLevel = 0;
  }

  return { check, recordFailure, recordSuccess };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/rate-limiter.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Extend `UnlockVaultResponse` with lockout info**

Modify `src/types/messages.ts` — replace the `UnlockVaultResponse` type:

```typescript
export type UnlockVaultResponse =
  | { ok: true }
  | {
      ok: false;
      error: string;
      attemptsRemaining?: number;
      lockoutMs?: number;
    };
```

- [ ] **Step 6: Wire rate limiter into service worker**

Modify `src/background/service-worker.ts` — add the import and integrate:

At the top of imports:

```typescript
import { createRateLimiter } from './rate-limiter';
```

After the `session` declaration:

```typescript
const unlockLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 5 * 60_000,
  baseLockoutMs: 30_000,
});
```

Replace the `case 'vault/unlock':` block entirely:

```typescript
    case 'vault/unlock': {
      const gate = unlockLimiter.check();
      if (!gate.allowed) {
        return {
          ok: false,
          error: `Too many attempts, wait ${Math.ceil(gate.lockoutMs / 1000)}s`,
          lockoutMs: gate.lockoutMs,
          attemptsRemaining: 0,
        };
      }
      try {
        await openVault(req.masterPassword);
        unlockLimiter.recordSuccess();
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          unlockLimiter.recordFailure();
          const next = unlockLimiter.check();
          return {
            ok: false,
            error: 'Wrong master password',
            attemptsRemaining: next.allowed ? next.attemptsRemaining : 0,
          };
        }
        if (err instanceof VaultLockedError) {
          return { ok: false, error: 'No vault exists' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }
```

- [ ] **Step 7: Update unlock view to show remaining attempts and lockout**

Modify `src/popup/views/unlock.ts` — replace the `submit()` function:

```typescript
      async function submit(): Promise<void> {
        if (pw.value.length === 0) return;
        btn.disabled = true;
        err.hidden = true;

        const req: UnlockVaultRequest = {
          type: 'vault/unlock',
          masterPassword: pw.value,
        };
        const res = (await chrome.runtime.sendMessage(req)) as UnlockVaultResponse;
        if (res.ok) {
          await onUnlocked();
        } else {
          err.hidden = false;
          let msg = res.error;
          if (typeof res.attemptsRemaining === 'number' && res.attemptsRemaining > 0) {
            msg += ` (${res.attemptsRemaining} tentativi rimasti)`;
          }
          if (typeof res.lockoutMs === 'number') {
            msg += ` — blocco attivo per ${Math.ceil(res.lockoutMs / 1000)}s`;
          }
          err.textContent = msg;
          pw.value = '';
          pw.focus();
          btn.disabled = false;
        }
      }
```

- [ ] **Step 8: Typecheck and rebuild**

```bash
npm run typecheck && npm run build
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/background/rate-limiter.ts tests/unit/rate-limiter.test.ts src/background/service-worker.ts src/types/messages.ts src/popup/views/unlock.ts
git commit -m "feat(security): rate limit unlock attempts (5/5min + exponential lockout)"
```

---

## Task 24: End-to-end manual test

**Files:**
- None (manual verification)

- [ ] **Step 1: Reload extension in Chrome**

1. `chrome://extensions/`
2. Locate "Universal Form Compiler"
3. Click the circular reload icon on the extension card (or if not yet loaded, click "Load unpacked" → select `dist/`)

- [ ] **Step 2: Verify first-run flow**

1. Click extension icon
2. Popup shows "Crea il tuo vault" screen
3. Enter `short` in first field → "Crea vault" button disabled, error shown
4. Enter `my master password` (17 chars) in first, different in second → button disabled, "Le password non coincidono"
5. Enter same password in both → button enabled
6. Click "Crea vault" → popup switches to "Vault unlocked" screen

- [ ] **Step 3: Verify lock/unlock cycle**

1. Click "Lock vault" → popup switches to unlock screen
2. Enter wrong password → shows "Wrong master password"
3. Enter correct password → shows "Vault unlocked" again

- [ ] **Step 4: Verify session persistence**

1. Close popup (click away)
2. Re-open popup → should show "Vault unlocked" immediately (session still active)

- [ ] **Step 5: Verify persistence across extension reload**

1. In `chrome://extensions/` click reload on the extension (this clears service worker memory)
2. Open popup → should show "Vault bloccato" (session key gone, but vault blob still in storage)
3. Unlock with correct password → "Vault unlocked"

- [ ] **Step 6: Verify reject on wrong password**

1. Lock
2. Enter wrong password 3 times → each shows error, password field cleared

- [ ] **Step 7: Verify service worker logs**

1. `chrome://extensions/` → "Inspect views: service worker"
2. Console should show `[UFC] service worker ready` and `[UFC] session unlocked` / `[UFC] session locked` entries as you interact

- [ ] **Step 8: Check vault persistence in chrome.storage**

1. In the service worker DevTools, go to Application → Storage → Extension storage
2. `ufc_vault_v1` key should exist with encrypted blob
3. Delete the key manually → reload popup → should show setup screen again

- [ ] **Step 9: If all manual tests pass, tag milestone**

```bash
git tag phase-1a-complete
git log --oneline | head -25
```

Expected: clean commit history, all Phase 1a tasks committed.

---

## Task 25: Full test suite run + type check

**Files:**
- None

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests passing (~30+ tests: sanity, crypto ×11, storage ×5, vault ×12, session ×6).

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Clean build**

```bash
rm -rf dist/
npm run build
```

Expected: `dist/` created, no errors, no warnings related to our code.

- [ ] **Step 4: Final commit and tag**

```bash
git log --oneline | head -30
git status
```

Expected: working tree clean, previous tag `phase-1a-complete` present.

---

## Phase 1a Deliverables

At the end of Phase 1a, the repository contains:

- A loadable Chrome MV3 extension at `dist/`
- First-run setup wizard (master password creation)
- Unlock screen with error handling
- Encrypted vault stored in `chrome.storage.local` using AES-256-GCM + PBKDF2
- Session management with 30-minute auto-lock
- 30+ unit tests covering crypto primitives, vault lifecycle, and session behavior
- Clean TypeScript build with strict mode
- Commit history suitable for review

**Next:** Phase 1b will add the OpenAI AI client, the DOCX/CSV/YAML importer, the canonical JSON schema with Zod validation, and complete the setup wizard so the user can actually populate the vault with their data.

---

## Self-Review Notes

**Spec coverage for Phase 1a (M0-M1):**
- M0 infrastructure → Tasks 1-7 (backup, git, npm, TS, Vite, Vitest, manifest, popup shell)
- M1 crypto + vault → Tasks 8-18 (types, crypto primitives, storage, vault lifecycle, session, message handler)
- M1 popup unlock/setup → Tasks 19-22 (router, views, main entry)
- Spec §4/§6 rate limiting → Task 23
- Manual verification → Task 24
- Final checks → Task 25

Spec §4 "Cifratura" requires Argon2id with PBKDF2 fallback. Phase 1a ships with PBKDF2 only (600k iterations matches spec's declared fallback). Argon2id upgrade is deferred and tracked in spec §8 "Open questions". This is explicit and not a gap.

**Placeholder scan:** none.

**Type consistency:** `VaultBlob`, `VaultData`, `EncryptedBlob`, `PopupRequest`, `PopupResponse`, `SessionState` defined once, referenced with matching names throughout.

**Scope check:** Phase 1a is focused on foundation. No AI code, no form code, no importer code. ~24 tasks, each 5-10 steps, executable in 2-3 hours of focused work.
