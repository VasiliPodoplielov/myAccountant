import { jpkDocumentId } from '@jdg/core';
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
    expect(paths.categoryOverridesCollection('u1').join('/')).toBe('users/u1/categoryOverrides');
    expect(paths.categoryOverride('u1', 'jpk-cost-1-F').join('/')).toBe('users/u1/categoryOverrides/jpk-cost-1-F');
  });

  it('ключ правила без NIP не ламає шлях', () => {
    const path = paths.vendorRule('u1', 'Firma A/B');
    expect(path).toHaveLength(4);
    expect(decodeURIComponent(path[3])).toBe('Firma A/B');
  });

  it('перевизначення категорії лежить за id документа з JPK, навіть якщо в номері був /', () => {
    const id = jpkDocumentId('cost', '7740001454', 'F 31866/4528/26');
    const path = paths.categoryOverride('u1', id);
    expect(path).toHaveLength(4);
    expect(path[3]).toBe(paths.document('u1', id)[3]);
  });

  it('шляхи різних користувачів не перетинаються', () => {
    expect(paths.documentsCollection('a')).not.toEqual(paths.documentsCollection('b'));
  });
});
