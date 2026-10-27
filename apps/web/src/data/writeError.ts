import { isPermissionDenied } from '../firebase/useSnapshot';

/**
 * Текст помилки запису для екрана. Відмова правил у власника майже завжди означає закритий місяць:
 * firestore.rules не пускають зміни документів, що його торкаються.
 */
export function writeErrorMessage(e: unknown): string {
  const error = e instanceof Error ? e : new Error(String(e));
  if (isPermissionDenied(error)) {
    return 'Firestore відхилив запис. Найімовірніше, зміна торкається закритого місяця: відкрийте його знову на екрані «Закриття», якщо потрібна корекція. Інакше перевірте, що запущено актуальну версію застосунку і ви увійшли під дозволеним акаунтом.';
  }
  return error.message;
}
