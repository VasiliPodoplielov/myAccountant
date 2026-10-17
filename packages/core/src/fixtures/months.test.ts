import { describe, expect, it } from 'vitest';
import { documentIssues } from '../document';
import { kpirContributions, kpirFromDocuments, kpirTotals } from '../kpir';
import { calcYearFromDocuments } from '../ledger';
import { TAX_CONFIG } from '../tax';
import { vatDeclaration, vatRegisters, vatTotals } from '../vat';
import { MONTH_FIXTURES } from './month-2026-03';

/**
 * Критерій готовності етапу 4: підсумки KPiR і реєстрів VAT за місяць збігаються з бухгалтером до гроша.
 * Кожен місяць у MONTH_FIXTURES проходить ті самі перевірки.
 */
describe.each(MONTH_FIXTURES)('звірка місяця: $name', (f) => {
  const opts = { fx: f.fx };
  const registers = vatRegisters(f.documents, f.year, f.month, opts);

  it('документи коректні', () => {
    expect(f.documents.flatMap((d) => documentIssues(d).map((issue) => `${d.number}: ${issue}`))).toEqual([]);
  });
  it('підсумок KPiR збігається до гроша', () => {
    const year = calcYearFromDocuments(f.documents, f.settings, TAX_CONFIG[f.year]!, opts);
    const entries = [...kpirFromDocuments(f.documents, f.year, opts), ...kpirContributions(f.year, year)];
    expect(kpirTotals(entries, f.month)).toEqual(f.expected.kpir);
  });
  it('підсумки реєстрів VAT збігаються до гроша', () => {
    expect(vatTotals(registers.sales)).toEqual(f.expected.sales);
    expect(vatTotals(registers.purchases)).toEqual(f.expected.purchases);
  });
  it('VAT у декларації збігається до злотого', () => {
    const declaration = vatDeclaration(registers);
    expect(declaration.output).toBe(f.expected.vatOutput);
    expect(declaration.input).toBe(f.expected.vatInput);
  });
});
