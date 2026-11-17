import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const require = createRequire(import.meta.url);
const { transformFileSync } = require("@babel/core");
const file = resolve(
  import.meta.dirname,
  "../src/features/calendar/quick-planner-control-motion.ts",
);
const compiled = transformFileSync(file, {
  configFile: false,
  babelrc: false,
  envName: "production",
  presets: ["babel-preset-expo"],
  caller: {
    name: "metro",
    supportsStaticESM: false,
    platform: "ios",
    isDev: false,
    engine: "hermes",
  },
});

// The UI context receives captured values, never the RN context's app imports.
const module = { exports: {} };
const motion = { distance: { scene: 24 }, duration: { instant: 100 } };
const rn = createContext({
  module,
  exports: module.exports,
  require(name) {
    if (name === "@/theme/motion") return { MOTION: motion };
    if (name === "react-native-reanimated") return { Easing: { linear: (value) => value } };
    if (name.startsWith("@babel/runtime/")) return require(name);
    throw new Error(`Unexpected runtime import: ${name}`);
  },
});
runInContext(compiled.code, rn, { filename: file });
const ui = createContext({});
const decoded = new Map();

function onUI(worklet) {
  assert.equal(typeof worklet.__workletHash, "number", "Expo must compile the worklet");
  assert.equal(typeof worklet.__initData?.code, "string", "compiled code must be available");
  if (decoded.has(worklet)) return decoded.get(worklet);
  const receiver = { __closure: {} };
  const callable = runInContext(`(${worklet.__initData.code})`, ui).bind(receiver);
  decoded.set(worklet, callable);
  for (const [key, value] of Object.entries(worklet.__closure)) {
    receiver.__closure[key] = typeof value === "function" ? onUI(value) : structuredClone(value);
  }
  return callable;
}

const clean = (value) => JSON.parse(JSON.stringify(value));
const { quickPlannerDockMotion, quickPlannerControlMotion } = module.exports;
const dockOnUI = onUI(quickPlannerDockMotion);
const controlOnUI = onUI(quickPlannerControlMotion);

test("compiled initial close-control frame runs without app imports in the UI context", () => {
  assert.equal(runInContext("typeof MOTION", ui), "undefined");
  for (const reduced of [false, true]) {
    const frame = controlOnUI(0, "close", reduced);
    assert.equal(frame.opacity, 0);
    assert.deepEqual(clean(frame), clean(quickPlannerControlMotion(0, "close", reduced)));
  }
});

test("compiled drawer defaults and interrupted control frames preserve their RN results", () => {
  const frames = [0, 0.15, 0.3, 0.6, 5 / 6, 11 / 12, 1, 0.8, 0.35, 0.7, 0.2, 0];
  for (const reduced of [false, true]) {
    for (const progress of frames) {
      for (const distance of [undefined, 0, 24, 96]) {
        assert.deepEqual(
          clean(dockOnUI(progress, reduced, distance)),
          clean(quickPlannerDockMotion(progress, reduced, distance)),
        );
      }
      for (const control of ["add", "close"]) {
        assert.deepEqual(
          clean(controlOnUI(progress, control, reduced)),
          clean(quickPlannerControlMotion(progress, control, reduced)),
        );
      }
    }
  }
});

test("production calendar cadence keeps one registered worklet across React Compiler renders", () => {
  const result = transformFileSync(
    resolve(import.meta.dirname, "../src/features/calendar/use-calendar-performance.ts"),
    {
      configFile: false,
      babelrc: false,
      envName: "production",
      presets: ["babel-preset-expo"],
      caller: {
        name: "metro",
        supportsStaticESM: false,
        supportsReactCompiler: true,
        platform: "ios",
        isDev: false,
        engine: "hermes",
      },
    },
  );
  const callbacks = [],
    events = [];
  const control = { setActive() {}, isActive: false, callbackId: 1 };
  const values = [0, [0, 0, 0, 0, 0, 0]].map((value) => ({
    value,
    set(next) {
      this.value = next;
    },
  }));
  let sharedIndex = 0,
    memoized,
    dependencies;
  const compilerCache = Array(64).fill(Symbol.for("react.memo_cache_sentinel"));
  const exportedModule = { exports: {} };
  const runtimeContext = createContext({
    module: exportedModule,
    exports: exportedModule.exports,
    require(name) {
      if (name === "react/compiler-runtime") return { c: () => compilerCache };
      if (name === "react")
        return {
          useCallback(fn, deps) {
            if (!dependencies || deps.some((value, index) => value !== dependencies[index])) {
              memoized = fn;
              dependencies = deps;
            }
            return memoized;
          },
          useSyncExternalStore: () => 7,
          useEffect() {},
          useLayoutEffect() {},
        };
      if (name === "react-native") return {};
      if (name === "react-native-reanimated")
        return {
          useSharedValue: () => values[sharedIndex++],
          useFrameCallback: (callback) => {
            callbacks.push(callback);
            return control;
          },
          runOnJS: (fn) => fn,
        };
      if (name === "@/application/calendar-performance")
        return {
          calendarPerformance: {
            subscribe() {},
            getSnapshot: () => 7,
            record: (kind, values, session) => events.push({ kind, values, session }),
          },
        };
      if (["@/engine/calendar", "@/engine/recurrence", "./calendar-entry-index"].includes(name))
        return {};
      if (name.startsWith("@babel/runtime/")) return require(name);
      throw new Error(`Unexpected calendar probe import: ${name}`);
    },
  });
  runInContext(result.code, runtimeContext);
  const render = (month) => {
    sharedIndex = 0;
    exportedModule.exports.useCalendarPerformance(true, month, "MONTH");
  };
  render("2026-01");
  render("2026-02");
  assert.equal(
    callbacks[1],
    callbacks[0],
    "rendering must not re-register and reset the UI frame window",
  );
  values[0].value = 7;
  const callback = callbacks[0];
  assert.equal(typeof callback.__workletHash, "number");
  const isolatedUI = createContext({});
  const onFrame = runInContext(`(${callback.__initData.code})`, isolatedUI).bind({
    __closure: callback.__closure,
  });
  onFrame({ timestamp: 100, timeSincePreviousFrame: null });
  for (let i = 1; i <= 50; i++) onFrame({ timestamp: 100 + i * 20, timeSincePreviousFrame: 20 });
  const frame = events.find((event) => event.kind === "ui-frames");
  assert.equal(frame.session, 7);
  assert.equal(frame.values.duration, 1000);
  assert.equal(frame.values.count, 50);
});
