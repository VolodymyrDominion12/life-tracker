import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Btn, Card, Chips, Divider, Field, Notice, Row, Screen, SectionTitle, useTheme } from '@/components/ui';
import { getSettings, setSetting, type AppSettings } from '@/domain/settings';
import {
  CSV_EXPORTS,
  dataCounts,
  exportBackupJson,
  exportCsv,
  importBackup,
  pickBackupFile,
  shareFile,
  wipeData,
  type ImportReport,
} from '@/features/backup/backup';
import { CURRENT_SCHEMA_VERSION } from '@/db/migrate';
import { storageInfo } from '@/platform/database';
import { useAsyncData } from '@/lib/hooks';

export default function SettingsScreen() {
  const p = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, reload } = useAsyncData(async () => ({
    settings: await getSettings(),
    counts: dataCounts(),
  }), []);

  const settings: AppSettings | undefined = data?.settings;

  const [draft, setDraft] = useState<Partial<Record<keyof AppSettings, string>>>({});
  const value = (key: keyof AppSettings, fallback: number | string) =>
    draft[key] ?? String(settings?.[key] ?? fallback);

  function clearMessages() {
    setMessage(null);
    setError(null);
  }

  async function withBusy(tag: string, action: () => Promise<void> | void) {
    setBusy(tag);
    clearMessages();
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    await withBusy('save', async () => {
      const numeric: [keyof AppSettings, number][] = [
        ['kcalTarget', Number(value('kcalTarget', 2200))],
        ['workoutTargetMin', Number(value('workoutTargetMin', 180))],
        ['studyTargetMin', Number(value('studyTargetMin', 600))],
      ];

      for (const [key, parsed] of numeric) {
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Некоректне значення для «${key}»`);
        }
        await setSetting(key, parsed);
      }

      setDraft({});
      setMessage('Налаштування збережено');
      await reload();
    });
  }

  function onExportJson() {
    void withBusy('export-json', async () => {
      const file = exportBackupJson();
      await shareFile(file, 'Зберегти бекап Life Tracker');
      setMessage(`Бекап готовий: ${file.name}`);
    });
  }

  function onExportCsv(id: string) {
    void withBusy(`csv-${id}`, async () => {
      const file = exportCsv(id);
      await shareFile(file, 'Зберегти CSV');
    });
  }

  function onImport() {
    void withBusy('import', async () => {
      const picked = await pickBackupFile();
      if (!picked) return;

      const rows = Object.values(picked.payload.tables).reduce(
        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
        0,
      );

      await new Promise<void>((resolve) => {
        Alert.alert(
          'Імпортувати дані?',
          `Файл: ${picked.filename}\nРядків у файлі: ${rows}\n\n` +
            'Дані буде ЗЛИТО з наявними: записи з тим самим id оновляться, ' +
            'якщо у файлі новіша дата зміни. Нічого не видаляється.',
          [
            { text: 'Скасувати', style: 'cancel', onPress: () => resolve() },
            {
              text: 'Імпортувати',
              onPress: () => {
                try {
                  setReport(importBackup(picked.payload));
                  setMessage('Імпорт завершено');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
                resolve();
              },
            },
          ],
        );
      });

      await reload();
    });
  }

  function onWipe() {
    Alert.alert(
      'Видалити всі записи?',
      'Будуть видалені транзакції, їжа, тренування, навчання та кредити. ' +
        'Рахунки, категорії й налаштування залишаться. Дію не можна відмінити.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: () => {
            void withBusy('wipe', async () => {
              wipeData();
              setReport(null);
              setMessage('Усі записи видалено');
              await reload();
            });
          },
        },
      ],
    );
  }

  return (
    <Screen>
      {message ? <Notice text={message} tone="success" /> : null}
      {error ? <Notice text={error} tone="danger" /> : null}

      <Card>
        <SectionTitle>Валюта</SectionTitle>
        <Chips
          options={[
            { value: 'UAH', label: '₴ Гривня' },
            { value: 'USD', label: '$ Долар' },
            { value: 'EUR', label: '€ Євро' },
          ]}
          value={settings?.baseCurrency ?? 'UAH'}
          onChange={(code) => {
            void withBusy('currency', async () => {
              await setSetting('baseCurrency', code);
              setMessage('Базову валюту змінено');
              await reload();
            });
          }}
        />
        <Text style={{ color: p.muted, fontSize: 12 }}>
          Суми в інших валютах перераховуються за курсом із таблиці валют (задається вручну).
        </Text>
      </Card>

      <Card>
        <SectionTitle>Цілі</SectionTitle>
        <Field
          label="Калорії на день"
          value={value('kcalTarget', 2200)}
          onChangeText={(t) => setDraft((d) => ({ ...d, kcalTarget: t }))}
          keyboardType="number-pad"
          suffix="ккал"
        />
        <Field
          label="Спорт на тиждень"
          value={value('workoutTargetMin', 180)}
          onChangeText={(t) => setDraft((d) => ({ ...d, workoutTargetMin: t }))}
          keyboardType="number-pad"
          suffix="хв"
        />
        <Field
          label="Навчання на тиждень"
          value={value('studyTargetMin', 600)}
          onChangeText={(t) => setDraft((d) => ({ ...d, studyTargetMin: t }))}
          keyboardType="number-pad"
          suffix="хв"
        />
        <Btn title="Зберегти цілі" onPress={() => void saveSettings()} loading={busy === 'save'} />
      </Card>

      <Card>
        <SectionTitle>Дані</SectionTitle>
        <Row left="Транзакції" right={String(data?.counts.transactions ?? 0)} />
        <Divider />
        <Row left="Записи про їжу" right={String(data?.counts.meals ?? 0)} />
        <Divider />
        <Row left="Тренування" right={String(data?.counts.workouts ?? 0)} />
        <Divider />
        <Row left="Сесії навчання" right={String(data?.counts.study ?? 0)} />
        <Divider />
        <Row left="Кредити" right={String(data?.counts.loans ?? 0)} />
        <Divider />
        <Row left="Версія схеми" right={String(CURRENT_SCHEMA_VERSION)} />
        <Divider />
        <Row left="Рушій" sub={storageInfo.location} right={storageInfo.engine} />
      </Card>

      <Card>
        <SectionTitle>Бекап</SectionTitle>
        <Text style={{ color: p.muted, fontSize: 12 }}>
          JSON містить усі таблиці й підходить для переносу на новий пристрій.
          Файл зберігається у кеш застосунку і далі надсилається через системне
          «Поділитися» — у Google Drive, Telegram або на пошту.
        </Text>
        <Btn
          title="Експортувати бекап (JSON)"
          onPress={onExportJson}
          loading={busy === 'export-json'}
        />
        <Btn
          title="Імпортувати бекап (JSON)"
          kind="secondary"
          onPress={onImport}
          loading={busy === 'import'}
        />

        {report ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: p.text, fontSize: 13, fontWeight: '600' }}>
              Результат імпорту
            </Text>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              Схема у файлі: {report.schemaVersion ?? '—'} · експорт:{' '}
              {report.exportedAt ? report.exportedAt.slice(0, 19).replace('T', ' ') : '—'}
            </Text>
            {report.tables
              .filter((t) => t.inserted || t.updated || t.skipped)
              .map((t) => (
                <Text key={t.table} style={{ color: p.muted, fontSize: 12 }}>
                  {t.table}: додано {t.inserted}, оновлено {t.updated}, пропущено {t.skipped}
                </Text>
              ))}
            {report.warnings.map((w) => (
              <Text key={w} style={{ color: p.warning, fontSize: 12 }}>
                {w}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>CSV для Excel і Python</SectionTitle>
        <Text style={{ color: p.muted, fontSize: 12 }}>
          Один файл — одна таблиця. Суми подано і в копійках (`_minor`), і у
          звичайних одиницях. Розділювач — кома, кодування UTF-8 з BOM.
        </Text>
        {CSV_EXPORTS.map((e) => (
          <Btn
            key={e.id}
            title={`CSV: ${e.label}`}
            kind="secondary"
            compact
            onPress={() => onExportCsv(e.id)}
            loading={busy === `csv-${e.id}`}
          />
        ))}
      </Card>

      <Card>
        <SectionTitle>Небезпечна зона</SectionTitle>
        <Btn title="Видалити всі записи" kind="danger" onPress={onWipe} loading={busy === 'wipe'} />
      </Card>

      <Text style={{ color: p.muted, fontSize: 12, textAlign: 'center' }}>
        Life Tracker 0.1.0 · дані зберігаються лише на цьому пристрої, без сервера й акаунтів
      </Text>
    </Screen>
  );
}
