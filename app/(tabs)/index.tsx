import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  Card,
  Divider,
  Empty,
  ProgressBar,
  Row,
  Screen,
  SectionTitle,
  StatTile,
  useTheme,
} from '@/components/ui';
import { currentStreak, weekMinutes as workoutWeekMinutes } from '@/domain/fitness';
import { listRecentTransactions } from '@/domain/finance';
import { dailySummary } from '@/domain/analytics';
import { getSettings } from '@/domain/settings';
import { weekMinutes as studyWeekMinutes } from '@/domain/study';
import { formatDateFull, humanMinutes, todayISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { formatMoney, percent } from '@/lib/money';

export default function TodayScreen() {
  const p = useTheme();
  const router = useRouter();

  const { data } = useAsyncData(async () => {
    const settings = await getSettings();
    const summary = await dailySummary(todayISO());
    const streak = await currentStreak();
    const workoutWeek = await workoutWeekMinutes();
    const studyWeek = await studyWeekMinutes();
    const recent = await listRecentTransactions(6);
    return { settings, summary, streak, workoutWeek, studyWeek, recent };
  }, []);

  const summary = data?.summary;
  const settings = data?.settings;

  const kcalTone =
    !summary || !settings
      ? 'default'
      : summary.kcal_in > settings.kcalTarget
        ? 'danger'
        : summary.kcal_in > settings.kcalTarget * 0.9
          ? 'warning'
          : 'success';

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text style={{ color: p.muted, fontSize: 13 }}>{formatDateFull(todayISO())}</Text>

        <Card>
          <SectionTitle>Гроші сьогодні</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile
              label="Витрати"
              value={formatMoney(summary?.spent_base ?? 0, settings?.baseCurrency)}
              tone={(summary?.spent_base ?? 0) > 0 ? 'danger' : 'default'}
            />
            <StatTile
              label="Дохід"
              value={formatMoney(summary?.earned_base ?? 0, settings?.baseCurrency)}
              tone={(summary?.earned_base ?? 0) > 0 ? 'success' : 'default'}
            />
          </View>
        </Card>

        <Card>
          <SectionTitle>Енергія</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile
              label="Ккал з їжі"
              value={String(summary?.kcal_in ?? 0)}
              hint={`ціль ${settings?.kcalTarget ?? 0}`}
              tone={kcalTone}
            />
            <StatTile label="Ккал спалено" value={String(summary?.kcal_out ?? 0)} />
            <StatTile
              label="Баланс"
              value={String(summary?.kcal_net ?? 0)}
              hint="їжа мінус тренування"
            />
          </View>
          <ProgressBar
            value={summary?.kcal_in ?? 0}
            max={settings?.kcalTarget ?? 1}
            tone={kcalTone}
          />
          {(summary?.meals ?? 0) === 0 ? (
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Записів про їжу за сьогодні ще немає
            </Text>
          ) : (
            <Text style={{ color: p.muted, fontSize: 12 }}>
              {summary?.meals} запис(ів) · {Math.round(percent(summary?.kcal_in ?? 0, settings?.kcalTarget ?? 1))}% цілі
            </Text>
          )}
        </Card>

        <Card>
          <SectionTitle>Спорт і навчання</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile
              label="Спорт сьогодні"
              value={humanMinutes(summary?.workout_min ?? 0)}
            />
            <StatTile
              label="Серія"
              value={`${data?.streak ?? 0} дн.`}
              hint="днів поспіль"
              tone={(data?.streak ?? 0) > 0 ? 'success' : 'default'}
            />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Тиждень: спорт {humanMinutes(data?.workoutWeek ?? 0)} із{' '}
              {humanMinutes(settings?.workoutTargetMin ?? 0)}
            </Text>
            <ProgressBar
              value={data?.workoutWeek ?? 0}
              max={settings?.workoutTargetMin ?? 1}
              tone={(data?.workoutWeek ?? 0) >= (settings?.workoutTargetMin ?? 0) ? 'success' : 'accent'}
            />
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatTile label="Навчання сьогодні" value={humanMinutes(summary?.study_min ?? 0)} />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Тиждень: навчання {humanMinutes(data?.studyWeek ?? 0)} із{' '}
              {humanMinutes(settings?.studyTargetMin ?? 0)}
            </Text>
            <ProgressBar
              value={data?.studyWeek ?? 0}
              max={settings?.studyTargetMin ?? 1}
              tone={(data?.studyWeek ?? 0) >= (settings?.studyTargetMin ?? 0) ? 'success' : 'accent'}
            />
          </View>
        </Card>

        <Card>
          <SectionTitle
            right={
              <Pressable onPress={() => router.push('/analytics')}>
                <Text style={{ color: p.accent, fontSize: 13 }}>Аналітика →</Text>
              </Pressable>
            }
          >
            Останні операції
          </SectionTitle>
          {(data?.recent.length ?? 0) === 0 ? (
            <Empty
              title="Порожньо"
              hint="Натисни «+», щоб додати першу витрату — це займе кілька секунд"
            />
          ) : (
            data?.recent.map((t, i) => (
              <View key={t.id}>
                {i > 0 ? <Divider /> : null}
                <Row
                  left={`${t.category_icon ?? '•'}  ${t.category_name ?? (t.kind === 'income' ? 'Дохід' : 'Без категорії')}`}
                  sub={`${t.date}${t.payee ? ` · ${t.payee}` : ''} · ${t.account_name ?? '—'}`}
                  right={`${t.kind === 'income' ? '+' : '−'}${formatMoney(t.amount_base, settings?.baseCurrency)}`}
                />
              </View>
            ))
          )}
        </Card>

        <Card>
          <SectionTitle>Підказка</SectionTitle>
          <Text style={{ color: p.muted, fontSize: 13 }}>
            Кнопка «+» відкриває швидкий ввід: сума, категорія, зберегти — кілька секунд.
            Екран не закривається після запису, тож кілька операцій підряд вносяться без
            зайвих рухів. Головний ризик будь-якого трекера — закинути його через тиждень,
            тому ввід зроблено максимально коротким.
          </Text>
        </Card>
      </Screen>

      <Pressable
        onPress={() => router.push('/quick-add')}
        style={({ pressed }) => ({
          position: 'absolute',
          right: 18,
          bottom: 24,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: p.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
        })}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 32, lineHeight: 34 }}>+</Text>
      </Pressable>
    </View>
  );
}
