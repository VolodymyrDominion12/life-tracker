/**
 * Точка входу до бази даних.
 *
 * Розподіл відповідальності:
 *  - `expo-sqlite` — рушій (файл БД на пристрої), прихований за `RawDb`;
 *  - Drizzle (`db`) — типізований CRUD;
 *  - сирий SQL (`sqlAll` / `sqlOne` / `sqlRun`) + запити з `./queries.ts` —
 *    аналітика по VIEW та масові операції експорту/імпорту.
 *
 * Модуль виконує міграції при першому імпорті. Це синхронно і займає
 * одиниці мілісекунд, тому окремий стан «завантаження БД» не потрібен.
 */
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { openDatabase } from '@/platform/database';
import { runMigrations } from './migrate';
import type { RawDb, SqlParam } from './raw-db';
import * as schema from './schema';

/** Єдине з'єднання на весь застосунок. */
export const sqlite: RawDb = openDatabase();

/** Результат застосування міграцій — показується в налаштуваннях. */
export const migrationInfo = runMigrations(sqlite);

/**
 * Drizzle очікує конкретний клієнт `expo-sqlite`, тоді як решта застосунку
 * працює з інтерфейсом `RawDb`. Приведення коректне: під `RawDb` лежить саме
 * цей клієнт (його повертає `openDatabase`), а інтерфейс — його підмножина.
 */
type ExpoSqliteHandle = Parameters<typeof drizzle>[0];

export const db = drizzle(sqlite as unknown as ExpoSqliteHandle, { schema });

/** Усі рядки запиту. */
export function sqlAll<T>(sql: string, params: SqlParam[] = []): T[] {
  return sqlite.getAllSync<T>(sql, params);
}

/** Один рядок або null. */
export function sqlOne<T>(sql: string, params: SqlParam[] = []): T | null {
  return sqlite.getFirstSync<T>(sql, params);
}

/** Довільний SQL, зокрема кілька інструкцій через `;`. */
export function sqlExec(sql: string): void {
  sqlite.execSync(sql);
}

/** Виконати одну інструкцію з параметрами. */
export function sqlRun(sql: string, params: SqlParam[] = []): { changes: number } {
  return sqlite.runSync(sql, params);
}

/** Обгортка над транзакцією: якщо fn кидає — зміни відкочуються. */
export function inTransaction<T>(fn: () => T): T {
  let result: T | undefined;
  sqlite.withTransactionSync(() => {
    result = fn();
  });
  return result as T;
}

export type { RawDb, SqlParam };
export { schema };
