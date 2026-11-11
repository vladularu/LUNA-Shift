import { describe, expect, it, jest } from "@jest/globals";
import "./check-issue-route.test";
import { act, fireEvent, render } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
import type { ComplianceIssue } from "@/domain/types";
import { CheckIssueScreen } from "./check-issue-screen";
import { openCheckIssueDetails } from "./compliance-issue-content";
import {
  createCheckIssueSession,
  currentCheckIssueSession,
} from "@/navigation/check-issue-session";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

const issue: ComplianceIssue = {
  id: "planning-finding",
  kind: "PLANNING",
  severity: "info",
  rule: "PLANNING_7_DAYS",
  date: "2026-11-29",
  title: "Dienstfolge",
  description: "Prüfhinweis",
  relatedShiftIds: [],
};
const input = { issue, shifts: [], timeZone: "Europe/Berlin" };

describe("native check-detail route lifecycle", () => {
  it("keeps one native header back action without a fixed bottom footer", async () => {
    createCheckIssueSession(input);
    const screen = await render(<CheckIssueScreen />);
    expect(screen.queryByTestId("check-detail-back-footer")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Zurück" })).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it("prevents duplicate pushes and permits reopening after native swipe dismissal", async () => {
    openCheckIssueDetails(input);
    openCheckIssueDetails(input);
    expect(router.push).toHaveBeenCalledTimes(1);
    const first = currentCheckIssueSession()!.id;
    const screen = await render(<CheckIssueScreen />);
    await screen.unmount();
    expect(currentCheckIssueSession()).toBeNull();
    openCheckIssueDetails(input);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(currentCheckIssueSession()!.id).not.toBe(first);
  });
  it("releases a failed presentation so the user can retry", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.mocked(router.push).mockImplementationOnce(() => {
      throw new Error("navigation unavailable");
    });
    expect(openCheckIssueDetails(input)).toBeNull();
    expect(currentCheckIssueSession()).toBeNull();
    expect(alert).toHaveBeenCalledWith("Details nicht geöffnet", "Versuche es bitte erneut.");
    expect(openCheckIssueDetails(input)).toEqual(expect.any(String));
    alert.mockRestore();
  });
  it("handles a stale route without exposing another finding and provides a safe way back", async () => {
    createCheckIssueSession(input);
    jest.mocked(useLocalSearchParams).mockReturnValueOnce({ session: "stale-token" });
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    const screen = await render(<CheckIssueScreen />);
    expect(screen.getByText("Prüfungsdetails nicht verfügbar")).toBeTruthy();
    expect(screen.queryByTestId("planning-hint-details")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(router.replace).toHaveBeenCalledWith("/analysis");
    await act(async () => screen.unmount());
    expect(currentCheckIssueSession()).not.toBeNull();
  });
});
