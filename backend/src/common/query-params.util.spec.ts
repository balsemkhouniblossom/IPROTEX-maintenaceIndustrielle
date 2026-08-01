import {
  buildCaseInsensitiveSearchFilter,
  escapeRegExp,
  parseCsvParam,
  parseSortParam,
} from './query-params.util';

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeRegExp('hydraulic pump')).toBe('hydraulic pump');
  });
});

describe('buildCaseInsensitiveSearchFilter', () => {
  it('builds a case-insensitive regex that matches a literal substring, not a regex pattern', () => {
    const regex = buildCaseInsensitiveSearchFilter('a.b');
    expect(regex.test('xa.by')).toBe(true);
    expect(regex.test('xaZby')).toBe(false); // '.' must be literal, not "any character"
    expect(regex.test('XA.BY')).toBe(true); // case-insensitive
  });
});

describe('parseSortParam', () => {
  const allowed = ['date_created', 'status'] as const;
  const fallback = { date_created: -1 as const };

  it('parses an ascending field', () => {
    expect(parseSortParam('status', allowed, fallback)).toEqual({ status: 1 });
  });

  it('parses a descending field prefixed with -', () => {
    expect(parseSortParam('-status', allowed, fallback)).toEqual({
      status: -1,
    });
  });

  it('falls back for a field not on the allow-list', () => {
    expect(parseSortParam('password', allowed, fallback)).toEqual(fallback);
  });

  it('falls back when no sort param is given', () => {
    expect(parseSortParam(undefined, allowed, fallback)).toEqual(fallback);
  });
});

describe('parseCsvParam', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseCsvParam('a, b ,,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns undefined for an absent or empty-after-trim value', () => {
    expect(parseCsvParam(undefined)).toBeUndefined();
    expect(parseCsvParam('  ,  ,')).toBeUndefined();
  });
});
