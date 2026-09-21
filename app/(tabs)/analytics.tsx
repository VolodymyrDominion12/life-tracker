import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  BarChart,
  BarRow,
  Card,
  Divider,
  Empty,
  Row,
  Screen,
  SectionTitle,
  StatTile,
  useTheme,
} from '@/components/ui';
import {
  averageDailySpend,
  expenseTrend,
  insights,
  kcalTrend,
  monthlyDashboard,
} from '@/domain/analytics';
import { debtLoadRatio, loanBalances } from '@/domain/finance';
import { workoutStatsByKind, WORKOUT_KIND_LABELS, type WorkoutKind } from '@/domain/fitness';
import { getSettings } from '@/domain/settings';
import { studyStatsBySubject } from '@/domain/study';
import { addMonthsToMonthKey, formatDateShort, formatMonthKeyHuman, humanMinutes, monthKey, monthEndISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { formatMoney, formatMoneyShort, formatPercent } from '@/lib/money';

export default function AnalyticsScreen() {
  const p = useTheme();
  const [month, setMonth] = useState(monthKey());

  const { data } = useAsyncData(async () => {
    const from = `${month}-01`;
    const to = monthEndISO(from);

    const [
      settings,
      dashboard,
      debtRatio,
      loans,
      workoutKinds,
      subjects,
      spendTrend,
      kcal,
      dailyAverage,
      found,
    ] = await Promise.all([
      getSettings(),
      monthlyDashboard(month),
      debtLoadRatio(month),
      loanBalances(),
      workoutStatsByKind(from, to),
      studyStatsBySubject(from, to),
      expenseTrend(30),
      kcalTrend(30),
      averageDailySpend(30),
      insights(60),
    ]);

    return {
      settings,
      dashboard,
      debtRatio,
      loans,
      workoutKinds,
      subjects,
      spendTrend,
      kcal,
      dailyAverage,
      insights: found,
    };
  }, [month]);

  const currency = data?.settings.baseCurrency ?? 'UAH';
  const d = data?.dashboard;

  const maxCategory = Math.max(1, ...(d?.expenseByCategory.map((c) => c.spent_base) ?? [1]));
  const maxSource = Math.max(1, ...(d?.incomeBySource.map((s) => s.income_base) ?? [1]));
  const hasFinanceData = (d?.income_base ?? 0) > 0 || (d?.expense_base ?? 0) > 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => setMonth(addMonthsToMonthKey(month, -1))} hitSlop={12}>
          <Text style={{ color: p.accent, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Text style={{ color: p.text, fontSize: 17, fontWeight: '700' }}>
          {formatMonthKeyHuman(month)}
        </Text>
        <Pressable onPress={() => setMonth(addMonthsToMonthKey(month, 1))} hitSlop={12}>
          <Text style={{ color: p.accent, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>

      <Card>
        <SectionTitle>Фінанси за місяць</SectionTitle>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile
            label="Дохід"
            value={formatMoneyShort(d?.income_base ?? 0, currency)}
            tone="success"
          />
          <StatTile
            label="Витрати"
            value={formatMoneyShort(d?.expense_base ?? 0, currency)}
            tone="danger"
          />
        </View>
        <Divider />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile
            label="Залишилось"
            value={formatMoneyShort(d?.net_base ?? 0, currency)}
            tone={(d?.net_base ?? 0) >= 0 ? 'success' : 'danger'}
          />
          <StatTile
            label="Норма заощаджень"
            value={formatPercent(d?.savingsRate ?? 0)}
            hint="частка доходу, що не витрачена"
          />
          <StatTile
            label="Боргове навантаження"
            value={formatPercent(data?.debtRatio ?? 0)}
            hint="платежі / дохід"
            tone={(data?.debtRatio ?? 0) > 30 ? 'warning' : 'default'}
          />
        </View>
        {!hasFinanceData ? (
          <Text style={{ color: p.muted, fontSize: 12 }}>
            За цей місяць операцій немає — обери інший місяць або додай записи.
          </Text>
        ) : (
          <Text style={{ color: p.muted, fontSize: 12 }}>
            Середні витрати за останні 30 днів: {formatMoney(data?.dailyAverage ?? 0, currency)} на день
          </Text>
        )}
      </Card>

      <Card>
        <SectionTitle>Витрати за 30 днів</SectionTitle>
        <BarChart
          data={(data?.spendTrend ?? []).map((t) => ({
            label: formatDateShort(t.date),
            value: t.value,
          }))}
          formatValue={(v) => formatMoneyShort(v, currency)}
        />
      </Card>

      <Card>
        <SectionTitle>Куди йдуть гроші</SectionTitle>
        {(d?.expenseByCategory.length ?? 0) === 0 ? (
          <Empty title="Немає витрат за цей місяць" />
        ) : (
          d?.expenseByCategory.map((c) => (
            <BarRow
              key={c.category}
              label={c.category}
              value={c.spent_base}
              max={maxCategory}
              caption={`${formatMoney(c.spent_base, currency)} · ${formatPercent(c.share)}`}
              tone="danger"
            />
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Джерела доходу</SectionTitle>
        {(d?.incomeBySource.length ?? 0) === 0 ? (
          <Empty title="Немає доходів за цей місяць" />
        ) : (
          d?.incomeBySource.map((s) => (
            <BarRow
              key={s.source}
              label={s.source}
              value={s.income_base}
              max={maxSource}
              caption={`${formatMoney(s.income_base, currency)} · ${formatPercent(s.share)}`}
              tone="success"
            />
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Калорії за 30 днів</SectionTitle>
        <BarChart data={(data?.kcal ?? []).map((t) => ({ label: formatDateShort(t.date), value: t.value }))} />
        <Text style={{ color: p.muted, fontSize: 12 }}>
          Середньо {d?.avgKcalIn ?? 0} ккал з їжі та {d?.avgKcalOut ?? 0} ккал спалено у дні з записами.
        </Text>
      </Card>

      <Card>
        <SectionTitle>Спорт за місяць</SectionTitle>
        <StatTile label="Усього" value={humanMinutes(d?.workoutMinutes ?? 0)} />
        {(data?.workoutKinds.length ?? 0) === 0 ? (
          <Empty title="Тренувань за цей місяць немає" />
        ) : (
          data?.workoutKinds.map((w) => (
            <Row
              key={w.kind}
              left={WORKOUT_KIND_LABELS[w.kind as WorkoutKind] ?? w.kind}
              sub={`${w.sessions} тренувань${w.avg_rpe ? ` · середній RPE ${w.avg_rpe.toFixed(1)}` : ''}`}
              right={humanMinutes(w.minutes)}
            />
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Навчання за місяць</SectionTitle>
        <StatTile label="Усього" value={humanMinutes(d?.studyMinutes ?? 0)} />
        {(data?.subjects.length ?? 0) === 0 ? (
          <Empty title="Сесій навчання за цей місяць немає" />
        ) : (
          data?.subjects.map((s) => (
            <Row
              key={s.subject}
              left={s.subject}
              sub={`${s.sessions} сесій${s.avg_focus ? ` · середня залученість ${s.avg_focus.toFixed(1)}/5` : ''}`}
              right={humanMinutes(s.minutes)}
            />
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Кредити</SectionTitle>
        {(data?.loans.length ?? 0) === 0 ? (
          <Empty title="Кредитів немає" hint="Додати кредит можна буде в наступній ітерації" />
        ) : (
          data?.loans.map((l) => (
            <View key={l.loan_id}>
              <Row
                left={l.loan}
                sub={`Сплачено тіла ${formatMoney(l.principal_paid, l.currency)} · процентів ${formatMoney(l.interest_paid, l.currency)}`}
                right={formatMoney(l.balance, l.currency)}
              />
              <BarRow
                label="Залишок боргу"
                value={l.balance}
                max={Math.max(1, l.principal)}
                caption={`з ${formatMoney(l.principal, l.currency)}`}
                tone="warning"
              />
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>Зв’язки між показниками</SectionTitle>
        {(data?.insights.length ?? 0) === 0 ? (
          <Empty
            title="Поки що замало даних"
            hint="Потрібно приблизно 2–3 тижні регулярних записів, щоб було що порівнювати"
          />
        ) : (
          data?.insights.map((i) => (
            <View key={i.id} style={{ gap: 3 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: '600' }}>{i.title}</Text>
              <Text style={{ color: p.muted, fontSize: 12 }}>{i.detail}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
