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
  | {
      ok: false;
      error: string;
      attemptsRemaining?: number;
      lockoutMs?: number;
    };

export type LockVaultRequest = { type: 'vault/lock' };
export type LockVaultResponse = { ok: true };

export type DeleteVaultRequest = {
  type: 'vault/delete';
  masterPassword: string;
};
export type DeleteVaultResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Settings ---
export type GetSettingsRequest = { type: 'settings/get' };
export type GetSettingsResponse = {
  apiKey: string | null;
  model: string;
};

export type SaveSettingsRequest = {
  type: 'settings/save';
  apiKey: string;
  model: string;
};
export type SaveSettingsResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Import ---
export type ImportFileRequest = {
  type: 'import/run';
  filename: string;
  // Either text or a base64-encoded buffer for DOCX.
  text?: string;
  bufferBase64?: string;
};
export type ImportFileResponse =
  | { ok: true; data: unknown; tokens: number } // data is CanonicalData shape
  | { ok: false; error: string; validationErrors?: { path: string; message: string }[] };

// --- Canonical data read/write ---
export type GetCanonicalDataRequest = { type: 'canonical/get' };
export type GetCanonicalDataResponse = { data: unknown | null };

export type SaveCanonicalDataRequest = {
  type: 'canonical/save';
  data: unknown;
};
export type SaveCanonicalDataResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Compile flow (popup ↔ background) ---

export type StartCompileRequest = { type: 'compile/start' };
export type StartCompileResponse =
  | {
      ok: true;
      fields: unknown[];       // FieldDescriptor[], serialized
      proposal: unknown[];     // Mapping[], serialized
      tokensUsed: number;
    }
  | { ok: false; error: string };

export type ConfirmCompileRequest = {
  type: 'compile/confirm';
  mappings: unknown[];         // user-edited Mapping[]
};
export type ConfirmCompileResponse =
  | { ok: true; results: { fieldId: string; ok: boolean; error?: string }[] }
  | { ok: false; error: string };

export type ClearMarksRequest = { type: 'compile/clearMarks' };
export type ClearMarksResponse = { ok: true };

// --- Discriminated union ---

export type PopupRequest =
  | GetVaultStateRequest
  | CreateVaultRequest
  | UnlockVaultRequest
  | LockVaultRequest
  | DeleteVaultRequest
  | GetSettingsRequest
  | SaveSettingsRequest
  | ImportFileRequest
  | GetCanonicalDataRequest
  | SaveCanonicalDataRequest
  | StartCompileRequest
  | ConfirmCompileRequest
  | ClearMarksRequest;

export type PopupResponse =
  | GetVaultStateResponse
  | CreateVaultResponse
  | UnlockVaultResponse
  | LockVaultResponse
  | DeleteVaultResponse
  | GetSettingsResponse
  | SaveSettingsResponse
  | ImportFileResponse
  | GetCanonicalDataResponse
  | SaveCanonicalDataResponse
  | StartCompileResponse
  | ConfirmCompileResponse
  | ClearMarksResponse;

// Helper to map request → response type at compile time.
export type ResponseFor<R extends PopupRequest> =
  R extends GetVaultStateRequest ? GetVaultStateResponse :
  R extends CreateVaultRequest ? CreateVaultResponse :
  R extends UnlockVaultRequest ? UnlockVaultResponse :
  R extends LockVaultRequest ? LockVaultResponse :
  R extends DeleteVaultRequest ? DeleteVaultResponse :
  R extends GetSettingsRequest ? GetSettingsResponse :
  R extends SaveSettingsRequest ? SaveSettingsResponse :
  R extends ImportFileRequest ? ImportFileResponse :
  R extends GetCanonicalDataRequest ? GetCanonicalDataResponse :
  R extends SaveCanonicalDataRequest ? SaveCanonicalDataResponse :
  R extends StartCompileRequest ? StartCompileResponse :
  R extends ConfirmCompileRequest ? ConfirmCompileResponse :
  R extends ClearMarksRequest ? ClearMarksResponse :
  never;
