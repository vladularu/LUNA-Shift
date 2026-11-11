/** Native-route host for focused component tests; not an application screen. */
import { afterEach, jest } from "@jest/globals";
import React, { useSyncExternalStore, type ReactElement, type PropsWithChildren } from "react";
import { View } from "react-native";
import { render as baseRender } from "@testing-library/react-native";
import { CheckIssueScreen } from "./check-issue-screen";
import {
  currentCheckIssueSession,
  releaseCheckIssueSession,
  subscribeCheckIssueSession,
} from "@/navigation/check-issue-session";

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(() => {
      const store = jest.requireActual<typeof import("@/navigation/check-issue-session")>(
        "@/navigation/check-issue-session",
      );
      const request = store.currentCheckIssueSession();
      if (request) store.releaseCheckIssueSession(request.id);
    }),
    replace: jest.fn(),
  },
  Stack: {
    // Render the actual configured native header action in this route test host.
    Screen: ({ options }: { options?: { headerLeft?: () => React.ReactNode } }) =>
      options?.headerLeft?.() ?? null,
  },
  useLocalSearchParams: jest.fn(() => {
    const store = jest.requireActual<typeof import("@/navigation/check-issue-session")>(
      "@/navigation/check-issue-session",
    );
    return { session: store.currentCheckIssueSession()?.id };
  }),
}));

function NativeRouteHost({ children }: PropsWithChildren) {
  const request = useSyncExternalStore(
    subscribeCheckIssueSession,
    currentCheckIssueSession,
    currentCheckIssueSession,
  );
  return (
    <>
      <View
        accessibilityElementsHidden={!!request}
        importantForAccessibility={request ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {request ? <CheckIssueScreen /> : null}
    </>
  );
}

afterEach(() => {
  const request = currentCheckIssueSession();
  if (request) releaseCheckIssueSession(request.id);
  jest.clearAllMocks();
});

export async function render(ui: ReactElement, options?: Parameters<typeof baseRender>[1]) {
  const result = await baseRender(<NativeRouteHost>{ui}</NativeRouteHost>, options);
  const rerender = result.rerender;
  result.rerender = (element: ReactElement) =>
    rerender(<NativeRouteHost>{element}</NativeRouteHost>);
  return result;
}
