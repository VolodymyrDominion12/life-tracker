/**
 * Гроші.
 *
 * Усі суми в застосунку та в базі — цілі числа в мінорних одиницях (копійки).
 * Дробові числа з плаваючою комою для грошей не використовуються: 0.1 + 0.2 ≠ 0.3,
 * і в обліку це накопичується у видимі розходження.
 */

const MINOR_UNITS = 100;

const SYMBOLS: Record<string, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
  PLN: 'zł',
};

/** 12345 → '123,45 ₴' */
export function formatMoney(minor: number, currency = 'UAH'): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const int = Math.floor(abs / MINOR_UNITS);
  const frac = String(abs % MINOR_UNITS).padStart(2, '0');
  const grouped = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = SYMBOLS[currency] ?? currency;
  return `${negative ? '−' : ''}${grouped},${frac} ${symbol}`;
}

/** Короткий формат без копійок: 1234567 → '12 346 ₴' */
export function formatMoneyShort(minor: number, currency = 'UAH'): string {
  const rounded = Math.round(minor / MINOR_UNITS);
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} ${SYMBOLS[currency] ?? currency}`;
}

/** '1 234,50' або '1234.5' → 123450 (мінорні одиниці). null, якщо не число. */
export function parseAmountToMinor(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * MINOR_UNITS);
}

/** 123450 → 1234.5 (для полів вводу та CSV) */
export function fromMinor(minor: number): number {
  return minor / MINOR_UNITS;
}

export function toMinor(value: number): number {
  return Math.round(value * MINOR_UNITS);
}

/** Частка у відсотках; безпечно для нульового знаменника. */
export function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}
