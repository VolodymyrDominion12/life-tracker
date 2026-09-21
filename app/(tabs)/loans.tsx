import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Pill, RateBadge, riskLabel, riskTone } from '@/components/loans';
import {
  Btn,
  Card,
  Chips,
  Divider,
  Empty,
  Notice,
  Screen,
  SectionTitle,
  Segmented,
  StatTile,
  toneColor,
  useTheme,
} from '@/components/ui';
import { loanStates } from '@/domain/finance';
import {
  LOAN_KIND_LABELS,
  LOAN_SORT_LABELS,
  LOAN_SORT_MODES,
  portfolioSummary,
  rateRisk,
  sortLoanStates,
  worstRanking,
  type LoanSortMode,
} from '@/domain/loan-accrual';
import { getSettings } from '@/domain/settings';
import { formatDateHuman, todayISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { formatMoney, formatPercent } from '@/lib/money';

type Scope = 'active' | 'closed' | 'all';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'active', label: 'Активні' },
  { value: 'closed', label: 'Закриті' },
  { value: 'all', label: 'Усі' },
];

/**
 * Список кредитів.
 *
 * Головне тут — сортування «найдорожчі першими»: воно відповідає на єдине
 * практичне питання, яке виникає, коли кредитів кілька — куди кидати гроші
 * в першу чергу. Другорядні режими (за боргом, за простроченням) лишились,
 * бо відповідають на інші питання: «скільки всього винен» і «де горить».
 */
export default function LoansScreen() {
  const p = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('active');
  const [sort, setSort] = useState<LoanSortMode>('worst');

  const { data } = useAsyncData(async () => {
    const [settings, rows] = await Promise.all([getSettings(), loanStates()]);
    return { settings, rows };
  }, []);

  const currency = data?.settings.baseCurrency ?? 'UAH';
  const rows = data?.rows ?? [];

  const visible = useMemo(
    () =>
      rows.filter((r) =>
        scope === 'all' ? true : scope === 'active' ? !r.isClosed : r.isClosed,
      ),
    [rows, scope],
  );
  const sorted = useMemo(() => sortLoanStates(visible, sort), [visible, sort]);
  const ranks = useMemo(() => worstRanking(rows), [rows]);
  const summary = useMemo(() => portfolioSummary(rows.map((r) => r.state)), [rows]);
  const worst = useMemo(() => sortLoanStates(rows.filter((r) => !r.isClosed), 'worst')[0] ?? null, [rows]);

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Card>
          <SectionTitle>Загальний борг</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile
              label="Тіло"
              value={formatMoney(summary.debt, currency)}
              hint={`${summary.activeCount} активн.`}
            />
            <StatTile
              label="Набігло процентів"
              value={formatMoney(summary.accrued, currency)}
              tone={summary.accrued > 0 ? 'warning' : 'default'}
            />
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile
              label="Коштує щодня"
              value={formatMoney(summary.dailyInterest, currency)}
              tone={summary.dailyInterest > 0 ? 'danger' : 'default'}
            />
            <StatTile
              label="Середня ставка"
              value={summary.weightedAnnualRate > 0 ? formatPercent(summary.weightedAnnualRate, 1) : '—'}
              hint="зважена на борг, річних"
            />
          </View>
          {summary.overdueCount > 0 ? (
            <Notice
              tone="danger"
              text={`Прострочено платежів у ${summary.overdueCount} кредит(ах) — вони вгорі у сортуванні «Прострочення».`}
            />
          ) : null}
          {worst ? (
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Найдорожчий зараз: {worst.name} — {formatPercent(worst.annualRate, 1)} річних,{' '}
              {formatMoney(worst.state.dailyInterest, currency)} на день.
            </Text>
          ) : null}
          <Btn title="＋ Додати кредит" onPress={() => router.push('/loan/new')} />
        </Card>

        <Card>
          <SectionTitle>Сортування</SectionTitle>
          <Chips
            options={LOAN_SORT_MODES.map((mode) => ({ value: mode, label: LOAN_SORT_LABELS[mode] }))}
            value={sort}
            onChange={setSort}
          />
          <Text style={{ color: p.muted, fontSize: 12 }}>
            «Найдорожчі» — за річною ставкою: туди й варто спрямовувати дострокові платежі.
            Закриті кредити завжди внизу списку.
          </Text>
          <Segmented options={SCOPES} value={scope} onChange={setScope} />
        </Card>

        {sorted.length === 0 ? (
          <Card>
            <Empty
              title={rows.length === 0 ? 'Кредитів немає' : 'Тут порожньо'}
              hint={
                rows.length === 0
                  ? 'Вкажи джерело (банк, МФО, магазин), дату, суму й ставку — далі проценти рахуються самі'
                  : 'У цьому фільтрі немає кредитів — перемкни на «Усі»'
              }
            />
          </Card>
        ) : (
          sorted.map((row) => {
            const risk = rateRisk(row.annualRate);
            const rank = ranks[row.id];
            return (
              <Pressable
                key={row.id}
                onPress={() => router.push(`/loan/${row.id}`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Card>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {rank === 1 ? <Pill text="🔥 найдорожчий" tone="danger" /> : null}
                        {rank && rank > 1 ? <Pill text={`№${rank} за ціною`} /> : null}
                        {row.isClosed ? <Pill text="закрито" tone="success" /> : null}
                        {row.state.overdueDays > 0 ? (
                          <Pill text={`прострочено ${row.state.overdueDays} дн.`} tone="danger" />
                        ) : null}
                      </View>
                      <Text style={{ color: p.text, fontSize: 16, fontWeight: '700' }}>
                        {row.name}
                      </Text>
                      <Text style={{ color: p.muted, fontSize: 12 }}>
                        {row.loan.lender ?? 'джерело не вказано'} ·{' '}
                        {row.loan.kind ? LOAN_KIND_LABELS[row.loan.kind] : 'кредит'} · з{' '}
                        {formatDateHuman(row.startDate)}
                      </Text>
                    </View>
                    <RateBadge
                      value={row.rateValue}
                      period={row.ratePeriod}
                      annualRate={row.annualRate}
                    />
                  </View>

                  <Divider />

                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <StatTile label="Залишок тіла" value={formatMoney(row.state.balance, currency)} />
                    <StatTile
                      label="Набігло"
                      value={formatMoney(row.state.accruedInterest, currency)}
                      tone={row.state.accruedInterest > 0 ? 'warning' : 'default'}
                    />
                    <StatTile
                      label="Всього до сплати"
                      value={formatMoney(row.state.totalOwed, currency)}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: toneColor(p, riskTone(risk)), fontSize: 12 }}>
                      {`+${formatMoney(row.state.dailyInterest, currency)} на день · ${riskLabel(risk)}`}
                    </Text>
                    {!row.isClosed && row.state.nextPaymentDate ? (
                      <Text style={{ color: p.muted, fontSize: 12 }}>
                        платіж до {formatDateHuman(row.state.nextPaymentDate)}
                      </Text>
                    ) : null}
                  </View>

                  {row.state.paidTotal > 0 ? (
                    <Text style={{ color: p.muted, fontSize: 12 }}>
                      Сплачено всього {formatMoney(row.state.paidTotal, currency)}: проценти{' '}
                      {formatMoney(row.state.paidInterest, currency)}, тіло{' '}
                      {formatMoney(row.state.paidPrincipal, currency)}
                    </Text>
                  ) : (
                    <Text style={{ color: p.warning, fontSize: 12 }}>
                      Погашень ще не було — проценти набігають від дати видачі.
                    </Text>
                  )}
                </Card>
              </Pressable>
            );
          })
        )}

        <Text style={{ color: p.muted, fontSize: 12, textAlign: 'center' }}>
          Проценти рахуються щодня на залишок тіла (база 360 днів) і оновлюються
          автоматично — на {formatDateHuman(todayISO())}.
        </Text>
      </Screen>
    </View>
  );
}
