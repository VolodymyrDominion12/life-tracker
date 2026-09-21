import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Pill, RateBadge, riskLabel, riskTone } from '@/components/loans';
import {
  Btn,
  Card,
  Chips,
  Divider,
  Empty,
  Field,
  Notice,
  ProgressBar,
  SectionTitle,
  StatTile,
  toneColor,
  useTheme,
} from '@/components/ui';
import {
  addLoanPayment,
  changeLoanRate,
  closeLoan,
  loanDetail,
  reopenLoan,
  softDeleteLoan,
  softDeleteLoanPayment,
  updateLoanTerms,
} from '@/domain/finance';
import {
  LOAN_KIND_LABELS,
  PAYMENT_PERIODS,
  PAYMENT_PERIOD_LABELS,
  RATE_PERIODS,
  RATE_PERIOD_LABELS,
  allocatePayment,
  computeLoanState,
  formatAnnualRate,
  formatRate,
  rateRisk,
  type PaymentPeriod,
  type RatePeriod,
} from '@/domain/loan-accrual';
import { buildAnnuitySchedule, earlyRepaymentEffect, monthsToPayoff } from '@/domain/loan-math';
import { getSettings } from '@/domain/settings';
import { formatDateHuman, isISODate, todayISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { formatMoney, parseAmountToMinor, percent } from '@/lib/money';

/** '1234.5' → '1 234,50' — щоб підставити суму у поле вводу. */
function toInput(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}

/**
 * Картка кредиту: умови, стан на сьогодні, погашення.
 *
 * Тут навмисно немає полів «скільки з платежу в проценти»: розбиття рахує
 * рушій нарахувань, і користувач бачить його ще до збереження. Вводити ці
 * числа руками означало б дозволити зробити борг таким, яким він не є.
 */
export default function LoanDetailScreen() {
  const p = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const loanId = String(id ?? '');

  const { data, reload } = useAsyncData(async () => {
    const [settings, detail] = await Promise.all([getSettings(), loanDetail(loanId)]);
    return { settings, detail };
  }, [loanId]);

  const currency = data?.settings.baseCurrency ?? 'UAH';
  const detail = data?.detail ?? null;
  const state = detail?.state ?? null;

  // ── форма погашення ──
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payEarly, setPayEarly] = useState(false);
  const [payMessage, setPayMessage] = useState<string | null>(null);

  // ── інші форми ──
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPaymentId, setConfirmPaymentId] = useState<string | null>(null);
  const [confirmLoanDelete, setConfirmLoanDelete] = useState(false);
  const [extra, setExtra] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newRatePeriod, setNewRatePeriod] = useState<RatePeriod>('month');
  const [rateFrom, setRateFrom] = useState(todayISO());
  // null означає «не чіпали» — тоді показуємо те, що вже збережено в кредиті.
  const [planAmount, setPlanAmount] = useState<string | null>(null);
  // null = «не чіпали» → показуємо те, що вже збережено в кредиті.
  const [planPeriod, setPlanPeriod] = useState<PaymentPeriod | null>(null);
  const [planDay, setPlanDay] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const payMinor = parseAmountToMinor(payAmount) ?? 0;
  const payDateValid = isISODate(payDate);

  const ratePoints = useMemo(
    () =>
      (detail?.rateHistory ?? []).map((r) => ({
        effectiveFrom: r.effectiveFrom,
        annualRate: r.annualRate,
      })),
    [detail],
  );

  /**
   * Стан на дату платежу — звідси береться розбиття. Це та сама функція, що
   * й при збереженні, тож те, що видно в формі, і те, що запишеться, збігається.
   * Дата перевіряється: поки вона введена не повністю, показувати нема чого.
   */
  const allocation = useMemo(() => {
    if (!detail || !payDateValid) return null;
    const atDate = computeLoanState(detail.loan, detail.payments, { asOf: payDate, rateHistory: ratePoints });
    return { atDate, split: allocatePayment(atDate, payMinor) };
  }, [detail, payDate, payDateValid, payMinor, ratePoints]);

  const monthsLeft =
    state && state.balance > 0 && detail?.loan.paymentAmount
      ? monthsToPayoff(state.balance, state.annualRate, detail.loan.paymentAmount)
      : null;

  /** Проценти за плановий період більші за платіж — борг не зменшується ніколи. */
  const paymentTooSmall =
    Boolean(detail?.loan.paymentAmount) && state && state.balance > 0 && monthsLeft === null;

  const whatIf = useMemo(() => {
    if (!detail || !state || state.balance <= 0) return null;
    const extraMinor = parseAmountToMinor(extra) ?? 0;
    const basePayment = detail.loan.paymentAmount ?? 0;
    if (extraMinor <= 0 || basePayment <= 0 || !monthsLeft) return null;

    return {
      monthlyPayment: basePayment,
      extraMinor,
      ...earlyRepaymentEffect({
        principalMinor: state.balance,
        annualRate: state.annualRate,
        termMonths: monthsLeft,
        firstPaymentDate: todayISO(),
        extraMonthlyMinor: extraMinor,
      }),
    };
  }, [detail, state, extra, monthsLeft]);

  const schedule = useMemo(() => {
    if (!detail || !state || state.balance <= 0 || !monthsLeft) return null;
    return buildAnnuitySchedule({
      principalMinor: state.balance,
      annualRate: state.annualRate,
      termMonths: monthsLeft,
      firstPaymentDate: detail.loan.firstPaymentDate ?? todayISO(),
    });
  }, [detail, state, monthsLeft]);

  async function run(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await action();
      if (message) setFlash(message);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePayment() {
    setBusy(true);
    setError(null);
    setPayMessage(null);
    try {
      const result = await addLoanPayment({
        loanId,
        date: payDate,
        totalMinor: payMinor,
        isEarly: payEarly,
        note: payNote || null,
      });
      setPayMessage(
        `Записано ${formatMoney(payMinor, currency)}: проценти ${formatMoney(result.toInterest, currency)}, тіло ${formatMoney(result.toPrincipal, currency)}` +
          (result.excess > 0 ? `, аванс ${formatMoney(result.excess, currency)}` : ''),
      );
      setPayAmount('');
      setPayNote('');
      setPayEarly(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail || !state) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <Stack.Screen options={{ title: 'Кредит', headerShown: true }} />
        <View style={{ padding: 16, gap: 12 }}>
          <Card>
            <Empty title="Кредит не знайдено" hint="Можливо, його видалено — повернись до списку" />
            <Btn title="До списку" kind="secondary" onPress={() => router.back()} />
          </Card>
        </View>
      </View>
    );
  }

  const loan = detail.loan;
  const risk = rateRisk(state.annualRate);
  const paidShare = percent(state.paidPrincipal, loan.principal);
  const planAmountValue = planAmount ?? (loan.paymentAmount ? toInput(loan.paymentAmount) : '');
  const planDayValue = planDay ?? (loan.paymentDay ? String(loan.paymentDay) : '');
  const planPeriodValue = planPeriod ?? loan.paymentPeriod;

  return (
    <>
      <Stack.Screen
        options={{
          title: loan.name,
          headerShown: true,
          headerStyle: { backgroundColor: p.card },
          headerTintColor: p.text,
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: p.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── умови ── */}
          <Card>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>{loan.name}</Text>
                <Text style={{ color: p.muted, fontSize: 12 }}>
                  {loan.lender ?? 'джерело не вказано'} ·{' '}
                  {loan.kind ? LOAN_KIND_LABELS[loan.kind] : 'кредит'} · видано{' '}
                  {formatDateHuman(loan.startDate)}
                </Text>
                <Text style={{ color: toneColor(p, riskTone(risk)), fontSize: 12, fontWeight: '600' }}>
                  {riskLabel(risk)} · узято {formatMoney(loan.principal, loan.currency)}
                </Text>
              </View>
              <RateBadge
                value={loan.rateValue ?? loan.annualRate}
                period={loan.ratePeriod}
                annualRate={state.annualRate}
              />
            </View>
            {loan.note ? <Text style={{ color: p.muted, fontSize: 12 }}>{loan.note}</Text> : null}
            {loan.closedAt ? (
              <Notice
                tone="success"
                text={`Кредит закрито ${formatDateHuman(loan.closedAt)} — проценти більше не набігають.`}
              />
            ) : null}
            {state.overdueDays > 0 ? (
              <Notice
                tone="danger"
                text={`Прострочено ${state.overdueDays} дн.: плановий платіж не внесено, і проценти за ці дні вже в боргу.`}
              />
            ) : null}
            {paymentTooSmall ? (
              <Notice
                tone="danger"
                text="Платіж за домовленістю менший за проценти, що набігають за місяць: за такого темпу борг не зменшується взагалі."
              />
            ) : null}
          </Card>

          {flash ? <Notice tone="success" text={flash} /> : null}
          {error ? <Notice tone="danger" text={error} /> : null}

          {/* ── стан ── */}
          <Card>
            <SectionTitle>Скільки набігло на {formatDateHuman(state.asOf)}</SectionTitle>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <StatTile label="Залишок тіла" value={formatMoney(state.balance, loan.currency)} />
              <StatTile
                label="Проценти"
                value={formatMoney(state.accruedInterest, loan.currency)}
                tone={state.accruedInterest > 0 ? 'warning' : 'default'}
              />
            </View>
            <Divider />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <StatTile
                label="Всього до сплати"
                value={formatMoney(state.totalOwed, loan.currency)}
                tone="danger"
              />
              <StatTile
                label="Коштує щодня"
                value={formatMoney(state.dailyInterest, loan.currency)}
                hint={`${formatMoney(state.monthlyInterest, loan.currency)} на місяць`}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text style={{ color: p.muted, fontSize: 12 }}>
                Тіло погашено на {paidShare.toFixed(0)}% ({formatMoney(state.paidPrincipal, loan.currency)}{' '}
                із {formatMoney(loan.principal, loan.currency)})
              </Text>
              <ProgressBar
                value={paidShare}
                max={100}
                tone={paidShare > 60 ? 'success' : paidShare > 25 ? 'accent' : 'warning'}
              />
            </View>
            <Divider />
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Сплачено всього {formatMoney(state.paidTotal, loan.currency)}: проценти{' '}
              {formatMoney(state.paidInterest, loan.currency)} і тіло{' '}
              {formatMoney(state.paidPrincipal, loan.currency)}. Нараховано процентів за весь час —{' '}
              {formatMoney(state.interestAccruedTotal, loan.currency)}.
              {state.overpaid > 0 ? ` Аванс: ${formatMoney(state.overpaid, loan.currency)}.` : ''}
            </Text>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              {state.daysSinceLastPayment == null
                ? 'Погашень ще не було.'
                : `Останнє погашення — ${state.daysSinceLastPayment} дн. тому.`}
              {state.nextPaymentDate
                ? ` Наступний платіж за графіком: ${formatDateHuman(state.nextPaymentDate)}.`
                : ' Графік платежів не задано.'}
              {monthsLeft ? ` За поточного платежу кредит закриється за ${monthsLeft} міс.` : ''}
            </Text>
          </Card>

          {/* ── погашення ── */}
          <Card>
            <SectionTitle>Внести погашення</SectionTitle>
            <Field
              label="Дата"
              value={payDate}
              onChangeText={setPayDate}
              placeholder="РРРР-ММ-ДД"
              suffix="дата"
            />
            <Field
              label="Сума"
              value={payAmount}
              onChangeText={setPayAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              suffix={loan.currency}
            />
            <Chips
              options={[
                { value: 'all', label: `Закрити все (${formatMoney(state.totalOwed, loan.currency)})` },
                {
                  value: 'interest',
                  label: `Лише проценти (${formatMoney(state.accruedInterest, loan.currency)})`,
                },
                ...(loan.paymentAmount
                  ? [
                      {
                        value: 'plan',
                        label: `За графіком (${formatMoney(loan.paymentAmount, loan.currency)})`,
                      },
                    ]
                  : []),
              ]}
              value={null}
              onChange={(v) => {
                if (v === 'all') setPayAmount(toInput(state.totalOwed));
                else if (v === 'interest') setPayAmount(toInput(state.accruedInterest));
                else if (v === 'plan' && loan.paymentAmount) setPayAmount(toInput(loan.paymentAmount));
              }}
            />
            {!payDateValid ? (
              <Notice tone="warning" text="Дата має бути у форматі РРРР-ММ-ДД, наприклад 2026-09-21." />
            ) : null}
            {allocation && payMinor > 0 ? (
              <Text style={{ color: p.text, fontSize: 13 }}>
                Піде: проценти {formatMoney(allocation.split.toInterest, loan.currency)}, тіло{' '}
                {formatMoney(allocation.split.toPrincipal, loan.currency)}
                {allocation.split.excess > 0
                  ? `, аванс ${formatMoney(allocation.split.excess, loan.currency)}`
                  : ''}
                . Тіло після платежу —{' '}
                {formatMoney(
                  allocation.atDate.balance - allocation.split.toPrincipal,
                  loan.currency,
                )}
                .
              </Text>
            ) : (
              <Text style={{ color: p.muted, fontSize: 12 }}>
                Проценти рахуються на дату платежу, а не на сьогодні: якщо вносиш за минулий
                місяць — розбиття буде те, що набігло тоді.
              </Text>
            )}
            <Chips
              options={[{ value: 'early' as const, label: 'Дострокове погашення' }]}
              value={payEarly ? 'early' : null}
              onChange={() => setPayEarly((v) => !v)}
            />
            <Field
              label="Нотатка (необов'язково)"
              value={payNote}
              onChangeText={setPayNote}
              placeholder="Через застосунок банку, готівкою…"
            />
            <Btn
              title="Записати платіж"
              onPress={() => void savePayment()}
              loading={busy}
              disabled={payMinor <= 0 || !payDateValid}
            />
            {payMessage ? <Notice tone="success" text={payMessage} /> : null}
          </Card>

          {/* ── історія погашень ── */}
          <Card>
            <SectionTitle
              right={<Text style={{ color: p.muted, fontSize: 12 }}>{detail.payments.length}</Text>}
            >
              Погашення
            </SectionTitle>
            {detail.payments.length === 0 ? (
              <Empty
                title="Погашень ще не було"
                hint="Кожен платіж спершу закриває проценти, і лише залишок зменшує тіло боргу"
              />
            ) : (
              [...detail.payments].reverse().map((payment, index) => (
                <View key={payment.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }}>
                          {formatMoney(payment.totalAmount, loan.currency)}
                        </Text>
                        {payment.isEarly ? <Pill text="достроково" tone="accent" /> : null}
                      </View>
                      <Text style={{ color: p.muted, fontSize: 12 }}>
                        {formatDateHuman(payment.date)} · проценти{' '}
                        {formatMoney(payment.interestPart ?? 0, loan.currency)} · тіло{' '}
                        {formatMoney(payment.principalPart ?? 0, loan.currency)}
                        {payment.note ? ` · ${payment.note}` : ''}
                      </Text>
                    </View>
                    {confirmPaymentId === payment.id ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          onPress={() =>
                            void run(async () => {
                              await softDeleteLoanPayment(payment.id);
                              setConfirmPaymentId(null);
                            })
                          }
                          hitSlop={8}
                        >
                          <Text style={{ color: p.danger, fontSize: 13, fontWeight: '600' }}>
                            Видалити
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => setConfirmPaymentId(null)} hitSlop={8}>
                          <Text style={{ color: p.muted, fontSize: 13 }}>Ні</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setConfirmPaymentId(payment.id)} hitSlop={8}>
                        <Text style={{ color: p.muted, fontSize: 16 }}>×</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))
            )}
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Розбиття — те, що застосунок порахував на дату платежу. Видалення платежу одразу
              перерахує весь стан кредиту.
            </Text>
          </Card>

          {/* ── що якщо платити більше ── */}
          <Card>
            <SectionTitle>Що якщо платити більше</SectionTitle>
            {state.balance <= 0 ? (
              <Text style={{ color: p.muted, fontSize: 13 }}>Борг за тілом уже закрито.</Text>
            ) : (
              <>
                <Field
                  label="Додатково щомісяця"
                  value={extra}
                  onChangeText={setExtra}
                  placeholder="2000"
                  keyboardType="decimal-pad"
                  suffix={loan.currency}
                />
                {whatIf ? (
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: p.success, fontSize: 14, fontWeight: '700' }}>
                      Строк коротший на {whatIf.monthsSaved} міс., переплата менша на{' '}
                      {formatMoney(whatIf.interestSaved, loan.currency)}
                    </Text>
                    <Text style={{ color: p.muted, fontSize: 12 }}>
                      Платіж {formatMoney(whatIf.monthlyPayment, loan.currency)} +{' '}
                      {formatMoney(whatIf.extraMinor, loan.currency)}: замість{' '}
                      {whatIf.baseline.months} міс. — {whatIf.withExtra.months} міс., замість{' '}
                      {formatMoney(whatIf.baseline.totalInterest, loan.currency)} процентів —{' '}
                      {formatMoney(whatIf.withExtra.totalInterest, loan.currency)}.
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: p.muted, fontSize: 12 }}>
                    Вкажи суму, а платіж за домовленістю — у блоці «Графік і умови» нижче.
                  </Text>
                )}
              </>
            )}
          </Card>

          {/* ── план ── */}
          {schedule ? (
            <Card>
              <SectionTitle
                right={
                  <Pressable onPress={() => setShowSchedule((v) => !v)} hitSlop={8}>
                    <Text style={{ color: p.accent, fontSize: 13 }}>
                      {showSchedule ? 'Згорнути' : 'Показати'}
                    </Text>
                  </Pressable>
                }
              >
                План від сьогодні
              </SectionTitle>
              <Text style={{ color: p.muted, fontSize: 12 }}>
                {schedule.months} платежів по {formatMoney(schedule.monthlyPayment, loan.currency)};
                усього процентів {formatMoney(schedule.totalInterest, loan.currency)}. Це план за
                поточним залишком і ставкою — факт може відрізнятися.
              </Text>
              {showSchedule
                ? schedule.rows.slice(0, 12).map((row) => (
                    <View key={row.seq}>
                      <Divider />
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          paddingVertical: 5,
                        }}
                      >
                        <Text style={{ color: p.text, fontSize: 13 }}>
                          {row.seq}. {formatDateHuman(row.dueDate)}
                        </Text>
                        <Text style={{ color: p.muted, fontSize: 13 }}>
                          {formatMoney(row.payment, loan.currency)} · проценти{' '}
                          {formatMoney(row.interest, loan.currency)}
                        </Text>
                      </View>
                    </View>
                  ))
                : null}
            </Card>
          ) : null}

          {/* ── графік і умови ── */}
          <Card>
            <SectionTitle>Графік і умови</SectionTitle>
            <Field
              label="Платіж за домовленістю"
              value={planAmountValue}
              onChangeText={setPlanAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              suffix={loan.currency}
            />
            <Chips
              options={PAYMENT_PERIODS.map((v) => ({ value: v, label: PAYMENT_PERIOD_LABELS[v] }))}
              value={planPeriodValue}
              onChange={setPlanPeriod}
            />
            <Field
              label="Число місяця для платежу (необов'язково)"
              value={planDayValue}
              onChangeText={setPlanDay}
              placeholder="15"
              keyboardType="number-pad"
              suffix="число"
            />
            <Btn
              title="Зберегти умови"
              kind="secondary"
              loading={busy}
              onPress={() =>
                void run(async () => {
                  const amountMinor = parseAmountToMinor(planAmountValue);
                  const day = Number(planDayValue.replace(',', '.'));
                  await updateLoanTerms(loanId, {
                    paymentAmountMinor: amountMinor && amountMinor > 0 ? amountMinor : null,
                    paymentPeriod: planPeriodValue,
                    paymentDay: Number.isFinite(day) && day >= 1 ? Math.round(day) : null,
                  });
                }, 'Умови збережено')
              }
            />
            <Text style={{ color: p.muted, fontSize: 12 }}>
              За цими умовами рахуються прострочення й дата наступного платежу. На самі проценти
              вони не впливають: проценти залежать лише від тіла, ставки й часу.
            </Text>
          </Card>

          {/* ── зміна ставки ── */}
          <Card>
            <SectionTitle>Змінити ставку</SectionTitle>
            <Field
              label="Нова ставка"
              value={newRate}
              onChangeText={setNewRate}
              placeholder="0,5 або 2 або 18"
              keyboardType="decimal-pad"
              suffix="%"
            />
            <Chips
              options={RATE_PERIODS.map((r) => ({ value: r, label: RATE_PERIOD_LABELS[r] }))}
              value={newRatePeriod}
              onChange={setNewRatePeriod}
            />
            <Field
              label="Чинна з дати"
              value={rateFrom}
              onChangeText={setRateFrom}
              placeholder="РРРР-ММ-ДД"
              suffix="дата"
            />
            <Btn
              title="Додати ставку"
              kind="secondary"
              loading={busy}
              disabled={newRate.trim() === ''}
              onPress={() =>
                void run(async () => {
                  if (newRate.trim() === '') throw new Error('Введи нову ставку');
                  await changeLoanRate({
                    loanId,
                    effectiveFrom: rateFrom,
                    rateValue: Number(newRate.replace(',', '.')),
                    ratePeriod: newRatePeriod,
                  });
                  setNewRate('');
                }, 'Ставку додано: після цієї дати нарахування піде за нею, до неї — за старою')
              }
            />
            {detail.rateHistory.map((r) => (
              <View key={r.id}>
                <Divider />
                <Text style={{ color: p.muted, fontSize: 12, paddingVertical: 4 }}>
                  з {formatDateHuman(r.effectiveFrom)} —{' '}
                  {formatRate(r.rateValue ?? r.annualRate, r.ratePeriod)} (
                  {formatAnnualRate(r.annualRate)}){r.note ? ` · ${r.note}` : ''}
                </Text>
              </View>
            ))}
          </Card>

          {/* ── закриття й видалення ── */}
          <Card>
            <SectionTitle>Кредит</SectionTitle>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Дата закриття береться з поля «Дата» у блоці погашення — постав ту дату, коли
              розрахувався.
            </Text>
            {loan.closedAt ? (
              <Btn
                title="Відкрити знову"
                kind="secondary"
                loading={busy}
                onPress={() => void run(async () => reopenLoan(loanId), 'Кредит знову активний')}
              />
            ) : (
              <Btn
                title="Позначити закритим"
                kind="secondary"
                loading={busy}
                onPress={() =>
                  void run(
                    async () => closeLoan(loanId, payDate),
                    'Кредит закрито — нарахування процентів зупинено',
                  )
                }
              />
            )}
            <Btn
              title="Погасити все й закрити"
              loading={busy}
              disabled={state.totalOwed <= 0}
              onPress={() =>
                void run(async () => {
                  const owed = state.totalOwed;
                  if (owed > 0) await addLoanPayment({ loanId, date: payDate, totalMinor: owed });
                  await closeLoan(loanId, payDate);
                }, 'Борг закрито повністю, кредит позначено закритим')
              }
            />
            {confirmLoanDelete ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn
                  title="Так, видалити"
                  kind="danger"
                  compact
                  loading={busy}
                  onPress={() =>
                    void run(async () => {
                      await softDeleteLoan(loanId);
                      router.back();
                    })
                  }
                />
                <Btn
                  title="Скасувати"
                  kind="secondary"
                  compact
                  onPress={() => setConfirmLoanDelete(false)}
                />
              </View>
            ) : (
              <Btn
                title="Видалити кредит"
                kind="danger"
                compact
                onPress={() => setConfirmLoanDelete(true)}
              />
            )}
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Видалення м'яке: рядок лишається в базі з позначкою, тож експорт і бекап не втрачають
              історію.
            </Text>
          </Card>

          <Text style={{ color: p.muted, fontSize: 12, textAlign: 'center' }}>
            Проценти: простий процент на залишок тіла, фактична кількість днів, база 360. Платіж
            спершу закриває проценти, потім тіло — тому перші платежі майже не зменшують борг.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
