import { MIGRATIONS } from './migrations';
import type { RawDb } from './raw-db';

/**
 * Мінімальний раннер міграцій.
 *
 * Поточна версія схеми зберігається в `PRAGMA user_version` самої бази —
 * це частина заголовка файлу БД, тому зміна версії відбувається в тій самій
 * транзакції, що й сама міграція: або застосовується все, або нічого.
 */
export function runMigrations(raw: RawDb): { from: number; to: number } {
  const row = raw.getFirstSync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );
  if (pending.length === 0) return { from: current, to: current };

  for (const migration of pending) {
    raw.withTransactionSync(() => {
      raw.execSync(migration.sql);
      // user_version не приймає параметрів — значення підставляємо з коду,
      // тому воно гарантовано числове (не з користувацького вводу).
      raw.execSync(`PRAGMA user_version = ${Number(migration.version)}`);
    });
  }

  const target = pending[pending.length - 1]!.version;
  return { from: current, to: target };
}

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);
