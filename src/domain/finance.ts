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
import type { Account, Category, IncomeSource, Loan } from '@/db/schema';
import { monthEndISO, monthStartISO, nowISO, todayISO } from '@/lib/dates';
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

export interface LoanInput {
  name: string;
  lender?: string | null;
  kind?: Loan['kind'];
  principalMinor: number;
  currency: string;
  annualRate: number;
  rateType?: 'fixed' | 'floating';
  termMonths?: number | null;
  startDate: string;
  firstPaymentDate?: string | null;
  paymentDay?: number | null;
  paymentAmountMinor?: number | null;
  note?: string | null;
}

export async function addLoan(input: LoanInput): Promise<string> {
  const timestamp = nowISO();
  const id = newId();

  await db.insert(loans).values({
    id,
    name: input.name,
    lender: input.lender ?? null,
    kind: input.kind ?? 'annuity',
    principal: input.principalMinor,
    currency: input.currency,
    annualRate: input.annualRate,
    rateType: input.rateType ?? 'fixed',
    termMonths: input.termMonths ?? null,
    startDate: input.startDate,
    firstPaymentDate: input.firstPaymentDate ?? null,
    paymentDay: input.paymentDay ?? null,
    paymentAmount: input.paymentAmountMinor ?? null,
    note: input.note ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(loanRateHistory).values({
    id: newId(),
    loanId: id,
    effectiveFrom: input.startDate,
    annualRate: input.annualRate,
    note: 'Початкова ставка',
    createdAt: timestamp,
  });

  return id;
}

export async function listLoans(): Promise<Loan[]> {
  return db.select().from(loans).where(isNull(loans.deletedAt)).orderBy(asc(loans.startDate));
}

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
  return sqlAll<LoanBalance>(
    `SELECT loan_id, loan, currency, principal, balance, principal_paid, interest_paid
       FROM v_loan_balance
      ORDER BY loan`,
  );
}

export interface LoanPaymentInput {
  loanId: string;
  date: string;
  totalMinor: number;
  interestMinor?: number | null;
  principalMinor?: number | null;
  accountId?: string | null;
  isEarly?: boolean;
  note?: string | null;
}

export async function addLoanPayment(input: LoanPaymentInput): Promise<string> {
  const timestamp = nowISO();
  const id = newId();

  await db.insert(loanPayments).values({
    id,
    loanId: input.loanId,
    date: input.date,
    accountId: input.accountId ?? null,
    totalAmount: input.totalMinor,
    interestPart: input.interestMinor ?? null,
    principalPart: input.principalMinor ?? null,
    isEarly: input.isEarly ?? false,
    note: input.note ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}


/** Скільки відсотків від доходу йде на обслуговування боргів за місяць. */
export async function debtLoadRatio(month: string): Promise<number> {
  const fin = await monthFinance(month);
  if (fin.income_base <= 0) return 0;

  const row = sqlOne<{ total: number }>(Q.LOAN_PAYMENTS_BY_MONTH, [month]);

  return ((row?.total ?? 0) / fin.income_base) * 100;
}
