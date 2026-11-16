import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareNative, writeNativeConfig } from "./native-config.mjs";
import { build, iosTargets } from "./build-ios.mjs";
import { androidAbis, build as buildAndroid } from "./build-android.mjs";

function cleanup(root) {
  const target = path.resolve(root);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert(path.basename(target).startsWith("luna-config-"));
  rmSync(target, { recursive: true, force: true });
}

const config = (root) =>
  JSON.parse(readFileSync(path.join(root, "expo-module.config.json"), "utf8"));
test("Production/design/no opt-in reset stale config without invoking a native builder", async () => {
  for (const env of [
    { APP_VARIANT: "production", LUNA_FULL_ENGINE: "1" },
    { APP_VARIANT: "design", LUNA_FULL_ENGINE: "1" },
    { APP_VARIANT: "internal" },
    {},
  ]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "luna-config-"));
    try {
      writeNativeConfig(root, ["apple", "android"]);
      let invoked = false;
      assert.deepEqual(
        await prepareNative({
          root,
          env,
          build() {
            invoked = true;
          },
        }),
        [],
      );
      assert.equal(invoked, false);
      assert.deepEqual(config(root), { platforms: [] });
    } finally {
      cleanup(root);
    }
  }
});
test("explicit internal activation waits for a successful artifact", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "luna-config-"));
  try {
    const env = { APP_VARIANT: "internal", LUNA_FULL_ENGINE: "1", EAS_BUILD_PLATFORM: "ios" };
    await assert.rejects(
      prepareNative({
        root,
        env,
        build() {
          assert.deepEqual(config(root), { platforms: [] });
          throw new Error("BUILD_FAILED");
        },
      }),
      /BUILD_FAILED/,
    );
    assert.deepEqual(config(root), { platforms: [] });
    await assert.rejects(prepareNative({ root, env, build() {} }), /ENGINE_ARTIFACT_MISSING/);
    await prepareNative({
      root,
      env,
      build() {
        mkdirSync(path.join(root, "ios/LunaEngineCore.xcframework"), { recursive: true });
        writeFileSync(
          path.join(root, "ios/LunaEngineCore.xcframework/Info.plist"),
          "synthetic build stub",
        );
      },
    });
    assert.deepEqual(config(root), {
      platforms: ["apple"],
      apple: { modules: ["LunaEngineModule"], podspecPath: "ios/LunaEngine.podspec" },
    });
  } finally {
    cleanup(root);
  }
});
test("invalid platform and non-internal iOS build fail closed", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "luna-config-"));
  try {
    await assert.rejects(
      prepareNative({
        root,
        env: { APP_VARIANT: "internal", LUNA_FULL_ENGINE: "1", LUNA_ENGINE_PLATFORM: "arbitrary" },
      }),
      /ENGINE_PLATFORM_REQUIRED/,
    );
    assert.deepEqual(config(root), { platforms: [] });
    await assert.rejects(build({ root, env: {}, host: "darwin" }), /INTERNAL_MACOS_BUILD_REQUIRED/);
    await assert.rejects(
      build({ root, env: { APP_VARIANT: "internal", LUNA_FULL_ENGINE: "1" }, host: "win32" }),
      /INTERNAL_MACOS_BUILD_REQUIRED/,
    );
  } finally {
    cleanup(root);
  }
});
test("iOS target selection is explicit, unique, and bounded", () => {
  assert.deepEqual(iosTargets(undefined, "arm64"), ["aarch64-apple-ios", "aarch64-apple-ios-sim"]);
  assert.deepEqual(iosTargets(undefined, "x64"), ["aarch64-apple-ios", "x86_64-apple-ios"]);
  for (const value of [
    "bad",
    "aarch64-apple-ios,aarch64-apple-ios",
    "aarch64-apple-ios,aarch64-apple-ios-sim,x86_64-apple-ios",
    "../path",
  ])
    assert.throws(() => iosTargets(value), /INVALID_IOS_TARGETS/);
});
test("Android preserves all four Expo57 default ABIs and validates explicit subsets", async () => {
  assert.deepEqual(androidAbis(), ["armeabi-v7a", "x86", "x86_64", "arm64-v8a"]);
  assert.deepEqual(androidAbis("arm64-v8a,x86_64"), ["arm64-v8a", "x86_64"]);
  for (const value of ["bad", "../path", "arm64-v8a,arm64-v8a", "x86,"])
    assert.throws(() => androidAbis(value), /INVALID_ANDROID_ABIS/);
  await assert.rejects(
    buildAndroid({ root: "unused", env: {} }),
    /INTERNAL_ANDROID_BUILD_REQUIRED/,
  );
});
test("Android activation verifies every requested ABI, not just one existing library", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "luna-config-"));
  try {
    const env = { APP_VARIANT: "internal", LUNA_FULL_ENGINE: "1", EAS_BUILD_PLATFORM: "android" };
    const put = (abi) => {
      const directory = path.join(root, ".build/android/prebuilt", abi);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "libluna_engine.so"),
        "synthetic activation test artifact",
      );
    };
    await assert.rejects(
      prepareNative({
        root,
        env,
        build() {
          put("arm64-v8a");
        },
      }),
      /ENGINE_ARTIFACT_MISSING/,
    );
    assert.deepEqual(config(root), { platforms: [] });
    await prepareNative({
      root,
      env,
      build() {
        for (const abi of androidAbis()) put(abi);
      },
    });
    assert.deepEqual(config(root), {
      platforms: ["android"],
      android: { modules: ["app.luna.engine.LunaEngineModule"] },
    });
  } finally {
    cleanup(root);
  }
});
