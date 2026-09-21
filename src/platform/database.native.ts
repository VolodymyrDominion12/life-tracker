/**
 * Реалізація сховища для Android / iOS.
 *
 * Дані лежать у приватній теці застосунку у вигляді одного файлу SQLite.
 * WAL увімкнено: швидший запис і менший ризик блокувань при частих дрібних
 * вставках (а саме так виглядає щоденний облік).
 */
import * as SQLite from 'expo-sqlite';

import type { RawDb } from '@/db/raw-db';

const DATABASE_NAME = 'life-tracker.db';

export function openDatabase(): RawDb {
  const db = SQLite.openDatabaseSync(DATABASE_NAME);

  // Налаштування, які обов'язково мають бути поза транзакцією.
  db.execSync('PRAGMA journal_mode = WAL;');
  db.execSync('PRAGMA foreign_keys = ON;');
  db.execSync('PRAGMA busy_timeout = 5000;');
  db.execSync('PRAGMA synchronous = NORMAL;');

  return db;
}

export const storageInfo = {
  engine: 'expo-sqlite',
  platform: 'native' as const,
  databaseName: DATABASE_NAME,
  location: 'Приватна тека застосунку (SQLite-файл)',
};
