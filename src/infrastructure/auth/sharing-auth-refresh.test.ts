import { expect, it, vi } from "vitest";
import { bindSharingSessionRefresh } from "./sharing-auth-refresh";

it("refreshes sessions only while the native app is active and removes its listener", () => {
  const startAutoRefresh = vi.fn();
  const stopAutoRefresh = vi.fn();
  const remove = vi.fn();
  let onChange: (status: string) => void = () => undefined;
  const dispose = bindSharingSessionRefresh(
    { startAutoRefresh, stopAutoRefresh },
    {
      currentState: "active",
      subscribe: (listener) => {
        onChange = listener;
        return remove;
      },
    },
  );
  expect(startAutoRefresh).toHaveBeenCalledTimes(1);
  onChange("background");
  expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
  onChange("active");
  expect(startAutoRefresh).toHaveBeenCalledTimes(2);
  dispose();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(stopAutoRefresh).toHaveBeenCalledTimes(2);
});

it("does not start token refresh while app is initially inactive", () => {
  const startAutoRefresh = vi.fn();
  const stopAutoRefresh = vi.fn();
  bindSharingSessionRefresh(
    { startAutoRefresh, stopAutoRefresh },
    { currentState: "inactive", subscribe: () => () => undefined },
  );
  expect(startAutoRefresh).not.toHaveBeenCalled();
  expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
});
