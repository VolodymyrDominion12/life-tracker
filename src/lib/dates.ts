/**
 * Робота з датами.
 *
 * `date` у схемі — це локальний календарний день користувача ('YYYY-MM-DD'),
 * а не UTC-мітка: витрата о 23:30 має належати сьогоднішньому дню, а не завтрашньому.
 * Технічні мітки часу (`created_at`, `updated_at`) навпаки пишуться в UTC.
 */

const MONTHS_UA = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

const WEEKDAYS_UA = [
  'неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п’ятниця', 'субота',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Локальна дата у форматі 'YYYY-MM-DD'. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Технічна мітка часу в UTC для created_at / updated_at. */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Локальний час 'HH:MM'. */
export function nowTimeHM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** 'YYYY-MM' — ключ місяця, збігається з `substr(date, 1, 7)` у VIEW. */
export function monthKey(iso: string = todayISO()): string {
  return iso.slice(0, 7);
}

export function monthStartISO(iso: string = todayISO()): string {
  return `${monthKey(iso)}-01`;
}

export function monthEndISO(iso: string = todayISO()): string {
  const [y, m] = monthKey(iso).split('-').map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${monthKey(iso)}-${pad(last)}`;
}

export function addMonthsToMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Масив останніх N днів включно з сьогоднішнім, від старішого до нового. */
export function lastNDaysISO(n: number, endISO: string = todayISO()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(addDaysISO(endISO, -i));
  return out;
}

/** 125 → '2 год 5 хв' */
export function humanMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

/** '2026-09-21' → '21.09' */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/** '2026-09-21' → '21 вересня' */
export function formatDateHuman(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_UA[m! - 1]}`;
}

/** '2026-09-21' → 'понеділок, 21 вересня' */
export function formatDateFull(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS_UA[d.getDay()]}, ${formatDateHuman(iso)}`;
}

/** '2026-09' → 'вересень 2026' */
export function formatMonthKeyHuman(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS_UA[m! - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/** 'Сьогодні' / 'Вчора' / '21 вересня' */
export function formatDateRelative(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Сьогодні';
  if (iso === addDaysISO(today, -1)) return 'Вчора';
  return formatDateHuman(iso);
}
