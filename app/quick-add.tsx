import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Btn, Card, Chips, Field, Notice, Segmented, useTheme } from '@/components/ui';
import { addTransaction, categoryUsage, listAccounts, listCategories, listIncomeSources } from '@/domain/finance';
import { addWorkout, WORKOUT_KIND_LABELS, type WorkoutKind } from '@/domain/fitness';
import { addMeal, MEAL_TYPE_LABELS, type MealType } from '@/domain/nutrition';
import { addStudySession, STUDY_KIND_LABELS, knownSubjects, type StudyKind } from '@/domain/study';
import { getSettings } from '@/domain/settings';
import { addDaysISO, todayISO } from '@/lib/dates';
import { useAsyncData } from '@/lib/hooks';
import { parseAmountToMinor } from '@/lib/money';

type Domain = 'money' | 'food' | 'workout' | 'study';

const DOMAINS: { value: Domain; label: string }[] = [
  { value: 'money', label: '💰 Гроші' },
  { value: 'food', label: '🍎 Їжа' },
  { value: 'workout', label: '🏋️ Спорт' },
  { value: 'study', label: '📚 Навчання' },
];

/** Порядок із найуживаніших: звичні категорії мають бути під пальцем. */
function sortByUsage<T extends { id: string; sortOrder: number; name: string }>(
  items: T[],
  usage: Record<string, number>,
): T[] {
  return [...items].sort((a, b) => {
    const ua = usage[a.id] ?? 0;
    const ub = usage[b.id] ?? 0;
    if (ua !== ub) return ub - ua;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

export default function QuickAddScreen() {
  const p = useTheme();
  const router = useRouter();

  const [domain, setDomain] = useState<Domain>('money');
  const [dateMode, setDateMode] = useState<'today' | 'yesterday'>('today');
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const date = useMemo(
    () => (dateMode === 'today' ? todayISO() : addDaysISO(todayISO(), -1)),
    [dateMode],
  );

  // ── довідники ──
  const { data: refs } = useAsyncData(async () => {
    const [settings, accounts, expenseCats, incomeCats, sources, usage, subjects] =
      await Promise.all([
        getSettings(),
        listAccounts(),
        listCategories('expense'),
        listCategories('income'),
        listIncomeSources(),
        categoryUsage('expense'),
        knownSubjects(6),
      ]);
    return { settings, accounts, expenseCats, incomeCats, sources, usage, subjects };
  }, []);

  // ── стан форм ──
  const [amount, setAmount] = useState('');
  const [txKind, setTxKind] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [incomeSourceId, setIncomeSourceId] = useState<string | null>(null);
  const [payee, setPayee] = useState('');

  const [kcal, setKcal] = useState('');
  const [mealName, setMealName] = useState('');
  const [mealType, setMealType] = useState<MealType | null>(null);

  const [duration, setDuration] = useState('');
  const [workoutKind, setWorkoutKind] = useState<WorkoutKind | null>(null);
  const [workoutName, setWorkoutName] = useState('');
  const [kcalBurned, setKcalBurned] = useState('');

  const [studyDuration, setStudyDuration] = useState('');
  const [subject, setSubject] = useState('');
  const [studyKind, setStudyKind] = useState<StudyKind | null>(null);
  const [topic, setTopic] = useState('');

  const currency = refs?.settings.baseCurrency ?? 'UAH';
  const activeAccount = accountId ?? refs?.accounts[0]?.id ?? null;

  const categories = useMemo(() => {
    const list = txKind === 'expense' ? (refs?.expenseCats ?? []) : (refs?.incomeCats ?? []);
    return sortByUsage(list, refs?.usage ?? {});
  }, [refs, txKind]);

  const selectedCategoryId = categoryId ?? categories[0]?.id ?? null;

  function resetFlash() {
    setFlash(null);
    setError(null);
  }

  async function runSave(action: () => Promise<unknown>, successMessage: string) {
    setSaving(true);
    resetFlash();
    try {
      await action();
      setFlash(successMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveMoney() {
    const minor = parseAmountToMinor(amount);
    if (minor == null || minor <= 0) throw new Error('Введи суму');
    if (!activeAccount) throw new Error('Немає жодного рахунку');

    await addTransaction({
      kind: txKind,
      amountMinor: minor,
      accountId: activeAccount,
      categoryId: selectedCategoryId,
      incomeSourceId: txKind === 'income' ? incomeSourceId : null,
      date,
      payee: payee || null,
    });
    setAmount('');
    setPayee('');
  }

  async function saveFood() {
    const value = Number(kcal.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) throw new Error('Введи калорійність');

    await addMeal({ kcal: value, name: mealName || null, mealType, date });
    setKcal('');
    setMealName('');
  }

  async function saveWorkout() {
    const minutes = Number(duration.replace(',', '.'));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Введи тривалість у хвилинах');

    const burned = kcalBurned ? Number(kcalBurned.replace(',', '.')) : null;

    await addWorkout({
      durationMin: minutes,
      kind: workoutKind,
      name: workoutName || null,
      kcalBurned: burned != null && Number.isFinite(burned) ? burned : null,
      date,
    });
    setDuration('');
    setWorkoutName('');
    setKcalBurned('');
  }

  async function saveStudy() {
    const minutes = Number(studyDuration.replace(',', '.'));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Введи тривалість у хвилинах');
    if (!subject.trim()) throw new Error('Вкажи предмет або напрям');

    await addStudySession({
      durationMin: minutes,
      subject: subject.trim(),
      kind: studyKind,
      topic: topic || null,
      date,
    });
    setStudyDuration('');
    setTopic('');
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={{ color: p.accent, fontSize: 16, fontWeight: '600' }}>Готово</Text>
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
          <Segmented options={DOMAINS} value={domain} onChange={setDomain} />

          <Chips
            options={[
              { value: 'today' as const, label: 'Сьогодні' },
              { value: 'yesterday' as const, label: 'Вчора' },
            ]}
            value={dateMode}
            onChange={setDateMode}
          />

          {flash ? <Notice text={flash} tone="success" /> : null}
          {error ? <Notice text={error} tone="danger" /> : null}

          {domain === 'money' ? (
            <>
              <Card>
                <Segmented
                  options={[
                    { value: 'expense' as const, label: 'Витрата' },
                    { value: 'income' as const, label: 'Дохід' },
                  ]}
                  value={txKind}
                  onChange={(v) => {
                    setTxKind(v);
                    setCategoryId(null);
                    resetFlash();
                  }}
                />

                <Field
                  label="Сума"
                  value={amount}
                  onChangeText={(t) => {
                    setAmount(t);
                    resetFlash();
                  }}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  suffix={currency}
                  autoFocus
                />

                <Text style={{ color: p.muted, fontSize: 12 }}>
                  {txKind === 'expense' ? 'Категорія витрати' : 'Категорія доходу'}
                </Text>
                <Chips
                  options={categories.map((c) => ({
                    value: c.id,
                    label: `${c.icon ?? ''} ${c.name}`.trim(),
                  }))}
                  value={selectedCategoryId}
                  onChange={setCategoryId}
                />

                {txKind === 'income' && (refs?.sources.length ?? 0) > 0 ? (
                  <>
                    <Text style={{ color: p.muted, fontSize: 12 }}>Джерело доходу</Text>
                    <Chips
                      options={(refs?.sources ?? []).map((s) => ({ value: s.id, label: s.name }))}
                      value={incomeSourceId}
                      onChange={setIncomeSourceId}
                    />
                  </>
                ) : null}
              </Card>

              <Card>
                <Text style={{ color: p.muted, fontSize: 12 }}>Рахунок</Text>
                <Chips
                  options={(refs?.accounts ?? []).map((a) => ({
                    value: a.id,
                    label: a.name,
                    hint: a.currency,
                  }))}
                  value={activeAccount}
                  onChange={setAccountId}
                />

                <Field
                  label="Кому / за що (необов’язково)"
                  value={payee}
                  onChangeText={setPayee}
                  placeholder="Сільпо, таксі, аптека…"
                />

                <Btn
                  title={txKind === 'expense' ? 'Записати витрату' : 'Записати дохід'}
                  onPress={() => void runSave(saveMoney, `Записано: ${amount} ${currency}`)}
                  loading={saving}
                />
              </Card>
            </>
          ) : null}

          {domain === 'food' ? (
            <Card>
              <Field
                label="Калорійність"
                value={kcal}
                onChangeText={(t) => {
                  setKcal(t);
                  resetFlash();
                }}
                placeholder="0"
                keyboardType="number-pad"
                suffix="ккал"
                autoFocus
              />

              <Field
                label="Що це було (необов’язково)"
                value={mealName}
                onChangeText={setMealName}
                placeholder="Вівсянка з бананом"
              />

              <Text style={{ color: p.muted, fontSize: 12 }}>Прийом їжі</Text>
              <Chips
                options={(Object.keys(MEAL_TYPE_LABELS) as MealType[]).map((k) => ({
                  value: k,
                  label: MEAL_TYPE_LABELS[k],
                }))}
                value={mealType}
                onChange={setMealType}
              />

              <Btn
                title="Записати їжу"
                onPress={() => void runSave(saveFood, `Записано: ${kcal} ккал`)}
                loading={saving}
              />
            </Card>
          ) : null}

          {domain === 'workout' ? (
            <Card>
              <Field
                label="Тривалість"
                value={duration}
                onChangeText={(t) => {
                  setDuration(t);
                  resetFlash();
                }}
                placeholder="0"
                keyboardType="number-pad"
                suffix="хв"
                autoFocus
              />

              <Text style={{ color: p.muted, fontSize: 12 }}>Тип тренування</Text>
              <Chips
                options={(Object.keys(WORKOUT_KIND_LABELS) as WorkoutKind[]).map((k) => ({
                  value: k,
                  label: WORKOUT_KIND_LABELS[k],
                }))}
                value={workoutKind}
                onChange={setWorkoutKind}
              />

              <Field
                label="Назва (необов’язково)"
                value={workoutName}
                onChangeText={setWorkoutName}
                placeholder="Жим, біг 5 км…"
              />

              <Field
                label="Спалено ккал (необов’язково)"
                value={kcalBurned}
                onChangeText={setKcalBurned}
                placeholder="за оцінкою годинника"
                keyboardType="number-pad"
                suffix="ккал"
              />

              <Btn
                title="Записати тренування"
                onPress={() => void runSave(saveWorkout, `Записано: ${duration} хв`)}
                loading={saving}
              />
            </Card>
          ) : null}

          {domain === 'study' ? (
            <Card>
              <Field
                label="Тривалість"
                value={studyDuration}
                onChangeText={(t) => {
                  setStudyDuration(t);
                  resetFlash();
                }}
                placeholder="0"
                keyboardType="number-pad"
                suffix="хв"
                autoFocus
              />

              <Field
                label="Предмет або напрям"
                value={subject}
                onChangeText={setSubject}
                placeholder="Python, англійська, математика…"
              />

              {(refs?.subjects.length ?? 0) > 0 ? (
                <Chips
                  options={(refs?.subjects ?? []).map((s) => ({ value: s, label: s }))}
                  value={subject}
                  onChange={setSubject}
                />
              ) : null}

              <Text style={{ color: p.muted, fontSize: 12 }}>Формат</Text>
              <Chips
                options={(Object.keys(STUDY_KIND_LABELS) as StudyKind[]).map((k) => ({
                  value: k,
                  label: STUDY_KIND_LABELS[k],
                }))}
                value={studyKind}
                onChange={setStudyKind}
              />

              <Field
                label="Тема (необов’язково)"
                value={topic}
                onChangeText={setTopic}
                placeholder="Що саме розбирав"
              />

              <Btn
                title="Записати навчання"
                onPress={() => void runSave(saveStudy, `Записано: ${studyDuration} хв`)}
                loading={saving}
              />
            </Card>
          ) : null}

          <Text style={{ color: p.muted, fontSize: 12, textAlign: 'center' }}>
            Записи зберігаються локально на пристрої. Експорт і бекап — у «Налаштуваннях».
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
