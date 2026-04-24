// Base64 helpers used by the importer/service-worker to pass DOCX buffers
// through the chrome.runtime message channel (which only supports JSON).
//
// NOTE: the encryption layer (deriveKey/encrypt/decrypt/randomBytes) was
// removed when the master-password flow was dropped. These helpers are all
// that remains because they're still useful for transporting binary data.

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
