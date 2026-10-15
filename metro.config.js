const { getDefaultConfig } = require("expo/metro-config");
require("./scripts/decode-uri-component-hardening.cjs").verifyDecodeUriComponentHardening();

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// expo-sqlite uses a WebAssembly worker in the browser.
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
