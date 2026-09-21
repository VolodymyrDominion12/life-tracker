import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { riskLabel, riskTone } from '@/components/loans';
import { Btn, Card, Chips, Field, Notice, SectionTitle, toneColor, useTheme } from '@/components/ui';
import { addLoan, recentLenders } from '@/domain/finance';
import {
  LOAN_KINDS,
  LOAN_KIND_LABELS,
  PAYMENT_PERIODS,
  PAYMENT_PERIOD_LABELS,
  RATE_PERIODS,
  RATE_PERIOD_LABELS,
  annualizeRate,
  dailyInterest,
  doublingMonths,
  formatAnnualRate,
  formatRate,
  rateRisk,
  type LoanKind,
  type PaymentPeriod,
  type RatePeriod,
} from '@/domain/loan-accrual';
import { getSettings } from '@/domain/settings';
import { addMonthsISO, formatDateFull, isISODate, todayISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { formatMoney, parseAmountToMinor } from '@/lib/money';

/**
 * Новий кредит: джерело → дата → сума → ставка за період.
 *
 * Ставка вводиться так, як її назвав кредитор («0,5 у день»), і тут же
 * показується річний еквівалент: без цього «0,5%» і «18%» виглядають як
 * числа одного порядку, хоча різниця між ними — десятикратна.
 */
export default function NewLoanScreen() {
  const p = useTheme();
  const router = useRouter();
  const today = todayISO();

  const { data: refs } = useAsyncData(async () => {
    const [settings, lenders] = await Promise.all([getSettings(), recentLenders(6)]);
    return { settings, lenders };
  }, []);

  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [ratePeriod, setRatePeriod] = useState<RatePeriod>('month');
  const [kind, setKind] = useState<LoanKind>('annuity');
  const [startDate, setStartDate] = useState(today);
  const [paymentPeriod, setPaymentPeriod] = useState<PaymentPeriod>('month');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [term, setTerm] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currency = refs?.settings.baseCurrency ?? 'UAH';
  const principalMinor = parseAmountToMinor(principal) ?? 0;
  const rateNumber = Number(rate.replace(',', '.'));
  const hasRate = rate.trim() !== '' && Number.isFinite(rateNumber) && rateNumber >= 0;
  const annualRate = hasRate ? annualizeRate(rateNumber, ratePeriod) : 0;

  const preview = useMemo(() => {
    if (!hasRate || principalMinor <= 0) return null;
    const risk = rateRisk(annualRate);
    return {
      risk,
      perDay: dailyInterest(principalMinor, annualRate),
      perMonth: Math.round((principalMinor * annualRate) / 100 / 12),
      doubling: doublingMonths(annualRate),
      totalInterestYear: Math.round((principalMinor * annualRate) / 100),
    };
  }, [hasRate, annualRate, principalMinor]);

  const datePresets = useMemo(
    () => [
      { label: 'Сьогодні', value: today },
      { label: '−1 міс', value: addMonthsISO(today, -1) },
      { label: '−3 міс', value: addMonthsISO(today, -3) },
      { label: '−1 рік', value: addMonthsISO(today, -12) },
    ],
    [today],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const paymentMinor = paymentAmount.trim() ? parseAmountToMinor(paymentAmount) : null;
      const termMonths = term.trim() ? Math.round(Number(term.replace(',', '.'))) : null;

      const id = await addLoan({
        name,
        lender: lender || null,
        kind,
        principalMinor,
        currency,
        rateValue: rateNumber,
        ratePeriod,
        startDate,
        paymentPeriod,
        paymentAmountMinor: paymentMinor && paymentMinor > 0 ? paymentMinor : null,
        termMonths: termMonths && termMonths > 0 ? termMonths : null,
        note: note || null,
      });
      router.replace(`/loan/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Новий кредит',
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={{ color: p.accent, fontSize: 16, fontWeight: '600' }}>Скасувати</Text>
            </Pressable>
          ),
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
          <Card>
            <SectionTitle>Що за кредит</SectionTitle>
            <Field
              label="Назва або призначення"
              value={name}
              onChangeText={setName}
              placeholder="Розстрочка на телефон, позика до зарплати…"
              autoFocus
            />
            <Field
              label="Джерело кредиту"
              value={lender}
              onChangeText={setLender}
              placeholder="ПриватБанк, МФО, магазин, знайомий…"
            />
            {(refs?.lenders.length ?? 0) > 0 ? (
              <Chips
                options={(refs?.lenders ?? []).map((l) => ({ value: l, label: l }))}
                value={lender}
                onChange={setLender}
              />
            ) : null}
            <Field
              label="Сума, яку взяли"
              value={principal}
              onChangeText={setPrincipal}
              placeholder="0"
              keyboardType="decimal-pad"
              suffix={currency}
            />
            <Text style={{ color: p.muted, fontSize: 12 }}>Тип</Text>
            <Chips
              options={LOAN_KINDS.map((k) => ({ value: k, label: LOAN_KIND_LABELS[k] }))}
              value={kind}
              onChange={setKind}
            />
          </Card>

          <Card>
            <SectionTitle>Ставка</SectionTitle>
            <Field
              label="Ставка — так, як її назвали"
              value={rate}
              onChangeText={setRate}
              placeholder="0,5 або 2 або 18"
              keyboardType="decimal-pad"
              suffix="%"
            />
            <Chips
              options={RATE_PERIODS.map((r) => ({ value: r, label: RATE_PERIOD_LABELS[r] }))}
              value={ratePeriod}
              onChange={setRatePeriod}
            />

            {preview ? (
              <View style={{ gap: 4 }}>
                <Text style={{ color: toneColor(p, riskTone(preview.risk)), fontSize: 14, fontWeight: '700' }}>
                  {formatRate(rateNumber, ratePeriod)} = {formatAnnualRate(annualRate)} ·{' '}
                  {riskLabel(preview.risk)}
                </Text>
                <Text style={{ color: p.muted, fontSize: 12 }}>
                  На {formatMoney(principalMinor, currency)} це {formatMoney(preview.perDay, currency)} на день
                  і {formatMoney(preview.perMonth, currency)} на місяць. За рік набігло б{' '}
                  {formatMoney(preview.totalInterestYear, currency)} процентів, якби не платити нічого.
                </Text>
                {preview.doubling ? (
                  <Text style={{ color: p.warning, fontSize: 12 }}>
                    За такого темпу борг подвоюється приблизно за{' '}
                    {preview.doubling < 2
                      ? `${Math.round(preview.doubling * 30)} днів`
                      : `${Math.round(preview.doubling)} міс.`}
                  </Text>
                ) : null}
                {preview.risk === 'critical' ? (
                  <Notice
                    tone="danger"
                    text="Ставка понад 100% річних: проценти ростуть швидше, ніж борг гаситься. Такий кредит варто закривати першим."
                  />
                ) : null}
              </View>
            ) : (
              <Text style={{ color: p.muted, fontSize: 12 }}>
                Введи ставку й суму — покажу, у скільки це обходиться на день, на місяць і за рік.
              </Text>
            )}
          </Card>

          <Card>
            <SectionTitle>Коли взяли і як платити</SectionTitle>
            <Field
              label="Дата видачі"
              value={startDate}
              onChangeText={setStartDate}
              placeholder="РРРР-ММ-ДД"
              suffix="дата"
            />
            <Chips
              options={datePresets.map((d) => ({ value: d.value, label: d.label }))}
              value={startDate}
              onChange={setStartDate}
            />
            <Text style={{ color: p.muted, fontSize: 12 }}>
              {isISODate(startDate)
                ? formatDateFull(startDate)
                : 'Дата має бути у форматі РРРР-ММ-ДД, наприклад 2026-09-21'}
            </Text>

            <Text style={{ color: p.muted, fontSize: 12 }}>Період платежів за домовленістю</Text>
            <Chips
              options={PAYMENT_PERIODS.map((v) => ({ value: v, label: PAYMENT_PERIOD_LABELS[v] }))}
              value={paymentPeriod}
              onChange={setPaymentPeriod}
            />
            <Field
              label="Платіж за домовленістю (необов'язково)"
              value={paymentAmount}
              onChangeText={setPaymentAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              suffix={currency}
            />
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Якщо вказати платіж — застосунок рахуватиме прострочення і покаже, за скільки
              місяців кредит закриється за такого темпу. Без нього проценти все одно набігають,
              просто графіка немає.
            </Text>
            <Field
              label="Строк, місяців (необов'язково)"
              value={term}
              onChangeText={setTerm}
              placeholder="12"
              keyboardType="number-pad"
              suffix="міс"
            />
            <Field
              label="Нотатка"
              value={note}
              onChangeText={setNote}
              placeholder="Номер договору, умови, застава…"
              multiline
            />
          </Card>

          {error ? <Notice tone="danger" text={error} /> : null}

          <Btn title="Зберегти кредит" onPress={() => void save()} loading={saving} />

          <Text style={{ color: p.muted, fontSize: 12, textAlign: 'center' }}>
            Проценти нараховуються щодня на залишок тіла (база 360 днів) і оновлюються самі —
            вести їх вручну не потрібно. Погашення вносяться на картці кредиту.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
