/**
 * Сирий SQL в одному місці.
 *
 * Навіщо окремий модуль:
 *  - ці запити — джерело істини для всієї аналітики, і вони не залежать від
 *    жодного рушія БД, тому їх можна виконати й перевірити будь-яким SQLite
 *    (саме це робить `scripts/verify-db.ts` на реальних тестових даних);
 *  - конструктор запитів Drizzle для агрегацій із CTE читався б гірше за SQL,
 *    а дублювання логіки підрахунку в двох місцях — прямий шлях до розбіжностей.
 *
 * Домовленість: `?` — позиційні параметри, порядок яких описано в коментарі
 * над запитом. Усі запити фільтрують `deleted_at IS NULL`.
 */

/** Без параметрів. Повертає рядок на місяць. */
export const MONTHLY_FINANCE_ALL = `
  SELECT month, income_base, expense_base, net_base
    FROM v_monthly_finance
   ORDER BY month DESC
   LIMIT ?`;

/** ?1 = 'YYYY-MM' */
export const MONTHLY_FINANCE_BY_MONTH = `
  SELECT month, income_base, expense_base, net_base
    FROM v_monthly_finance
   WHERE month = ?`;

/** ?1 = 'YYYY-MM' */
export const CATEGORY_SPEND_BY_MONTH = `
  SELECT category_id, category, spent_base, tx_count
    FROM v_category_spend
   WHERE month = ?
   ORDER BY spent_base DESC`;

/** ?1 = 'YYYY-MM' */
export const INCOME_BY_SOURCE_BY_MONTH = `
  SELECT source_id, source, source_kind, income_base
    FROM v_income_by_source
   WHERE month = ?
   ORDER BY income_base DESC`;

/** ?1 = date, ?2 = date */
export const DAILY_ENERGY_BY_DATE = `
  SELECT date, kcal_in, kcal_out, kcal_net, workout_min, study_min
    FROM v_daily_energy
   WHERE date = ?`;

/** ?1 = date, ?2 = date */
export const KCAL_IN_RANGE = `
  SELECT date, kcal_in AS value
    FROM v_daily_energy
   WHERE date BETWEEN ? AND ?`;

/** ?1 = date, ?2 = date */
export const DAILY_ENERGY_RANGE = `
  SELECT date, kcal_in, kcal_out, kcal_net, workout_min, study_min
    FROM v_daily_energy
   WHERE date BETWEEN ? AND ?
   ORDER BY date`;

/** ?1 = limit */
export const WEEKLY_LOAD_LIMIT = `
  SELECT week, workout_min, study_min
    FROM v_weekly_load
   ORDER BY week DESC
   LIMIT ?`;

export const LOAN_BALANCES = `
  SELECT loan_id, loan, currency, principal, balance, principal_paid, interest_paid
    FROM v_loan_balance
   ORDER BY loan`;

/**
 * Залишки по рахунках.
 *
 * `initial_balance` — це вже наявні гроші на момент початку обліку.
 * Перекази зберігаються зі знаком (мінус — списання, плюс — зарахування),
 * тому вони просто додаються, без окремої гілки логіки.
 */
export const ACCOUNT_BALANCES = `
  SELECT a.id, a.name, a.currency,
         a.initial_balance
           + COALESCE(SUM(CASE WHEN t.kind = 'income'   THEN t.amount END), 0)
           - COALESCE(SUM(CASE WHEN t.kind = 'expense'  THEN t.amount END), 0)
           + COALESCE(SUM(CASE WHEN t.kind = 'transfer' THEN t.amount END), 0)
         AS balance
    FROM accounts a
    LEFT JOIN transactions t
           ON t.account_id = a.id AND t.deleted_at IS NULL
   WHERE a.deleted_at IS NULL AND a.include_in_net = 1
   GROUP BY a.id
   ORDER BY a.sort_order, a.name`;

/** ?1 = limit */
export const RECENT_TRANSACTIONS = `
  SELECT t.id, t.date, t.kind, t.amount, t.currency, t.amount_base, t.payee, t.note,
         c.name AS category_name, c.icon AS category_icon, a.name AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts   a ON a.id = t.account_id
   WHERE t.deleted_at IS NULL
   ORDER BY t.date DESC, t.created_at DESC
   LIMIT ?`;

/** ?1 = date, ?2 = date */
export const EXPENSES_BY_DATE_RANGE = `
  SELECT date, SUM(amount_base) AS spent_base
    FROM transactions
   WHERE deleted_at IS NULL AND kind = 'expense' AND date BETWEEN ? AND ?
   GROUP BY date
   ORDER BY date`;

/** ?1 = date, ?2 = date */
export const SPEND_TOTAL_RANGE = `
  SELECT COALESCE(SUM(amount_base), 0) AS total
    FROM transactions
   WHERE deleted_at IS NULL AND kind = 'expense' AND date BETWEEN ? AND ?`;

/** ?1 = date, ?2 = date */
export const INCOME_AND_EXPENSE_RANGE = `
  SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_base END), 0) AS spent_base,
         COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount_base END), 0) AS earned_base
    FROM transactions
   WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`;

/** ?1 = date */
export const INCOME_AND_EXPENSE_BY_DATE = `
  SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_base END), 0) AS spent_base,
         COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount_base END), 0) AS earned_base
    FROM transactions
   WHERE deleted_at IS NULL AND date = ?`;

/** ?1 = 'YYYY-MM' */
export const MONTH_FINANCE_TOTALS = `
  SELECT COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount_base END), 0) AS income_base,
         COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_base END), 0) AS expense_base
    FROM transactions
   WHERE deleted_at IS NULL AND substr(date, 1, 7) = ?`;

/** ?1 = 'YYYY-MM' */
export const LOAN_PAYMENTS_BY_MONTH = `
  SELECT COALESCE(SUM(total_amount), 0) AS total
    FROM loan_payments
   WHERE deleted_at IS NULL AND substr(date, 1, 7) = ?`;

/** ?1 = date, ?2 = date */
export const WORKOUT_MINUTES_RANGE = `
  SELECT COALESCE(SUM(duration_min), 0) AS total
    FROM workouts
   WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`;

/** ?1 = date, ?2 = date */
export const STUDY_MINUTES_RANGE = `
  SELECT COALESCE(SUM(duration_min), 0) AS total
    FROM study_sessions
   WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`;

/** ?1 = date, ?2 = date */
export const WORKOUT_STATS_BY_KIND = `
  SELECT COALESCE(kind, 'other') AS kind,
         COUNT(*)                AS sessions,
         SUM(duration_min)       AS minutes,
         AVG(intensity_rpe)      AS avg_rpe
    FROM workouts
   WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
   GROUP BY COALESCE(kind, 'other')
   ORDER BY minutes DESC`;

/** ?1 = date, ?2 = date */
export const STUDY_STATS_BY_SUBJECT = `
  SELECT subject,
         COUNT(*)          AS sessions,
         SUM(duration_min) AS minutes,
         AVG(focus)        AS avg_focus
    FROM study_sessions
   WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
   GROUP BY subject
   ORDER BY minutes DESC`;

export const WORKOUT_DATES_DESC = `
  SELECT DISTINCT date FROM workouts WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 400`;

/** ?1 = limit */
export const RECENT_SUBJECTS = `
  SELECT subject
    FROM study_sessions
   WHERE deleted_at IS NULL
   GROUP BY subject
   ORDER BY MAX(created_at) DESC
   LIMIT ?`;

/** ?1 = limit */
export const RECENT_MEAL_NAMES = `
  SELECT name
    FROM meal_entries
   WHERE deleted_at IS NULL AND name IS NOT NULL AND name <> ''
   GROUP BY name
   ORDER BY MAX(created_at) DESC
   LIMIT ?`;

/** ?1 = 'expense' | 'income', ?2 = 'expense' | 'income' */
export const CATEGORY_USAGE = `
  SELECT t.category_id AS category_id, COUNT(*) AS n
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
   WHERE t.deleted_at IS NULL AND t.kind = ? AND c.kind = ?
   GROUP BY t.category_id`;

/** ?1 = 'YYYY-MM' */
export const MONTH_ENERGY_AVERAGES = `
  SELECT COALESCE(SUM(workout_min), 0)         AS workout_min,
         COALESCE(SUM(study_min), 0)           AS study_min,
         COALESCE(AVG(NULLIF(kcal_in, 0)), 0)  AS avg_kcal_in,
         COALESCE(AVG(NULLIF(kcal_out, 0)), 0) AS avg_kcal_out,
         COUNT(*)                              AS days
    FROM v_daily_energy
   WHERE substr(date, 1, 7) = ?`;

/** ?1 = date, ?2 = date */
export const DAILY_CROSS_DOMAIN = `
  SELECT e.date AS date,
         e.kcal_in AS kcal_in,
         e.workout_min AS workout_min,
         e.study_min AS study_min,
         COALESCE((SELECT SUM(t.amount_base) FROM transactions t
                    WHERE t.deleted_at IS NULL AND t.kind = 'expense' AND t.date = e.date), 0) AS spent
    FROM v_daily_energy e
   WHERE e.date BETWEEN ? AND ?
   ORDER BY e.date`;

/** ?1 = date */
export const MEAL_MACROS_RANGE = `
  SELECT COALESCE(SUM(protein_g), 0) AS protein_g,
         COALESCE(SUM(fat_g), 0)     AS fat_g,
         COALESCE(SUM(carbs_g), 0)   AS carbs_g,
         COUNT(*)                    AS meals
    FROM meal_entries
   WHERE deleted_at IS NULL AND date = ?`;

export const SETTINGS_ALL = 'SELECT key, value FROM settings';

export const CURRENCY_RATE = 'SELECT rate_to_base FROM currencies WHERE code = ?';

export const ACCOUNT_CURRENCY = 'SELECT currency FROM accounts WHERE id = ?';

export const COUNT_ALL_RECORDS = `
  SELECT (SELECT COUNT(*) FROM transactions)   AS transactions,
         (SELECT COUNT(*) FROM meal_entries)   AS meals,
         (SELECT COUNT(*) FROM workouts)       AS workouts,
         (SELECT COUNT(*) FROM study_sessions) AS study,
         (SELECT COUNT(*) FROM loans)          AS loans`;

/** ?1 = table name у WHERE — підставляється лише з коду, не з вводу користувача. */
export const countByPk = (table: string, pkCols: string[]): string =>
  `SELECT COUNT(*) AS n FROM ${table} WHERE ${pkCols.map((c) => `${c} = ?`).join(' AND ')}`;
