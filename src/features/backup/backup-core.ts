/**
 * Ядро бекапу: побудова, розбір і злиття даних.
 *
 * Тут немає жодного імпорту з Expo — усе працює через інтерфейс `RawDb`.
 * Завдяки цьому логіку злиття (найризикованішу частину застосунку, бо вона
 * торкається всіх даних одразу) можна виконати й перевірити в Node на
 * справжньому SQLite — див. `scripts/verify-db.ts`. Файлові операції та
 * системні діалоги живуть окремо, у `backup.ts`.
 */
import { CURRENT_SCHEMA_VERSION } from '@/db/migrate';
import type { RawDb, SqlParam } from '@/db/raw-db';
import { nowISO, todayISO } from '@/lib/dates';

export const BACKUP_FORMAT = 'life-tracker-backup';

/**
 * Порядок важливий при імпорті в порожню базу: спочатку довідники, потім те,
 * що на них посилається.
 */
export const BACKUP_TABLES = [
  'settings',
  'currencies',
  'tags',
  'accounts',
  'income_sources',
  'categories',
  'loans',
  'loan_rate_history',
  'loan_payments',
  'loan_schedule',
  'transactions',
  'food_catalog',
  'meal_entries',
  'workouts',
  'body_metrics',
  'study_sessions',
  'daily_checkins',
  'goals',
] as const;

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function buildBackup(raw: RawDb, appVersion = '0.1.0'): BackupPayload {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = raw.getAllSync<Record<string, unknown>>(`SELECT * FROM ${table}`, []);
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: nowISO(),
    appVersion,
    tables,
  };
}

// ─────────────────────────── CSV ───────────────────────────

export interface CsvExport {
  id: string;
  label: string;
  filenameHint: string;
  sql: string;
}

/**
 * Готові вивантаження. Колонки підібрані вручну (підписи замість id), а суми
 * подано у двох вигляді: `_minor` — як у базі, і звичайні одиниці — щоб
 * не змушувати нікого ділити на 100 вручну й не втрачати точність.
 */
export const CSV_EXPORTS: CsvExport[] = [
  {
    id: 'transactions',
    label: 'Транзакції',
    filenameHint: 'transactions',
    sql: `SELECT t.date, t.kind, c.name AS category, a.name AS account, s.name AS income_source,
                 t.amount AS amount_minor, t.amount / 100.0 AS amount,
                 t.currency, t.amount_base AS amount_base_minor, t.amount_base / 100.0 AS amount_base,
                 t.payee, t.note
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN income_sources s ON s.id = t.income_source_id
           WHERE t.deleted_at IS NULL
           ORDER BY t.date, t.created_at`,
  },
  {
    id: 'meals',
    label: 'Харчування',
    filenameHint: 'meals',
    sql: `SELECT date, time, meal_type, name, grams, kcal, protein_g, fat_g, carbs_g, note
            FROM meal_entries
           WHERE deleted_at IS NULL
           ORDER BY date, time`,
  },
  {
    id: 'workouts',
    label: 'Тренування',
    filenameHint: 'workouts',
    sql: `SELECT date, start_time, kind, name, duration_min, intensity_rpe AS rpe,
                 kcal_burned, distance_km, note
            FROM workouts
           WHERE deleted_at IS NULL
           ORDER BY date, start_time`,
  },
  {
    id: 'study',
    label: 'Навчання',
    filenameHint: 'study',
    sql: `SELECT date, start_time, subject, topic, kind, duration_min, focus, pages, note
            FROM study_sessions
           WHERE deleted_at IS NULL
           ORDER BY date, start_time`,
  },
  {
    id: 'loan_payments',
    label: 'Платежі за кредитами',
    filenameHint: 'loan_payments',
    sql: `SELECT p.date, l.name AS loan, p.total_amount AS total_minor, p.total_amount / 100.0 AS total,
                 p.interest_part AS interest_minor, p.interest_part / 100.0 AS interest,
                 p.principal_part AS principal_minor, p.principal_part / 100.0 AS principal,
                 p.is_early, p.note
            FROM loan_payments p
            JOIN loans l ON l.id = p.loan_id
           WHERE p.deleted_at IS NULL
           ORDER BY p.date`,
  },
];

/** Екранування за RFC 4180: лапки подвоюються, поля з комою беруться в лапки. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  // BOM — щоб Excel не ламав кирилицю.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildCsv(raw: RawDb, exportId: string): { filename: string; content: string } {
  const config = CSV_EXPORTS.find((e) => e.id === exportId);
  if (!config) throw new Error(`Невідомий експорт: ${exportId}`);

  const rows = raw.getAllSync<Record<string, unknown>>(config.sql, []);
  const content = toCsv(rows);
  if (!content) throw new Error('Немає даних для експорту');

  return { filename: `${config.filenameHint}-${todayISO()}.csv`, content };
}

// ─────────────────────────── імпорт ───────────────────────────

export interface ImportTableStat {
  table: string;
  inserted: number;
  updated: number;
  skipped: number;
  ignoredColumns: string[];
}

export interface ImportReport {
  tables: ImportTableStat[];
  schemaVersion: number | null;
  exportedAt: string | null;
  warnings: string[];
}

export function tableColumns(raw: RawDb, table: string): string[] {
  return raw.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`, []).map((c) => c.name);
}

export function primaryKeyColumns(raw: RawDb, table: string): string[] {
  return raw
    .getAllSync<{ name: string; pk: number }>(`PRAGMA table_info(${table})`, [])
    .filter((c) => c.pk > 0)
    .map((c) => c.name);
}

export function parseBackup(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не є коректним JSON');
  }

  const payload = parsed as Partial<BackupPayload>;
  if (
    payload?.format !== BACKUP_FORMAT ||
    typeof payload.tables !== 'object' ||
    payload.tables === null
  ) {
    throw new Error('Це не файл бекапу Life Tracker');
  }
  return payload as BackupPayload;
}

/**
 * Злиття бекапу з поточною базою.
 *
 * Особливості, які варто знати:
 *  - колонки, яких немає в поточній схемі, ігноруються (бекап зі старішої або
 *    новішої версії не зламає базу);
 *  - якщо в таблиці є `updated_at`, перезапис відбувається лише коли вхідний
 *    рядок новіший — інакше локальна правка була б затерта старішими даними
 *    (last-write-wins);
 *  - рядки, яких немає у файлі, не видаляються;
 *  - усе виконується в одній транзакції: часткового імпорту не буває.
 */
export function importBackup(raw: RawDb, payload: BackupPayload): ImportReport {
  const report: ImportReport = {
    tables: [],
    schemaVersion: payload.schemaVersion ?? null,
    exportedAt: payload.exportedAt ?? null,
    warnings: [],
  };

  if (payload.schemaVersion != null && payload.schemaVersion > CURRENT_SCHEMA_VERSION) {
    report.warnings.push(
      `Бекап зроблено у новішій версії схеми (${payload.schemaVersion} проти ${CURRENT_SCHEMA_VERSION}). ` +
        'Невідомі поля буде пропущено.',
    );
  }

  raw.withTransactionSync(() => {
    for (const table of BACKUP_TABLES) {
      const rows = payload.tables[table];
      const stat: ImportTableStat = {
        table,
        inserted: 0,
        updated: 0,
        skipped: 0,
        ignoredColumns: [],
      };
      report.tables.push(stat);
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const existing = tableColumns(raw, table);
      const pk = primaryKeyColumns(raw, table);
      if (pk.length === 0) {
        stat.skipped = rows.length;
        report.warnings.push(`Таблиця ${table} не має первинного ключа — пропущено.`);
        continue;
      }

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const cols = Object.keys(row).filter((c) => existing.includes(c));
        const ignored = Object.keys(row).filter((c) => !existing.includes(c));
        if (ignored.length) {
          stat.ignoredColumns = Array.from(new Set([...stat.ignoredColumns, ...ignored]));
        }
        if (!pk.every((k) => cols.includes(k))) {
          stat.skipped += 1;
          continue;
        }

        const placeholders = cols.map(() => '?').join(', ');
        const updateCols = cols.filter((c) => !pk.includes(c));
        const hasUpdatedAt = existing.includes('updated_at') && cols.includes('updated_at');

        // WHERE у DO UPDATE — це і є LWW: старіший рядок не перезаписує новіший.
        const onConflict = updateCols.length
          ? `ON CONFLICT(${pk.join(', ')}) DO UPDATE SET ${updateCols
              .map((c) => `${c} = excluded.${c}`)
              .join(', ')}${hasUpdatedAt ? ` WHERE excluded.updated_at >= ${table}.updated_at` : ''}`
          : `ON CONFLICT(${pk.join(', ')}) DO NOTHING`;

        const values: SqlParam[] = cols.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (typeof v === 'boolean') return v ? 1 : 0;
          if (typeof v === 'number' || typeof v === 'string') return v;
          return JSON.stringify(v);
        });

        const pkValues = pk.map((k) => values[cols.indexOf(k)] ?? null);
        const before = raw.getFirstSync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${pk.map((k) => `${k} = ?`).join(' AND ')}`,
          pkValues,
        );
        const existed = (before?.n ?? 0) > 0;

        const result = raw.runSync(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ${onConflict}`,
          values,
        );

        if (!existed) stat.inserted += 1;
        else if (result.changes > 0) stat.updated += 1;
        // Рядок існує, але локальний новіший — LWW залишив локальну версію.
        else stat.skipped += 1;
      }
    }
  });

  return report;
}

// ─────────────────────────── обслуговування ───────────────────────────

export interface DataCounts {
  transactions: number;
  meals: number;
  workouts: number;
  study: number;
  loans: number;
}

export function dataCounts(raw: RawDb): DataCounts {
  const row = raw.getFirstSync<{
    transactions: number;
    meals: number;
    workouts: number;
    study: number;
    loans: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL)   AS transactions,
            (SELECT COUNT(*) FROM meal_entries WHERE deleted_at IS NULL)   AS meals,
            (SELECT COUNT(*) FROM workouts WHERE deleted_at IS NULL)       AS workouts,
            (SELECT COUNT(*) FROM study_sessions WHERE deleted_at IS NULL) AS study,
            (SELECT COUNT(*) FROM loans WHERE deleted_at IS NULL)          AS loans`,
    [],
  );
  return {
    transactions: row?.transactions ?? 0,
    meals: row?.meals ?? 0,
    workouts: row?.workouts ?? 0,
    study: row?.study ?? 0,
    loans: row?.loans ?? 0,
  };
}

/**
 * Видаляє всі записи, але зберігає довідники (рахунки, категорії, джерела
 * доходу, налаштування).
 *
 * Таблиці перелічені явно, а не взяті зі схеми: видалення даних має ламатися
 * голосно, якщо з'явиться нова таблиця, а не мовчки її пропустити.
 */
export const DATA_TABLES = [
  'loan_schedule',
  'loan_payments',
  'loan_rate_history',
  'loans',
  'transactions',
  'meal_entries',
  'workouts',
  'study_sessions',
  'body_metrics',
  'daily_checkins',
  'goals',
] as const;

export function wipeData(raw: RawDb): void {
  raw.withTransactionSync(() => {
    for (const table of DATA_TABLES) {
      raw.runSync(`DELETE FROM ${table}`, []);
    }
  });
}
