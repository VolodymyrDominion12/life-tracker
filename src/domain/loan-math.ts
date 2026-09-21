/**
 * Математика кредитів — чисті функції без доступу до бази.
 *
 * Винесено окремо навмисно: це єдина частина застосунку, де помилка в формулі
 * виглядає як «нормальні» цифри. Тут немає жодних залежностей, тому функції
 * перевіряються звичайним тестом на реальних числах (див. scripts/verify-db.ts).
 *
 * Усі суми — у мінорних одиницях (копійках), ставки — у відсотках річних.
 */

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  payment: number;
  interest: number;
  principalPart: number;
  balanceAfter: number;
}

export interface AnnuitySchedule {
  rows: ScheduleRow[];
  /** Розмір регулярного платежу за графіком. */
  monthlyPayment: number;
  totalPaid: number;
  totalInterest: number;
  months: number;
}

/** Місячна ставка з річної, у частках (18% річних → 0.015). */
export function monthlyRate(annualRatePercent: number): number {
  return annualRatePercent / 100 / 12;
}

/**
 * Ануїтетний платіж: P = S · i / (1 − (1 + i)^(−n)).
 *
 * При нульовій ставці формула вироджується, тому це окремий випадок:
 * тіло просто ділиться на кількість місяців.
 */
export function annuityPayment(
  principalMinor: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  if (termMonths <= 0) return 0;
  const i = monthlyRate(annualRatePercent);
  if (i === 0) return Math.round(principalMinor / termMonths);
  return Math.round((principalMinor * i) / (1 - Math.pow(1 + i, -termMonths)));
}

/**
 * Графік амортизації ануїтетного кредиту.
 *
 * `extraMonthlyMinor` — додатковий щомісячний внесок у тіло (дострокове
 * погашення). Такий внесок зменшує залишок, а отже й проценти в наступних
 * періодах, тому кредит закривається швидше за номінальний строк.
 *
 * Цикл обмежений `termMonths * 2` ітераціями — це запобіжник від
 * нескінченного циклу, якщо платіж менший за нараховані проценти.
 */
export function buildAnnuitySchedule(params: {
  principalMinor: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  extraMonthlyMinor?: number;
}): AnnuitySchedule {
  const { principalMinor, annualRate, termMonths, firstPaymentDate } = params;
  const extra = params.extraMonthlyMinor ?? 0;
  const i = monthlyRate(annualRate);
  const monthlyPayment = annuityPayment(principalMinor, annualRate, termMonths);

  const rows: ScheduleRow[] = [];
  let balance = principalMinor;
  const start = new Date(`${firstPaymentDate}T12:00:00Z`);
  let seq = 1;

  while (balance > 0 && seq <= termMonths * 2) {
    const interest = Math.round(balance * i);
    let principalPart = monthlyPayment - interest + extra;
    if (principalPart <= 0) break; // платіж не покриває проценти — борг не закриється ніколи
    if (principalPart > balance) principalPart = balance;

    const due = new Date(start);
    due.setUTCMonth(start.getUTCMonth() + (seq - 1));

    balance -= principalPart;
    rows.push({
      seq,
      dueDate: due.toISOString().slice(0, 10),
      payment: interest + principalPart,
      interest,
      principalPart,
      balanceAfter: balance,
    });
    seq += 1;
  }

  return {
    rows,
    monthlyPayment,
    totalPaid: rows.reduce((sum, r) => sum + r.payment, 0),
    totalInterest: rows.reduce((sum, r) => sum + r.interest, 0),
    months: rows.length,
  };
}

/**
 * Ефект дострокового погашення: скільки місяців і скільки процентів економить
 * додатковий щомісячний внесок. Саме це питання виникає найчастіше.
 */
export function earlyRepaymentEffect(params: {
  principalMinor: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  extraMonthlyMinor: number;
}): {
  baseline: AnnuitySchedule;
  withExtra: AnnuitySchedule;
  monthsSaved: number;
  interestSaved: number;
} {
  // База — той самий кредит БЕЗ дострокових внесків; інакше порівнювати нічого.
  const baseline = buildAnnuitySchedule({ ...params, extraMonthlyMinor: 0 });
  const withExtra = buildAnnuitySchedule(params);

  return {
    baseline,
    withExtra,
    monthsSaved: baseline.months - withExtra.months,
    interestSaved: baseline.totalInterest - withExtra.totalInterest,
  };
}
