/**
 * Фінанси: рахунки, категорії, джерела доходу, транзакції, кредити.
 *
 * Розподіл: Drizzle — для записів (там важлива типізація значень), сирий SQL —
 * для читань з агрегацією (там джерело істини — VIEW у схемі, і дублювати його
 * конструктором запитів означало б мати дві різні логіки підрахунку).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

import { db, sqlAll, sqlOne } from '@/db/client';
import {
  accounts,
  categories,
  incomeSources,
  loanPayments,
  loanRateHistory,
  loans,
  transactions,
} from '@/db/schema';
import type {
  Account,
  Category,
  IncomeSource,
  Loan,
  LoanPayment,
  LoanRateHistoryRow,
  NewLoan,
} from '@/db/schema';
import {
  allocatePayment,
  annualizeRate,
  computeLoanState,
  type LoanKind,
  type LoanState,
  type PaymentPeriod,
  type RatePeriod,
  type RatePoint,
  type SortableLoanState,
} from './loan-accrual';
import { isISODate, monthEndISO, monthStartISO, nowISO, todayISO } from '@/lib/dates';
import { newId } from '@/lib/id';
import * as Q from '@/db/queries';
import { getFxRate, getSettings } from './settings';

// Формули кредитної математики — у чистому модулі `./loan-math`, який не
// залежить від бази й перевіряється тестом на реальних числах.
export {
  annuityPayment,
  buildAnnuitySchedule,
  earlyRepaymentEffect,
  monthlyRate,
  type AnnuitySchedule,
  type ScheduleRow,
} from './loan-math';

// ─────────────────────────── довідники ───────────────────────────

export async function listAccounts(): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(isNull(accounts.deletedAt))
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
}

export async function listCategories(kind: 'income' | 'expense'): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(and(isNull(categories.deletedAt), eq(categories.kind, kind)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function listIncomeSources(): Promise<IncomeSource[]> {
  return db
    .select()
    .from(incomeSources)
    .where(and(isNull(incomeSources.deletedAt), eq(incomeSources.isActive, true)))
    .orderBy(asc(incomeSources.name));
}

/** Скільки разів категорію використано — щоб підняти звичні категорії вгору. */
export async function categoryUsage(kind: 'income' | 'expense'): Promise<Record<string, number>> {
  const rows = sqlAll<{ category_id: string; n: number }>(Q.CATEGORY_USAGE, [
    kind === 'expense' ? 'expense' : 'income',
    kind,
  ]);
  return Object.fromEntries(rows.map((r) => [r.category_id, r.n]));
}

// ─────────────────────────── транзакції ───────────────────────────

export type TxKind = 'expense' | 'income' | 'transfer';

export interface AddTransactionInput {
  kind: TxKind;
  /**
   * Сума в мінорних одиницях (копійках).
   * Для `expense` та `income` — завжди додатна (напрямок задає `kind`).
   * Для `transfer` — ЗНАКОВА: мінус означає списання з рахунку-джерела,
   * плюс — зарахування на рахунок-отримувач. Переказ — це два рядки,
   * пов'язані через `transfer_peer_id`.
   */
  amountMinor: number;
  accountId: string;
  categoryId?: string | null;
  incomeSourceId?: string | null;
  loanId?: string | null;
  date?: string;
  payee?: string | null;
  note?: string | null;
  tags?: string[];
}

export async function addTransaction(input: AddTransactionInput): Promise<string> {
  if (input.amountMinor === 0) throw new Error('Сума не може бути нульовою');
  if (input.kind !== 'transfer' && input.amountMinor < 0) {
    throw new Error('Для доходу й витрати сума має бути додатною');
  }

  const { baseCurrency } = await getSettings();
  const account = sqlOne<{ currency: string }>(Q.ACCOUNT_CURRENCY, [input.accountId]);
  const currency = account?.currency ?? baseCurrency;
  const fxRate = getFxRate(currency, baseCurrency);
  const timestamp = nowISO();
  const id = newId();

  await db.insert(transactions).values({
    id,
    date: input.date ?? todayISO(),
    accountId: input.accountId,
    kind: input.kind,
    categoryId: input.categoryId ?? null,
    incomeSourceId: input.incomeSourceId ?? null,
    loanId: input.loanId ?? null,
    amount: input.amountMinor,
    currency,
    amountBase: Math.round(input.amountMinor * fxRate),
    fxRate,
    payee: input.payee?.trim() || null,
    note: input.note?.trim() || null,
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}

export async function softDeleteTransaction(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(transactions)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(transactions.id, id));
}

export interface TransactionRow {
  id: string;
  date: string;
  kind: TxKind;
  amount: number;
  currency: string;
  amount_base: number;
  payee: string | null;
  note: string | null;
  category_name: string | null;
  category_icon: string | null;
  account_name: string | null;
}

export async function listRecentTransactions(limit = 20): Promise<TransactionRow[]> {
  return sqlAll<TransactionRow>(Q.RECENT_TRANSACTIONS, [limit]);
}

// ─────────────────────────── агрегати ───────────────────────────

export interface MonthFinance {
  month: string;
  income_base: number;
  expense_base: number;
  net_base: number;
}

export async function monthFinance(month: string): Promise<MonthFinance> {
  const row = sqlOne<MonthFinance>(Q.MONTHLY_FINANCE_BY_MONTH, [month]);
  return row ?? { month, income_base: 0, expense_base: 0, net_base: 0 };
}

export async function financeHistory(months = 12): Promise<MonthFinance[]> {
  return sqlAll<MonthFinance>(Q.MONTHLY_FINANCE_ALL, [months]);
}

export interface CategorySpend {
  category_id: string;
  category: string;
  spent_base: number;
  tx_count: number;
}

export async function categorySpend(month: string): Promise<CategorySpend[]> {
  return sqlAll<CategorySpend>(Q.CATEGORY_SPEND_BY_MONTH, [month]);
}

export interface IncomeBySource {
  source_id: string;
  source: string;
  source_kind: string;
  income_base: number;
}

export async function incomeBySource(month: string): Promise<IncomeBySource[]> {
  return sqlAll<IncomeBySource>(Q.INCOME_BY_SOURCE_BY_MONTH, [month]);
}

export interface AccountBalance {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

export async function accountBalances(): Promise<AccountBalance[]> {
  return sqlAll<AccountBalance>(Q.ACCOUNT_BALANCES);
}

/** Витрати по днях за період — для графіка. */
export async function dailyExpenses(fromISO: string, toISO: string): Promise<
  { date: string; spent_base: number }[]
> {
  return sqlAll<{ date: string; spent_base: number }>(Q.EXPENSES_BY_DATE_RANGE, [
    fromISO,
    toISO,
  ]);
}

/** Витрати за поточний місяць — швидкий підсумок для головного екрана. */
export async function currentMonthSpend(): Promise<number> {
  const row = sqlOne<{ total: number }>(Q.SPEND_TOTAL_RANGE, [monthStartISO(), monthEndISO()]);
  return row?.total ?? 0;
}

/** Чи є хоч один запис — щоб відрізнити «порожньо» від «нуль». */
export async function hasAnyTransaction(): Promise<boolean> {
  const row = sqlOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL',
  );
  return (row?.n ?? 0) > 0;
}

// ─────────────────────────── кредити ───────────────────────────
//
// Кредит — це умови (хто дав, коли, скільки, під який процент) і список
// погашень. Похідні числа — залишок, набіглі проценти, прострочення — тут
// НЕ зберігаються: вони рахуються з умов і платежів на будь-яку дату
// (`domain/loan-accrual.ts`). Інакше в базі жила б друга правда про борг,
// яка після першої ж правки ставки розійшлася б із розрахунком.

export interface LoanInput {
  name: string;
  /** Джерело кредиту: банк, МФО, магазин, знайомий. */
  lender?: string | null;
  kind?: LoanKind;
  principalMinor: number;
  currency?: string;
  /** Ставка так, як її назвали: «0,5» + «у день» або «2» + «у місяць». */
  rateValue: number;
  ratePeriod: RatePeriod;
  startDate: string;
  paymentPeriod?: PaymentPeriod;
  paymentAmountMinor?: number | null;
  paymentDay?: number | null;
  firstPaymentDate?: string | null;
  termMonths?: number | null;
  note?: string | null;
}

/** Річна ставка у відсотках з точністю до сотих — більше не має сенсу. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function addLoan(input: LoanInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Вкажи назву або призначення кредиту');
  if (!Number.isFinite(input.principalMinor) || input.principalMinor <= 0) {
    throw new Error('Сума кредиту має бути більшою за нуль');
  }
  if (!Number.isFinite(input.rateValue) || input.rateValue < 0) {
    throw new Error('Ставка має бути числом, не меншим за нуль');
  }
  if (!isISODate(input.startDate)) {
    throw new Error('Дата видачі має бути у форматі РРРР-ММ-ДД');
  }

  const settings = await getSettings();
  const annualRate = round2(annualizeRate(input.rateValue, input.ratePeriod));
  const timestamp = nowISO();
  const id = newId();

  await db.insert(loans).values({
    id,
    name,
    lender: input.lender?.trim() || null,
    kind: input.kind ?? 'annuity',
    principal: input.principalMinor,
    currency: input.currency ?? settings.baseCurrency,
    annualRate,
    ratePeriod: input.ratePeriod,
    rateValue: input.rateValue,
    termMonths: input.termMonths ?? null,
    startDate: input.startDate,
    firstPaymentDate: input.firstPaymentDate ?? null,
    paymentDay: input.paymentDay ?? null,
    paymentPeriod: input.paymentPeriod ?? 'month',
    paymentAmount: input.paymentAmountMinor ?? null,
    note: input.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  // Історія ставок починається з початкової. Без цього першого запису зміна
  // ставки через рік виглядала б як правка самих умов кредиту, а не як подія:
  // минулі нарахування перерахувались би за новою ставкою.
  await db.insert(loanRateHistory).values({
    id: newId(),
    loanId: id,
    effectiveFrom: input.startDate,
    annualRate,
    ratePeriod: input.ratePeriod,
    rateValue: input.rateValue,
    note: 'Початкова ставка',
    createdAt: timestamp,
  });

  return id;
}

export async function listLoans(): Promise<Loan[]> {
  return db.select().from(loans).where(isNull(loans.deletedAt));
}

/**
 * Залишки «як записано» — з VIEW `v_loan_balance`.
 *
 * Це агрегат по введених платежах (скільки тіла й процентів записано), а не
 * повний стан кредиту: набіглі проценти тут не враховані, бо вони залежать від
 * дати. Для «скільки я винен просто зараз» є `loanStates()`.
 */
export interface LoanBalance {
  loan_id: string;
  loan: string;
  currency: string;
  principal: number;
  balance: number;
  principal_paid: number;
  interest_paid: number;
}

export async function loanBalances(): Promise<LoanBalance[]> {
  return sqlAll<LoanBalance>(Q.LOAN_BALANCES);
}

/** Усе, що потрібно, щоб порахувати стан кредитів: три читання замість N+1. */
interface LoanBundle {
  loans: Loan[];
  payments: LoanPayment[];
  rates: LoanRateHistoryRow[];
}

async function loadLoanBundle(): Promise<LoanBundle> {
  const [loanRows, paymentRows, rateRows] = await Promise.all([
    db.select().from(loans).where(isNull(loans.deletedAt)),
    db.select().from(loanPayments).where(isNull(loanPayments.deletedAt)),
    db.select().from(loanRateHistory),
  ]);
  return { loans: loanRows, payments: paymentRows, rates: rateRows };
}

function ratePoints(rows: LoanRateHistoryRow[]): RatePoint[] {
  return rows.map((r) => ({ effectiveFrom: r.effectiveFrom, annualRate: r.annualRate }));
}

/** Кредит разом із порахованим станом — саме те, що показує список. */
export interface LoanWithState extends SortableLoanState {
  id: string;
  loan: Loan;
  state: LoanState;
  /** Ставка, як її ввів користувач (число + період) — для бейджа й редагування. */
  rateValue: number;
  ratePeriod: RatePeriod;
}

function toLoanWithState(loan: Loan, bundle: LoanBundle, asOf: string): LoanWithState {
  const state = computeLoanState(
    loan,
    bundle.payments.filter((p) => p.loanId === loan.id),
    { asOf, rateHistory: ratePoints(bundle.rates.filter((r) => r.loanId === loan.id)) },
  );

  return {
    id: loan.id,
    loan,
    state,
    name: loan.name,
    startDate: loan.startDate,
    isClosed: Boolean(loan.closedAt),
    annualRate: state.annualRate,
    dailyInterest: state.dailyInterest,
    totalOwed: state.totalOwed,
    overdueDays: state.overdueDays,
    rateValue: loan.rateValue ?? loan.annualRate,
    ratePeriod: loan.ratePeriod,
  };
}

/** Усі кредити зі станом на дату (за замовчуванням — на сьогодні). */
export async function loanStates(asOf: string = todayISO()): Promise<LoanWithState[]> {
  const bundle = await loadLoanBundle();
  return bundle.loans.map((loan) => toLoanWithState(loan, bundle, asOf));
}

export interface LoanDetail {
  loan: Loan;
  state: LoanState;
  /** Платежі від старіших до новіших — у тому порядку, у якому їх обробляє рушій. */
  payments: LoanPayment[];
  rateHistory: LoanRateHistoryRow[];
}

export async function loanDetail(
  id: string,
  asOf: string = todayISO(),
): Promise<LoanDetail | null> {
  const bundle = await loadLoanBundle();
  const loan = bundle.loans.find((l) => l.id === id);
  if (!loan) return null;

  const payments = bundle.payments
    .filter((p) => p.loanId === id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rateHistory = bundle.rates
    .filter((r) => r.loanId === id)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  return {
    loan,
    payments,
    rateHistory,
    state: computeLoanState(loan, payments, { asOf, rateHistory: ratePoints(rateHistory) }),
  };
}

export interface LoanPaymentInput {
  loanId: string;
  date: string;
  totalMinor: number;
  /** Якщо не задано — розбиття рахується автоматично: проценти → тіло. */
  interestMinor?: number | null;
  principalMinor?: number | null;
  accountId?: string | null;
  isEarly?: boolean;
  note?: string | null;
}

export interface LoanPaymentResult {
  id: string;
  toInterest: number;
  toPrincipal: number;
  /** Скільки внесено понад борг — залишається авансом. */
  excess: number;
}

/**
 * Записати погашення.
 *
 * Розбиття на проценти й тіло рахується на ДАТУ ПЛАТЕЖУ, а не на сьогодні:
 * якщо вносиш гроші за минулий місяць, проценти мають бути ті, що набігли
 * тоді. Обчислене розбиття зберігається в рядку як знімок (його показує CSV),
 * але в інтерфейсі числа завжди перераховуються рушієм — щоб правка ставки
 * чи дати не залишала в минулому числа, які вже нічому не відповідають.
 */
export async function addLoanPayment(input: LoanPaymentInput): Promise<LoanPaymentResult> {
  if (!Number.isFinite(input.totalMinor) || input.totalMinor <= 0) {
    throw new Error('Сума платежу має бути більшою за нуль');
  }
  if (!isISODate(input.date)) {
    throw new Error('Дата платежу має бути у форматі РРРР-ММ-ДД');
  }

  const bundle = await loadLoanBundle();
  const loan = bundle.loans.find((l) => l.id === input.loanId);
  if (!loan) throw new Error('Кредит не знайдено');

  const before = computeLoanState(
    loan,
    bundle.payments.filter((p) => p.loanId === loan.id),
    {
      asOf: input.date,
      rateHistory: ratePoints(bundle.rates.filter((r) => r.loanId === loan.id)),
    },
  );
  const auto = allocatePayment(before, input.totalMinor);
  const toInterest = input.interestMinor ?? auto.toInterest;
  const toPrincipal = input.principalMinor ?? auto.toPrincipal;

  const timestamp = nowISO();
  const id = newId();

  await db.insert(loanPayments).values({
    id,
    loanId: loan.id,
    date: input.date,
    accountId: input.accountId ?? null,
    totalAmount: input.totalMinor,
    interestPart: toInterest,
    principalPart: toPrincipal,
    isEarly: input.isEarly ?? false,
    note: input.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { id, toInterest, toPrincipal, excess: auto.excess };
}

export async function softDeleteLoanPayment(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(loanPayments)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(loanPayments.id, id));
}

/**
 * Записати зміну ставки.
 *
 * Ставка змінюється з дати, а не «взагалі»: стара діє до `effectiveFrom`,
 * нова — після. Саме тому історія ставок існує окремо від самих умов.
 */
export async function changeLoanRate(input: {
  loanId: string;
  effectiveFrom: string;
  rateValue: number;
  ratePeriod: RatePeriod;
  note?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.rateValue) || input.rateValue < 0) {
    throw new Error('Ставка має бути числом, не меншим за нуль');
  }
  if (!isISODate(input.effectiveFrom)) {
    throw new Error('Дата, з якої діє ставка, має бути у форматі РРРР-ММ-ДД');
  }

  const bundle = await loadLoanBundle();
  const loan = bundle.loans.find((l) => l.id === input.loanId);
  if (!loan) throw new Error('Кредит не знайдено');

  const timestamp = nowISO();
  const annualRate = round2(annualizeRate(input.rateValue, input.ratePeriod));

  await db.insert(loanRateHistory).values({
    id: newId(),
    loanId: input.loanId,
    effectiveFrom: input.effectiveFrom,
    annualRate,
    ratePeriod: input.ratePeriod,
    rateValue: input.rateValue,
    note: input.note?.trim() || null,
    createdAt: timestamp,
  });

  // Поточні умови теж оновлюються, якщо зміна вже набрала чинності: інакше
  // картка кредиту показувала б стару ставку, а рахувала б новою.
  if (input.effectiveFrom <= todayISO()) {
    await db
      .update(loans)
      .set({
        annualRate,
        ratePeriod: input.ratePeriod,
        rateValue: input.rateValue,
        updatedAt: timestamp,
      })
      .where(eq(loans.id, input.loanId));
  }
}

export interface LoanTermsPatch {
  name?: string;
  lender?: string | null;
  kind?: LoanKind;
  note?: string | null;
  paymentPeriod?: PaymentPeriod;
  paymentAmountMinor?: number | null;
  paymentDay?: number | null;
  firstPaymentDate?: string | null;
  termMonths?: number | null;
}

/** Правка умов, які не впливають на вже нараховані проценти. */
export async function updateLoanTerms(id: string, patch: LoanTermsPatch): Promise<void> {
  const timestamp = nowISO();
  const values: Partial<NewLoan> = { updatedAt: timestamp };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Назва не може бути порожньою');
    values.name = name;
  }
  if (patch.lender !== undefined) values.lender = patch.lender?.trim() || null;
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (patch.note !== undefined) values.note = patch.note?.trim() || null;
  if (patch.paymentPeriod !== undefined) values.paymentPeriod = patch.paymentPeriod;
  if (patch.paymentAmountMinor !== undefined) values.paymentAmount = patch.paymentAmountMinor;
  if (patch.paymentDay !== undefined) values.paymentDay = patch.paymentDay;
  if (patch.firstPaymentDate !== undefined) values.firstPaymentDate = patch.firstPaymentDate;
  if (patch.termMonths !== undefined) values.termMonths = patch.termMonths;

  await db.update(loans).set(values).where(eq(loans.id, id));
}

/** Позначити кредит закритим: нарахування процентів зупиняється в цей день. */
export async function closeLoan(id: string, closedAt: string = todayISO()): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(loans)
    .set({ closedAt, updatedAt: timestamp })
    .where(eq(loans.id, id));
}

export async function reopenLoan(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(loans)
    .set({ closedAt: null, updatedAt: timestamp })
    .where(eq(loans.id, id));
}

export async function softDeleteLoan(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(loans)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(loans.id, id));
}

/** Джерела, які вже вводили: щоб не набирати «ПриватБанк» щоразу заново. */
export async function recentLenders(limit = 6): Promise<string[]> {
  return sqlAll<{ name: string }>(Q.RECENT_LENDERS, [limit]).map((r) => r.name);
}


/** Скільки відсотків від доходу йде на обслуговування боргів за місяць. */
export async function debtLoadRatio(month: string): Promise<number> {
  const fin = await monthFinance(month);
  if (fin.income_base <= 0) return 0;

  const row = sqlOne<{ total: number }>(Q.LOAN_PAYMENTS_BY_MONTH, [month]);

  return ((row?.total ?? 0) / fin.income_base) * 100;
}
