/**
 * Контракт сховища.
 *
 * Це найвужчий інтерфейс, якого потребує застосунок: виконати SQL, отримати
 * рядки, зробити транзакцію. `expo-sqlite` задовольняє його структурно, тому
 * мобільний код працює напряму, без обгорток.
 *
 * Практична цінність саме в тому, що цей інтерфейс можна реалізувати будь-чим:
 *  - `node:sqlite` — щоб перевіряти схему й запити у звичайному тесті
 *    (див. `scripts/verify-db.ts`), без емулятора й без телефона;
 *  - `tauri-plugin-sql` — щоб той самий код працював на десктопі;
 *  - in-memory варіант — для швидких юніт-тестів.
 */

export type SqlParam = string | number | null;

export interface SqlRunResult {
  changes: number;
}

export interface RawDb {
  /** Виконує одну або кілька інструкцій без параметрів (DDL, PRAGMA). */
  execSync(sql: string): void;
  /** Виконує одну інструкцію з параметрами. */
  runSync(sql: string, params: SqlParam[]): SqlRunResult;
  /** Повертає всі рядки запиту. */
  getAllSync<T>(sql: string, params: SqlParam[]): T[];
  /** Повертає перший рядок або null. */
  getFirstSync<T>(sql: string, params: SqlParam[]): T | null;
  /** Виконує fn у транзакції; помилка всередині скасовує всі зміни. */
  withTransactionSync(fn: () => void): void;
}
