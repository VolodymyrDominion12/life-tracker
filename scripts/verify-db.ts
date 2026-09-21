/**
 * Перевірка схеми, аналітики та логіки бекапу на справжньому SQLite.
 *
 * Запуск:  npm run verify
 *
 * Ідея: усе, що не залежить від інтерфейсу, має перевірятися без телефона
 * й без емулятора. Тут для цього використовується вбудований у Node `node:sqlite`,
 * загорнутий в інтерфейс `RawDb` — той самий, який на пристрої реалізує
 * `expo-sqlite`. Тобто цей файл заодно доводить, що межа адаптера справді
 * дозволяє підмінити рушій БД.
 *
 * Що перевіряється:
 *   1. міграції застосовуються, ідемпотентні, версія схеми зберігається;
 *   2. довідники з міграції №2 на місці;
 *   3. усі аналітичні VIEW дають правильні числа на відомих тестових даних;
 *   4. SQL доменних запитів виконується й повертає очікувані агрегати;
 *   5. математика кредитів збігається з незалежно порахованою формулою;
 *   6. CSV коректно екранує лапки, коми й переноси рядків;
 *   7. злиття бекапу: додавання, LWW-конфлікти, невідомі колонки, ідемпотентність
 *      і повний відкат при помилці всередині імпорту;
 *   8. очищення даних не зачіпає довідники.
 */
import { DatabaseSync } from 'node:sqlite';

import { CURRENT_SCHEMA_VERSION, runMigrations } from '@/db/migrate';
import * as Q from '@/db/queries';
import type { RawDb, SqlParam } from '@/db/raw-db';
import { annuityPayment, buildAnnuitySchedule, earlyRepaymentEffect } from '@/domain/loan-math';
import {
  buildBackup,
  buildCsv,
  csvCell,
  dataCounts,
  importBackup,
  parseBackup,
  toCsv,
  wipeData,
  type BackupPayload,
} from '@/features/backup/backup-core';
import { addDaysISO, humanMinutes, monthEndISO, monthKey } from '@/lib/dates';
import { formatMoney, fromMinor, parseAmountToMinor, toMinor } from '@/lib/money';

// ─────────────────────────── інфраструктура тесту ───────────────────────────

let checks = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), `отримано ${String(actual)}, очікувалось ${String(expected)}`);
}

function approx(name: string, actual: number, expected: number, tolerance: number): void {
  check(
    name,
    Math.abs(actual - expected) <= tolerance,
    `отримано ${actual}, очікувалось ${expected} ±${tolerance}`,
  );
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Адаптер: node:sqlite → RawDb. Саме те, що на пристрої робить expo-sqlite. */
function rawFromNodeSqlite(db: DatabaseSync): RawDb {
  const clean = (params: SqlParam[]) => params.map((p) => (p === undefined ? null : p));
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, params) => {
      const result = db.prepare(sql).run(...clean(params));
      return { changes: Number(result.changes) };
    },
    getAllSync: <T>(sql: string, params: SqlParam[] = []) =>
      db.prepare(sql).all(...clean(params)) as T[],
    getFirstSync: <T>(sql: string, params: SqlParam[] = []) =>
      (db.prepare(sql).get(...clean(params)) ?? null) as T | null,
    withTransactionSync: (fn) => {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function freshDb(): { raw: RawDb; version: { from: number; to: number } } {
  const raw = rawFromNodeSqlite(new DatabaseSync(':memory:'));
  raw.execSync('PRAGMA foreign_keys = ON;');
  const version = runMigrations(raw);
  return { raw, version };
}

const D1 = '2026-03-15';
const D2 = '2026-03-16';
const TS = '2026-03-15T10:00:00.000Z';

// ─────────────────────────── 1. міграції ───────────────────────────

section('1. Міграції');
{
  const { raw, version } = freshDb();
  eq('перша міграція підняла схему від 0', version.from, 0);
  eq('версія схеми дорівнює очікуваній', version.to, CURRENT_SCHEMA_VERSION);

  const userVersion = raw.getFirstSync<{ user_version: number }>('PRAGMA user_version', []);
  eq('PRAGMA user_version збережено у файлі БД', userVersion?.user_version, CURRENT_SCHEMA_VERSION);

  const tables = raw
    .getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      [],
    )
    .map((t) => t.name);
  for (const expected of [
    'transactions',
    'accounts',
    'categories',
    'income_sources',
    'loans',
    'loan_payments',
    'meal_entries',
    'workouts',
    'study_sessions',
    'goals',
  ]) {
    check(`таблиця ${expected} створена`, tables.includes(expected));
  }

  const views = raw
    .getAllSync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'view'`, [])
    .map((v) => v.name);
  for (const expected of [
    'v_monthly_finance',
    'v_category_spend',
    'v_income_by_source',
    'v_daily_energy',
    'v_weekly_load',
    'v_loan_balance',
  ]) {
    check(`VIEW ${expected} створено`, views.includes(expected));
  }

  const second = runMigrations(raw);
  eq('повторний запуск міграцій нічого не робить', `${second.from}->${second.to}`, `${CURRENT_SCHEMA_VERSION}->${CURRENT_SCHEMA_VERSION}`);
}

// ─────────────────────────── 2. довідники ───────────────────────────

section('2. Довідники з міграції №2');
{
  const { raw } = freshDb();
  const accounts = raw.getAllSync<{ n: number }>('SELECT COUNT(*) AS n FROM accounts', [])[0]!.n;
  const categories = raw.getAllSync<{ n: number }>('SELECT COUNT(*) AS n FROM categories', [])[0]!.n;
  const sources = raw.getAllSync<{ n: number }>('SELECT COUNT(*) AS n FROM income_sources', [])[0]!.n;
  const settings = raw.getAllSync<{ n: number }>('SELECT COUNT(*) AS n FROM settings', [])[0]!.n;

  check('рахунки за замовчуванням створені', accounts >= 2, `їх ${accounts}`);
  check('категорії за замовчуванням створені', categories >= 15, `їх ${categories}`);
  check('джерела доходу створені', sources >= 3, `їх ${sources}`);
  check('налаштування за замовчуванням створені', settings >= 5, `їх ${settings}`);

  const base = raw.getFirstSync<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'base_currency'`,
    [],
  );
  eq('базова валюта — гривня', base?.value, 'UAH');

  // Мітки часу в сідах мають бути в тому самому форматі, що пише застосунок,
  // інакше LWW-порівняння рядків при імпорті бекапу працює неправильно.
  const seedStamp = raw.getFirstSync<{ updated_at: string }>(
    `SELECT updated_at FROM accounts WHERE id = 'acc-cash'`,
    [],
  )?.updated_at;
  check(
    'мітки часу сідів у форматі ISO-8601 UTC',
    typeof seedStamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(seedStamp),
    `отримано ${seedStamp}`,
  );
}

// ─────────────────────────── тестові дані ───────────────────────────

interface Fixture {
  raw: RawDb;
}

/** Наповнює базу відомими даними: суми легко перевірити вручну. */
function seedFixture(): Fixture {
  const { raw } = freshDb();

  // Початкові залишки: 1000.00 ₴ на готівці.
  raw.runSync(`UPDATE accounts SET initial_balance = ? WHERE id = ?`, [100000, 'acc-cash']);

  const tx = (
    id: string,
    date: string,
    accountId: string,
    kind: string,
    amount: number,
    categoryId: string | null,
    incomeSourceId: string | null,
  ) =>
    raw.runSync(
      `INSERT INTO transactions
         (id, date, account_id, kind, category_id, income_source_id, amount, currency,
          amount_base, fx_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'UAH', ?, 1, ?, ?)`,
      [id, date, accountId, kind, categoryId, incomeSourceId, amount, amount, TS, TS],
    );

  tx('tx-1', D1, 'acc-cash', 'expense', 10000, 'cat-groceries', null); // 100.00
  tx('tx-2', D1, 'acc-card', 'expense', 5000, 'cat-groceries', null); // 50.00
  tx('tx-3', D1, 'acc-cash', 'income', 100000, 'cat-salary', 'inc-salary'); // 1000.00

  // Переказ: перекази зберігаються зі знаком (мінус — списання, плюс — зарахування).
  raw.runSync(
    `INSERT INTO transactions
       (id, date, account_id, kind, amount, currency, amount_base, fx_rate, transfer_peer_id,
        created_at, updated_at)
     VALUES ('tr-out', ?, 'acc-cash', 'transfer', -20000, 'UAH', -20000, 1, 'tr-in', ?, ?)`,
    [D1, TS, TS],
  );
  raw.runSync(
    `INSERT INTO transactions
       (id, date, account_id, kind, amount, currency, amount_base, fx_rate, transfer_peer_id,
        created_at, updated_at)
     VALUES ('tr-in', ?, 'acc-card', 'transfer', 20000, 'UAH', 20000, 1, 'tr-out', ?, ?)`,
    [D1, TS, TS],
  );

  const meal = (id: string, kcal: number, protein: number) =>
    raw.runSync(
      `INSERT INTO meal_entries (id, date, time, meal_type, name, kcal, protein_g, created_at, updated_at)
       VALUES (?, ?, '12:00', 'lunch', 'Тест', ?, ?, ?, ?)`,
      [id, D1, kcal, protein, TS, TS],
    );
  meal('meal-1', 1200, 40);
  meal('meal-2', 800, 25);

  raw.runSync(
    `INSERT INTO workouts (id, date, start_time, duration_min, kind, intensity_rpe, kcal_burned, created_at, updated_at)
     VALUES ('wo-1', ?, '18:00', 60, 'strength', 7, 300, ?, ?)`,
    [D1, TS, TS],
  );
  // kcal_burned = NULL: SUM по порожніх значеннях має дати 0, а не NULL.
  raw.runSync(
    `INSERT INTO workouts (id, date, start_time, duration_min, kind, created_at, updated_at)
     VALUES ('wo-2', ?, '08:00', 45, 'walk', ?, ?)`,
    [D2, TS, TS],
  );

  raw.runSync(
    `INSERT INTO study_sessions (id, date, start_time, duration_min, subject, kind, focus, created_at, updated_at)
     VALUES ('st-1', ?, '20:00', 90, 'Python', 'course', 4, ?, ?)`,
    [D1, TS, TS],
  );

  raw.runSync(
    `INSERT INTO loans (id, name, kind, principal, currency, annual_rate, rate_type, term_months,
                        start_date, first_payment_date, created_at, updated_at)
     VALUES ('loan-1', 'Тестовий кредит', 'annuity', 10000000, 'UAH', 18, 'fixed', 12,
             '2026-01-01', '2026-02-01', ?, ?)`,
    [TS, TS],
  );
  raw.runSync(
    `INSERT INTO loan_payments (id, loan_id, date, total_amount, interest_part, principal_part, is_early, created_at, updated_at)
     VALUES ('lp-1', 'loan-1', '2026-02-01', 916800, 150000, 766800, 0, ?, ?)`,
    [TS, TS],
  );

  return { raw };
}

// ─────────────────────────── 3. аналітичні VIEW ───────────────────────────

section('3. Аналітичні VIEW на тестових даних');
{
  const { raw } = seedFixture();

  const monthly = raw.getFirstSync<{ income_base: number; expense_base: number; net_base: number }>(
    Q.MONTHLY_FINANCE_BY_MONTH,
    ['2026-03'],
  );
  eq('v_monthly_finance: дохід', monthly?.income_base, 100000);
  eq('v_monthly_finance: витрати', monthly?.expense_base, 15000);
  eq('v_monthly_finance: чистий результат', monthly?.net_base, 85000);
  check(
    'v_monthly_finance: перекази не враховано як дохід/витрату',
    monthly?.income_base === 100000 && monthly?.expense_base === 15000,
  );

  const cats = raw.getAllSync<{ category: string; spent_base: number; tx_count: number }>(
    Q.CATEGORY_SPEND_BY_MONTH,
    ['2026-03'],
  );
  eq('v_category_spend: одна категорія витрат', cats.length, 1);
  eq('v_category_spend: сума по категорії', cats[0]?.spent_base, 15000);
  eq('v_category_spend: кількість операцій', cats[0]?.tx_count, 2);

  const sources = raw.getAllSync<{ source: string; income_base: number }>(
    Q.INCOME_BY_SOURCE_BY_MONTH,
    ['2026-03'],
  );
  eq('v_income_by_source: джерело доходу', sources[0]?.source, 'Зарплата');
  eq('v_income_by_source: сума доходу', sources[0]?.income_base, 100000);

  const d1 = raw.getFirstSync<{
    kcal_in: number;
    kcal_out: number;
    kcal_net: number;
    workout_min: number;
    study_min: number;
  }>(Q.DAILY_ENERGY_BY_DATE, [D1]);
  eq('v_daily_energy: калорії з їжі', d1?.kcal_in, 2000);
  eq('v_daily_energy: спалені калорії', d1?.kcal_out, 300);
  eq('v_daily_energy: баланс калорій', d1?.kcal_net, 1700);
  eq('v_daily_energy: хвилини спорту', d1?.workout_min, 60);
  eq('v_daily_energy: хвилини навчання', d1?.study_min, 90);

  const d2 = raw.getFirstSync<{ kcal_in: number; kcal_out: number; workout_min: number }>(
    Q.DAILY_ENERGY_BY_DATE,
    [D2],
  );
  eq('v_daily_energy: день без їжі дає 0, а не NULL', d2?.kcal_in, 0);
  eq('v_daily_energy: NULL у kcal_burned дає 0', d2?.kcal_out, 0);
  eq('v_daily_energy: день існує лише завдяки тренуванню', d2?.workout_min, 45);

  const weekly = raw.getAllSync<{ workout_min: number; study_min: number }>(
    `SELECT workout_min, study_min FROM v_weekly_load`,
    [],
  );
  const totalWorkout = weekly.reduce((s, w) => s + w.workout_min, 0);
  const totalStudy = weekly.reduce((s, w) => s + w.study_min, 0);
  eq('v_weekly_load: сума хвилин спорту', totalWorkout, 105);
  eq('v_weekly_load: сума хвилин навчання', totalStudy, 90);

  const loan = raw.getFirstSync<{
    principal: number;
    balance: number;
    principal_paid: number;
    interest_paid: number;
  }>(`SELECT principal, balance, principal_paid, interest_paid FROM v_loan_balance`, []);
  eq('v_loan_balance: тіло кредиту', loan?.principal, 10000000);
  eq('v_loan_balance: залишок після платежу', loan?.balance, 10000000 - 766800);
  eq('v_loan_balance: сплачені проценти', loan?.interest_paid, 150000);

  const energy = raw.getFirstSync<{
    workout_min: number;
    study_min: number;
    avg_kcal_in: number;
    avg_kcal_out: number;
    days: number;
  }>(Q.MONTH_ENERGY_AVERAGES, ['2026-03']);
  eq('місячні середні: хвилини спорту', energy?.workout_min, 105);
  eq('місячні середні: середні калорії з їжі', Math.round(energy?.avg_kcal_in ?? 0), 2000);
  eq('місячні середні: середні спалені калорії (нулі ігноруються)', Math.round(energy?.avg_kcal_out ?? 0), 300);
  eq('місячні середні: кількість днів із записами', energy?.days, 2);
}

// ─────────────────────────── 4. доменні запити ───────────────────────────

section('4. Запити домену');
{
  const { raw } = seedFixture();

  const balances = raw.getAllSync<{ id: string; balance: number }>(Q.ACCOUNT_BALANCES, []);
  const cash = balances.find((b) => b.id === 'acc-cash');
  const card = balances.find((b) => b.id === 'acc-card');
  // 1000.00 початково + 1000.00 дохід − 100.00 витрата − 200.00 переказ
  eq('залишок готівки враховує початковий баланс, дохід, витрату й переказ', cash?.balance, 170000);
  // 0 + 200.00 переказ − 50.00 витрата
  eq('залишок картки враховує переказ і витрату', card?.balance, 15000);

  const recent = raw.getAllSync<{ id: string; category_name: string | null; account_name: string | null }>(
    Q.RECENT_TRANSACTIONS,
    [10],
  );
  eq('останні транзакції: усі рядки', recent.length, 5);
  check(
    'останні транзакції: підтягнуто назву категорії та рахунку',
    recent.some((r) => r.category_name === 'Продукти' && r.account_name === 'Готівка'),
  );

  const spend = raw.getFirstSync<{ total: number }>(Q.SPEND_TOTAL_RANGE, ['2026-03-01', '2026-03-31']);
  eq('витрати за діапазон', spend?.total, 15000);

  const byDay = raw.getAllSync<{ date: string; spent_base: number }>(Q.EXPENSES_BY_DATE_RANGE, [
    '2026-03-01',
    '2026-03-31',
  ]);
  eq('витрати по днях: один день із витратами', byDay.length, 1);
  eq('витрати по днях: сума за день', byDay[0]?.spent_base, 15000);

  const io = raw.getFirstSync<{ spent_base: number; earned_base: number }>(
    Q.INCOME_AND_EXPENSE_BY_DATE,
    [D1],
  );
  eq('дохід і витрати за день: витрати', io?.spent_base, 15000);
  eq('дохід і витрати за день: дохід', io?.earned_base, 100000);

  const workoutTotals = raw.getFirstSync<{ total: number }>(Q.WORKOUT_MINUTES_RANGE, [
    '2026-03-01',
    '2026-03-31',
  ]);
  eq('хвилини спорту за період', workoutTotals?.total, 105);

  const studyTotals = raw.getFirstSync<{ total: number }>(Q.STUDY_MINUTES_RANGE, [
    '2026-03-01',
    '2026-03-31',
  ]);
  eq('хвилини навчання за період', studyTotals?.total, 90);

  const kinds = raw.getAllSync<{ kind: string; sessions: number; minutes: number; avg_rpe: number | null }>(
    Q.WORKOUT_STATS_BY_KIND,
    ['2026-03-01', '2026-03-31'],
  );
  eq('статистика за типами тренувань: два типи', kinds.length, 2);
  const strength = kinds.find((k) => k.kind === 'strength');
  eq('середній RPE рахується лише по заповнених', Math.round(strength?.avg_rpe ?? 0), 7);

  const subjects = raw.getAllSync<{ subject: string; minutes: number }>(Q.STUDY_STATS_BY_SUBJECT, [
    '2026-03-01',
    '2026-03-31',
  ]);
  eq('статистика за предметами', subjects[0]?.subject, 'Python');

  const cross = raw.getAllSync<{ date: string; spent: number; workout_min: number }>(
    Q.DAILY_CROSS_DOMAIN,
    ['2026-03-01', '2026-03-31'],
  );
  eq('крос-доменний зріз: два дні', cross.length, 2);
  eq('крос-доменний зріз: витрати прив’язані до дня', cross.find((c) => c.date === D1)?.spent, 15000);

  const categoryUsage = raw.getAllSync<{ category_id: string; n: number }>(Q.CATEGORY_USAGE, [
    'expense',
    'expense',
  ]);
  eq('використання категорій: одна категорія', categoryUsage.length, 1);
  eq('використання категорій: кількість використань', categoryUsage[0]?.n, 2);

  const counts = dataCounts(raw);
  eq('підрахунок записів: транзакції', counts.transactions, 5);
  eq('підрахунок записів: їжа', counts.meals, 2);
  eq('підрахунок записів: тренування', counts.workouts, 2);
  eq('підрахунок записів: навчання', counts.study, 1);
  eq('підрахунок записів: кредити', counts.loans, 1);

  // М'яке видалення: видалений рядок не має потрапляти в аналітику.
  raw.runSync(`UPDATE meal_entries SET deleted_at = ? WHERE id = 'meal-2'`, [TS]);
  const afterDelete = raw.getFirstSync<{ kcal_in: number }>(Q.DAILY_ENERGY_BY_DATE, [D1]);
  eq('видалений запис зникає з аналітики', afterDelete?.kcal_in, 1200);
}

// ─────────────────────────── 5. математика кредитів ───────────────────────────

section('5. Математика кредитів');
{
  const principal = 10000000; // 100 000.00 ₴
  const rate = 18;
  const term = 12;

  // Незалежний розрахунок тієї ж формули — щоб тест не повторював код застосунку.
  const i = rate / 100 / 12;
  const reference = (principal * i) / (1 - Math.pow(1 + i, -term));

  approx('ануїтетний платіж збігається з незалежним розрахунком', annuityPayment(principal, rate, term), reference, 1);
  approx('платіж за 100 000 ₴ під 18% на рік ≈ 9 168 ₴', annuityPayment(principal, rate, term) / 100, 9168, 1);

  const schedule = buildAnnuitySchedule({
    principalMinor: principal,
    annualRate: rate,
    termMonths: term,
    firstPaymentDate: '2026-02-01',
  });
  eq('графік містить рівно 12 платежів', schedule.rows.length, 12);
  eq('після останнього платежу залишок нульовий', schedule.rows[schedule.rows.length - 1]?.balanceAfter, 0);
  eq('сума погашеного тіла дорівнює сумі кредиту', schedule.rows.reduce((s, r) => s + r.principalPart, 0), principal);

  const referenceInterest = reference * term - principal;
  approx('загальна переплата близька до розрахункової', schedule.totalInterest, referenceInterest, 2000);
  check('переплата додатна', schedule.totalInterest > 0);

  const firstRow = schedule.rows[0]!;
  eq('у першому платежі проценти = тіло × місячна ставка', firstRow.interest, Math.round(principal * i));
  check(
    'на короткому кредиті перший платіж здебільшого гасить тіло',
    firstRow.principalPart > firstRow.interest,
    `проценти ${firstRow.interest}, тіло ${firstRow.principalPart}`,
  );
  check(
    'проценти в останньому платежі менші, ніж у першому',
    schedule.rows[schedule.rows.length - 1]!.interest < firstRow.interest,
  );

  const zeroRate = buildAnnuitySchedule({
    principalMinor: 1200000,
    annualRate: 0,
    termMonths: 12,
    firstPaymentDate: '2026-02-01',
  });
  eq('нульова ставка: платіж = тіло / строк', zeroRate.monthlyPayment, 100000);
  eq('нульова ставка: переплата нульова', zeroRate.totalInterest, 0);
  eq('нульова ставка: графік на 12 місяців', zeroRate.rows.length, 12);

  // Іпотека: 1 000 000 ₴ під 18% на 20 років — тут проценти в першому платежі
  // справді домінують, саме тому довгі кредити такі дорогі.
  const mortgage = buildAnnuitySchedule({
    principalMinor: 100000000,
    annualRate: 18,
    termMonths: 240,
    firstPaymentDate: '2026-02-01',
  });
  check(
    'на довгому кредиті перший платіж здебільшого складається з процентів',
    mortgage.rows[0]!.interest > mortgage.rows[0]!.principalPart,
    `проценти ${mortgage.rows[0]!.interest}, тіло ${mortgage.rows[0]!.principalPart}`,
  );
  eq('іпотека закривається рівно за 240 платежів', mortgage.rows.length, 240);
  eq(
    'іпотека повертає рівно суму боргу',
    mortgage.rows.reduce((s, r) => s + r.principalPart, 0),
    100000000,
  );
  check(
    'переплата за іпотекою більша за суму боргу',
    mortgage.totalInterest > 100000000,
    `переплата ${mortgage.totalInterest / 100} ₴`,
  );

  const extra = earlyRepaymentEffect({
    principalMinor: principal,
    annualRate: rate,
    termMonths: term,
    firstPaymentDate: '2026-02-01',
    extraMonthlyMinor: 200000, // +2 000 ₴ щомісяця
  });
  check('дострокове погашення скорочує строк', extra.monthsSaved > 0, `зекономлено ${extra.monthsSaved} міс.`);
  check('дострокове погашення зменшує переплату', extra.interestSaved > 0, `зекономлено ${extra.interestSaved / 100} ₴`);
  eq('дострокове погашення не змінює суму основного боргу', extra.withExtra.rows.reduce((s, r) => s + r.principalPart, 0), principal);

  // Захисний запобіжник: якщо внесок «з'їдає» платіж, графік не має зациклитися.
  const broken = buildAnnuitySchedule({
    principalMinor: principal,
    annualRate: rate,
    termMonths: term,
    firstPaymentDate: '2026-02-01',
    extraMonthlyMinor: -annuityPayment(principal, rate, term) * 2,
  });
  eq('некоректний внесок дає порожній графік, а не нескінченний цикл', broken.rows.length, 0);
}

// ─────────────────────────── 6. гроші й CSV ───────────────────────────

section('6. Форматування грошей і CSV');
{
  eq('формат суми з розділювачами', formatMoney(123456789), '1 234 567,89 ₴');
  eq('формат від’ємної суми', formatMoney(-5000), '−50,00 ₴');
  eq('формат доларів', formatMoney(100000, 'USD'), '1 000,00 $');
  eq('розбір суми з комою', parseAmountToMinor('1 234,50'), 123450);
  eq('розбір суми з точкою', parseAmountToMinor('99.99'), 9999);
  eq('порожній рядок не є сумою', parseAmountToMinor(''), null);
  eq('текст не є сумою', parseAmountToMinor('abc'), null);
  eq('переведення у мінорні одиниці', toMinor(19.99), 1999);
  eq('переведення з мінорних одиниць', fromMinor(1999), 19.99);
  eq('округлення до копійки', toMinor(0.005), 1);

  eq('комірка без спецсимволів не екранується', csvCell('Продукти'), 'Продукти');
  eq('комірка з комою береться в лапки', csvCell('Сільпо, центр'), '"Сільпо, центр"');
  eq('лапки подвоюються', csvCell('сказав "так"'), '"сказав ""так"""');
  eq('перенос рядка екранується', csvCell('рядок1\nрядок2'), '"рядок1\nрядок2"');
  eq('null стає порожнім', csvCell(null), '');

  const csv = toCsv([
    { date: D1, name: 'Сільпо, центр', kcal: 1200 },
    { date: D2, name: 'Кафе "Ласка"', kcal: 800 },
  ]);
  check('CSV починається з BOM для Excel', csv.startsWith('\uFEFF'));
  check('CSV містить заголовки', csv.includes('date,name,kcal'));
  check('CSV екранує кому в значенні', csv.includes('"Сільпо, центр"'));
  check('CSV використовує CRLF', csv.includes('\r\n'));
  eq('порожній набір даних дає порожній CSV', toCsv([]), '');

  const { raw } = seedFixture();
  const exported = buildCsv(raw, 'transactions');
  check('CSV транзакцій має зрозумілу назву файлу', exported.filename.startsWith('transactions-'));
  check('CSV транзакцій містить колонку з мінорними одиницями', exported.content.includes('amount_minor'));
  check('CSV транзакцій містить підпис категорії', exported.content.includes('Продукти'));

  let unknownExportThrew = false;
  try {
    buildCsv(raw, 'неіснуючий');
  } catch {
    unknownExportThrew = true;
  }
  check('невідомий експорт кидає помилку', unknownExportThrew);
}

// ─────────────────────────── 7. бекап і злиття ───────────────────────────

section('7. Бекап, імпорт і LWW-злиття');
{
  const source = seedFixture();
  const payload = buildBackup(source.raw, '0.1.0');

  eq('бекап має правильний формат', payload.format, 'life-tracker-backup');
  eq('бекап містить версію схеми', payload.schemaVersion, CURRENT_SCHEMA_VERSION);
  eq('бекап містить усі транзакції', payload.tables.transactions?.length, 5);
  check('бекап містить довідники', (payload.tables.categories?.length ?? 0) > 0);

  // 7.1 Імпорт у порожню базу
  {
    const target = freshDb();
    const report = importBackup(target.raw, payload);
    const txStat = report.tables.find((t) => t.table === 'transactions')!;
    eq('імпорт у порожню базу: додано транзакцій', txStat.inserted, 5);
    eq('імпорт у порожню базу: оновлено', txStat.updated, 0);

    const counts = dataCounts(target.raw);
    eq('після імпорту транзакцій стільки ж', counts.transactions, 5);
    eq('після імпорту тренувань стільки ж', counts.workouts, 2);

    // Порівнюємо похідні від імпортованих записів числа. Залишки на рахунках
    // для цього не годяться: довідник рахунків у цільовій базі щойно засіяний,
    // тому його `updated_at` новіший за бекап і LWW законно залишає початковий
    // баланс із сідів, а не з файлу.
    const sourceMonthly = source.raw.getFirstSync<{ income_base: number; expense_base: number }>(
      Q.MONTHLY_FINANCE_BY_MONTH,
      ['2026-03'],
    );
    const targetMonthly = target.raw.getFirstSync<{ income_base: number; expense_base: number }>(
      Q.MONTHLY_FINANCE_BY_MONTH,
      ['2026-03'],
    );
    eq('після імпорту дохід за місяць збігається з джерелом', targetMonthly?.income_base, sourceMonthly?.income_base);
    eq('після імпорту витрати за місяць збігаються з джерелом', targetMonthly?.expense_base, sourceMonthly?.expense_base);

    const sourceEnergy = source.raw.getFirstSync<{ kcal_in: number; workout_min: number }>(
      Q.DAILY_ENERGY_BY_DATE,
      [D1],
    );
    const targetEnergy = target.raw.getFirstSync<{ kcal_in: number; workout_min: number }>(
      Q.DAILY_ENERGY_BY_DATE,
      [D1],
    );
    eq('після імпорту калорії збігаються з джерелом', targetEnergy?.kcal_in, sourceEnergy?.kcal_in);
    eq('після імпорту хвилини спорту збігаються з джерелом', targetEnergy?.workout_min, sourceEnergy?.workout_min);

    // 7.2 Повторний імпорт того самого файлу нічого не додає
    const again = importBackup(target.raw, payload);
    const againStat = again.tables.find((t) => t.table === 'transactions')!;
    eq('повторний імпорт не додає дублікатів', againStat.inserted, 0);
    eq('повторний імпорт не створює нових рядків', dataCounts(target.raw).transactions, 5);
  }

  // 7.3 Локальніший рядок не має бути перетертий старішим із файлу
  {
    const target = freshDb();
    importBackup(target.raw, payload);

    const localUpdate = '2026-04-01T00:00:00.000Z';
    target.raw.runSync(`UPDATE meal_entries SET kcal = 1000, updated_at = ? WHERE id = 'meal-1'`, [
      localUpdate,
    ]);

    // У файлі цей самий рядок старіший → має залишитись локальна версія.
    const report = importBackup(target.raw, payload);
    const mealStat = report.tables.find((t) => t.table === 'meal_entries')!;
    const kept = target.raw.getFirstSync<{ kcal: number }>(
      `SELECT kcal FROM meal_entries WHERE id = 'meal-1'`,
      [],
    );
    eq('старіший рядок із бекапу не перезаписує новіший локальний', kept?.kcal, 1000);
    eq('такий рядок пораховано як пропущений', mealStat.skipped, 1);

    // А тепер навпаки: у файлі новіша версія.
    const newerPayload: BackupPayload = {
      ...payload,
      tables: {
        ...payload.tables,
        meal_entries: payload.tables.meal_entries!.map((row) =>
          row.id === 'meal-1'
            ? { ...row, kcal: 1500, updated_at: '2026-05-01T00:00:00.000Z' }
            : row,
        ),
      },
    };
    const report2 = importBackup(target.raw, newerPayload);
    const updated = target.raw.getFirstSync<{ kcal: number }>(
      `SELECT kcal FROM meal_entries WHERE id = 'meal-1'`,
      [],
    );
    eq('новіший рядок із бекапу перезаписує локальний', updated?.kcal, 1500);
    // `>=` у DO UPDATE означає, що рядок із тим самим часом теж перезаписується.
    // Це свідомо: повторний імпорт того самого файлу працює як «ремонт» —
    // пошкоджений локальний рядок відновлюється з бекапу.
    eq(
      'рядки з однаковим updated_at перезаписуються (ідемпотентний ремонт)',
      report2.tables.find((t) => t.table === 'meal_entries')!.updated,
      2,
    );
  }

  // 7.4 Невідомі колонки ігноруються, а не ламають імпорт
  {
    const target = freshDb();
    const withExtra: BackupPayload = {
      ...payload,
      tables: {
        ...payload.tables,
        meal_entries: payload.tables.meal_entries!.map((row) => ({
          ...row,
          колонка_з_майбутнього: 'щось',
        })),
      },
    };
    const report = importBackup(target.raw, withExtra);
    const stat = report.tables.find((t) => t.table === 'meal_entries')!;
    check('невідома колонка зафіксована у звіті', stat.ignoredColumns.includes('колонка_з_майбутнього'));
    eq('дані при цьому імпортовані', stat.inserted, 2);
  }

  // 7.5 Бекап із новішою версією схеми дає попередження, але не падає
  {
    const target = freshDb();
    const report = importBackup(target.raw, { ...payload, schemaVersion: CURRENT_SCHEMA_VERSION + 5 });
    check('попередження про новішу версію схеми', report.warnings.length > 0);
    eq('імпорт усе одно виконано', dataCounts(target.raw).transactions, 5);
  }

  // 7.6 Атомарність: помилка в середині файлу скасовує весь імпорт
  {
    const target = freshDb();
    const brokenPayload: BackupPayload = {
      ...payload,
      tables: {
        ...payload.tables,
        accounts: [
          ...(payload.tables.accounts ?? []),
          {
            id: 'acc-new',
            name: 'Новий рахунок',
            kind: 'cash',
            currency: 'UAH',
            initial_balance: 0,
            include_in_net: 1,
            sort_order: 99,
            created_at: TS,
            updated_at: TS,
          },
        ],
        transactions: [
          ...(payload.tables.transactions ?? []),
          {
            // amount = null порушує NOT NULL → має відкотити весь імпорт
            id: 'tx-broken',
            date: D1,
            account_id: 'acc-cash',
            kind: 'expense',
            amount: null,
            currency: 'UAH',
            amount_base: 0,
            fx_rate: 1,
            created_at: TS,
            updated_at: TS,
          },
        ],
      },
    };

    let threw = false;
    try {
      importBackup(target.raw, brokenPayload);
    } catch {
      threw = true;
    }
    check('помилковий рядок призводить до помилки імпорту', threw);
    eq('після помилки база порожня', dataCounts(target.raw).transactions, 0);
    eq(
      'рахунок із того ж файлу теж не додався (транзакція відкотилась)',
      target.raw.getFirstSync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM accounts WHERE id = 'acc-new'`,
        [],
      )?.n,
      0,
    );
  }

  // 7.7 Розбір некоректних файлів
  {
    let notJson = false;
    try {
      parseBackup('це не json');
    } catch {
      notJson = true;
    }
    check('не-JSON відхиляється', notJson);

    let notBackup = false;
    try {
      parseBackup(JSON.stringify({ hello: 'world' }));
    } catch {
      notBackup = true;
    }
    check('чужий JSON відхиляється', notBackup);

    const ok = parseBackup(JSON.stringify(payload));
    eq('коректний бекап розбирається', ok.format, 'life-tracker-backup');
  }

  // 7.8 Очищення даних не зачіпає довідники
  {
    const target = seedFixture();
    wipeData(target.raw);
    const counts = dataCounts(target.raw);
    eq('після очищення транзакцій немає', counts.transactions, 0);
    eq('після очищення тренувань немає', counts.workouts, 0);
    eq('після очищення кредитів немає', counts.loans, 0);
    const accounts = target.raw.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM accounts',
      [],
    );
    check('рахунки залишились', (accounts?.n ?? 0) >= 2);
    const settings = target.raw.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM settings',
      [],
    );
    check('налаштування залишились', (settings?.n ?? 0) >= 5);
  }
}

// ─────────────────────────── 8. дати ───────────────────────────

section('8. Робота з датами');
{
  eq('кінець місяця для березня', monthEndISO('2026-03-15'), '2026-03-31');
  eq('кінець місяця для лютого (не високосний)', monthEndISO('2026-02-10'), '2026-02-28');
  eq('кінець місяця для лютого (високосний)', monthEndISO('2028-02-10'), '2028-02-29');
  eq('ключ місяця', monthKey('2026-03-15'), '2026-03');
  eq('додавання днів уперед', addDaysISO('2026-03-15', 3), '2026-03-18');
  eq('додавання днів назад через межу місяця', addDaysISO('2026-03-01', -1), '2026-02-28');
  eq('людяний формат хвилин (години й хвилини)', humanMinutes(125), '2 год 5 хв');
  eq('людяний формат хвилин (тільки хвилини)', humanMinutes(45), '45 хв');
  eq('людяний формат хвилин (рівно година)', humanMinutes(60), '1 год');
}

// ─────────────────────────── підсумок ───────────────────────────

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`Усі ${checks} перевірок пройдено.`);
} else {
  console.log(`Провалено ${failures.length} із ${checks} перевірок:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
