import { expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Text } from "@/ui/text";
import { FlowPage } from "./flow-layout";

jest.mock("@/ui/native-scroll-edge", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const ctx = React.createContext(false);
  return {
    nativeScrollEdge: {
      ScrollEdgeEffectProvider: ({ children }: PropsWithChildren) =>
        React.createElement(ctx.Provider, { value: true }, children),
      useScrollEdgeEffectRef: () => {
        if (!React.useContext(ctx)) throw Error("Missing scroll provider");
        return jest.fn();
      },
      ScrollEdgeEffect: ({
        edge,
        effect,
        children,
      }: PropsWithChildren<{ edge: string; effect: string }>) =>
        React.createElement(View, { testID: edge + "-" + effect }, children),
    },
  };
});
it("places the shared glass back button and footer on separate soft edges of the scroll page", async () => {
  const s = await render(
    <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>
      <FlowPage
        title="Sonderregelungen"
        pageKey="series"
        onBack={() => {}}
        footer={<Text>Weiter</Text>}
      >
        <Text>Arbeitstage am Stück</Text>
      </FlowPage>
    </SafeAreaInsetsContext.Provider>,
  );
  expect(s.getByTestId("top-soft")).toContainElement(s.getByLabelText("Zurück"));
  expect(s.getByTestId("bottom-soft")).toContainElement(s.getByText("Weiter"));
  expect(s.getByText("Arbeitstage am Stück")).toBeVisible();
});
