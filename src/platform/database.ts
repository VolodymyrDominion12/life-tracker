/**
 * Адаптер сховища — публічний контракт.
 *
 * На практиці Metro підставляє `database.native.ts` або `database.web.ts`
 * залежно від платформи, тому цей файл використовується лише як резервний
 * варіант (наприклад, інструментами, що не знають про platform extensions).
 *
 * Щоб підключити інший рушій (Tauri `tauri-plugin-sql`, SQLite WASM у браузері,
 * in-memory база для тестів) — достатньо додати `database.<platform>.ts`,
 * що повертає об'єкт із тим самим інтерфейсом, що й `expo-sqlite`. Решта коду
 * застосунку працює з ним через `@/db/client` і не знає, де лежать дані.
 */
import type { RawDb } from '@/db/raw-db';

export function openDatabase(): RawDb {
  throw new Error(
    'Не знайдено реалізації сховища для цієї платформи. ' +
      'Очікується src/platform/database.native.ts (Android/iOS) або database.web.ts (web).',
  );
}

/** Опис сховища для екрана налаштувань; перекривається у platform-реалізаціях. */
export const storageInfo = {
  engine: 'невідомо',
  platform: 'unknown' as const,
  databaseName: '—',
  location: '—',
};
