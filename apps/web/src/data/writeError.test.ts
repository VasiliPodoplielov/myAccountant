import { describe, expect, it } from 'vitest';
import { writeErrorMessage } from './writeError';

describe('writeErrorMessage', () => {
  it('відмова правил: пояснення про закритий місяць', () => {
    const error = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    expect(writeErrorMessage(error)).toMatch(/закритого місяця/);
  });

  it('інша помилка: її текст', () => {
    expect(writeErrorMessage(new Error('offline'))).toBe('offline');
    expect(writeErrorMessage('рядок')).toBe('рядок');
  });
});
