/**
 * Дрібні компоненти, потрібні лише кредитам.
 *
 * Винесено окремо, бо ставка й ризик показуються і в списку, і в картці
 * кредиту, і у формі — а розбіжність у кольорі чи підписі між цими місцями
 * читається як різні цифри. Один компонент — один підпис.
 */
import React from 'react';
import { Text, View } from 'react-native';

import { toneColor, useTheme, type Tone } from '@/components/ui';
import {
  formatAnnualRate,
  formatRate,
  rateRisk,
  type RatePeriod,
  type RateRisk,
} from '@/domain/loan-accrual';

export function riskTone(risk: RateRisk): Tone {
  switch (risk) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'accent';
    default:
      return 'success';
  }
}

export function riskLabel(risk: RateRisk): string {
  switch (risk) {
    case 'critical':
      return 'дуже дорого';
    case 'high':
      return 'дорого';
    case 'medium':
      return 'помірно';
    default:
      return 'недорого';
  }
}

/**
 * Ставка так, як її назвали, і поруч річна — щоб «0,5% у день» не виглядало
 * дешевшим за «18% річних». Колір визначає саме річна ставка.
 */
export function RateBadge({
  value,
  period,
  annualRate,
}: {
  value: number;
  period: RatePeriod;
  annualRate: number;
}) {
  const p = useTheme();
  const color = toneColor(p, riskTone(rateRisk(annualRate)));
  return (
    <View style={{ alignItems: 'flex-end', gap: 2 }}>
      <Text style={{ color, fontSize: 15, fontWeight: '700' }}>
        {formatRate(value, period)}
      </Text>
      <Text style={{ color: p.muted, fontSize: 11 }}>{formatAnnualRate(annualRate)}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'default' }: { text: string; tone?: Tone }) {
  const p = useTheme();
  const color = toneColor(p, tone);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
