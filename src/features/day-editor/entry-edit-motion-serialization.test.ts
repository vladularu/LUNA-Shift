import { transformFileSync } from "@babel/core";
import { describe, expect, it } from "vitest";

function loadNativeJavaScript(file: string, imports: Record<string, unknown>) {
  const result = transformFileSync(file, {
    babelrc: false,
    configFile: false,
    presets: ["@babel/preset-typescript"],
    plugins: ["@babel/plugin-transform-modules-commonjs"],
    compact: false,
  });
  if (!result?.code) throw new Error(`Unable to compile ${file}`);
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function("require", "module", "exports", "__DEV__", result.code);
  evaluate(
    (name: string) => {
      if (!(name in imports)) throw new Error(`Unexpected isolated dependency: ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    false,
  );
  return module.exports;
}

function nativeSerializationFixture() {
  // Retain the installed builder classes and serializer; replace only native bridge calls
  // and dependencies unused by this serialization path so the test runs without an iPhone.
  const animation = { withDelay: () => {}, withSpring: () => {}, withTiming: () => {} };
  const animationUtil = {
    getReduceMotionFromConfig: () => false,
    assertEasingIsWorklet: () => {},
  };
  const base = loadNativeJavaScript(
    "node_modules/react-native-reanimated/src/layoutReanimation/animationBuilder/BaseAnimationBuilder.ts",
    {
      "../../animation": animation,
      "../../animation/util": animationUtil,
      "../../commonTypes": { ReduceMotion: { System: "system" } },
    },
  );
  const complex = loadNativeJavaScript(
    "node_modules/react-native-reanimated/src/layoutReanimation/animationBuilder/ComplexAnimationBuilder.ts",
    {
      "../../animation": animation,
      "../../animation/util": animationUtil,
      "./BaseAnimationBuilder": base,
    },
  );
  const slide = loadNativeJavaScript(
    "node_modules/react-native-reanimated/src/layoutReanimation/defaultAnimations/Slide.ts",
    { "../animationBuilder": { ...base, ...complex } },
  );
  const motion = loadNativeJavaScript("src/features/day-editor/entry-edit-overlay-motion.ts", {
    "react-native-reanimated": slide,
    "@/theme/motion": { MOTION: { easing: { calm: () => {} }, reduceMotion: "system" } },
  });
  const backend = new Proxy(
    {},
    {
      get:
        () =>
        (...args: unknown[]) => ({ args }),
    },
  );
  const serializer = loadNativeJavaScript(
    "node_modules/react-native-worklets/src/memory/serializable.native.ts",
    {
      "../debug/errors": { registerWorkletStackDetails: () => {} },
      "../debug/jsVersion": { jsVersion: "isolated-serialization-test" },
      "../debug/logger": { logger: { warn: () => {} } },
      "../runtimeKind": { getRuntimeKind: () => 1, RuntimeKind: { ReactNative: 1 } },
      "../workletFunction": {
        isWorkletFunction: (value: unknown) =>
          typeof value === "function" && "__workletHash" in value,
      },
      "../WorkletsModule/NativeWorklets": { WorkletsModule: backend },
      "./isSynchronizable": { isSynchronizable: () => false },
      "./serializableMappingCache": {
        serializableMappingCache: new WeakMap(),
        serializableMappingFlag: Symbol("flag"),
      },
    },
  );
  return {
    motion,
    createSerializable: serializer.createSerializable as (value: unknown) => unknown,
  };
}

describe("entry editor production Worklet serialization", () => {
  it("reproduces the real native serializer rejection of the layout-animation builder", () => {
    const { motion, createSerializable } = nativeSerializationFixture();
    expect(() => createSerializable(motion.ENTRY_EDIT_MOTION)).toThrow(
      "[Worklets] Cannot copy value of type `SlideInDown`.",
    );
  });

  it("captures a serializable numeric duration instead of the animation-builder object", () => {
    const metroCaller = {
      name: "metro",
      bundler: "metro",
      platform: "ios",
      engine: "hermes",
      isDev: false,
      isServer: false,
      projectRoot: process.cwd(),
      supportsStaticESM: false,
    };
    const result = transformFileSync("src/features/day-editor/entry-edit-overlay-frame.tsx", {
      babelrc: false,
      configFile: false,
      presets: ["babel-preset-expo"],
      caller: metroCaller,
      envName: "production",
    });
    if (!result?.code) throw new Error("Unable to compile the production editor frame");
    const closures = [...result.code.matchAll(/\.__closure\s*=\s*\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    expect(closures.length).toBeGreaterThan(0);
    expect(closures.some((closure) => /\bENTRY_EDIT_MOTION\b/.test(closure))).toBe(false);
    expect(closures.some((closure) => /\bENTRY_EDIT_CLOSE_DURATION\b/.test(closure))).toBe(true);
    const { motion, createSerializable } = nativeSerializationFixture();
    expect(typeof motion.ENTRY_EDIT_CLOSE_DURATION).toBe("number");
    expect(() =>
      createSerializable({ ENTRY_EDIT_CLOSE_DURATION: motion.ENTRY_EDIT_CLOSE_DURATION }),
    ).not.toThrow();
  });
});
