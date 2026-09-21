/**
 * Аналітика: зведення по доменах і пошук зв'язків між ними.
 *
 * Уся важка агрегація живе в SQL VIEW (див. `migrations.ts`), а цей модуль
 * лише збирає потрібні зрізи та рахує похідні показники: норму заощаджень,
 * коефіцієнт виконання цілей, кореляції між метриками.
 */
import { sqlAll, sqlOne } from '@/db/client';
import * as Q from '@/db/queries';
import { lastNDaysISO, monthEndISO, monthKey, todayISO } from '@/lib/dates';
import { percent } from '@/lib/money';
import type { DayNutrition } from './nutrition';
import { dayNutrition } from './nutrition';

export interface DailySummary extends DayNutrition {
  spent_base: number;
  earned_base: number;
}

/** Повний підсумок одного дня: гроші + енергія + спорт + навчання. */
export async function dailySummary(date: string = todayISO()): Promise<DailySummary> {
  const nutrition = await dayNutrition(date);

  const money = sqlOne<{ spent_base: number; earned_base: number }>(
    Q.INCOME_AND_EXPENSE_BY_DATE,
    [date],
  );

  return {
    ...nutrition,
    spent_base: money?.spent_base ?? 0,
    earned_base: money?.earned_base ?? 0,
  };
}

export interface MonthlyDashboard {
  month: string;
  income_base: number;
  expense_base: number;
  net_base: number;
  /** Частка доходу, яку вдалося не витратити. */
  savingsRate: number;
  expenseByCategory: { category: string; spent_base: number; share: number }[];
  incomeBySource: { source: string; income_base: number; share: number }[];
  workoutMinutes: number;
  studyMinutes: number;
  avgKcalIn: number;
  avgKcalOut: number;
  daysTracked: number;
}

export async function monthlyDashboard(month: string = monthKey()): Promise<MonthlyDashboard> {
  const from = `${month}-01`;
  const to = monthEndISO(from);

  const finance = sqlOne<{ income_base: number; expense_base: number }>(
    Q.MONTH_FINANCE_TOTALS,
    [month],
  );

  const income = finance?.income_base ?? 0;
  const expense = finance?.expense_base ?? 0;

  const cats = sqlAll<{ category: string; spent_base: number }>(Q.CATEGORY_SPEND_BY_MONTH, [month]);

  const sources = sqlAll<{ source: string; income_base: number }>(
    Q.INCOME_BY_SOURCE_BY_MONTH,
    [month],
  );

  const load = sqlOne<{
    workout_min: number;
    study_min: number;
    avg_kcal_in: number;
    avg_kcal_out: number;
    days: number;
  }>(Q.MONTH_ENERGY_AVERAGES, [month]);

  return {
    month,
    income_base: income,
    expense_base: expense,
    net_base: income - expense,
    savingsRate: percent(income - expense, income),
    expenseByCategory: cats.map((c) => ({
      category: c.category,
      spent_base: c.spent_base,
      share: percent(c.spent_base, expense),
    })),
    incomeBySource: sources.map((s) => ({
      source: s.source,
      income_base: s.income_base,
      share: percent(s.income_base, income),
    })),
    workoutMinutes: load?.workout_min ?? 0,
    studyMinutes: load?.study_min ?? 0,
    avgKcalIn: Math.round(load?.avg_kcal_in ?? 0),
    avgKcalOut: Math.round(load?.avg_kcal_out ?? 0),
    daysTracked: load?.days ?? 0,
  };
}

export interface TrendPoint {
  date: string;
  value: number;
}

/** Ряд «витрати по днях» для графіка, із заповненням пропусків нулями. */
export async function expenseTrend(days = 30, endISO: string = todayISO()): Promise<TrendPoint[]> {
  const from = lastNDaysISO(days, endISO)[0]!;
  const rows = sqlAll<{ date: string; value: number }>(Q.EXPENSES_BY_DATE_RANGE, [from, endISO]);
  const map = new Map(rows.map((r) => [r.date, r.value]));
  return lastNDaysISO(days, endISO).map((date) => ({ date, value: map.get(date) ?? 0 }));
}

export async function kcalTrend(days = 30, endISO: string = todayISO()): Promise<TrendPoint[]> {
  const from = lastNDaysISO(days, endISO)[0]!;
  const rows = sqlAll<{ date: string; value: number }>(Q.KCAL_IN_RANGE, [from, endISO]);
  const map = new Map(rows.map((r) => [r.date, r.value]));
  return lastNDaysISO(days, endISO).map((date) => ({ date, value: map.get(date) ?? 0 }));
}

/**
 * Коефіцієнт кореляції Пірсона.
 *
 * Свідомо без p-value: на 20–40 точках щоденних даних значущість майже ніколи
 * не досягається, і показувати «зв'язок» як висновок було б оманливо. Тому
 * результат подається як орієнтир, а не як доведений факт.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;

  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export interface Insight {
  id: string;
  title: string;
  detail: string;
  /** Сила зв'язку за модулем, для сортування. */
  strength: number;
}

/**
 * Пошук зв'язків між доменами за останні N днів.
 *
 * Обчислюється лише на днях, де є обидві метрики — інакше нулі від «день без
 * записів» штучно створювали б кореляцію.
 */
export async function insights(days = 60, endISO: string = todayISO()): Promise<Insight[]> {
  const from = lastNDaysISO(days, endISO)[0]!;

  const rows = sqlAll<{
    date: string;
    kcal_in: number;
    workout_min: number;
    study_min: number;
    spent: number;
  }>(Q.DAILY_CROSS_DOMAIN, [from, endISO]);

  const out: Insight[] = [];

  const pairs: { id: string; title: string; detail: string; a: (r: typeof rows[number]) => number | null; b: (r: typeof rows[number]) => number | null; labelA: string; labelB: string }[] = [
    {
      id: 'workout_study',
      title: 'Тренування й навчання',
      detail: 'Чи впливають тренування на час, який вдається присвятити навчанню',
      a: (r) => (r.workout_min > 0 ? r.workout_min : null),
      b: (r) => (r.study_min > 0 ? r.study_min : null),
      labelA: 'хвилини спорту',
      labelB: 'хвилини навчання',
    },
    {
      id: 'kcal_spend',
      title: 'Калорії та витрати',
      detail: 'Чи пов’язані дні з більшим споживанням їжі з більшими витратами',
      a: (r) => (r.kcal_in > 0 ? r.kcal_in : null),
      b: (r) => (r.spent > 0 ? r.spent : null),
      labelA: 'ккал',
      labelB: 'витрати',
    },
    {
      id: 'workout_kcal',
      title: 'Тренування та калорії',
      detail: 'Скільки їжі припадає на дні з тренуванням',
      a: (r) => (r.workout_min > 0 ? r.workout_min : null),
      b: (r) => (r.kcal_in > 0 ? r.kcal_in : null),
      labelA: 'хвилини спорту',
      labelB: 'ккал',
    },
  ];

  for (const p of pairs) {
    const aVals: number[] = [];
    const bVals: number[] = [];
    for (const r of rows) {
      const a = p.a(r);
      const b = p.b(r);
      if (a == null || b == null) continue;
      aVals.push(a);
      bVals.push(b);
    }

    const r = pearson(aVals, bVals);
    if (r == null || Math.abs(r) < 0.2) continue;

    const direction = r > 0 ? 'зростають разом' : 'рухаються у протилежні боки';
    out.push({
      id: p.id,
      title: p.title,
      detail:
        `${p.labelA} і ${p.labelB} ${direction} (r = ${r.toFixed(2)} на ${aVals.length} днях). ` +
        'Це орієнтир, а не доведений причинний зв’язок.',
      strength: Math.abs(r),
    });
  }

  return out.sort((x, y) => y.strength - x.strength);
}

/** Середні витрати на день за період — основа для «безпечного» денного ліміту. */
export async function averageDailySpend(days = 30, endISO: string = todayISO()): Promise<number> {
  const from = lastNDaysISO(days, endISO)[0]!;
  const row = sqlOne<{ total: number }>(Q.SPEND_TOTAL_RANGE, [from, endISO]);
  return Math.round((row?.total ?? 0) / days);
}
