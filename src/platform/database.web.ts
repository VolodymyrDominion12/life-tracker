/**
 * Реалізація сховища для web.
 *
 * expo-sqlite на web — це SQLite, скомпільований у WASM; файл БД зберігається
 * у OPFS (Origin Private File System). WAL не підтримується, тому прагми
 * відрізняються від native-версії — це і є та невелика частина, яку доводиться
 * тримати окремо для кожної платформи.
 *
 * Щоб web-збірка запустилась, у metro.config.js розширено assetExts для 'wasm',
 * а хостинг має віддавати заголовки COOP/COEP (див. docs/CONCEPT.md).
 */
import * as SQLite from 'expo-sqlite';

import type { RawDb } from '@/db/raw-db';

const DATABASE_NAME = 'life-tracker.db';

export function openDatabase(): RawDb {
  const db = SQLite.openDatabaseSync(DATABASE_NAME);
  db.execSync('PRAGMA foreign_keys = ON;');
  return db;
}

export const storageInfo = {
  engine: 'expo-sqlite (wasm)',
  platform: 'web' as const,
  databaseName: DATABASE_NAME,
  location: 'OPFS у браузері',
};
