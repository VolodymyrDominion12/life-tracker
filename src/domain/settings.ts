import { db, sqlAll } from '@/db/client';
import * as Q from '@/db/queries';
import { settings } from '@/db/schema';

/**
 * Налаштування застосунку (таблиця key/value).
 *
 * Читання — один запит на весь набір: налаштувань мало, і вони потрібні
 * майже на кожному екрані, тому дешевше прочитати всі одразу, ніж робити
 * окремий запит на кожен ключ.
 */
export interface AppSettings {
  baseCurrency: string;
  kcalTarget: number;
  workoutTargetMin: number;
  studyTargetMin: number;
  weekStartsOn: number;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseCurrency: 'UAH',
  kcalTarget: 2200,
  workoutTargetMin: 180,
  studyTargetMin: 600,
  weekStartsOn: 1,
  onboarded: false,
};

const SETTING_KEYS = {
  baseCurrency: 'base_currency',
  kcalTarget: 'kcal_target',
  workoutTargetMin: 'workout_target_min',
  studyTargetMin: 'study_target_min',
  weekStartsOn: 'week_starts_on',
  onboarded: 'onboarded',
} as const;

export type SettingName = keyof typeof SETTING_KEYS;

export async function getSettings(): Promise<AppSettings> {
  const rows = sqlAll<{ key: string; value: string }>(Q.SETTINGS_ALL);
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const num = (key: string, fallback: number): number => {
    const raw = map.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    baseCurrency: map.get(SETTING_KEYS.baseCurrency) ?? DEFAULT_SETTINGS.baseCurrency,
    kcalTarget: num(SETTING_KEYS.kcalTarget, DEFAULT_SETTINGS.kcalTarget),
    workoutTargetMin: num(SETTING_KEYS.workoutTargetMin, DEFAULT_SETTINGS.workoutTargetMin),
    studyTargetMin: num(SETTING_KEYS.studyTargetMin, DEFAULT_SETTINGS.studyTargetMin),
    weekStartsOn: num(SETTING_KEYS.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn),
    onboarded: map.get(SETTING_KEYS.onboarded) === '1',
  };
}

export async function setSetting(name: SettingName, value: string | number | boolean): Promise<void> {
  const key = SETTING_KEYS[name];
  const raw = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);

  await db
    .insert(settings)
    .values({ key, value: raw })
    .onConflictDoUpdate({ target: settings.key, set: { value: raw } });
}

/** Курс валюти до базової. Невідома валюта вважається рівною базовій. */
export function getFxRate(currency: string, baseCurrency: string): number {
  if (currency === baseCurrency) return 1;
  const row = sqlAll<{ rate_to_base: number }>(Q.CURRENCY_RATE, [currency])[0];
  return row?.rate_to_base && row.rate_to_base > 0 ? row.rate_to_base : 1;
}
