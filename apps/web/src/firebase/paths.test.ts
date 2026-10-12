import { describe, expect, it } from 'vitest';
import { paths } from './paths';

describe('paths', () => {
  it('усе користувацьке лежить під users/{uid}', () => {
    expect(paths.settings('u1', 2026).join('/')).toBe('users/u1/settings/2026');
    expect(paths.documentsCollection('u1').join('/')).toBe('users/u1/documents');
    expect(paths.document('u1', 'd7').join('/')).toBe('users/u1/documents/d7');
    expect(paths.fxRatesCollection('u1').join('/')).toBe('users/u1/fxRates');
    expect(paths.fxRate('u1', '2026-03-02').join('/')).toBe('users/u1/fxRates/2026-03-02');
  });

  it('шляхи різних користувачів не перетинаються', () => {
    expect(paths.documentsCollection('a')).not.toEqual(paths.documentsCollection('b'));
  });
});
