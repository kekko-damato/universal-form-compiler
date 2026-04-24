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
