/**
 * Drizzle-схема — джерело істини для типізованих запитів.
 *
 * ВАЖЛИВО: DDL для створення таблиць живе в `./migrations.ts` (звичайний SQL,
 * який виконується власним раннером через `PRAGMA user_version`). Це свідомий
 * вибір: міграції не залежать від коду генерації drizzle-kit і працюють
 * однаково на native та web. Якщо змінюєш структуру тут — додай відповідну
 * міграцію в `migrations.ts`, інакше типи розійдуться з реальною БД.
 *
 * Гроші зберігаються в мінорних одиницях (копійки) як INTEGER.
 */
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

const audit = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
};

// ─────────────────────────── службові ───────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: ['cash', 'card', 'bank', 'savings', 'crypto', 'broker'],
  }).notNull(),
  currency: text('currency').notNull(),
  initialBalance: integer('initial_balance').notNull().default(0),
  includeInNet: integer('include_in_net', { mode: 'boolean' }).notNull().default(true),
  archivedAt: text('archived_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit,
});

export const incomeSources = sqliteTable('income_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: ['salary', 'freelance', 'business', 'passive', 'gift', 'other'],
  }).notNull(),
  expectedAmount: integer('expected_amount'),
  period: text('period', { enum: ['monthly', 'weekly', 'one_off'] }),
  currency: text('currency'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  ...audit,
});

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    parentId: text('parent_id'),
    icon: text('icon'),
    color: text('color'),
    isEssential: integer('is_essential', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...audit,
  },
  (t) => [index('idx_categories_kind').on(t.kind)],
);

// ─────────────────────────── кредити ───────────────────────────
/**
 * `annualRate` — завжди річна ставка, навіть якщо користувач вводив денну
 * чи місячну. Оригінальне значення лежить у `rateValue` + `ratePeriod`.
 * Так порівняння кредитів між собою (сортування «найдорожчі») і вся
 * математика йдуть по одному числу, а показати можна те, що ввів користувач.
 */
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  lender: text('lender'),
  kind: text('kind', {
    enum: ['annuity', 'differential', 'revolving', 'mortgage', 'installment'],
  }),
  principal: integer('principal').notNull(),
  currency: text('currency').notNull(),
  annualRate: real('annual_rate').notNull(),
  ratePeriod: text('rate_period', { enum: ['day', 'month', 'year'] })
    .notNull()
    .default('year'),
  rateValue: real('rate_value'),
  rateType: text('rate_type', { enum: ['fixed', 'floating'] }).notNull().default('fixed'),
  rateIndex: text('rate_index'),
  termMonths: integer('term_months'),
  startDate: text('start_date').notNull(),
  firstPaymentDate: text('first_payment_date'),
  paymentDay: integer('payment_day'),
  paymentPeriod: text('payment_period', { enum: ['day', 'week', 'month'] })
    .notNull()
    .default('month'),
  paymentAmount: integer('payment_amount'),
  earlyRepaymentFee: integer('early_repayment_fee').default(0),
  closedAt: text('closed_at'),
  note: text('note'),
  ...audit,
});

export const loanRateHistory = sqliteTable(
  'loan_rate_history',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    annualRate: real('annual_rate').notNull(),
    ratePeriod: text('rate_period', { enum: ['day', 'month', 'year'] })
      .notNull()
      .default('year'),
    rateValue: real('rate_value'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_rate_hist').on(t.loanId, t.effectiveFrom)],
);

export const loanPayments = sqliteTable(
  'loan_payments',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id').notNull(),
    date: text('date').notNull(),
    accountId: text('account_id'),
    transactionId: text('transaction_id'),
    totalAmount: integer('total_amount').notNull(),
    interestPart: integer('interest_part'),
    principalPart: integer('principal_part'),
    feePart: integer('fee_part').default(0),
    isEarly: integer('is_early', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    ...audit,
  },
  (t) => [index('idx_loan_pay').on(t.loanId, t.date)],
);

export const loanSchedule = sqliteTable(
  'loan_schedule',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id').notNull(),
    seq: integer('seq').notNull(),
    dueDate: text('due_date').notNull(),
    paymentAmount: integer('payment_amount').notNull(),
    interestPart: integer('interest_part').notNull(),
    principalPart: integer('principal_part').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    annualRate: real('annual_rate').notNull(),
    generatedAt: text('generated_at').notNull(),
  },
  (t) => [index('idx_schedule_loan').on(t.loanId, t.seq)],
);

// ─────────────────────────── фінанси ───────────────────────────
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    accountId: text('account_id').notNull(),
    kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    categoryId: text('category_id'),
    incomeSourceId: text('income_source_id'),
    loanId: text('loan_id'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    amountBase: integer('amount_base').notNull(),
    fxRate: real('fx_rate').notNull().default(1),
    transferPeerId: text('transfer_peer_id'),
    payee: text('payee'),
    note: text('note'),
    tags: text('tags'),
    ...audit,
  },
  (t) => [
    index('idx_tx_date').on(t.date),
    index('idx_tx_account').on(t.accountId, t.date),
    index('idx_tx_cat').on(t.categoryId, t.date),
    index('idx_tx_loan').on(t.loanId),
  ],
);

// ─────────────────────────── їжа / тіло ───────────────────────────
export const foodCatalog = sqliteTable(
  'food_catalog',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    brand: text('brand'),
    barcode: text('barcode'),
    source: text('source', { enum: ['manual', 'openfoodfacts', 'user'] }).default('manual'),
    per: text('per', { enum: ['100g', '100ml', 'portion'] }).notNull().default('100g'),
    kcal: real('kcal'),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    fiberG: real('fiber_g'),
    defaultPortionG: real('default_portion_g'),
    ...audit,
  },
  (t) => [index('idx_food_barcode').on(t.barcode)],
);

export const mealEntries = sqliteTable(
  'meal_entries',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    time: text('time'),
    mealType: text('meal_type', {
      enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink'],
    }),
    foodId: text('food_id'),
    name: text('name'),
    grams: real('grams'),
    portion: real('portion'),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    note: text('note'),
    tags: text('tags'),
    ...audit,
  },
  (t) => [index('idx_meal_date').on(t.date)],
);

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    durationMin: integer('duration_min').notNull(),
    kind: text('kind', {
      enum: ['strength', 'cardio', 'hiit', 'mobility', 'sport', 'walk', 'other'],
    }),
    name: text('name'),
    intensityRpe: integer('intensity_rpe'),
    kcalBurned: integer('kcal_burned'),
    distanceKm: real('distance_km'),
    avgHr: integer('avg_hr'),
    setsJson: text('sets_json'),
    note: text('note'),
    tags: text('tags'),
    ...audit,
  },
  (t) => [index('idx_workout_date').on(t.date)],
);

export const bodyMetrics = sqliteTable(
  'body_metrics',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    time: text('time'),
    weightKg: real('weight_kg'),
    bodyFatPct: real('body_fat_pct'),
    waistCm: real('waist_cm'),
    note: text('note'),
    ...audit,
  },
  (t) => [index('idx_body_date').on(t.date)],
);

// ─────────────────────────── навчання ───────────────────────────
export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    durationMin: integer('duration_min').notNull(),
    subject: text('subject').notNull(),
    topic: text('topic'),
    kind: text('kind', {
      enum: ['reading', 'course', 'practice', 'project', 'flashcards', 'lecture', 'other'],
    }),
    resource: text('resource'),
    focus: integer('focus'),
    pages: integer('pages'),
    note: text('note'),
    tags: text('tags'),
    ...audit,
  },
  (t) => [index('idx_study_date').on(t.date)],
);

// ─────────────────────────── щоденник і цілі ───────────────────────────
export const dailyCheckins = sqliteTable('daily_checkins', {
  date: text('date').primaryKey(),
  sleepHours: real('sleep_hours'),
  sleepQuality: integer('sleep_quality'),
  mood: integer('mood'),
  energy: integer('energy'),
  stress: integer('stress'),
  steps: integer('steps'),
  waterMl: integer('water_ml'),
  note: text('note'),
  ...audit,
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(),
  period: text('period', {
    enum: ['day', 'week', 'month', 'quarter', 'year'],
  }).notNull(),
  targetValue: real('target_value').notNull(),
  direction: text('direction', { enum: ['at_least', 'at_most'] })
    .notNull()
    .default('at_least'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  note: text('note'),
  ...audit,
});

// ─────────────────────────── типи ───────────────────────────
export type Account = typeof accounts.$inferSelect;
export type IncomeSource = typeof incomeSources.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;
export type LoanPayment = typeof loanPayments.$inferSelect;
export type LoanRateHistoryRow = typeof loanRateHistory.$inferSelect;
export type MealEntry = typeof mealEntries.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type Goal = typeof goals.$inferSelect;
