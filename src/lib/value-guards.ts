import type { FieldDescriptor } from '@/types/field';

// Heuristics that detect when a candidate value is actually placeholder /
// example text rather than real user data. Used both:
//   - by the orchestrator (Pass 2) to reject AI-generated values
//   - by the importer post-processing to drop values the model copied from
//     the source document's example sections

// Domains that are universally placeholder/example content. An email landing
// on one of these MUST be rejected — they are RFC-reserved or convention.
const EXAMPLE_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'example.it',
  'example.eu',
  'domain.com',
  'domain.it',
  'domain.tld',
  'tld.com',
  'dominio.it',
  'dominio.com',
  'dominio.eu',
  'esempio.it',
  'esempio.com',
  'esempio.eu',
  'prova.it',
  'prova.com',
  'sample.com',
  'test.com',
  'test.it',
  'mail.tld',
  'yourcompany.com',
  'yourdomain.com',
  'yourdomain.tld',
  'yourname.com',
  'company.com',
  'company.it',
  'placeholder.com',
];

const EXAMPLE_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'nome.cognome',
  'name.surname',
  'mario.rossi',
  'jane.doe',
  'john.doe',
  'mariorossi',
  'janedoe',
  'johndoe',
  'utente',
  'user',
  'esempio',
  'example',
  'test',
  'prova',
  'placeholder',
]);

export function looksLikeExampleEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v.includes('@')) return false;
  const at = v.lastIndexOf('@');
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!domain) return false;

  for (const d of EXAMPLE_EMAIL_DOMAINS) {
    if (domain === d) return true;
    if (domain.endsWith('.' + d)) return true;
  }

  if (EXAMPLE_LOCAL_PARTS.has(local)) return true;

  return false;
}

// True when the candidate value is essentially the field's placeholder /
// example helper text — typical AI mistake when the form has a hint like
// placeholder="esempio: mario.rossi@dominio.it".
export function matchesFieldPlaceholder(
  value: string,
  field: FieldDescriptor | undefined,
): boolean {
  if (!field) return false;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return false;

  const candidates = [
    field.attributes.placeholder,
    field.attributes.title,
    field.attributes.ariaLabel,
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  for (const c of candidates) {
    const cl = c.toLowerCase();
    if (cl === v) return true;
    // Catch "esempio: mario.rossi@dominio.it" → contains the email verbatim.
    // Require value to be at least 5 chars so we don't false-positive on
    // single letters / very short tokens (e.g. "M" inside a long placeholder).
    if (v.length >= 5 && cl.includes(v)) return true;
  }
  return false;
}
