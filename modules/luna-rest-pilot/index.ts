import { requireOptionalNativeModule } from "expo";

export const REST_ENGINE_VERSION = "luna-rest-native-v1";
export interface NativeYearRest {
  readonly yearEngineVersion: string;
  readonly runYearAsync: (
    payload: string,
  ) => Promise<{ readonly payload: string; readonly nativeMs: number }>;
}
export function getNativeYearRest(): NativeYearRest | null {
  const module = requireOptionalNativeModule<NativeYearRest>("LunaRestPilot");
  return module?.yearEngineVersion === "luna-rest-year-v1" &&
    typeof module.runYearAsync === "function"
    ? module
    : null;
}
export interface NativeRestPilot {
  readonly engineVersion: string;
  readonly runAsync: (
    payload: string,
  ) => Promise<{ readonly payload: string; readonly nativeMs: number }>;
}
export function getNativeRestPilot(): NativeRestPilot | null {
  const module = requireOptionalNativeModule<NativeRestPilot>("LunaRestPilot");
  return module?.engineVersion === REST_ENGINE_VERSION ? module : null;
}

// Metro evaluates these large synthetic fixtures only after the explicit tap.
export function loadRestPilotComparison(): typeof import("./benchmark") {
  return require("./benchmark");
}
