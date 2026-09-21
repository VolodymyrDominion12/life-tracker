/**
 * Харчування: записи про їжу та денні підсумки по калоріях.
 *
 * Каталог продуктів (`food_catalog`) — необов'язковий: запис можна зробити
 * просто вказавши калорії руками. Це принципово: облік має працювати навіть
 * якщо продукту немає в жодній базі.
 */
import { and, desc, eq, isNull, like } from 'drizzle-orm';

import { db, sqlAll, sqlOne } from '@/db/client';
import { foodCatalog, mealEntries } from '@/db/schema';
import type { MealEntry } from '@/db/schema';
import * as Q from '@/db/queries';
import { nowISO, nowTimeHM, todayISO } from '@/lib/dates';
import { newId } from '@/lib/id';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Сніданок',
  lunch: 'Обід',
  dinner: 'Вечеря',
  snack: 'Перекус',
  drink: 'Напій',
};

export interface AddMealInput {
  kcal: number;
  name?: string | null;
  date?: string;
  time?: string | null;
  mealType?: MealType | null;
  grams?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  note?: string | null;
}

export async function addMeal(input: AddMealInput): Promise<string> {
  if (!Number.isFinite(input.kcal) || input.kcal <= 0) {
    throw new Error('Калорійність має бути більшою за нуль');
  }

  const timestamp = nowISO();
  const id = newId();

  await db.insert(mealEntries).values({
    id,
    date: input.date ?? todayISO(),
    time: input.time ?? nowTimeHM(),
    mealType: input.mealType ?? null,
    name: input.name?.trim() || null,
    grams: input.grams ?? null,
    kcal: Math.round(input.kcal),
    proteinG: input.proteinG ?? null,
    fatG: input.fatG ?? null,
    carbsG: input.carbsG ?? null,
    note: input.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}

export async function softDeleteMeal(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(mealEntries)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(mealEntries.id, id));
}

export async function listMealsForDate(date: string = todayISO()): Promise<MealEntry[]> {
  return db
    .select()
    .from(mealEntries)
    .where(and(isNull(mealEntries.deletedAt), eq(mealEntries.date, date)))
    .orderBy(desc(mealEntries.time), desc(mealEntries.createdAt));
}

export interface DayNutrition {
  date: string;
  kcal_in: number;
  kcal_out: number;
  kcal_net: number;
  workout_min: number;
  study_min: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  meals: number;
}

/** Денний баланс енергії з VIEW `v_daily_energy` + макроси. */
export async function dayNutrition(date: string = todayISO()): Promise<DayNutrition> {
  const base = sqlOne<Omit<DayNutrition, 'protein_g' | 'fat_g' | 'carbs_g' | 'meals'>>(
    Q.DAILY_ENERGY_BY_DATE,
    [date],
  );

  const macros = sqlOne<{
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    meals: number;
  }>(Q.MEAL_MACROS_RANGE, [date]);

  return {
    date,
    kcal_in: base?.kcal_in ?? 0,
    kcal_out: base?.kcal_out ?? 0,
    kcal_net: base?.kcal_net ?? 0,
    workout_min: base?.workout_min ?? 0,
    study_min: base?.study_min ?? 0,
    protein_g: macros?.protein_g ?? 0,
    fat_g: macros?.fat_g ?? 0,
    carbs_g: macros?.carbs_g ?? 0,
    meals: macros?.meals ?? 0,
  };
}

/** Середнє споживання калорій за останні N днів із записами. */
export async function averageKcal(days = 7, endISO: string = todayISO()): Promise<number> {
  const row = sqlOne<{ avg_kcal: number | null }>(
    `SELECT AVG(daily) AS avg_kcal FROM (
       SELECT date, SUM(kcal) AS daily
         FROM meal_entries
        WHERE deleted_at IS NULL AND date <= ? AND date >= date(?, ?)
        GROUP BY date
     )`,
    [endISO, endISO, `-${days - 1} days`],
  );
  return Math.round(row?.avg_kcal ?? 0);
}

export async function kcalSeries(fromISO: string, toISO: string): Promise<
  { date: string; kcal_in: number; kcal_out: number }[]
> {
  return sqlAll<{ date: string; kcal_in: number; kcal_out: number }>(Q.DAILY_ENERGY_RANGE, [
    fromISO,
    toISO,
  ]);
}

/** Останні назви страв — для швидкого повторного вводу. */
export async function recentMealNames(limit = 8): Promise<string[]> {
  const rows = sqlAll<{ name: string }>(Q.RECENT_MEAL_NAMES, [limit]);
  return rows.map((r) => r.name);
}

/** Пошук у локальному каталозі продуктів. */
export async function searchFood(query: string, limit = 10) {
  const q = query.trim();
  if (!q) return [];

  return db
    .select()
    .from(foodCatalog)
    .where(and(isNull(foodCatalog.deletedAt), like(foodCatalog.name, `%${q}%`)))
    .limit(limit);
}
