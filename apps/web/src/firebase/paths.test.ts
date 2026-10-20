import { describe, expect, it } from 'vitest';
import { paths } from './paths';

describe('paths', () => {
  it('усе користувацьке лежить під users/{uid}', () => {
    expect(paths.settings('u1', 2026).join('/')).toBe('users/u1/settings/2026');
    expect(paths.documentsCollection('u1').join('/')).toBe('users/u1/documents');
    expect(paths.document('u1', 'd7').join('/')).toBe('users/u1/documents/d7');
    expect(paths.fxRatesCollection('u1').join('/')).toBe('users/u1/fxRates');
    expect(paths.fxRate('u1', '2026-03-02').join('/')).toBe('users/u1/fxRates/2026-03-02');
    expect(paths.referenceCollection('u1').join('/')).toBe('users/u1/reference');
    expect(paths.reference('u1', '2026-01').join('/')).toBe('users/u1/reference/2026-01');
    expect(paths.vendorRulesCollection('u1').join('/')).toBe('users/u1/vendorRules');
    expect(paths.vendorRule('u1', '7740001454').join('/')).toBe('users/u1/vendorRules/7740001454');
  });

  it('ключ правила без NIP не ламає шлях', () => {
    const path = paths.vendorRule('u1', 'Firma A/B');
    expect(path).toHaveLength(4);
    expect(decodeURIComponent(path[3])).toBe('Firma A/B');
  });

  it('шляхи різних користувачів не перетинаються', () => {
    expect(paths.documentsCollection('a')).not.toEqual(paths.documentsCollection('b'));
  });
});
