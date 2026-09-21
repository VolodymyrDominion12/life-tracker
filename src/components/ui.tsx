/**
 * Мінімальна дизайн-система.
 *
 * Без сторонніх UI-бібліотек: у застосунку шість екранів, і власні
 * компоненти тут дешевші за будь-яку залежність. Кольори зібрані в одну
 * палітру з підтримкою темної теми.
 */
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type KeyboardTypeOptions,
  type ViewStyle,
} from 'react-native';

export type Tone = 'default' | 'accent' | 'success' | 'danger' | 'warning';

export interface Palette {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  success: string;
  danger: string;
  warning: string;
}

const LIGHT: Palette = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  cardAlt: '#EDEFF3',
  text: '#11151A',
  muted: '#6B7280',
  border: '#E2E5EA',
  accent: '#2F6FED',
  success: '#15803D',
  danger: '#DC2626',
  warning: '#B45309',
};

const DARK: Palette = {
  bg: '#0E1116',
  card: '#171B22',
  cardAlt: '#1F242C',
  text: '#F2F4F7',
  muted: '#98A2B3',
  border: '#272D37',
  accent: '#6C9BFF',
  success: '#4ADE80',
  danger: '#F87171',
  warning: '#FBBF24',
};

export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? DARK : LIGHT;
}

export function toneColor(p: Palette, tone: Tone): string {
  switch (tone) {
    case 'accent':
      return p.accent;
    case 'success':
      return p.success;
    case 'danger':
      return p.danger;
    case 'warning':
      return p.warning;
    default:
      return p.text;
  }
}

// ─────────────────────────── контейнери ───────────────────────────

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  const p = useTheme();
  const base: ViewStyle = { padding: 16, gap: 12 };

  if (!scroll) {
    return <View style={[{ flex: 1, backgroundColor: p.bg }, base, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.bg }}
      contentContainerStyle={[base, { paddingBottom: 48 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const p = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: p.card,
          borderRadius: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
          padding: 14,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const p = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: p.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }}>
        {String(children).toUpperCase()}
      </Text>
      {right}
    </View>
  );
}

export function Divider() {
  const p = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />;
}

// ─────────────────────────── дані ───────────────────────────

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const p = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: p.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: toneColor(p, tone), fontSize: 20, fontWeight: '700' }} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={{ color: p.muted, fontSize: 11 }}>{hint}</Text> : null}
    </View>
  );
}

export function Row({
  left,
  right,
  sub,
  onPress,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  sub?: React.ReactNode;
  onPress?: () => void;
}) {
  const p = useTheme();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 15 }} numberOfLines={1}>
          {left}
        </Text>
        {sub ? <Text style={{ color: p.muted, fontSize: 12 }}>{sub}</Text> : null}
      </View>
      {right ? (
        <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {right}
        </Text>
      ) : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export function BarRow({
  label,
  value,
  max,
  caption,
  tone = 'accent',
}: {
  label: string;
  value: number;
  max: number;
  caption?: string;
  tone?: Tone;
}) {
  const p = useTheme();
  const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: p.text, fontSize: 14 }} numberOfLines={1}>
          {label}
        </Text>
        {caption ? <Text style={{ color: p.muted, fontSize: 13 }}>{caption}</Text> : null}
      </View>
      <View style={{ height: 6, backgroundColor: p.cardAlt, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${width}%`, height: '100%', backgroundColor: toneColor(p, tone) }} />
      </View>
    </View>
  );
}

export function BarChart({
  data,
  height = 90,
  formatValue,
}: {
  data: { label: string; value: number }[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const p = useTheme();
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 3 }}>
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View
              style={{
                width: '100%',
                height: Math.max(2, (d.value / max) * (height - 14)),
                backgroundColor: d.value > 0 ? p.accent : p.cardAlt,
                borderRadius: 3,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: p.muted, fontSize: 11 }}>{data[0]?.label ?? ''}</Text>
        <Text style={{ color: p.muted, fontSize: 11 }}>
          {formatValue ? `макс ${formatValue(max)}` : `макс ${max}`}
        </Text>
        <Text style={{ color: p.muted, fontSize: 11 }}>{data[data.length - 1]?.label ?? ''}</Text>
      </View>
    </View>
  );
}

export function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: Tone }) {
  const p = useTheme();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ height: 8, backgroundColor: p.cardAlt, borderRadius: 4, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: toneColor(p, tone) }} />
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  const p = useTheme();
  return (
    <View style={{ paddingVertical: 18, alignItems: 'center', gap: 4 }}>
      <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {hint ? (
        <Text style={{ color: p.muted, fontSize: 13, textAlign: 'center' }}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────── керування ───────────────────────────

export function Btn({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  compact,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const p = useTheme();
  const bg = kind === 'primary' ? p.accent : kind === 'danger' ? p.danger : p.cardAlt;
  const fg = kind === 'secondary' ? p.text : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        paddingVertical: compact ? 8 : 13,
        paddingHorizontal: compact ? 12 : 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: compact ? 36 : 48,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '600', fontSize: compact ? 13 : 15 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  multi = false,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  multi?: boolean;
}) {
  const p = useTheme();
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const active = selected(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? p.accent : p.border,
              backgroundColor: active ? p.accent : p.card,
            }}
          >
            <Text style={{ color: active ? '#FFFFFF' : p.text, fontSize: 14 }}>
              {o.label}
              {o.hint ? <Text style={{ color: active ? '#FFFFFF' : p.muted }}>{`  ${o.hint}`}</Text> : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const p = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: p.cardAlt,
        borderRadius: 12,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: 10,
              alignItems: 'center',
              backgroundColor: active ? p.card : 'transparent',
            }}
          >
            <Text style={{ color: active ? p.text : p.muted, fontWeight: active ? '700' : '500', fontSize: 14 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  suffix,
  autoFocus,
  multiline,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  suffix?: string;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  const p = useTheme();
  return (
    <View style={{ gap: 5 }}>
      {label ? <Text style={{ color: p.muted, fontSize: 12 }}>{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: p.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: p.border,
          borderRadius: 12,
          paddingHorizontal: 12,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.muted}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          multiline={multiline}
          style={{
            flex: 1,
            color: p.text,
            fontSize: 16,
            paddingVertical: 12,
            minHeight: multiline ? 72 : undefined,
          }}
        />
        {suffix ? <Text style={{ color: p.muted, fontSize: 14 }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export function Notice({ text, tone = 'default' }: { text: string; tone?: Tone }) {
  const p = useTheme();
  const color = toneColor(p, tone);
  return (
    <View
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        backgroundColor: p.card,
        borderRadius: 10,
        padding: 10,
      }}
    >
      <Text style={{ color: p.text, fontSize: 13 }}>{text}</Text>
    </View>
  );
}
