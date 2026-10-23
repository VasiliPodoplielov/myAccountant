/** Завантаження текстового файла з браузера (бекап JSON) */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // негайне скасування посилання обриває завантаження в частини браузерів
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Текст обраного файла; FileReader замість File.text(), який є не в усіх середовищах */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Не вдалося прочитати файл'));
    reader.readAsText(file);
  });
}
