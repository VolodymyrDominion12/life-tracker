/**
 * Міграції схеми.
 *
 * Кожна міграція має унікальний зростаючий `version` і виконується рівно один раз.
 * Поточна версія зберігається в `PRAGMA user_version` самої бази.
 *
 * Правила:
 *  - Ніколи не змінюй уже випущену міграцію — додавай нову з більшим version.
 *  - Кожна міграція виконується в транзакції (див. `migrate.ts`).
 *  - SQL — звичайний SQLite: працює і на native, і на web.
 *  - Мітки часу пишуться ТІЛЬКИ у форматі ISO-8601 UTC —
 *    `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, а не `datetime('now')`.
 *    Причина не косметична: LWW-злиття при імпорті бекапу порівнює `updated_at`
 *    як звичайні рядки, тож формати мусять бути однакові в усьому застосунку.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
-- ─────────────── службові ───────────────
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS currencies (
  code         TEXT PRIMARY KEY,
  rate_to_base REAL,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

-- ─────────────── фінанси: довідники ───────────────
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('cash','card','bank','savings','crypto','broker')),
  currency        TEXT NOT NULL,
  initial_balance INTEGER NOT NULL DEFAULT 0,
  include_in_net  INTEGER NOT NULL DEFAULT 1,
  archived_at     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS income_sources (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('salary','freelance','business','passive','gift','other')),
  expected_amount INTEGER,
  period          TEXT CHECK (period IN ('monthly','weekly','one_off')),
  currency        TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id    TEXT,
  icon         TEXT,
  color        TEXT,
  is_essential INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_categories_kind ON categories(kind);

-- ─────────────── кредити ───────────────
CREATE TABLE IF NOT EXISTS loans (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  lender               TEXT,
  kind                 TEXT CHECK (kind IN ('annuity','differential','revolving','mortgage','installment')),
  principal            INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  annual_rate          REAL NOT NULL,
  rate_type            TEXT NOT NULL DEFAULT 'fixed' CHECK (rate_type IN ('fixed','floating')),
  rate_index           TEXT,
  term_months          INTEGER,
  start_date           TEXT NOT NULL,
  first_payment_date   TEXT,
  payment_day          INTEGER,
  payment_amount       INTEGER,
  early_repayment_fee  INTEGER DEFAULT 0,
  closed_at            TEXT,
  note                 TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE IF NOT EXISTS loan_rate_history (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  annual_rate    REAL NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_hist ON loan_rate_history(loan_id, effective_from);

CREATE TABLE IF NOT EXISTS loan_payments (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  account_id     TEXT,
  transaction_id TEXT,
  total_amount   INTEGER NOT NULL,
  interest_part  INTEGER,
  principal_part INTEGER,
  fee_part       INTEGER DEFAULT 0,
  is_early       INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_loan_pay ON loan_payments(loan_id, date);

CREATE TABLE IF NOT EXISTS loan_schedule (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  due_date       TEXT NOT NULL,
  payment_amount INTEGER NOT NULL,
  interest_part  INTEGER NOT NULL,
  principal_part INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  annual_rate    REAL NOT NULL,
  generated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_loan ON loan_schedule(loan_id, seq);

-- ─────────────── транзакції ───────────────
CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL,
  account_id       TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  category_id      TEXT,
  income_source_id TEXT,
  loan_id          TEXT,
  amount           INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  amount_base      INTEGER NOT NULL,
  fx_rate          REAL NOT NULL DEFAULT 1,
  transfer_peer_id TEXT,
  payee            TEXT,
  note             TEXT,
  tags             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_cat     ON transactions(category_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_loan    ON transactions(loan_id);

-- ─────────────── їжа / тіло ───────────────
CREATE TABLE IF NOT EXISTS food_catalog (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  brand              TEXT,
  barcode            TEXT,
  source             TEXT DEFAULT 'manual' CHECK (source IN ('manual','openfoodfacts','user')),
  per                TEXT NOT NULL DEFAULT '100g' CHECK (per IN ('100g','100ml','portion')),
  kcal               REAL,
  protein_g          REAL,
  fat_g              REAL,
  carbs_g            REAL,
  fiber_g            REAL,
  default_portion_g  REAL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_food_barcode ON food_catalog(barcode);

CREATE TABLE IF NOT EXISTS meal_entries (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  time       TEXT,
  meal_type  TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack','drink')),
  food_id    TEXT,
  name       TEXT,
  grams      REAL,
  portion    REAL,
  kcal       REAL NOT NULL,
  protein_g  REAL,
  fat_g      REAL,
  carbs_g    REAL,
  note       TEXT,
  tags       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_date ON meal_entries(date);

CREATE TABLE IF NOT EXISTS workouts (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  start_time    TEXT,
  duration_min  INTEGER NOT NULL,
  kind          TEXT CHECK (kind IN ('strength','cardio','hiit','mobility','sport','walk','other')),
  name          TEXT,
  intensity_rpe INTEGER,
  kcal_burned   INTEGER,
  distance_km   REAL,
  avg_hr        INTEGER,
  sets_json     TEXT,
  note          TEXT,
  tags          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_workout_date ON workouts(date);

CREATE TABLE IF NOT EXISTS body_metrics (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  time         TEXT,
  weight_kg    REAL,
  body_fat_pct REAL,
  waist_cm     REAL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_body_date ON body_metrics(date);

-- ─────────────── навчання ───────────────
CREATE TABLE IF NOT EXISTS study_sessions (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  start_time   TEXT,
  duration_min INTEGER NOT NULL,
  subject      TEXT NOT NULL,
  topic        TEXT,
  kind         TEXT CHECK (kind IN ('reading','course','practice','project','flashcards','lecture','other')),
  resource     TEXT,
  focus        INTEGER,
  pages        INTEGER,
  note         TEXT,
  tags         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_study_date ON study_sessions(date);

-- ─────────────── щоденник і цілі ───────────────
CREATE TABLE IF NOT EXISTS daily_checkins (
  date          TEXT PRIMARY KEY,
  sleep_hours   REAL,
  sleep_quality INTEGER,
  mood          INTEGER,
  energy        INTEGER,
  stress        INTEGER,
  steps         INTEGER,
  water_ml      INTEGER,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,
  metric       TEXT NOT NULL,
  period       TEXT NOT NULL CHECK (period IN ('day','week','month','quarter','year')),
  target_value REAL NOT NULL,
  direction    TEXT NOT NULL DEFAULT 'at_least' CHECK (direction IN ('at_least','at_most')),
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

-- ─────────────── аналітичні VIEW ───────────────
CREATE VIEW IF NOT EXISTS v_monthly_finance AS
SELECT substr(date, 1, 7)                                    AS month,
       SUM(CASE WHEN kind = 'income'  THEN amount_base END)  AS income_base,
       SUM(CASE WHEN kind = 'expense' THEN amount_base END)  AS expense_base,
       SUM(CASE WHEN kind = 'income'  THEN amount_base END)
         - SUM(CASE WHEN kind = 'expense' THEN amount_base END) AS net_base
FROM transactions
WHERE deleted_at IS NULL AND kind IN ('income','expense')
GROUP BY month;

CREATE VIEW IF NOT EXISTS v_category_spend AS
SELECT substr(t.date, 1, 7) AS month,
       c.id                 AS category_id,
       c.name               AS category,
       SUM(t.amount_base)   AS spent_base,
       COUNT(*)             AS tx_count
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.deleted_at IS NULL AND t.kind = 'expense'
GROUP BY month, c.id;

CREATE VIEW IF NOT EXISTS v_income_by_source AS
SELECT substr(t.date, 1, 7) AS month,
       s.id                 AS source_id,
       s.name               AS source,
       s.kind               AS source_kind,
       SUM(t.amount_base)   AS income_base
FROM transactions t
JOIN income_sources s ON s.id = t.income_source_id
WHERE t.deleted_at IS NULL AND t.kind = 'income'
GROUP BY month, s.id;

-- kcal in (їжа) vs kcal out (тренування) + хвилини спорту й навчання за день.
-- Написано без FULL OUTER JOIN, щоб працювати на старіших збірках SQLite (web/WASM).
CREATE VIEW IF NOT EXISTS v_daily_energy AS
WITH days AS (
  SELECT date FROM meal_entries   WHERE deleted_at IS NULL
  UNION
  SELECT date FROM workouts       WHERE deleted_at IS NULL
  UNION
  SELECT date FROM study_sessions WHERE deleted_at IS NULL
)
SELECT d.date AS date,
       COALESCE((SELECT SUM(m.kcal)         FROM meal_entries   m WHERE m.date = d.date AND m.deleted_at IS NULL), 0) AS kcal_in,
       COALESCE((SELECT SUM(w.kcal_burned)  FROM workouts       w WHERE w.date = d.date AND w.deleted_at IS NULL), 0) AS kcal_out,
       COALESCE((SELECT SUM(m.kcal)         FROM meal_entries   m WHERE m.date = d.date AND m.deleted_at IS NULL), 0)
         - COALESCE((SELECT SUM(w.kcal_burned) FROM workouts     w WHERE w.date = d.date AND w.deleted_at IS NULL), 0) AS kcal_net,
       COALESCE((SELECT SUM(w.duration_min) FROM workouts       w WHERE w.date = d.date AND w.deleted_at IS NULL), 0) AS workout_min,
       COALESCE((SELECT SUM(s.duration_min) FROM study_sessions s WHERE s.date = d.date AND s.deleted_at IS NULL), 0) AS study_min
FROM days d;

CREATE VIEW IF NOT EXISTS v_weekly_load AS
WITH days AS (
  SELECT date FROM workouts       WHERE deleted_at IS NULL
  UNION
  SELECT date FROM study_sessions WHERE deleted_at IS NULL
)
SELECT strftime('%Y-W%W', d.date) AS week,
       COALESCE((SELECT SUM(w.duration_min) FROM workouts       w WHERE strftime('%Y-W%W', w.date) = strftime('%Y-W%W', d.date) AND w.deleted_at IS NULL), 0) AS workout_min,
       COALESCE((SELECT SUM(s.duration_min) FROM study_sessions s WHERE strftime('%Y-W%W', s.date) = strftime('%Y-W%W', d.date) AND s.deleted_at IS NULL), 0) AS study_min
FROM days d
GROUP BY week;

CREATE VIEW IF NOT EXISTS v_loan_balance AS
SELECT l.id                                        AS loan_id,
       l.name                                      AS loan,
       l.currency                                  AS currency,
       l.principal                                 AS principal,
       l.principal - COALESCE(p.paid_principal, 0) AS balance,
       COALESCE(p.paid_principal, 0)               AS principal_paid,
       COALESCE(p.paid_interest, 0)                AS interest_paid
FROM loans l
LEFT JOIN (
  SELECT loan_id,
         SUM(COALESCE(principal_part, 0)) AS paid_principal,
         SUM(COALESCE(interest_part, 0))  AS paid_interest
  FROM loan_payments
  WHERE deleted_at IS NULL
  GROUP BY loan_id
) p ON p.loan_id = l.id
WHERE l.deleted_at IS NULL;
`,
  },
  {
    version: 2,
    name: 'seed_defaults',
    sql: `
-- Довідники за замовчуванням: можна вільно редагувати й видаляти в застосунку.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('base_currency', 'UAH'),
  ('kcal_target', '2200'),
  ('workout_target_min', '180'),
  ('study_target_min', '600'),
  ('week_starts_on', '1'),
  ('onboarded', '0');

INSERT OR IGNORE INTO currencies (code, rate_to_base, updated_at) VALUES
  ('UAH', 1,    strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('USD', 42,   strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('EUR', 45,   strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- rate_to_base — приблизний курс; користувач оновлює вручну в налаштуваннях.

INSERT OR IGNORE INTO accounts (id, name, kind, currency, initial_balance, include_in_net, sort_order, created_at, updated_at) VALUES
  ('acc-cash',   'Готівка',    'cash', 'UAH', 0, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc-card',   'Картка',     'card', 'UAH', 0, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO income_sources (id, name, kind, period, currency, is_active, created_at, updated_at) VALUES
  ('inc-salary',   'Зарплата',       'salary',    'monthly', 'UAH', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('inc-freelance','Фріланс',        'freelance', 'monthly', 'UAH', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('inc-passive',  'Пасивний дохід', 'passive',   'monthly', 'UAH', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO categories (id, name, kind, icon, is_essential, sort_order, created_at, updated_at) VALUES
  ('cat-groceries', 'Продукти',      'expense', '🛒', 1,  10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-housing',   'Житло',         'expense', '🏠', 1,  20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-utilities', 'Комуналка',     'expense', '💡', 1,  30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-transport', 'Транспорт',     'expense', '🚌', 1,  40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-health',    'Здоров''я',     'expense', '💊', 1,  50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-sport',     'Спорт',         'expense', '🏋️', 0,  60, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-education', 'Освіта',        'expense', '📚', 0,  70, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-cafe',      'Кафе і ресторани','expense','☕', 0,  80, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-clothes',   'Одяг',          'expense', '👕', 0,  90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-fun',       'Розваги',       'expense', '🎮', 0, 100, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-comm',      'Зв''язок',      'expense', '📱', 1, 110, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-subs',      'Підписки',      'expense', '🔁', 0, 120, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-loan',      'Кредити',       'expense', '🏦', 1, 130, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-gifts',     'Подарунки',     'expense', '🎁', 0, 140, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-other-exp', 'Інше',          'expense', '📦', 0, 999, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-salary',    'Зарплата',      'income',  '💼', 0,  10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-freelance', 'Фріланс',       'income',  '💻', 0,  20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-gift-in',   'Подарунок',     'income',  '🎁', 0,  30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('cat-other-inc', 'Інший дохід',   'income',  '➕', 0, 999, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`,
  },
  {
    version: 3,
    name: 'loan_rate_period',
    sql: `
-- Ставка кредиту тепер має ПЕРІОД: «0,5% у день», «2% у місяць», «18% річних».
-- Це не косметика: без періоду два кредити з однаковим числом ставки
-- («2») могли коштувати у 30 разів по-різному, і сортувати їх не було як.
--
-- Розділення на два поля навмисне:
--   rate_value  + rate_period — те, як ставку назвав кредитор (для показу й редагування);
--   annual_rate               — та сама ставка, приведена до річних (для порівняння й математики).
-- Тримати лише одне з них означало б або втратити те, що ввів користувач,
-- або рахувати проценти від необрізаного до річних числа.
--
-- Наявні кредити лишаються з періодом 'year': їхній annual_rate і був річним.
ALTER TABLE loans ADD COLUMN rate_period TEXT NOT NULL DEFAULT 'year'
  CHECK (rate_period IN ('day','month','year'));
ALTER TABLE loans ADD COLUMN rate_value REAL;
ALTER TABLE loans ADD COLUMN payment_period TEXT NOT NULL DEFAULT 'month'
  CHECK (payment_period IN ('day','week','month'));

ALTER TABLE loan_rate_history ADD COLUMN rate_period TEXT NOT NULL DEFAULT 'year'
  CHECK (rate_period IN ('day','month','year'));
ALTER TABLE loan_rate_history ADD COLUMN rate_value REAL;

UPDATE loans SET rate_value = annual_rate WHERE rate_value IS NULL;
UPDATE loan_rate_history SET rate_value = annual_rate WHERE rate_value IS NULL;
`,
  },
];
