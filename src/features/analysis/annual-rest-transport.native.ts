import { Platform } from "react-native";
import { getNativeYearRest } from "../../../modules/luna-rest-pilot";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import type { AnnualRestTransport } from "./annual-rest-transport";
export type { AnnualRestTransport } from "./annual-rest-transport";

export function getAnnualRestTransport(): AnnualRestTransport | null {
  if (!DEV_TOOLS_AVAILABLE || Platform.OS !== "ios") return null;
  const native = getNativeYearRest();
  return native ? { run: (payload) => native.runYearAsync(payload) } : null;
}
