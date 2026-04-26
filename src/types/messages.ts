// Discriminated union of all messages exchanged between popup and background.
// Each request has a matching response type.

export type Theme = 'light' | 'dark' | 'system';

export type VaultState =
  | { kind: 'no_data' }
  | { kind: 'has_data' };

// --- Requests from popup to background ---

export type GetVaultStateRequest = { type: 'vault/getState' };
export type GetVaultStateResponse = { state: VaultState };

export type ResetVaultRequest = { type: 'vault/reset' };
export type ResetVaultResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Settings ---
export type GetSettingsRequest = { type: 'settings/get' };
export type GetSettingsResponse = {
  apiKey: string | null;
  model: string;
  theme: Theme;
};

export type SaveSettingsRequest = {
  type: 'settings/save';
  apiKey: string;
  model: string;
  theme: Theme;
};
export type SaveSettingsResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Import ---
export type ImportFileRequest = {
  type: 'import/run';
  filename: string;
  text?: string;
  bufferBase64?: string;
};
export type ImportFileResponse =
  | { ok: true; data: unknown; tokens: number }
  | { ok: false; error: string; validationErrors?: { path: string; message: string }[] };

// --- Documents ---
export interface DocumentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  preview: {
    fullName: string;
    email: string;
  };
}

export type ListDocumentsRequest = { type: 'documents/list' };
export type ListDocumentsResponse = {
  documents: DocumentSummary[];
  activeId: string | null;
};

export type GetDocumentRequest = { type: 'documents/get'; id: string };
export type GetDocumentResponse = {
  document:
    | { id: string; name: string; data: unknown; createdAt: string; updatedAt: string }
    | null;
};

export type CreateDocumentRequest = {
  type: 'documents/create';
  name: string;
  data: unknown;
};
export type CreateDocumentResponse =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type UpdateDocumentRequest = {
  type: 'documents/update';
  id: string;
  name?: string;
  data?: unknown;
};
export type UpdateDocumentResponse =
  | { ok: true }
  | { ok: false; error: string };

export type DeleteDocumentRequest = { type: 'documents/delete'; id: string };
export type DeleteDocumentResponse =
  | { ok: true }
  | { ok: false; error: string };

export type SetActiveDocumentRequest = {
  type: 'documents/setActive';
  id: string;
};
export type SetActiveDocumentResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Canonical data read/write (still used by setup wizard for first import) ---
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
      fields: unknown[];
      proposal: unknown[];
      tokensUsed: number;
    }
  | { ok: false; error: string };

export type ConfirmCompileRequest = {
  type: 'compile/confirm';
  mappings: unknown[];
};
export type ConfirmCompileResponse =
  | { ok: true; results: { fieldId: string; ok: boolean; error?: string }[] }
  | { ok: false; error: string };

export type ClearMarksRequest = { type: 'compile/clearMarks' };
export type ClearMarksResponse = { ok: true };

export type RestoreCompileSessionRequest = { type: 'compile/restoreSession' };
export type RestoreCompileSessionResponse = {
  session:
    | {
        fields: unknown[];
        proposal: unknown[];
        results: { fieldId: string; ok: boolean; error?: string }[];
        tokensUsed: number;
        ts: number;
      }
    | null;
};

export type DismissCompileResultRequest = { type: 'compile/dismissResult' };
export type DismissCompileResultResponse = { ok: true };

// --- Discriminated union ---

export type PopupRequest =
  | GetVaultStateRequest
  | ResetVaultRequest
  | GetSettingsRequest
  | SaveSettingsRequest
  | ImportFileRequest
  | ListDocumentsRequest
  | GetDocumentRequest
  | CreateDocumentRequest
  | UpdateDocumentRequest
  | DeleteDocumentRequest
  | SetActiveDocumentRequest
  | GetCanonicalDataRequest
  | SaveCanonicalDataRequest
  | StartCompileRequest
  | ConfirmCompileRequest
  | ClearMarksRequest
  | RestoreCompileSessionRequest
  | DismissCompileResultRequest;

export type PopupResponse =
  | GetVaultStateResponse
  | ResetVaultResponse
  | GetSettingsResponse
  | SaveSettingsResponse
  | ImportFileResponse
  | ListDocumentsResponse
  | GetDocumentResponse
  | CreateDocumentResponse
  | UpdateDocumentResponse
  | DeleteDocumentResponse
  | SetActiveDocumentResponse
  | GetCanonicalDataResponse
  | SaveCanonicalDataResponse
  | StartCompileResponse
  | ConfirmCompileResponse
  | ClearMarksResponse
  | RestoreCompileSessionResponse
  | DismissCompileResultResponse;

export type ResponseFor<R extends PopupRequest> =
  R extends GetVaultStateRequest ? GetVaultStateResponse :
  R extends ResetVaultRequest ? ResetVaultResponse :
  R extends GetSettingsRequest ? GetSettingsResponse :
  R extends SaveSettingsRequest ? SaveSettingsResponse :
  R extends ImportFileRequest ? ImportFileResponse :
  R extends ListDocumentsRequest ? ListDocumentsResponse :
  R extends GetDocumentRequest ? GetDocumentResponse :
  R extends CreateDocumentRequest ? CreateDocumentResponse :
  R extends UpdateDocumentRequest ? UpdateDocumentResponse :
  R extends DeleteDocumentRequest ? DeleteDocumentResponse :
  R extends SetActiveDocumentRequest ? SetActiveDocumentResponse :
  R extends GetCanonicalDataRequest ? GetCanonicalDataResponse :
  R extends SaveCanonicalDataRequest ? SaveCanonicalDataResponse :
  R extends StartCompileRequest ? StartCompileResponse :
  R extends ConfirmCompileRequest ? ConfirmCompileResponse :
  R extends ClearMarksRequest ? ClearMarksResponse :
  R extends RestoreCompileSessionRequest ? RestoreCompileSessionResponse :
  R extends DismissCompileResultRequest ? DismissCompileResultResponse :
  never;
