import { createContext, useContext, type PropsWithChildren } from "react";
import type { SharingController } from "./sharing-ui-contract";

const SharingUiContext = createContext<SharingController | null>(null);
export function SharingUiProvider({
  controller,
  children,
}: PropsWithChildren<{ readonly controller: SharingController }>) {
  return <SharingUiContext.Provider value={controller}>{children}</SharingUiContext.Provider>;
}
export function useSharingUiController(): SharingController | null {
  return useContext(SharingUiContext);
}
