const { getDefaultConfig } = require('expo/metro-config');

/**
 * Конфіг Metro.
 *
 * `wasm` додано в assetExts, бо expo-sqlite на web — це SQLite, скомпільований
 * у WebAssembly, і Metro має віддавати цей файл як ресурс, а не намагатися
 * розібрати його як JS. Для Android/iOS це ні на що не впливає.
 */
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
