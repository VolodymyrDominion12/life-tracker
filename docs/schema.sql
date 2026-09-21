-- Life Tracker — чернетка схеми SQLite (v1)
-- Гроші зберігаються в мінорних одиницях (копійки) як INTEGER.
-- Дати: 'YYYY-MM-DD', часові мітки: ISO-8601 UTC.

PRAGMA foreign_keys = ON;

-- ─────────────────────────── службове ───────────────────────────
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
); -- schema_version, app_version, created_at, device_id

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
); -- base_currency, kcal_target, protein_target, week_starts_on, locale...

CREATE TABLE currencies (
  code          TEXT PRIMARY KEY,      -- 'UAH', 'USD', 'EUR'
  rate_to_base  REAL,                  -- 1 од. валюти = rate_to_base базової
  updated_at    TEXT
);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

-- ─────────────────────────── фінанси ───────────────────────────
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('cash','card','bank','savings','crypto','broker')),
  currency        TEXT NOT NULL REFERENCES currencies(code),
  initial_balance INTEGER NOT NULL DEFAULT 0,   -- у мінорних одиницях
  include_in_net  INTEGER NOT NULL DEFAULT 1,
  archived_at     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE income_sources (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,                -- 'Зарплата', 'Фріланс', 'Оренда'
  kind            TEXT NOT NULL CHECK (kind IN ('salary','freelance','business','passive','gift','other')),
  expected_amount INTEGER,                      -- очікуваний дохід за period
  period          TEXT CHECK (period IN ('monthly','weekly','one_off')),
  currency        TEXT REFERENCES currencies(code),
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  icon       TEXT,
  color      TEXT,
  is_essential INTEGER NOT NULL DEFAULT 0,      -- для розрахунку "обов'язкових" витрат
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_categories_kind ON categories(kind) WHERE deleted_at IS NULL;

CREATE TABLE transactions (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL,               -- 'YYYY-MM-DD'
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  kind             TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  category_id      TEXT REFERENCES categories(id),      -- NULL для переказів
  income_source_id TEXT REFERENCES income_sources(id),  -- для kind='income'
  amount           INTEGER NOT NULL,            -- > 0, у валюті рахунку
  currency         TEXT NOT NULL REFERENCES currencies(code),
  amount_base      INTEGER NOT NULL,            -- у базовій валюті на дату операції
  fx_rate          REAL NOT NULL DEFAULT 1,
  transfer_peer_id TEXT REFERENCES transactions(id),    -- друга нога переказу
  loan_id          TEXT REFERENCES loans(id),
  payee            TEXT,                        -- контрагент/магазин
  note             TEXT,
  tags             TEXT,                        -- JSON-масив рядків (спрощення v1)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX idx_tx_date    ON transactions(date)          WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_account ON transactions(account_id, date) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_cat     ON transactions(category_id, date) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_loan    ON transactions(loan_id)       WHERE deleted_at IS NULL;

-- ─────────────────────────── кредити ───────────────────────────
-- rate_value + rate_period — те, як ставку назвав кредитор («0,5% у день»);
-- annual_rate — вона ж, приведена до річних (банківська конвенція 30/360:
-- місяць = 30 днів, рік = 360). Порівнювати кредити між собою можна лише
-- за annual_rate: 2% у місяць і 18% річних — це 24% і 18% річних.
CREATE TABLE loans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  lender            TEXT,                       -- джерело кредиту: банк, МФО, магазин
  kind              TEXT CHECK (kind IN ('annuity','differential','revolving','mortgage','installment')),
  principal         INTEGER NOT NULL,           -- початкова сума
  currency          TEXT NOT NULL REFERENCES currencies(code),
  annual_rate       REAL NOT NULL,              -- % РІЧНИХ, завжди нормалізовано
  rate_period       TEXT NOT NULL DEFAULT 'year' CHECK (rate_period IN ('day','month','year')),
  rate_value        REAL,                       -- ставка як її ввели (за rate_period)
  rate_type         TEXT NOT NULL DEFAULT 'fixed' CHECK (rate_type IN ('fixed','floating')),
  rate_index        TEXT,                       -- напр. 'NBU_rate + 3%' для floating
  term_months       INTEGER,
  start_date        TEXT NOT NULL,
  first_payment_date TEXT,
  payment_day       INTEGER,                    -- день місяця
  payment_period    TEXT NOT NULL DEFAULT 'month' CHECK (payment_period IN ('day','week','month')),
  payment_amount    INTEGER,                    -- плановий платіж
  early_repayment_fee INTEGER DEFAULT 0,        -- комісія за дострокове погашення
  closed_at         TEXT,                       -- нарахування зупиняється цього дня
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);

CREATE TABLE loan_rate_history (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  annual_rate    REAL NOT NULL,                 -- теж нормалізовано до річних
  rate_period    TEXT NOT NULL DEFAULT 'year' CHECK (rate_period IN ('day','month','year')),
  rate_value     REAL,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_rate_hist ON loan_rate_history(loan_id, effective_from);

-- фактичні платежі; розбиття тіло/проценти може вводитись руками або рахуватись
CREATE TABLE loan_payments (
  id               TEXT PRIMARY KEY,
  loan_id          TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  account_id       TEXT REFERENCES accounts(id),
  transaction_id   TEXT REFERENCES transactions(id),
  total_amount     INTEGER NOT NULL,
  interest_part    INTEGER,
  principal_part   INTEGER,
  fee_part         INTEGER DEFAULT 0,
  is_early         INTEGER NOT NULL DEFAULT 0,  -- дострокове погашення
  note             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX idx_loan_pay ON loan_payments(loan_id, date);

-- Таблиця під збережений графік платежів. Зараз НЕ використовується: план
-- будується на льоту (`buildAnnuitySchedule`) і не записується, бо він повністю
-- виводиться з умов кредиту й поточного залишку, а збережена копія неминуче
-- розійшлася б із розрахунком. Лишена як місце для імпорту чужих графіків
-- (наприклад, вивантаження з банку) — тоді факт можна буде звіряти з планом.
CREATE TABLE loan_schedule (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  due_date       TEXT NOT NULL,
  payment_amount INTEGER NOT NULL,
  interest_part  INTEGER NOT NULL,
  principal_part INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  annual_rate    REAL NOT NULL,
  generated_at   TEXT NOT NULL,
  UNIQUE (loan_id, seq)
);

-- ─────────────────────────── їжа / тіло ───────────────────────────
CREATE TABLE food_catalog (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  brand         TEXT,
  barcode       TEXT,
  source        TEXT DEFAULT 'manual' CHECK (source IN ('manual','openfoodfacts','user')),
  per           TEXT NOT NULL DEFAULT '100g' CHECK (per IN ('100g','100ml','portion')),
  kcal          REAL,
  protein_g     REAL,
  fat_g         REAL,
  carbs_g       REAL,
  fiber_g       REAL,
  default_portion_g REAL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_food_barcode ON food_catalog(barcode);

CREATE TABLE meal_entries (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  time        TEXT,                              -- 'HH:MM'
  meal_type   TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack','drink')),
  food_id     TEXT REFERENCES food_catalog(id),
  name        TEXT,                              -- якщо без каталогу
  grams       REAL,
  portion     REAL,                              -- кількість порцій
  kcal        REAL NOT NULL,                     -- підсумок по запису
  protein_g   REAL,
  fat_g       REAL,
  carbs_g     REAL,
  note        TEXT,
  tags        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_meal_date ON meal_entries(date) WHERE deleted_at IS NULL;

CREATE TABLE workouts (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  start_time    TEXT,                            -- 'HH:MM'
  duration_min  INTEGER NOT NULL,
  kind          TEXT CHECK (kind IN ('strength','cardio','hiit','mobility','sport','walk','other')),
  name          TEXT,                            -- 'Жим', 'Футбол', 'Біг 5к'
  intensity_rpe INTEGER CHECK (intensity_rpe BETWEEN 1 AND 10),
  kcal_burned   INTEGER,
  distance_km   REAL,
  avg_hr        INTEGER,
  sets_json     TEXT,                            -- деталізація підходів, якщо треба
  note          TEXT,
  tags          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_workout_date ON workouts(date) WHERE deleted_at IS NULL;

CREATE TABLE body_metrics (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  time         TEXT,
  weight_kg    REAL,
  body_fat_pct REAL,
  waist_cm     REAL,
  chest_cm     REAL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  UNIQUE (date, time)
);

-- ─────────────────────────── навчання ───────────────────────────
CREATE TABLE study_sessions (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  start_time    TEXT,
  duration_min  INTEGER NOT NULL,
  subject       TEXT NOT NULL,                   -- 'Математика', 'Python', 'Англійська'
  topic         TEXT,
  kind          TEXT CHECK (kind IN ('reading','course','practice','project','flashcards','lecture','other')),
  resource      TEXT,                            -- книга/курс/посилання
  focus         INTEGER CHECK (focus BETWEEN 1 AND 5),
  pages         INTEGER,
  note          TEXT,
  tags          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_study_date ON study_sessions(date) WHERE deleted_at IS NULL;

-- ─────────────────────────── щоденник і цілі ───────────────────────────
CREATE TABLE daily_checkins (
  date         TEXT PRIMARY KEY,
  sleep_hours  REAL,
  sleep_quality INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
  mood         INTEGER CHECK (mood BETWEEN 1 AND 5),
  energy       INTEGER CHECK (energy BETWEEN 1 AND 5),
  stress       INTEGER CHECK (stress BETWEEN 1 AND 5),
  steps        INTEGER,
  water_ml     INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  metric       TEXT NOT NULL,   -- 'savings','kcal_max','workout_min','study_min','weight'
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

-- ─────────────────────────── аналітичні VIEW ───────────────────────────
CREATE VIEW v_monthly_finance AS
SELECT substr(date, 1, 7)                                   AS month,
       SUM(CASE WHEN kind = 'income'  THEN amount_base END) AS income_base,
       SUM(CASE WHEN kind = 'expense' THEN amount_base END) AS expense_base,
       SUM(CASE WHEN kind = 'income'  THEN amount_base END)
         - SUM(CASE WHEN kind = 'expense' THEN amount_base END) AS net_base
FROM transactions
WHERE deleted_at IS NULL AND kind IN ('income','expense')
GROUP BY month;

CREATE VIEW v_category_spend AS
SELECT substr(t.date, 1, 7) AS month,
       c.id                 AS category_id,
       c.name               AS category,
       SUM(t.amount_base)   AS spent_base,
       COUNT(*)             AS tx_count
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.deleted_at IS NULL AND t.kind = 'expense'
GROUP BY month, c.id;

CREATE VIEW v_income_by_source AS
SELECT substr(t.date, 1, 7) AS month,
       s.id                 AS source_id,
       s.name               AS source,
       s.kind               AS source_kind,
       SUM(t.amount_base)   AS income_base
FROM transactions t
JOIN income_sources s ON s.id = t.income_source_id
WHERE t.deleted_at IS NULL AND t.kind = 'income'
GROUP BY month, s.id;

-- kcal in (їжа) vs kcal out (тренування) за день
CREATE VIEW v_daily_energy AS
WITH food AS (
  SELECT date, SUM(kcal) AS kcal_in
  FROM meal_entries WHERE deleted_at IS NULL GROUP BY date
), burn AS (
  SELECT date, SUM(COALESCE(kcal_burned, 0)) AS kcal_out,
         SUM(duration_min)                  AS workout_min
  FROM workouts WHERE deleted_at IS NULL GROUP BY date
), study AS (
  SELECT date, SUM(duration_min) AS study_min
  FROM study_sessions WHERE deleted_at IS NULL GROUP BY date
)
SELECT COALESCE(food.date, burn.date, study.date)              AS date,
       COALESCE(food.kcal_in, 0)                               AS kcal_in,
       COALESCE(burn.kcal_out, 0)                              AS kcal_out,
       COALESCE(food.kcal_in, 0) - COALESCE(burn.kcal_out, 0)  AS kcal_net,
       COALESCE(burn.workout_min, 0)                           AS workout_min,
       COALESCE(study.study_min, 0)                            AS study_min
FROM food
FULL OUTER JOIN burn  ON burn.date  = food.date
FULL OUTER JOIN study ON study.date = food.date;

-- тижневе навантаження: спорт і навчання поруч
CREATE VIEW v_weekly_load AS
SELECT strftime('%Y-W%W', date) AS week,
       (SELECT SUM(duration_min) FROM workouts       w WHERE strftime('%Y-W%W', w.date) = week AND w.deleted_at IS NULL) AS workout_min,
       (SELECT SUM(duration_min) FROM study_sessions s WHERE strftime('%Y-W%W', s.date) = week AND s.deleted_at IS NULL) AS study_min
FROM (SELECT date FROM workouts WHERE deleted_at IS NULL
      UNION SELECT date FROM study_sessions WHERE deleted_at IS NULL)
GROUP BY week;

-- залишок по кредиту: тіло − сплачене тіло
CREATE VIEW v_loan_balance AS
SELECT l.id                                AS loan_id,
       l.name                              AS loan,
       l.principal - COALESCE(p.paid_principal, 0) AS balance,
       COALESCE(p.paid_interest, 0)        AS interest_paid,
       COALESCE(p.paid_principal, 0)       AS principal_paid,
       l.currency
FROM loans l
LEFT JOIN (
  SELECT loan_id,
         SUM(COALESCE(principal_part, 0)) AS paid_principal,
         SUM(COALESCE(interest_part, 0))  AS paid_interest
  FROM loan_payments WHERE deleted_at IS NULL GROUP BY loan_id
) p ON p.loan_id = l.id
WHERE l.deleted_at IS NULL;

-- Примітки щодо реалізації:
-- 1) SQLite не має FULL OUTER JOIN до 3.39 — якщо цільова версія старіша,
--    v_daily_energy переписується через UNION дат + scalar subqueries.
-- 2) transactions.transfer_peer_id і loans посилаються одне на одного — порядок
--    створення таблиць у міграції треба врахувати (loans створювати до transactions,
--    або додати колонку окремою міграцією).
-- 3) Усі TEXT-id — UUID v4/v7, згенеровані на клієнті (offline-first).
