/**
 * Файлові операції бекапу: запис у кеш застосунку, системне поширення,
 * вибір файлу для імпорту.
 *
 * Уся логіка даних — у `backup-core.ts`; цей модуль лише з'єднує її з
 * файловою системою та діалогами ОС.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { sqlite } from '@/db/client';
import { todayISO } from '@/lib/dates';
import {
  buildBackup as coreBuildBackup,
  buildCsv,
  dataCounts as coreDataCounts,
  importBackup as coreImportBackup,
  parseBackup,
  wipeData as coreWipeData,
  type BackupPayload,
} from './backup-core';

export interface WrittenFile {
  uri: string;
  name: string;
  size: number;
}

/**
 * Запис у кеш застосунку.
 *
 * `create()` кидає помилку, якщо файл уже існує, тому спочатку видаляємо —
 * інакше другий експорт за день завершився б помилкою.
 */
function writeCacheFile(name: string, content: string): WrittenFile {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return { uri: file.uri, name: file.name, size: content.length };
}

export function exportBackupJson(appVersion = '0.1.0'): WrittenFile {
  const payload = coreBuildBackup(sqlite, appVersion);
  const json = JSON.stringify(payload, null, 2);
  return writeCacheFile(`life-tracker-backup-${todayISO()}.json`, json);
}

export function exportCsv(exportId: string): WrittenFile {
  const { filename, content } = buildCsv(sqlite, exportId);
  return writeCacheFile(filename, content);
}

export async function shareFile(file: WrittenFile, dialogTitle = 'Зберегти файл'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Системне поширення недоступне на цьому пристрої');
  }
  const isCsv = file.name.endsWith('.csv');
  await Sharing.shareAsync(file.uri, {
    mimeType: isCsv ? 'text/csv' : 'application/json',
    dialogTitle,
    UTI: isCsv ? 'public.comma-separated-values-text' : 'public.json',
  });
}

export interface PickedImport {
  payload: BackupPayload;
  filename: string;
  size: number;
}

/** Вибір файлу бекапу через системний діалог і його розбір. */
export async function pickBackupFile(): Promise<PickedImport | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0]!;
  const file = new File(asset.uri);
  const text = file.textSync();

  return {
    payload: parseBackup(text),
    filename: asset.name ?? file.name,
    size: asset.size ?? text.length,
  };
}

// Зручні обгортки: екрани працюють із застосунковою базою і не мусять
// передавати з'єднання в кожен виклик. Тим часом ядро (`backup-core.ts`)
// залишається чистим і приймає будь-який `RawDb`.
export const dataCounts = () => coreDataCounts(sqlite);
export const wipeData = () => coreWipeData(sqlite);
export const importBackup = (payload: BackupPayload) => coreImportBackup(sqlite, payload);
export const buildBackupPayload = (appVersion = '0.1.0') => coreBuildBackup(sqlite, appVersion);

export {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  CSV_EXPORTS,
  csvCell,
  parseBackup,
  toCsv,
  type BackupPayload,
  type CsvExport,
  type DataCounts,
  type ImportReport,
  type ImportTableStat,
} from './backup-core';
