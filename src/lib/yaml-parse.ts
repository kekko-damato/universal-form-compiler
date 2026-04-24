import yaml from 'js-yaml';

export function parseYamlToObject(raw: string): unknown {
  return yaml.load(raw);
}

export function parseYamlToText(raw: string): string {
  const obj = parseYamlToObject(raw);
  const lines: string[] = [];
  const walk = (v: unknown, prefix: string): void => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'object') {
      lines.push(`${prefix}: ${String(v)}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, idx) => walk(item, `${prefix}[${idx}]`));
      return;
    }
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
      const next = prefix === '' ? k : `${prefix}.${k}`;
      walk(inner, next);
    }
  };
  walk(obj, '');
  return lines.join('\n');
}
