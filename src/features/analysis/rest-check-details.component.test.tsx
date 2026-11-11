import { fireEvent, waitFor } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";
import { Share } from "react-native";
import { router } from "expo-router";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { LegalCheckDetails } from "./legal-check-details";
import { RestCheckDetails, restCheckDetailModel } from "./rest-check-details";
import { ComplianceIssueContent } from "./compliance-issue-content";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

const shift = (
  id: string,
  date: string,
  title: string,
  startTime: string,
  endTime: string,
): ShiftEntry => ({
  kind: "SHIFT",
  id,
  date,
  title,
  startTime,
  endTime,
  type: "DAY",
  templateId: null,
  breakMinutes: 30,
  color: id === "late" ? "#8E5AA9" : "#E8A300",
  symbol: id === "late" ? "L" : "E",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  deletedAt: null,
});
const duties = [
  shift("late", "2026-11-11", "Spätdienst", "13:18", "21:30"),
  shift("early", "2026-11-12", "Frühdienst", "06:00", "14:12"),
];
const issue: ComplianceIssue = {
  id: "rest",
  kind: "LEGAL",
  severity: "critical",
  rule: "ARBZG_5_REST_10H",
  title: "Ruhezeit unter 10 Stunden",
  description: "Zwischen den Diensten liegen 8:30 h Ruhezeit.",
  date: "2026-11-12",
  relatedShiftIds: ["late", "early"],
  facts: { rule: "ARBZG_5_REST_10H", restMinutes: 510, minimumRestMinutes: 600 },
};
const model = () => restCheckDetailModel(issue, duties, "Europe/Berlin", bundledRuleResolver)!;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("structured rest-check details", () => {
  it("opens a critical finding when iOS Intl omits its calendar without falling into the app error screen", async () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      const options = { ...resolvedOptions.call(this) };
      Reflect.deleteProperty(options, "calendar");
      return options;
    });
    const screen = await render(
      <ComplianceIssueContent issue={issue} shifts={duties} timeZone="Europe/Berlin" />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.getByTestId("rest-check-details")).toBeTruthy();
    expect(screen.getByText("11.–12. November 2026")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(screen.queryByTestId("rest-check-details")).toBeNull());
  });
  it("keeps check details read-only and closes without starting editors or sharing", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    const screen = await render(
      <ComplianceIssueContent issue={issue} shifts={duties} timeZone="Europe/Berlin" />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.getByTestId("rest-check-details")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /bearbeiten|kopieren|teilen|Weitere Aktionen/i }),
    ).toBeNull();
    expect(screen.getByTestId("rest-check-duties-2026-11-11")).toBeTruthy();
    expect(screen.getByTestId("rest-check-duties-2026-11-12")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(screen.queryByTestId("rest-check-details")).toBeNull());
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/check-issue",
        params: { session: expect.any(String) },
      }),
    );
    expect(share).not.toHaveBeenCalled();
  });
  it("retains both actual duty tiles, dates and times without an edit shortcut", async () => {
    const screen = await render(<RestCheckDetails model={model()} />);
    expect(screen.getByTestId("rest-check-duties-2026-11-11")).toBeTruthy();
    expect(screen.getByTestId("rest-check-duties-2026-11-12")).toBeTruthy();
    expect(screen.getByText("13:18–21:30")).toBeTruthy();
    expect(screen.getByText("06:00–14:12")).toBeTruthy();
    expect(screen.getByText("8:30 h")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Prüfgrundlage", expanded: false }));
    expect(screen.getByText("11:00 h")).toBeTruthy();
    expect(screen.getByText("10:00 h")).toBeTruthy();
    expect(screen.getByText("1:30 h unter der verkürzten Ruhezeit.")).toBeTruthy();
    expect(screen.getByText("Betriebliche Ausnahmen sind nicht geprüft.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bearbeiten|kopieren|teilen/i })).toBeNull();
  });

  it("uses the finding's threshold instead of a fixed ten-hour UI limit", () => {
    const changed = restCheckDetailModel(
      { ...issue, facts: { rule: "ARBZG_5_REST_10H", restMinutes: 510, minimumRestMinutes: 540 } },
      duties,
      "Europe/Berlin",
      bundledRuleResolver,
    )!;
    expect(changed.minimumMinutes).toBe(540);
    expect(changed.differenceMinutes).toBe(30);
  });

  it("does not invent a regular-rule value without an available catalog", () => {
    expect(restCheckDetailModel(issue, duties, "Europe/Berlin")?.regularMinutes).toBeNull();
  });

  it("refuses to present stale, missing, overlapping or unsupported evidence as a precise case", () => {
    expect(restCheckDetailModel(issue, duties.slice(0, 1), "Europe/Berlin")).toBeNull();
    expect(
      restCheckDetailModel(
        issue,
        [duties[0], { ...duties[1], startTime: "07:00" }],
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      restCheckDetailModel(
        issue,
        [duties[0], { ...duties[1], date: duties[0].date }],
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      restCheckDetailModel({ ...issue, facts: undefined }, duties, "Europe/Berlin"),
    ).toBeNull();
    expect(
      restCheckDetailModel({ ...issue, kind: "PLANNING" }, duties, "Europe/Berlin"),
    ).toBeNull();
  });

  it("keeps the existing missing-data explanation when the precise view cannot be established", async () => {
    const screen = await render(
      <LegalCheckDetails
        issue={issue}
        title={issue.title}
        missing
        shifts={duties.slice(0, 1)}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.queryByTestId("rest-check-details")).toBeNull();
    expect(screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bearbeiten/ })).toBeNull();
  });
});
