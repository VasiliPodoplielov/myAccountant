/** CSV для перевірки й обміну: крапка з комою, UTF-8 з BOM (Excel), суми — у злотих із крапкою (123456 → 1234.56) */

const needsQuotes = /[;"\r\n]/;

// Excel виконує текст, що починається з цих символів, як формулу; числа (у т.ч. від'ємні) лишаються числами
const formulaStart = /^[=+\-@\t\r]/;
const plainNumber = /^-?\d+(\.\d+)?$/;

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && formulaStart.test(text) && !plainNumber.test(text)) text = `'${text}`;
  return needsQuotes.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Гроші → злоті з двома знаками і крапкою, точно (без float) */
export function groszeToCsv(grosze: number): string {
  const sign = grosze < 0 ? '-' : '';
  const abs = Math.abs(grosze);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function downloadCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // негайне скасування посилання обриває завантаження в частини браузерів
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
