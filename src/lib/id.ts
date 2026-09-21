import * as Crypto from 'expo-crypto';

/**
 * Локальна генерація ідентифікаторів.
 *
 * ID створюються на клієнті, а не базою: це обов'язкова умова offline-first —
 * запис можна створити без мережі й без сервера, а пізніше злити з іншими
 * пристроями без переприсвоєння ключів.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
