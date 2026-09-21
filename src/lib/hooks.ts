import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Завантаження даних для екрана.
 *
 * Два режими оновлення:
 *  - `reload()` — вручну (після збереження запису);
 *  - автоматично при поверненні на екран (`useFocusEffect`), бо записи
 *    додаються на іншому екрані (Quick Add), і без цього головний екран
 *    показував би застарілі цифри.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // deps навмисно передаються ззовні: loader — це нова функція на кожен рендер.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    try {
      setError(null);
      const result = await loaderRef.current();
      if (mounted.current) setData(result);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, loading, error, reload, setData };
}
