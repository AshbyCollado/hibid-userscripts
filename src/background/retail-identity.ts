import { detectProductKind, extractProductDiscriminators, type ProductDiscriminators, type ProductIdentity } from '../intelligence/us-deal-intelligence.js';

export function retailQuery(value: unknown): string {
  const query = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (query.length < 2) throw new Error('Amazon search query is too short');
  return query;
}

function strings(value: unknown, label: string, limit: number, length: number): string[] {
  if (!Array.isArray(value) || value.length > limit
    || value.some((item) => typeof item !== 'string' || item.length > length)) {
    throw new Error(`Malformed retail identity ${label}`);
  }
  return [...new Set(value.map((item: string) => item.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

export function validateRetailIdentity(value: unknown): ProductIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed retail identity');
  const source = value as ProductIdentity;
  const clean = (item: unknown, max: number) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const name = clean(source.name, 300);
  const discriminators = extractProductDiscriminators(name);
  const optionalGroups: Array<keyof ProductDiscriminators> = ['engineDisplacements', 'horsepower', 'motorFrames', 'impactRates', 'ringSizes'];
  const groups = new Set<keyof ProductDiscriminators>([
    ...Object.keys(discriminators) as Array<keyof ProductDiscriminators>, ...optionalGroups,
  ]);
  if (source.discriminators != null) {
    if (typeof source.discriminators !== 'object' || Array.isArray(source.discriminators)) throw new Error('Malformed retail identity discriminators');
    // Preserve description evidence while preventing messages from erasing title constraints.
    for (const group of groups) {
      if (!Object.hasOwn(source.discriminators, group)) continue;
      const incoming = strings(source.discriminators[group], group, 64, 120);
      discriminators[group] = group === 'ringSizes' && (!incoming.length || discriminators[group]?.length === 0)
        ? [] : [...new Set([...(discriminators[group] || []), ...incoming])];
    }
  }
  let includedComponents: string[][] | undefined;
  if (source.includedComponents != null) {
    if (!Array.isArray(source.includedComponents) || source.includedComponents.length > 64) throw new Error('Malformed retail identity includedComponents');
    includedComponents = source.includedComponents.map((component) => strings(component, 'includedComponents', 20, 60));
    if (includedComponents.some((component) => !component.length)) throw new Error('Malformed retail identity empty component');
  }
  return {
    name, query: retailQuery(source.query), brand: clean(source.brand, 80),
    model: source.model ? clean(source.model, 60) : null,
    model2: source.model2 ? clean(source.model2, 60) : null,
    kind: detectProductKind(name),
    capacities: source.capacities == null ? [] : strings(source.capacities, 'capacities', 64, 120),
    discriminators,
    tokens: source.tokens == null ? [] : strings(source.tokens, 'tokens', 64, 120),
    ...(includedComponents?.length ? { includedComponents } : {}),
  };
}
