export const ALL_FIELDS_TOKEN = '__all_fields__';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_SAMPLE_SIZE = 50;
const DEFAULT_MAX_FIELDS = 3;
const DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

const SEARCHABLE_PRIORITY_PATTERNS: RegExp[] = [
  /(name|nom|title|titre|label|libelle|designation)/,
  /(description|details|comment|reason|cause|action|summary)/,
  /(status|state|type|category|role|priority|severity)/,
  /(code|ref|reference|number|num|serial)/,
  /(date|time|deadline|due|start|end)/,
];

const SEARCHABLE_EXCLUSION_PATTERNS: RegExp[] = [
  /(^|\.)(?:_?id|[a-z0-9]+_id|uuid|guid)$/,
  /(password|token|secret|hash|salt|signature|otp)/,
  /(file_path|filepath|blob|binary|base64|photo|image|avatar|mime)/,
  /(created_by|updated_by|deleted_by|owner_id|user_id|machine_id|technician_id)/,
];

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(DIACRITICS_PATTERN, '').toLowerCase();
}

function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;

  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, value);
}

function stringifyValue(value: unknown, depth = 0, maxDepth = DEFAULT_MAX_DEPTH): string {
  if (value == null) return '';
  if (isPrimitive(value)) return normalizeSearchText(value.toString());

  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyValue(entry, depth + 1, maxDepth))
      .filter(Boolean)
      .join(' ');
  }

  if (value instanceof Date) {
    return normalizeSearchText(value.toISOString());
  }

  if (typeof value === 'object') {
    if (depth >= maxDepth) return '';

    return Object.values(value as Record<string, unknown>)
      .map((entry) => stringifyValue(entry, depth + 1, maxDepth))
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

function isSearchableFieldPath(path: string, exclude: Set<string>, include: Set<string>): boolean {
  if (!path || exclude.has(path)) {
    return false;
  }

  if (include.has(path)) {
    return true;
  }

  const normalizedPath = path.toLowerCase();
  return !SEARCHABLE_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function scoreSearchableField(path: string, include: Set<string>): number {
  const normalizedPath = path.toLowerCase();
  let score = 0;

  if (include.has(path)) {
    // Force explicitly-included fields (e.g. Machine's own code field, which
    // shares a name with foreign-key fields on other entities) to the front
    // so they aren't dropped by the maxFields cap below.
    score += 10_000;
  }

  SEARCHABLE_PRIORITY_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(normalizedPath)) {
      score += (SEARCHABLE_PRIORITY_PATTERNS.length - index) * 30;
    }
  });

  if (normalizedPath.includes('.')) {
    score -= 8;
  }

  score -= normalizedPath.length * 0.05;
  return score;
}

function collectFieldPaths(
  value: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  collector: Set<string>,
): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (isPrimitive(entry)) {
        if (prefix) collector.add(prefix);
      } else if (depth < maxDepth) {
        collectFieldPaths(entry, prefix, depth + 1, maxDepth, collector);
      }
    });
    return;
  }

  if (typeof value !== 'object') {
    if (prefix) collector.add(prefix);
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry == null) return;

    if (isPrimitive(entry) || entry instanceof Date) {
      collector.add(path);
      return;
    }

    if (Array.isArray(entry)) {
      if (entry.some((item) => isPrimitive(item))) {
        collector.add(path);
      }
      if (depth < maxDepth) {
        entry.forEach((item) => collectFieldPaths(item, path, depth + 1, maxDepth, collector));
      }
      return;
    }

    if (depth < maxDepth) {
      collectFieldPaths(entry, path, depth + 1, maxDepth, collector);
    }
  });
}

function hasItemsField<T>(obj: unknown): obj is { items: T[] } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'items' in obj &&
    Array.isArray((obj as { items?: unknown }).items)
  );
}

function hasDataField<T>(obj: unknown): obj is { data: T[] } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'data' in obj &&
    Array.isArray((obj as { data?: unknown }).data)
  );
}

function normalizeSearchItems<T>(items: unknown): T[] {
  if (Array.isArray(items)) {
    return items;
  }

  if (hasItemsField<T>(items)) {
    return items.items;
  }

  if (hasDataField<T>(items)) {
    return items.data;
  }

  return [];
}

export function getSearchableFields<T>(
  items: unknown,
  options?: { maxDepth?: number; sampleSize?: number; maxFields?: number; exclude?: string[]; include?: string[] },
): string[] {
  const safeItems = normalizeSearchItems<T>(items);
  if (safeItems.length === 0) {
    // Empty arrays are perfectly valid while data is loading.
    if (!Array.isArray(items)) {
      console.error('getSearchableFields invalid input shape:', {
        type: typeof items,
        isArray: Array.isArray(items),
        keys:
          items && typeof items === 'object'
            ? Object.keys(items as Record<string, unknown>)
            : null,
        value: items,
      });
    }

    return [];
  }

  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const sampleSize = options?.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const maxFields = options?.maxFields ?? DEFAULT_MAX_FIELDS;
  const exclude = new Set(options?.exclude ?? []);
  const include = new Set(options?.include ?? []);

  const collector = new Set<string>();

  safeItems.slice(0, sampleSize).forEach((item) => {
    collectFieldPaths(item, '', 0, maxDepth, collector);
  });

  return Array.from(collector)
    .filter((field) => isSearchableFieldPath(field, exclude, include))
    .sort((left, right) => {
      const scoreDiff = scoreSearchableField(right, include) - scoreSearchableField(left, include);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left.localeCompare(right);
    })
    .slice(0, maxFields);
}

export function matchesDynamicSearch<T>(
  item: T,
  searchTerm: string,
  selectedField?: string,
  maxDepth?: number,
  options?: { include?: string[] },
): boolean {
  const effectiveSelectedField = selectedField ?? ALL_FIELDS_TOKEN;
  const effectiveMaxDepth = maxDepth ?? DEFAULT_MAX_DEPTH;
  const normalizedTerm = normalizeSearchText(searchTerm.trim());
  if (!normalizedTerm) return true;

  if (effectiveSelectedField === ALL_FIELDS_TOKEN) {
    const scopedFields = getSearchableFields([item], {
      maxDepth: effectiveMaxDepth,
      sampleSize: 1,
      maxFields: DEFAULT_MAX_FIELDS,
      include: options?.include,
    });

    if (scopedFields.length === 0) {
      return stringifyValue(item, 0, effectiveMaxDepth).includes(normalizedTerm);
    }

    return scopedFields.some((field) => stringifyValue(getByPath(item, field), 0, effectiveMaxDepth).includes(normalizedTerm));
  }

  const value = getByPath(item, effectiveSelectedField);
  return stringifyValue(value, 0, effectiveMaxDepth).includes(normalizedTerm);
}
