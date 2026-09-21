/**
 * Навчання: сесії навчання та статистика по предметах.
 *
 * Структура навмисно дзеркалить тренування (дата + тривалість + тип + оцінка
 * залученості), щоб ці дві метрики можна було порівнювати й шукати кореляції
 * між ними без окремої логіки.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db, sqlAll, sqlOne } from '@/db/client';
import { studySessions } from '@/db/schema';
import type { StudySession } from '@/db/schema';
import * as Q from '@/db/queries';
import { addDaysISO, nowISO, nowTimeHM, todayISO } from '@/lib/dates';
import { newId } from '@/lib/id';

export type StudyKind =
  | 'reading'
  | 'course'
  | 'practice'
  | 'project'
  | 'flashcards'
  | 'lecture'
  | 'other';

export const STUDY_KIND_LABELS: Record<StudyKind, string> = {
  reading: 'Читання',
  course: 'Курс',
  practice: 'Практика',
  project: 'Проєкт',
  flashcards: 'Картки',
  lecture: 'Лекція',
  other: 'Інше',
};

export interface AddStudyInput {
  durationMin: number;
  subject: string;
  topic?: string | null;
  kind?: StudyKind | null;
  resource?: string | null;
  focus?: number | null;
  pages?: number | null;
  date?: string;
  startTime?: string | null;
  note?: string | null;
}

export async function addStudySession(input: AddStudyInput): Promise<string> {
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error('Тривалість має бути більшою за нуль');
  }
  if (!input.subject.trim()) throw new Error('Вкажи предмет або напрям');
  if (input.focus != null && (input.focus < 1 || input.focus > 5)) {
    throw new Error('Оцінка залученості має бути в межах 1–5');
  }

  const timestamp = nowISO();
  const id = newId();

  await db.insert(studySessions).values({
    id,
    date: input.date ?? todayISO(),
    startTime: input.startTime ?? nowTimeHM(),
    durationMin: Math.round(input.durationMin),
    subject: input.subject.trim(),
    topic: input.topic?.trim() || null,
    kind: input.kind ?? null,
    resource: input.resource?.trim() || null,
    focus: input.focus ?? null,
    pages: input.pages ?? null,
    note: input.note?.trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}

export async function softDeleteStudySession(id: string): Promise<void> {
  const timestamp = nowISO();
  await db
    .update(studySessions)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(studySessions.id, id));
}

export async function listStudyForDate(date: string = todayISO()): Promise<StudySession[]> {
  return db
    .select()
    .from(studySessions)
    .where(and(isNull(studySessions.deletedAt), eq(studySessions.date, date)))
    .orderBy(desc(studySessions.startTime));
}

export async function listRecentStudy(limit = 20): Promise<StudySession[]> {
  return db
    .select()
    .from(studySessions)
    .where(isNull(studySessions.deletedAt))
    .orderBy(desc(studySessions.date), desc(studySessions.startTime))
    .limit(limit);
}

export async function minutesInRange(fromISO: string, toISO: string): Promise<number> {
  const row = sqlOne<{ total: number }>(Q.STUDY_MINUTES_RANGE, [fromISO, toISO]);
  return row?.total ?? 0;
}

export async function weekMinutes(referenceISO: string = todayISO()): Promise<number> {
  const dow = new Date(`${referenceISO}T12:00:00`).getDay();
  const sinceMonday = (dow + 6) % 7;
  const monday = addDaysISO(referenceISO, -sinceMonday);
  return minutesInRange(monday, addDaysISO(monday, 6));
}

export interface SubjectStat {
  subject: string;
  sessions: number;
  minutes: number;
  avg_focus: number | null;
}

export async function studyStatsBySubject(
  fromISO: string,
  toISO: string,
): Promise<SubjectStat[]> {
  return sqlAll<SubjectStat>(Q.STUDY_STATS_BY_SUBJECT, [fromISO, toISO]);
}

/** Предмети, які вже використовувались — щоб не набирати їх щоразу. */
export async function knownSubjects(limit = 10): Promise<string[]> {
  const rows = sqlAll<{ subject: string }>(Q.RECENT_SUBJECTS, [limit]);
  return rows.map((r) => r.subject);
}
