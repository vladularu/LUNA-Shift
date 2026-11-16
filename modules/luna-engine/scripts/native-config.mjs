import { existsSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = fileURLToPath(new URL("../", import.meta.url));
export function writeNativeConfig(root, platforms) {
  const config = { platforms };
  if (platforms.includes("apple"))
    config.apple = {
      modules: ["LunaEngineModule"],
      podspecPath: "ios/LunaEngine.podspec",
    };
  if (platforms.includes("android"))
    config.android = {
      modules: ["app.luna.engine.LunaEngineModule"],
    };
  const target = path.join(root, "expo-module.config.json");
  writeFileSync(`${target}.tmp`, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8" });
  renameSync(`${target}.tmp`, target);
}

/** Reset first, even on Production and on failed builds. No implicit opt-in. */
export async function prepareNative({ root = moduleRoot, env = process.env, build } = {}) {
  writeNativeConfig(root, []);
  if (env.APP_VARIANT !== "internal" || env.LUNA_FULL_ENGINE !== "1") return [];
  const platform = env.EAS_BUILD_PLATFORM ?? env.LUNA_ENGINE_PLATFORM;
  if (platform !== "ios" && platform !== "android") throw new Error("ENGINE_PLATFORM_REQUIRED");
  if (!build) {
    const builder = await import(platform === "ios" ? "./build-ios.mjs" : "./build-android.mjs");
    build = builder.build;
  }
  await build({ root, env });
  const artifacts =
    platform === "ios"
      ? ["ios/LunaEngineCore.xcframework/Info.plist"]
      : (await import("./build-android.mjs"))
          .androidAbis(env.LUNA_ANDROID_ABIS)
          .map((abi) => `.build/android/prebuilt/${abi}/libluna_engine.so`);
  if (artifacts.some((artifact) => !existsSync(path.join(root, artifact))))
    throw new Error("ENGINE_ARTIFACT_MISSING");
  const platforms = platform === "ios" ? ["apple"] : ["android"];
  writeNativeConfig(root, platforms);
  return platforms;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareNative();
}
