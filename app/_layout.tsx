import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';

/**
 * Імпорт `@/db/client` навмисно на рівні модуля: він відкриває SQLite-файл і
 * застосовує міграції синхронно, ще до першого рендера екранів. Завдяки цьому
 * жоден екран не мусить мати стан «база ще не готова».
 */
import '@/db/client';

export default function RootLayout() {
  const p = useTheme();

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: p.bg },
          headerStyle: { backgroundColor: p.bg },
          headerTintColor: p.text,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="quick-add"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Новий запис',
            headerStyle: { backgroundColor: p.card },
            headerTintColor: p.text,
          }}
        />
        {/*
          Кредити: список живе табом, а форма створення — модальним вікном
          (щоб «Скасувати» було очевидним), картка кредиту — звичайним екраном
          з кнопкою «назад» у заголовку.
        */}
        <Stack.Screen
          name="loan/new"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Новий кредит',
            headerStyle: { backgroundColor: p.card },
            headerTintColor: p.text,
          }}
        />
        <Stack.Screen
          name="loan/[id]"
          options={{
            headerShown: true,
            title: 'Кредит',
            headerStyle: { backgroundColor: p.card },
            headerTintColor: p.text,
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
