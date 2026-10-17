import type { FxTables, LedgerDocument, Stored } from '../document';
import type { KpirTotals } from '../kpir';
import type { YearSettings } from '../tax';
import type { PurchaseVatField, SalesVatField } from '../vat';

/**
 * Місяць для звірки з бухгалтером: документи та підсумки, з якими облік має збігтися до гроша.
 * Справжні дані сюди потрапляють лише анонімізованими: вигадані назви й NIP, суми можна лишити.
 */
export interface MonthFixture {
  name: string;
  year: number;
  month: number;
  /** Документи, що зачіпають місяць: з датою PIT або VAT у ньому */
  documents: Stored<LedgerDocument>[];
  fx: FxTables;
  settings: YearSettings;
  expected: {
    /** Підсумок місяця в KPiR, разом зі składkami з розрахунку року */
    kpir: KpirTotals;
    /** Підсумки реєстрів VAT по полях JPK_V7M */
    sales: Partial<Record<SalesVatField, number>>;
    purchases: Partial<Record<PurchaseVatField, number>>;
    /** VAT należny і naliczony в декларації, повні злоті */
    vatOutput: number;
    vatInput: number;
  };
}
