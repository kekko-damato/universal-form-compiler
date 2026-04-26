import type { FieldDescriptor } from '@/types/field';
import type { CanonicalData } from '@/lib/canonical-schema';

// Local heuristic mapping from form fields → canonical keys based on the
// HTML autocomplete attribute and a shortlist of high-precision name/id
// patterns. Goal: keep the AI off the critical path for the obvious cases.
//
// Only TRUE-BY-DESIGN matches go here — anything semantic / ambiguous stays
// for the AI.

interface Rule {
  // Returns the canonical path the field should map to, or null if no match.
  match: (f: FieldDescriptor) => string | null;
  // Confidence assigned when this rule fires.
  confidence: number;
  // Note shown to the user.
  note: string;
}

// HTML autocomplete tokens (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)
// → canonical paths. Authored by the page, so trustworthy when present.
const AUTOCOMPLETE_TO_KEY: Record<string, string> = {
  'given-name': 'person.first_name',
  'additional-name': 'person.middle_name',
  'family-name': 'person.last_name',
  name: 'person.full_name',
  email: 'contact.email',
  tel: 'contact.phone',
  'tel-national': 'contact.phone',
  url: 'contact.website',
  organization: 'company.legal_name',
  'organization-title': 'company.trade_name',
  bday: 'person.birth_date',
  'street-address': 'addresses.primary.street',
  'address-line1': 'addresses.primary.street',
  'address-level1': 'addresses.primary.state_province',
  'address-level2': 'addresses.primary.city',
  'postal-code': 'addresses.primary.postal_code',
  country: 'addresses.primary.country',
  'country-name': 'addresses.primary.country',
  // Sensitive autocompletes are intentionally not mapped here — they are
  // already covered by `matchSensitiveLocally` which masks the preview.
};

// Italian/English name/id tokens for fields that don't carry autocomplete.
// Each entry is a precise label/name match, not a fuzzy contains.
const NAME_ID_TO_KEY: { tokens: string[]; key: string }[] = [
  { tokens: ['first_name', 'firstname', 'given_name', 'givenname', 'nome'], key: 'person.first_name' },
  { tokens: ['last_name', 'lastname', 'family_name', 'familyname', 'surname', 'cognome'], key: 'person.last_name' },
  { tokens: ['middle_name', 'middlename', 'secondo_nome', 'secondonome'], key: 'person.middle_name' },
  { tokens: ['full_name', 'fullname', 'nome_completo', 'nomecompleto'], key: 'person.full_name' },
  { tokens: ['email', 'mail', 'e_mail', 'e-mail'], key: 'contact.email' },
  { tokens: ['phone', 'telephone', 'telefono', 'tel'], key: 'contact.phone' },
  { tokens: ['mobile', 'cellulare', 'cell'], key: 'contact.phone_mobile' },
  { tokens: ['pec'], key: 'contact.pec' },
  { tokens: ['website', 'sito', 'sito_web', 'sitoweb', 'url'], key: 'contact.website' },
  { tokens: ['vat', 'vat_number', 'vatnumber', 'partita_iva', 'partitaiva', 'piva', 'p_iva'], key: 'company.vat_number' },
  { tokens: ['street', 'via', 'indirizzo', 'address'], key: 'addresses.primary.street' },
  { tokens: ['city', 'citta', 'città', 'comune'], key: 'addresses.primary.city' },
  { tokens: ['province', 'provincia', 'state', 'state_province'], key: 'addresses.primary.state_province' },
  { tokens: ['postal_code', 'postalcode', 'cap', 'zip', 'zip_code', 'zipcode'], key: 'addresses.primary.postal_code' },
  { tokens: ['country', 'paese', 'nazione'], key: 'addresses.primary.country' },
];

const RULES: Rule[] = [
  {
    match: (f) => {
      const ac = (f.attributes.autocomplete ?? '').trim().toLowerCase();
      if (!ac) return null;
      // autocomplete can be a token list (e.g. "shipping street-address")
      for (const tok of ac.split(/\s+/)) {
        const k = AUTOCOMPLETE_TO_KEY[tok];
        if (k) return k;
      }
      return null;
    },
    confidence: 0.99,
    note: 'mapping locale (autocomplete)',
  },
  {
    match: (f) => {
      const candidates = [
        f.attributes.name,
        f.attributes.id,
      ].filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (candidates.length === 0) return null;
      const norm = candidates
        .map((c) => c.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_'))
        .filter((c) => c.length > 0);
      for (const rule of NAME_ID_TO_KEY) {
        for (const tok of rule.tokens) {
          if (norm.includes(tok)) return rule.key;
        }
      }
      return null;
    },
    confidence: 0.9,
    note: 'mapping locale (name/id)',
  },
];

export interface HeuristicMatch {
  fieldId: string;
  canonicalKey: string;
  confidence: number;
  note: string;
}

// Returns one match per field that the heuristics could resolve. The path
// returned is only useful if the canonical data ACTUALLY contains a value at
// that path — caller must check.
export function heuristicMap(
  fields: FieldDescriptor[],
  data: CanonicalData,
): HeuristicMatch[] {
  const matches: HeuristicMatch[] = [];
  for (const f of fields) {
    for (const rule of RULES) {
      const key = rule.match(f);
      if (!key) continue;
      if (!hasValueAtPath(data, key)) break; // matched but no data — fall through to AI
      matches.push({
        fieldId: f.id,
        canonicalKey: key,
        confidence: rule.confidence,
        note: rule.note,
      });
      break;
    }
  }
  return matches;
}

function hasValueAtPath(data: unknown, path: string): boolean {
  const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== '');
  let cur: unknown = data;
  for (const p of parts) {
    if (cur === null || cur === undefined) return false;
    if (typeof cur !== 'object') return false;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (Number.isNaN(idx)) return false;
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[p];
    }
  }
  if (cur === null || cur === undefined) return false;
  if (typeof cur === 'string') return cur.trim().length > 0;
  return true;
}
