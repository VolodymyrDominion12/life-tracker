/**
 * Нарахування процентів за кредитом — чисті функції, без бази й без Expo.
 *
 * Чому окремий модуль. Це друга (після ануїтету) частина застосунку, де
 * помилка у формулі виглядає як «нормальні» цифри: неправильно пораховані
 * проценти не кидають винятку, вони просто непомітно брешуть. Тому тут немає
 * жодної залежності, і все перевіряється звичайним тестом на реальних числах
 * (`scripts/verify-db.ts`), без емулятора.
 *
 * ── Угода про ставки ────────────────────────────────────────────────
 * Користувач вводить ставку так, як її йому назвали: «0,5% у день»,
 * «2% у місяць», «18% річних». У базі поруч зі ставкою лежить її період
 * (`rate_period`), а `annual_rate` завжди зберігається як РІЧНА — щоб
 * кредити з різними періодами можна було порівнювати одним числом
 * (це і є основа сортування «найгірші — ті, де більше процентів»).
 *
 * Нормалізація — банківська конвенція 30/360: місяць = 30 днів, рік = 360.
 * Завдяки цьому:
 *   18% річних  ≡ 1,5% на місяць ≡ 0,05% на день — без розбіжностей в
 *   округленні між трьома способами вводу однієї й тієї самої ставки.
 *
 * Нарахування — простими процентами за ФАКТИЧНУ кількість днів, база 360:
 *   проценти = залишок тіла × річна ставка / 100 × дні / 360.
 * Це та сама логіка, що в банківських виписках: проценти набігають щодня на
 * залишок, тому дострокове погашення справді зменшує наступні нарахування.
 *
 * ── Куди йдуть гроші платника ───────────────────────────────────────
 * Платіж спершу покриває нараховані проценти, і лише залишок зменшує тіло
 * боргу. Це стандартна черговість («waterfall»), і саме тому в списку
 * видно, що перші платежі майже не зменшують борг — це не помилка, це те,
 * як кредити працюють насправді.
 */
import { addDaysISO, addMonthsISO, daysBetweenISO, withDayOfMonth } from '@/lib/dates';

// ─────────────────────────── довідники ───────────────────────────

/** Період, за який оголошено ставку. */
export type RatePeriod = 'day' | 'month' | 'year';

/** Як часто за домовленістю вноситься платіж. */
export type PaymentPeriod = 'day' | 'week' | 'month';

export type LoanKind = 'annuity' | 'differential' | 'revolving' | 'mortgage' | 'installment';

/** Скільки днів у періоді за конвенцією 30/360. */
export const DAYS_IN_YEAR = 360;
export const DAYS_IN_MONTH = 30;

const PERIOD_DAYS: Record<RatePeriod, number> = {
  day: 1,
  month: DAYS_IN_MONTH,
  year: DAYS_IN_YEAR,
};

export const RATE_PERIOD_LABELS: Record<RatePeriod, string> = {
  day: 'у день',
  month: 'у місяць',
  year: 'у рік',
};

/** Короткий підпис для бейджа на картці: «2% / міс». */
export const RATE_PERIOD_SHORT: Record<RatePeriod, string> = {
  day: 'день',
  month: 'міс',
  year: 'рік',
};

export const PAYMENT_PERIOD_LABELS: Record<PaymentPeriod, string> = {
  day: 'щодня',
  week: 'щотижня',
  month: 'щомісяця',
};

export const LOAN_KIND_LABELS: Record<LoanKind, string> = {
  annuity: 'Ануїтет',
  differential: 'Диференційований',
  revolving: 'Кредитна лінія',
  mortgage: 'Іпотека',
  installment: 'Розстрочка',
};

export const RATE_PERIODS: RatePeriod[] = ['day', 'month', 'year'];
export const PAYMENT_PERIODS: PaymentPeriod[] = ['day', 'week', 'month'];
export const LOAN_KINDS: LoanKind[] = [
  'annuity',
  'installment',
  'revolving',
  'mortgage',
  'differential',
];

/** '0,5' → '0,5%' — кома як десятковий розділювач, зайві нулі прибрано. */
export function formatRateValue(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${String(rounded).replace('.', ',')}%`;
}

/** Ставка, як її ввів користувач: '0,5% / день'. */
export function formatRate(value: number, period: RatePeriod): string {
  return `${formatRateValue(value)} / ${RATE_PERIOD_SHORT[period]}`;
}

/** '18% річних' — для порівняння кредитів із різними періодами ставки. */
export function formatAnnualRate(annualRate: number): string {
  return `${formatRateValue(annualRate)} річних`;
}

// ─────────────────────────── перерахунок ставок ───────────────────────────

/** Ставка за період → річна. 0,5%/день → 180% річних; 2%/міс → 24%. */
export function annualizeRate(value: number, period: RatePeriod): number {
  return (value * DAYS_IN_YEAR) / PERIOD_DAYS[period];
}

/** Річна ставка → ставка за період (обернена до `annualizeRate`). */
export function rateForPeriod(annualRate: number, period: RatePeriod): number {
  return (annualRate * PERIOD_DAYS[period]) / DAYS_IN_YEAR;
}

/**
 * Скільки процентів набігає за один день на поточний залишок.
 *
 * Саме це число найкраще пояснює, чому один кредит гірший за інший:
 * «18% річних» і «0,5% у день» звучать схоже, а коштують у 10 разів по-різному.
 */
export function dailyInterest(balanceMinor: number, annualRate: number): number {
  return Math.round((balanceMinor * annualRate) / 100 / DAYS_IN_YEAR);
}

/** Скільки процентів набігає за 30 днів — для звичної місячної картинки. */
export function monthlyInterest(balanceMinor: number, annualRate: number): number {
  return Math.round((balanceMinor * annualRate) / 100 / 12);
}

export type RateRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * Груба оцінка «наскільки це дорого» за річною ставкою.
 *
 * Межі — орієнтир, а не істина: 20% річних — звичайний банківський кредит,
 * 40%+ — кредитна картка, 100%+ — мікропозика, де борг подвоюється швидше,
 * ніж ти встигаєш його гасити.
 */
export function rateRisk(annualRate: number): RateRisk {
  if (annualRate >= 100) return 'critical';
  if (annualRate >= 40) return 'high';
  if (annualRate >= 20) return 'medium';
  return 'low';
}

/**
 * Груба оцінка, за скільки місяців борг подвоїться (правило 72).
 *
 * Це саме та цифра, яка робить різницю між «18% річних» і «0,5% у день»
 * відчутною: перше подвоюється за 4 роки, друге — за 5 місяців.
 * Оцінка наближена (правило 72 — саме правило, а не формула), тому в
 * інтерфейсі вона й подається як «≈».
 */
export function doublingMonths(annualRate: number): number | null {
  const monthlyPercent = annualRate / 12;
  if (monthlyPercent <= 0) return null;
  return 72 / monthlyPercent;
}

// ─────────────────────────── стан кредиту ───────────────────────────

/** Мінімум полів кредиту, потрібний для нарахування. */
export interface LoanForAccrual {
  id: string;
  name: string;
  principal: number;
  annualRate: number;
  startDate: string;
  closedAt?: string | null;
  paymentAmount?: number | null;
  firstPaymentDate?: string | null;
  paymentDay?: number | null;
  paymentPeriod?: PaymentPeriod | null;
  termMonths?: number | null;
}

export interface PaymentForAccrual {
  id: string;
  date: string;
  totalAmount: number;
  isEarly?: boolean | null;
}

/** Точка зміни ставки (для плаваючих кредитів). */
export interface RatePoint {
  effectiveFrom: string;
  annualRate: number;
}

export interface AccrualStep {
  kind: 'accrual' | 'payment';
  date: string;
  /** Днів, за які нараховано проценти (для кроку нарахування). */
  days: number;
  /** Нараховано процентів на цьому кроці. */
  interest: number;
  /** Сума платежу (для кроку платежу). */
  amount: number;
  /** Скільки з платежу пішло в проценти. */
  toInterest: number;
  /** Скільки з платежу пішло в тіло. */
  toPrincipal: number;
  balanceAfter: number;
  accruedAfter: number;
}

export interface LoanState {
  loanId: string;
  /** Дата, на яку пораховано стан (сьогодні або дата закриття). */
  asOf: string;
  principal: number;
  /** Поточна річна ставка — за нею йде сортування «найгірші». */
  annualRate: number;
  /** Залишок тіла боргу. */
  balance: number;
  /** Нараховано, але ще не сплачено. */
  accruedInterest: number;
  /** Скільки всього треба віддати прямо зараз: тіло + набіглі проценти. */
  totalOwed: number;
  paidPrincipal: number;
  paidInterest: number;
  paidTotal: number;
  /** Усе нараховане за весь час роботи кредиту. */
  interestAccruedTotal: number;
  /** Скільки процентів набігає за один день на поточний залишок. */
  dailyInterest: number;
  /** Те саме за місяць (30 днів) — звичніша одиниця. */
  monthlyInterest: number;
  /** Заплачено понад борг — аванс, який не пропадає. */
  overpaid: number;
  daysOpen: number;
  daysSinceLastPayment: number | null;
  lastPaymentDate: string | null;
  /** Наступний платіж за домовленістю (null, якщо графік не задано). */
  nextPaymentDate: string | null;
  /** Скільки днів прострочено останній плановий платіж (0 — не прострочено). */
  overdueDays: number;
  isClosed: boolean;
  steps: AccrualStep[];
}

/** Ставка, чинна на дату: остання точка, що не пізніша за дату. */
function rateAt(segments: RatePoint[], date: string): number {
  let rate = segments[0]?.annualRate ?? 0;
  for (const segment of segments) {
    if (segment.effectiveFrom <= date) rate = segment.annualRate;
  }
  return rate;
}

/**
 * Проценти за відрізок [from, to) на поточний залишок.
 *
 * Відрізок рветься на частини в датах зміни ставки: інакше кредит зі зміною
 * ставки порахувався б за однією з них, і помилка була б тим більшою, чим
 * довше діє нова ставка.
 */
function accrualBetween(
  balance: number,
  segments: RatePoint[],
  from: string,
  to: string,
): number {
  if (daysBetweenISO(from, to) <= 0) return 0;

  const boundaries = segments
    .map((s) => s.effectiveFrom)
    .filter((d) => d > from && d < to)
    .sort();

  let interest = 0;
  let cursor = from;
  for (const boundary of [...boundaries, to]) {
    const days = daysBetweenISO(cursor, boundary);
    if (days > 0) {
      interest += Math.round(((balance * rateAt(segments, cursor)) / 100) * (days / DAYS_IN_YEAR));
    }
    cursor = boundary;
  }
  return interest;
}

/**
 * Повний стан кредиту на дату: залишок тіла, набіглі проценти, прострочення.
 *
 * Функція детермінована: той самий набір платежів завжди дає ті самі числа.
 * Розбиття платежу на «проценти/тіло» рахується тут, а не береться з бази:
 * у базі воно зберігається лише як знімок на момент вводу (для CSV і звітів),
 * а істина — цей розрахунок. Інакше виправлення ставки чи дати платежу
 * залишало б у минулому числа, які вже нічому не відповідають.
 */
export function computeLoanState(
  loan: LoanForAccrual,
  payments: PaymentForAccrual[],
  options: { asOf: string; rateHistory?: RatePoint[] },
): LoanState {
  const { asOf } = options;
  // Закритий кредит перестає набігати в день закриття: інакше через рік
  // у ньому «набігло» б стільки, ніби ним досі користуються.
  const effectiveAsOf = loan.closedAt && loan.closedAt < asOf ? loan.closedAt : asOf;

  const history = [...(options.rateHistory ?? [])].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const segments: RatePoint[] =
    history.length > 0 && history[0]!.effectiveFrom <= loan.startDate
      ? history
      : [{ effectiveFrom: loan.startDate, annualRate: loan.annualRate }, ...history];

  let balance = loan.principal;
  let accrued = 0;
  let paidPrincipal = 0;
  let paidInterest = 0;
  let paidTotal = 0;
  let overpaid = 0;
  let interestAccruedTotal = 0;
  let cursor = loan.startDate;
  let lastPaymentDate: string | null = null;
  const steps: AccrualStep[] = [];

  const ordered = [...payments]
    .filter((p) => p.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const payment of ordered) {
    // Платіж після закриття не має нараховувати проценти (кредит уже закрито),
    // але й не має зникати: гроші внесені, і борг вони зменшують.
    const when = payment.date > effectiveAsOf ? effectiveAsOf : payment.date;

    const interest = accrualBetween(balance, segments, cursor, when);
    if (interest > 0) {
      accrued += interest;
      interestAccruedTotal += interest;
      steps.push({
        kind: 'accrual',
        date: when,
        days: daysBetweenISO(cursor, when),
        interest,
        amount: 0,
        toInterest: 0,
        toPrincipal: 0,
        balanceAfter: balance,
        accruedAfter: accrued,
      });
    }

    const amount = Math.max(0, payment.totalAmount);
    // Черговість: проценти → тіло. Залишок понад борг не «згорає»,
    // а лишається авансом — інакше кредит виглядав би закритим із боргом.
    const toInterest = Math.min(amount, accrued);
    const toPrincipal = Math.min(amount - toInterest, balance);
    const excess = amount - toInterest - toPrincipal;

    accrued -= toInterest;
    balance -= toPrincipal;
    overpaid += excess;
    paidInterest += toInterest;
    paidPrincipal += toPrincipal;
    paidTotal += amount;
    if (when > cursor) cursor = when;
    lastPaymentDate = payment.date;

    steps.push({
      kind: 'payment',
      date: payment.date,
      days: 0,
      interest: 0,
      amount,
      toInterest,
      toPrincipal,
      balanceAfter: balance,
      accruedAfter: accrued,
    });
  }

  const tail = accrualBetween(balance, segments, cursor, effectiveAsOf);
  if (tail > 0) {
    accrued += tail;
    interestAccruedTotal += tail;
    steps.push({
      kind: 'accrual',
      date: effectiveAsOf,
      days: daysBetweenISO(cursor, effectiveAsOf),
      interest: tail,
      amount: 0,
      toInterest: 0,
      toPrincipal: 0,
      balanceAfter: balance,
      accruedAfter: accrued,
    });
  }

  const currentRate = rateAt(segments, effectiveAsOf);
  const schedule = paymentSchedule(loan, effectiveAsOf, balance, lastPaymentDate);

  return {
    loanId: loan.id,
    asOf: effectiveAsOf,
    principal: loan.principal,
    annualRate: currentRate,
    balance,
    accruedInterest: accrued,
    totalOwed: balance + accrued,
    paidPrincipal,
    paidInterest,
    paidTotal,
    interestAccruedTotal,
    dailyInterest: dailyInterest(balance, currentRate),
    monthlyInterest: monthlyInterest(balance, currentRate),
    overpaid,
    daysOpen: Math.max(0, daysBetweenISO(loan.startDate, effectiveAsOf)),
    daysSinceLastPayment: lastPaymentDate ? daysBetweenISO(lastPaymentDate, effectiveAsOf) : null,
    lastPaymentDate,
    nextPaymentDate: schedule.nextPaymentDate,
    overdueDays: schedule.overdueDays,
    isClosed: Boolean(loan.closedAt),
    steps,
  };
}

/**
 * Найближчий плановий платіж і прострочення.
 *
 * Графік у застосунку не зберігається окремою таблицею: він повністю
 * виводиться з періоду платежів і дати першого платежу. Тримати ту саму
 * інформацію ще й у `loan_schedule` означало б мати два графіки, які
 * рано чи пізно розійдуться.
 */
function paymentSchedule(
  loan: LoanForAccrual,
  asOf: string,
  balance: number,
  lastPaymentDate: string | null,
): { nextPaymentDate: string | null; overdueDays: number } {
  const hasPlan = Boolean(loan.firstPaymentDate || loan.paymentAmount || loan.paymentDay);
  if (!hasPlan || balance <= 0) return { nextPaymentDate: null, overdueDays: 0 };

  const anchor = loan.firstPaymentDate
    ? loan.firstPaymentDate
    : loan.paymentDay
      ? withDayOfMonth(loan.startDate, loan.paymentDay)
      : loan.startDate;
  const period = loan.paymentPeriod ?? 'month';

  const shift = (step: number): string => {
    if (period === 'day') return addDaysISO(anchor, step);
    if (period === 'week') return addDaysISO(anchor, step * 7);
    return addMonthsISO(anchor, step);
  };

  let lastDue: string | null = null;
  let nextDue: string | null = null;
  // Межа обходу — запобіжник від вічного циклу на щоденному графіку,
  // який тягнеться роками.
  for (let i = 0; i < 5000; i += 1) {
    const due = shift(i);
    if (due > asOf) {
      nextDue = due;
      break;
    }
    lastDue = due;
  }

  const missed = lastDue !== null && (lastPaymentDate === null || lastPaymentDate < lastDue);
  return {
    nextPaymentDate: nextDue,
    overdueDays: missed && lastDue ? Math.max(0, daysBetweenISO(lastDue, asOf)) : 0,
  };
}

/** Останні N кроків історії — для картки «що відбувалось із кредитом». */
export function recentSteps(state: LoanState, limit = 8): AccrualStep[] {
  return state.steps.slice(-limit);
}

/**
 * Як розкладеться платіж: спершу проценти, потім тіло, решта — аванс.
 *
 * Використовується і при збереженні платежу, і при попередньому показі в
 * формі. Це навмисно та сама функція: якби форма показувала одне розбиття,
 * а база зберігала інше, користувач втратив би довіру до цифр назавжди.
 */
export function allocatePayment(
  state: LoanState,
  amountMinor: number,
): { toInterest: number; toPrincipal: number; excess: number } {
  const amount = Math.max(0, amountMinor);
  const toInterest = Math.min(amount, state.accruedInterest);
  const toPrincipal = Math.min(amount - toInterest, state.balance);
  return {
    toInterest,
    toPrincipal,
    excess: amount - toInterest - toPrincipal,
  };
}

// ─────────────────────────── сортування ───────────────────────────

export type LoanSortMode = 'worst' | 'dailyCost' | 'debt' | 'overdue' | 'newest' | 'name';

export const LOAN_SORT_LABELS: Record<LoanSortMode, string> = {
  worst: '🔥 Найдорожчі',
  dailyCost: '₴/день',
  debt: 'Борг',
  overdue: 'Прострочення',
  newest: 'Нові',
  name: 'Назва',
};

export const LOAN_SORT_MODES: LoanSortMode[] = ['worst', 'dailyCost', 'debt', 'overdue', 'newest', 'name'];

export interface SortableLoanState {
  name: string;
  annualRate: number;
  dailyInterest: number;
  totalOwed: number;
  overdueDays: number;
  startDate: string;
  isClosed: boolean;
}

/**
 * Сортування списку кредитів.
 *
 * Основне — «найдорожчі»: за річною ставкою, спадаючи. Це відповідь на
 * питання «що гасити першим»: кожна гривня, кинута в дорогий кредит,
 * економить більше, ніж та сама гривня в дешевому.
 *
 * Закриті кредити завжди внизу, у будь-якому режимі: вони вже не тиснуть,
 * і не мають заважати дивитись на ті, що тиснуть.
 */
export function sortLoanStates<T extends SortableLoanState>(rows: T[], mode: LoanSortMode): T[] {
  const byMode = (a: T, b: T): number => {
    switch (mode) {
      case 'worst':
        return b.annualRate - a.annualRate || b.totalOwed - a.totalOwed;
      case 'dailyCost':
        return b.dailyInterest - a.dailyInterest || b.annualRate - a.annualRate;
      case 'debt':
        return b.totalOwed - a.totalOwed || b.annualRate - a.annualRate;
      case 'overdue':
        return b.overdueDays - a.overdueDays || b.annualRate - a.annualRate;
      case 'newest':
        return b.startDate.localeCompare(a.startDate) || b.annualRate - a.annualRate;
      case 'name':
        return a.name.localeCompare(b.name, 'uk');
    }
  };

  return [...rows].sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    return byMode(a, b) || a.name.localeCompare(b.name, 'uk');
  });
}

/**
 * Номери «найгірших»: 1 — кредит із найбільшою ставкою.
 *
 * Повертає мапу id → номер, щоб картка могла показати «№1 за ціною грошей»,
 * навіть якщо список відсортовано за чимось іншим. Закритим номер не
 * присвоюється — вони поза змаганням.
 */
export function worstRanking<T extends { id: string; annualRate: number; isClosed: boolean }>(
  rows: T[],
): Record<string, number> {
  const active = rows
    .filter((r) => !r.isClosed)
    .sort((a, b) => b.annualRate - a.annualRate || a.id.localeCompare(b.id));

  return Object.fromEntries(active.map((r, i) => [r.id, i + 1]));
}

export interface PortfolioInput {
  balance: number;
  accruedInterest: number;
  dailyInterest: number;
  annualRate: number;
  overdueDays: number;
  isClosed: boolean;
}

/**
 * Сумарний стан портфеля кредитів — для шапки екрана.
 *
 * `weightedAnnualRate` — середня ставка, зважена на борг: вона показує
 * реальну ціну грошей, а не середнє арифметичне, яке витягне вгору
 * маленька, але дорога позика.
 */
export function portfolioSummary(rows: PortfolioInput[]): {
  debt: number;
  accrued: number;
  dailyInterest: number;
  activeCount: number;
  closedCount: number;
  overdueCount: number;
  weightedAnnualRate: number;
} {
  const active = rows.filter((r) => !r.isClosed);
  const debt = active.reduce((sum, r) => sum + r.balance, 0);
  const accrued = active.reduce((sum, r) => sum + r.accruedInterest, 0);
  const daily = active.reduce((sum, r) => sum + r.dailyInterest, 0);
  const weighted = active.reduce((sum, r) => sum + r.annualRate * r.balance, 0);

  return {
    debt,
    accrued,
    dailyInterest: daily,
    activeCount: active.length,
    closedCount: rows.length - active.length,
    overdueCount: active.filter((r) => r.overdueDays > 0).length,
    weightedAnnualRate: debt > 0 ? weighted / debt : 0,
  };
}
