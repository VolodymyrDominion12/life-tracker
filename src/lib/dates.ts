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

/**
 * Додає місяці з прив'язкою до календаря, а не до 30 днів.
 *
 * Саме тому тут окрема функція: графік платежів «15-го числа» — це місяці,
 * і 31 січня + 1 місяць має дати 28/29 лютого, а не 3 березня (так поводиться
 * `setMonth` у JS, тому дата рахується вручну й підрізається під довжину
 * місяця — інакше платіж «31-го» щомісяця переповзав би на початок наступного).
 */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(d!, lastDay);
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** '2026-09-21' → true. Дати в застосунку вводяться руками, тож перевірка потрібна. */
export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // Відсіює те, що JS «пробачає»: 2026-02-31 стає 3 березня.
  return toISODate(d) === value;
}

/** Кількість днів від `from` до `to` (додатна, якщо `to` пізніше). */
export function daysBetweenISO(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  const days = (b.getTime() - a.getTime()) / 86400000;
  // Некоректна дата дає NaN, і він розповзається по всьому розрахунку кредиту:
  // замість «помилка» користувач бачив би «NaN ₴». Краще 0 днів — а хибні дати
  // відсікає `isISODate` ще на етапі запису.
  if (!Number.isFinite(days)) return 0;
  return Math.round(days);
}

/**
 * Той самий місяць, але з потрібним числом.
 *
 * Число підрізається під довжину місяця: «31-го» у лютому — це 28/29.
 * Без цього графік платежів у лютому поїхав би на початок березня.
 */
export function withDayOfMonth(iso: string, day: number): string {
  const [y, m] = iso.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  const clamped = Math.min(Math.max(1, Math.round(day)), lastDay);
  return `${iso.slice(0, 7)}-${pad(clamped)}`;
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
