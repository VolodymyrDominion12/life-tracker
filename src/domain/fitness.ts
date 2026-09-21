/**
 * Спорт: тренування та тижневе навантаження.
 *
 * Свідомо без деталізації підходів у v1: головна метрика — регулярність
 * (хвилини, кількість тренувань, серії днів), а не вага штанги. Поле `sets_json`
 * у схемі вже є, тому деталізацію можна додати пізніше без міграції.
 */
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';

import { db, sqlAll, sqlOne } from '@/db/client';
import { workouts } from '@/db/schema';
import type { Workout } from '@/db/schema';
import * as Q from '@/db/queries';
import { addDaysISO, nowISO, nowTimeHM, todayISO } from '@/lib/dates';
import { newId } from '@/lib/id';

export type WorkoutKind =
  | 'strength'
  | 'cardio'
  | 'hiit'
  | 'mobility'
  | 'sport'
  | 'walk'
  | 'other';

export const WORKOUT_KIND_LABELS: Record<WorkoutKind, string> = {
  strength: 'Силове',
  cardio: 'Кардіо',
  hiit: 'HIIT',
  mobility: 'Мобільність',
  sport: 'Ігровий спорт',
  walk: 'Ходьба',
  other: 'Інше',
};

export interface AddWorkoutInput {
  durationMin: number;
  kind?: WorkoutKind | null;
  name?: string | null;
  date?: string;
  startTime?: string | null;
  intensityRpe?: number | null;
  kcalBurned?: number | null;
  distanceKm?: number | null;
  note?: string | null;
}

export async function addWorkout(input: AddWorkoutInput): Promise<string> {
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error('Тривалість має бути більшою за нуль');
  }
  if (input.intensityRpe != null && (input.intensityRpe < 1 || input.intensityRpe > 10)) {
    throw new Error('RPE має бути в межах 1–10');
  }

  const timestamp = nowISO();
  const id = newId();

  await db.insert(workouts).values({
    id,
    date: input.date ?? todayISO(),
    startTime: input.startTime ?? nowTimeHM(),
    durationMin: Math.round(input.durationMin),
    kind: input.kind ?? null,
    name: input.name?.trim() || null,
    intensityRpe: input.intensityRpe ?? null,
    kcalBurned: input.kcalBurned != null ? Math.round(input.kcalBurned) : null,
    distanceKm: input.distanceKm ?? null,
    note: input.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}

export async function softDeleteWorkout(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(workouts)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(workouts.id, id));
}

export async function listWorkoutsForDate(date: string = todayISO()): Promise<Workout[]> {
  return db
    .select()
    .from(workouts)
    .where(and(isNull(workouts.deletedAt), eq(workouts.date, date)))
    .orderBy(desc(workouts.startTime));
}

export async function listRecentWorkouts(limit = 20): Promise<Workout[]> {
  return db
    .select()
    .from(workouts)
    .where(isNull(workouts.deletedAt))
    .orderBy(desc(workouts.date), desc(workouts.startTime))
    .limit(limit);
}

export interface WeekLoad {
  week: string;
  workout_min: number;
  study_min: number;
}

export async function weeklyLoad(limit = 8): Promise<WeekLoad[]> {
  return sqlAll<WeekLoad>(Q.WEEKLY_LOAD_LIMIT, [limit]);
}

export async function minutesInRange(fromISO: string, toISO: string): Promise<number> {
  const row = sqlOne<{ total: number }>(Q.WORKOUT_MINUTES_RANGE, [fromISO, toISO]);
  return row?.total ?? 0;
}

export async function weekMinutes(referenceISO: string = todayISO()): Promise<number> {
  // Тиждень рахуємо від понеділка: так зручніше планувати тренування.
  const dow = new Date(`${referenceISO}T12:00:00`).getDay();
  const sinceMonday = (dow + 6) % 7;
  const monday = addDaysISO(referenceISO, -sinceMonday);
  return minutesInRange(monday, addDaysISO(monday, 6));
}

export interface WorkoutKindStat {
  kind: string;
  sessions: number;
  minutes: number;
  avg_rpe: number | null;
}

export async function workoutStatsByKind(fromISO: string, toISO: string): Promise<WorkoutKindStat[]> {
  return sqlAll<WorkoutKindStat>(Q.WORKOUT_STATS_BY_KIND, [fromISO, toISO]);
}

/** Серія днів поспіль із тренуванням, включно з сьогоднішнім (або вчорашнім). */
export async function currentStreak(): Promise<number> {
  const rows = sqlAll<{ date: string }>(Q.WORKOUT_DATES_DESC);
  if (rows.length === 0) return 0;

  const dates = new Set(rows.map((r) => r.date));
  let cursor = todayISO();
  if (!dates.has(cursor)) cursor = addDaysISO(cursor, -1);

  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDaysISO(cursor, -1);
  }
  return streak;
}
