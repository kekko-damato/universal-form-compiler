import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const AddressSchema = z
  .object({
    street: z.string().default(''),
    number: z.string().default(''),
    unit: z.string().optional(),
    city: z.string().default(''),
    state_province: z.string().optional(),
    postal_code: z.string().default(''),
    country: z.string().default(''),
  })
  .strict();

const PersonSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    middle_name: z.string().optional(),
    full_name: z.string().optional(),
    gender: z
      .enum(['M', 'F', 'X', 'prefer_not_to_say'])
      .optional(),
    birth_date: isoDate.optional(),
    birth_city: z.string().optional(),
    birth_country: z.string().optional(),
    nationality: z.string().optional(),
    tax_code: z.string().optional(),
    ssn: z.string().optional(),
  })
  .strict();

const ContactSchema = z
  .object({
    email: z.string().email(),
    email_secondary: z.string().email().optional(),
    phone: z.string().optional(),
    phone_mobile: z.string().optional(),
    pec: z.string().email().optional(),
    website: z.string().url().optional(),
  })
  .strict();

const AddressesSchema = z
  .object({
    primary: AddressSchema.optional(),
    billing: AddressSchema.optional(),
    shipping: AddressSchema.optional(),
  })
  .strict();

const CompanySchema = z
  .object({
    legal_name: z.string().optional(),
    trade_name: z.string().optional(),
    vat_number: z.string().optional(),
    tax_code: z.string().optional(),
    legal_form: z.string().optional(),
    rea_number: z.string().optional(),
    founded_date: isoDate.optional(),
    employees: z.number().int().nonnegative().optional(),
    annual_revenue: z.number().nonnegative().optional(),
    address: AddressSchema.optional(),
  })
  .strict();

const BankingSchema = z
  .object({
    iban: z.string().optional(),
    swift_bic: z.string().optional(),
    bank_name: z.string().optional(),
    account_holder: z.string().optional(),
  })
  .strict();

const CredentialEntrySchema = z
  .object({
    username: z.string(),
    password: z.string(),
  })
  .strict();

const PaymentCardSchema = z
  .object({
    label: z.string(),
    number: z.string(),
    expiry: z.string().regex(/^\d{2}\/\d{2}$/, 'expected MM/YY'),
    cvv: z.string(),
    holder: z.string(),
    type: z.string().optional(),
  })
  .strict();

const DocumentsSchema = z
  .object({
    passport_number: z.string().optional(),
    id_card_number: z.string().optional(),
    driver_license_number: z.string().optional(),
  })
  .strict();

export const CanonicalDataSchema = z
  .object({
    version: z.literal(1),
    person: PersonSchema,
    contact: ContactSchema,
    addresses: AddressesSchema.optional(),
    company: CompanySchema.optional(),
    banking: BankingSchema.optional(),
    credentials: z.record(z.string(), CredentialEntrySchema).optional(),
    payment_cards: z.array(PaymentCardSchema).optional(),
    documents: DocumentsSchema.optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CanonicalData = z.infer<typeof CanonicalDataSchema>;

export const SENSITIVE_FIELD_PATHS: readonly string[] = [
  'credentials.*.password',
  'payment_cards[*].number',
  'payment_cards[*].cvv',
  'banking.iban',
  'documents.passport_number',
  'documents.id_card_number',
  'documents.driver_license_number',
  'person.ssn',
];

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_FIELD_PATHS.some((pattern) => {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.]/g, '\\.')
          .replace(/\[\*\]/g, '\\[\\d+\\]')
          .replace(/\*/g, '[^.]+') +
        '$',
    );
    return regex.test(path);
  });
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; data: CanonicalData }
  | { ok: false; errors: ValidationError[] };

export function validateCanonical(input: unknown): ValidationResult {
  const result = CanonicalDataSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { ok: false, errors };
}

export interface ListKeysOptions {
  includeSensitive?: boolean;
}

export function listAvailableKeys(
  data: CanonicalData,
  opts: ListKeysOptions = {},
): string[] {
  const keys: string[] = [];
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== 'object') {
      if (!opts.includeSensitive && isSensitivePath(prefix)) return;
      keys.push(prefix);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => walk(item, `${prefix}[${idx}]`));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix === '' ? k : `${prefix}.${k}`;
      walk(v, next);
    }
  };
  walk(data, '');
  // Remove the version key
  return keys.filter((k) => k !== 'version');
}
