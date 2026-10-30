import { render } from "@testing-library/react-native";
import { expect, it, jest } from "@jest/globals";
import { Text } from "react-native";
import { CalendarStablePager } from "./calendar-stable-pager";
import { createMonthWindow } from "./month-window";

// The standard RN mock forwards raw props and misses ScrollView's native
// pagingEnabled=false rewrite when snapToInterval is provided.
jest.unmock("react-native/Libraries/Components/ScrollView/ScrollView");

it("keeps native iOS page settling enabled through the real ScrollView wrapper", async () => {
  const screen = await render(
    <CalendarStablePager
      month="2026-09"
      months={createMonthWindow("2026-09", 24, 36)}
      height={700}
      enabled
      revision={0}
      onBeginDrag={() => {}}
      onSettled={() => {}}
      renderMonth={(month) => <Text>{month}</Text>}
    />,
  );
  const nativePager = screen.getByTestId("calendar-month-pager");
  expect(nativePager.props.pagingEnabled).toBe(true);
  expect(nativePager.props.decelerationRate).toBe(0.998);
});
