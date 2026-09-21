import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { useTheme } from '@/components/ui';

export default function TabsLayout() {
  const p = useTheme();
  // Типізація під те, що реально передає expo-router: колір може бути
  // не лише рядком, а й платформеним ColorValue.
  const icon = (glyph: string) => (props: { color: ColorValue }) => (
    <Text style={{ fontSize: 18, color: props.color }}>{glyph}</Text>
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: p.bg },
        headerTitleStyle: { color: p.text, fontSize: 18 },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: p.card, borderTopColor: p.border },
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Сьогодні', tabBarIcon: icon('📅') }}
      />
      <Tabs.Screen
        name="loans"
        options={{ title: 'Кредити', tabBarIcon: icon('🏦') }}
      />
      <Tabs.Screen
        name="analytics"
        options={{ title: 'Аналітика', tabBarIcon: icon('📈') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Налаштування', tabBarIcon: icon('⚙️') }}
      />
    </Tabs>
  );
}
