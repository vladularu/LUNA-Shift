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
