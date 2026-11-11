import { fireEvent, within } from "@testing-library/react-native";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";
import * as ReactNative from "react-native";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { ComplianceIssueContent } from "./compliance-issue-content";
import { ComplianceDayList } from "./compliance-day-list";
import { ComplianceDetails } from "./compliance-details";
import { TARIFF_SCOPE_SOURCE, TARIFF_TIME_POLICIES } from "@/domain/tariff-time-policy";
import { TariffCheckDetails } from "./tariff-check-details";
import { tariffCheckPresentation } from "./tariff-check-presentation";
import { TariffCheckPeriod } from "./tariff-check-period";
import * as DesignSystem from "@/ui/design-system";

const { Linking } = ReactNative;

type Screen = Awaited<ReturnType<typeof render>>;
const openLimits = async (screen: Screen) =>
  fireEvent.press(screen.getByRole("button", { name: "Quelle & Berechnung", expanded: false }));
const openOriginal = async (screen: Screen) =>
  fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

const duty: ShiftEntry = {
  kind: "SHIFT",
  id: "duty",
  templateId: null,
  date: "2026-11-30",
  title: "Frühdienst",
  type: "EARLY",
  startTime: "06:00",
  endTime: "14:00",
  breakMinutes: 30,
  color: "#227766",
  symbol: "F",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
};

type TariffStatus = NonNullable<ComplianceIssue["tariff"]>["status"];
const finding = (status: TariffStatus = "REVIEW"): ComplianceIssue => ({
  id: "tariff-week",
  date: "2026-12-01",
  kind: "LEGAL",
  severity: "info",
  rule: "TARIFF_WEEK_DAYS",
  title: "7 Arbeitstage in einer Kalenderwoche",
  description: "Die Zuordnung zur regelmäßigen Arbeitszeit ist noch nicht vollständig belegt.",
  relatedShiftIds: [duty.id],
  tariff: {
    tariffLabel: "TVöD-P",
    ruleId: "TARIFF_WEEK_DAYS",
    status,
    period: { from: "2026-11-30", until: "2026-12-06" },
    source: {
      title: "TVöD-AT, § 6",
      url: "https://www.vka.de/assets/media/docs/0/Tarifvertr%C3%A4ge/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf",
      section: "§ 6 Abs. 1 Satz 3",
      version: "01.01.2026",
    },
    ruleText:
      "Die regelmäßige Arbeitszeit wird auf fünf, bei notwendigen Gründen auf sechs Tage verteilt.",
    requirements: ["Prüfe die regelmäßige Arbeitszeit und den betrieblichen Ausnahmegrund."],
    recordedDates: [duty.date],
    count: 7,
    limit: 6,
  },
});

const unavailable = (): ComplianceIssue => {
  const original = finding("UNAVAILABLE");
  return {
    ...original,
    id: "tariff-scope",
    rule: "TARIFF_SCOPE",
    title: "Tarifgrundlage prüfen",
    description: "Der persönliche Tarifbereich ist noch nicht ausreichend belegt.",
    tariff: { ...original.tariff!, source: TARIFF_SCOPE_SOURCE },
  };
};

const compliance = (issues: readonly ComplianceIssue[]) => ({
  month: "2026-12",
  issues,
  affectedDates: issues.map((issue) => issue.date),
  criticalCount: 0,
  warningCount: 0,
  infoCount: issues.length,
});

describe("integrated tariff details", () => {
  it("shows only duties starting on each Sunday without copying Saturday nights or visible times", async () => {
    const base = finding();
    const entries: ShiftEntry[] = [
      {
        ...duty,
        id: "late-sun",
        date: "2026-11-22",
        title: "Spät",
        symbol: "sun",
        color: "#DD4455",
      },
      {
        ...duty,
        id: "night-sat",
        date: "2026-11-28",
        title: "Nacht",
        symbol: "moon",
        color: "#AA8833",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
      },
      {
        ...duty,
        id: "night-sun",
        date: "2026-11-29",
        title: "Nacht",
        symbol: "moon",
        color: "#AA8833",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
      },
    ];
    const badgeSpy = jest.spyOn(DesignSystem, "ColorBadge");
    try {
      const screen = await render(
        <TariffCheckDetails
          evidence={{
            ...base.tariff!,
            ruleId: "TARIFF_FREE_SUNDAY",
            count: 2,
            recordedDates: ["2026-11-22", "2026-11-29"],
            period: { from: "2026-11-16", until: "2026-11-29" },
          }}
          shifts={entries}
          timeZone="Europe/Berlin"
          title="2 Sonntage mit Dienst"
          description="Beide Sonntage belegt"
          missing={false}
        />,
      );
      const late = within(screen.getByTestId("tariff-period-2026-11-22"));
      expect(late.getByText("Spät")).toBeVisible();
      expect(badgeSpy.mock.calls.map(([props]) => props)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            color: "#DD4455",
            label: "sun",
          }),
          expect.objectContaining({ color: "#AA8833", label: "moon" }),
        ]),
      );
      const night = within(screen.getByTestId("tariff-period-2026-11-29"));
      expect(night.getAllByText("Nacht")).toHaveLength(1);
      expect(screen.getAllByTestId(/^check-shift-/)).toHaveLength(2);
      expect(screen.queryByTestId("check-shift-night-sat")).toBeNull();
      expect(night.queryByText("vom 28.11.")).toBeNull();
      expect(screen.queryByText(/21:00|07:30|13:18/)).toBeNull();
      expect(screen.queryByText("Dienst")).toBeNull();
      expect(screen.queryByRole("button", { name: /Dienste (anzeigen|ausblenden)/ })).toBeNull();
      expect(screen.queryByText("Zugehörige Dienste")).toBeNull();
    } finally {
      badgeSpy.mockRestore();
    }
  });

  it("shows every weekly symbol from the actual plan including two duties on one day", async () => {
    const base = finding();
    const dates = [
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
    ];
    const entries = dates.map((date, index) => ({
      ...duty,
      id: date,
      date,
      color: index % 2 ? "#ABCDEF" : "#123456",
    }));
    entries.push({
      ...duty,
      id: "second-duty",
      date: dates[0],
      startTime: "18:00",
      color: "#FEDCBA",
    });
    const screen = await render(
      <TariffCheckPeriod
        evidence={{ ...base.tariff!, recordedDates: dates }}
        shifts={entries}
        timeZone="Europe/Berlin"
      />,
    );
    for (const entry of entries)
      expect(screen.getByTestId(`check-duty-symbol-${entry.date}-${entry.id}`)).toBeVisible();
    expect(screen.getAllByTestId(/^check-duty-symbol-/)).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /Dienste anzeigen/ })).toBeNull();
  });
  it("renders the week without native date formatting or implicit Temporal coercion", async () => {
    const formatter = jest
      .spyOn(Temporal.PlainDate.prototype, "toLocaleString")
      .mockImplementation(() => {
        throw new TypeError("Native date formatter unavailable");
      });
    const primitive = jest.spyOn(Temporal.PlainDate.prototype, "valueOf");
    try {
      const issue = finding();
      const evidence = {
        ...issue.tariff!,
        recordedDates: [
          "2026-11-30",
          "2026-12-01",
          "2026-12-02",
          "2026-12-03",
          "2026-12-04",
          "2026-12-05",
          "2026-12-06",
        ],
      };
      const screen = await render(
        <TariffCheckDetails
          evidence={evidence}
          title={issue.title}
          description={issue.description}
          missing={false}
        >
          {null}
        </TariffCheckDetails>,
      );
      expect(screen.getByTestId("tariff-check-summary")).toBeVisible();
      expect(
        screen.getByLabelText(/^Montag, 30. November 2026. Kein Dienstbeginn erfasst/),
      ).toBeVisible();
      expect(
        screen.getByLabelText(/^Sonntag, 6. Dezember 2026. Kein Dienstbeginn erfasst/),
      ).toBeVisible();
      expect(formatter).not.toHaveBeenCalled();
      expect(primitive).not.toHaveBeenCalled();
    } finally {
      formatter.mockRestore();
      primitive.mockRestore();
    }
  });
  it("shows real dates across a month boundary and keeps the calculation closed", async () => {
    const issue = finding();
    const evidence = {
      ...issue.tariff!,
      recordedDates: [
        "2026-11-30",
        "2026-12-01",
        "2026-12-02",
        "2026-12-03",
        "2026-12-04",
        "2026-12-05",
        "2026-12-06",
      ],
    };
    const screen = await render(
      <TariffCheckDetails
        evidence={evidence}
        title={issue.title}
        description={issue.description}
        missing={false}
      >
        {null}
      </TariffCheckDetails>,
    );
    expect(screen.getByTestId("tariff-period-2026-11-30")).toBeVisible();
    expect(screen.getByTestId("tariff-period-2026-12-06")).toBeVisible();
    expect(
      screen.getByLabelText(/Montag, 30. November 2026. Kein Dienstbeginn erfasst/),
    ).toBeVisible();
    expect(screen.queryByTestId("tariff-check-limitation")).toBeNull();
    await openLimits(screen);
    expect(screen.getByTestId("tariff-check-limitation")).toBeVisible();
  });

  it("shows only the two recorded Sundays and makes a large-text period scrollable", async () => {
    const dimensions = jest
      .spyOn(ReactNative, "useWindowDimensions")
      .mockReturnValue({ width: 320, height: 700, scale: 3, fontScale: 1.6 });
    try {
      const issue = finding();
      const screen = await render(
        <TariffCheckPeriod
          evidence={{
            ...issue.tariff!,
            ruleId: "TARIFF_FREE_SUNDAY",
            period: { from: "2026-11-16", until: "2026-11-29" },
            count: 2,
            recordedDates: ["2026-11-29", "2026-11-22"],
          }}
        />,
      );
      expect(screen.getByLabelText("Betroffene Tage, horizontal scrollbar")).toBeVisible();
      expect(screen.getAllByText("Sonntag")).toHaveLength(2);
      const dates = screen.getAllByTestId(/^tariff-period-2026/).map((node) => node.props.testID);
      expect(dates).toEqual(["tariff-period-2026-11-22", "tariff-period-2026-11-29"]);
    } finally {
      dimensions.mockRestore();
    }
  });

  it("does not invent a week strip from incomplete saved dates", async () => {
    const screen = await render(<TariffCheckPeriod evidence={finding().tariff!} />);
    expect(screen.queryByTestId("tariff-period")).toBeNull();
  });
  it("keeps the first tariff view short with planned time and collapsed source limits", async () => {
    const issue = finding("PENDING");
    const screen = await render(
      <TariffCheckDetails
        evidence={issue.tariff!}
        title={issue.title}
        description={issue.description}
        missing={false}
      >
        {null}
      </TariffCheckDetails>,
    );
    expect(screen.queryByText("Nicht beurteilbar")).toBeNull();
    expect(screen.queryByText("Einordnung prüfen")).toBeNull();
    expect(screen.getByTestId("tariff-check-summary")).toHaveStyle({ fontSize: 16 });
    expect(screen.queryByText(issue.tariff!.requirements[0])).toBeNull();
    expect(screen.queryByText(issue.tariff!.ruleText)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle & Berechnung", expanded: false }),
    );
    expect(screen.getByRole("link", { name: issue.tariff!.source.title })).toBeVisible();
    expect(screen.queryByText(issue.tariff!.ruleText)).toBeNull();
    expect(screen.queryByText(issue.description)).toBeNull();
    expect(screen.queryByText(issue.tariff!.requirements[0])).toBeNull();
    await openOriginal(screen);
    expect(screen.getByText(issue.tariff!.ruleText)).toBeVisible();
    expect(screen.getByText(issue.description)).toBeVisible();
  });
  it("lets a grouped caller render the shared services once without false missing-service text", async () => {
    const issue = finding();
    const screen = await render(
      <TariffCheckDetails
        evidence={issue.tariff!}
        title={issue.title}
        description={issue.description}
        missing
        hideServices
      >
        {null}
      </TariffCheckDetails>,
    );
    expect(screen.queryByText("Zugehörige Dienste")).toBeNull();
    expect(screen.queryByText("Für diesen Befund sind keine Dienste zugeordnet.")).toBeNull();
    expect(screen.queryByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeNull();
  });
  it("keeps unknown saved conditions unchanged behind a separate closed archive", async () => {
    const issue = finding();
    const condition = "Bestätige eine ältere, hier nicht übersetzte Einzelfallbedingung.";
    const screen = await render(
      <TariffCheckDetails
        evidence={{ ...issue.tariff!, requirements: [condition] }}
        title={issue.title}
        description={issue.description}
        missing={false}
      >
        {null}
      </TariffCheckDetails>,
    );
    expect(screen.queryByText(condition)).toBeNull();
    await openLimits(screen);
    expect(screen.queryByText(condition)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getByText(condition)).toBeVisible();
    expect(screen.queryByRole("button", { name: condition })).toBeNull();
  });
  it("keeps genuinely unavailable services visible in the default detail path", async () => {
    const issue = finding();
    const screen = await render(
      <TariffCheckDetails
        evidence={issue.tariff!}
        title={issue.title}
        description={issue.description}
        missing
      >
        {null}
      </TariffCheckDetails>,
    );
    expect(screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeVisible();
    expect(screen.queryByText("Für diesen Befund sind keine Dienste zugeordnet.")).toBeNull();
  });
  it.each(["day-list", "grouped"])(
    "keeps the free-Sunday Soll rule distinct in the %s path with recommendations off",
    async (path) => {
      const base = finding();
      const sundays = ["2026-11-29", "2026-12-06"].map((date) => ({ ...duty, id: date, date }));
      const issue: ComplianceIssue = {
        ...base,
        rule: "TARIFF_FREE_SUNDAY",
        title: "Beide Sonntage mit Diensten",
        description: "Beide Sonntage des Beobachtungszeitraums enthalten erfasste Tätigkeiten.",
        relatedShiftIds: sundays.map((item) => item.id),
        tariff: {
          ...base.tariff!,
          ruleId: "TARIFF_FREE_SUNDAY",
          period: { from: "2026-11-23", until: "2026-12-06" },
          count: 2,
          limit: undefined,
          recordedDates: sundays.map((item) => item.date),
          source: TARIFF_TIME_POLICIES.TVOED_K.freeSource!,
          ruleText: "Von den beiden freien Tagen soll einer auf einen Sonntag fallen.",
          requirements: [
            "Die regelmäßige Sonn- und Feiertagsarbeit sowie der Bezugszeitraum sind zu prüfen.",
          ],
        },
      };
      const screen = await render(
        path === "day-list" ? (
          <ComplianceDayList
            compliance={compliance([issue])}
            shifts={sundays}
            showPlanning={false}
            timeZone="Europe/Berlin"
          />
        ) : (
          <ComplianceDetails
            compliance={compliance([issue])}
            shifts={sundays}
            showPlanning={false}
          />
        ),
      );
      expect(screen.getByText(/^Tarif(?:liche )?prüfung$/i)).toBeVisible();
      expect(screen.queryByText("Hinweise & Empfehlungen")).toBeNull();
      expect(screen.queryByText(issue.description)).toBeNull();
      await fireEvent.press(
        path === "day-list"
          ? within(screen.getByTestId(`check-details-${issue.id}`)).getByRole("button", {
              name: /Details ansehen:/,
            })
          : within(screen.getByTestId(`check-rule-card-${issue.rule}`)).getByRole("button", {
              expanded: false,
            }),
      );
      expect(screen.getByText("23.11.–06.12.2026")).toBeVisible();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText(issue.tariff!.requirements[0])).toBeNull();
      await openLimits(screen);
      expect(screen.queryByText(issue.description)).toBeNull();
      await openOriginal(screen);
      expect(screen.getByText(issue.description)).toBeVisible();
      expect(screen.getByText(issue.tariff!.ruleText)).toBeVisible();
      expect(screen.getByRole("link", { name: issue.tariff!.source.title })).toBeVisible();
    },
  );

  it.each(["REVIEW", "PENDING", "UNAVAILABLE", "DEVIATION"] as const)(
    "shows the %s assessment with its actual tariff source",
    async (status) => {
      const issue = finding(status);
      const screen = await render(
        <ComplianceIssueContent issue={issue} shifts={[duty]} timeZone="Europe/Berlin" />,
      );
      const card = screen.getByTestId("check-details-tariff-week");
      expect(
        within(card).getByText(
          status === "DEVIATION"
            ? "Tarifprüfung · Abweichung erkannt"
            : /^Tarif(?:liche )?prüfung$/i,
        ),
      ).toBeVisible();
      expect(within(card).getByText("TVöD-P")).toBeVisible();
      expect(within(card).queryByText("§ 6 Abs. 1 Satz 3")).toBeNull();
      expect(within(card).queryByText(issue.tariff!.ruleText)).toBeNull();
      expect(card).toHaveStyle({ borderColor: LIGHT_PALETTE.tariffCheckBorder, borderWidth: 1 });
      expect(within(card).queryByText("Nicht beurteilbar")).toBeNull();
      expect(within(card).queryByText("Einordnung prüfen")).toBeNull();
      expect(within(card).queryByText(issue.description)).toBeNull();
      expect(within(card).queryByText(/empfiehlt/)).toBeNull();
      expect(within(card).queryByText("Arbeitswissenschaftliche Hinweise")).toBeNull();
      await fireEvent.press(within(card).getByRole("button", { name: /Details ansehen:/ }));
      const body = within(screen.getByTestId("tariff-check-detail-content"));
      const copy = tariffCheckPresentation(issue.tariff!, issue.title, issue.description);
      expect(body.getByText(copy.summary)).toBeVisible();
      expect(body.queryByText(copy.limitation)).toBeNull();
      if (status === "PENDING") expect(body.getByText(/Geplant oder noch laufend/)).toBeVisible();
      if (status === "DEVIATION") expect(body.getByText(/Abweichung erkannt/)).toBeVisible();
      expect(body.getByText("30.11.–06.12.2026")).toBeVisible();
      expect(body.queryByText(issue.tariff!.requirements[0])).toBeNull();
      await openLimits(screen);
      expect(body.getByText(copy.limitation)).toBeVisible();
      expect(body.queryByText(issue.description)).toBeNull();
      await openOriginal(screen);
      expect(body.getByText(issue.description)).toBeVisible();
      expect(screen.getByTestId("check-shift-duty")).toBeVisible();
      expect(screen.queryByRole("button", { name: "1 Dienst anzeigen" })).toBeNull();
      expect(screen.getByTestId("check-shift-duty")).toBeVisible();
    },
  );

  it("keeps tariff findings visible with recommendations switched off", async () => {
    const issue = finding();
    const screen = await render(
      <ComplianceDayList
        compliance={{
          month: "2026-12",
          issues: [issue],
          affectedDates: [issue.date],
          criticalCount: 0,
          warningCount: 0,
          infoCount: 1,
        }}
        shifts={[duty]}
        showPlanning={false}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getByTestId("check-details-tariff-week")).toBeVisible();
    expect(screen.queryByText("Hinweise & Empfehlungen")).toBeNull();
  });

  it("opens the original source only from the common detail view", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    try {
      const issue = finding();
      const screen = await render(
        <ComplianceIssueContent issue={issue} shifts={[duty]} timeZone="Europe/Berlin" />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
      expect(screen.queryByRole("link")).toBeNull();
      await openLimits(screen);
      await fireEvent.press(screen.getByRole("link", { name: "TVöD-AT, § 6" }));
      expect(open).toHaveBeenCalledWith(issue.tariff!.source.url);
    } finally {
      open.mockRestore();
    }
  });

  it.each(["javascript:run()", "https://untrusted.example/tariff"])(
    "does not open an unregistered source from cached metadata: %s",
    async (url) => {
      const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
      try {
        const original = finding();
        const issue = {
          ...original,
          tariff: {
            ...original.tariff!,
            source: { ...original.tariff!.source, url },
          },
        };
        const screen = await render(
          <ComplianceIssueContent issue={issue} shifts={[]} timeZone="Europe/Berlin" />,
        );
        await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
        await openLimits(screen);
        expect(screen.queryByRole("link")).toBeNull();
        expect(open).not.toHaveBeenCalled();
        expect(
          screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar."),
        ).toBeVisible();
      } finally {
        open.mockRestore();
      }
    },
  );

  it("shows missing tariff allocation as scope information rather than a tariff norm", async () => {
    const original = finding("UNAVAILABLE");
    const issue = {
      ...original,
      rule: "TARIFF_SCOPE",
      tariff: { ...original.tariff!, source: TARIFF_SCOPE_SOURCE },
    };
    const screen = await render(
      <ComplianceIssueContent issue={issue} shifts={[]} timeZone="Europe/Berlin" />,
    );
    expect(screen.getByText("TVöD-P")).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.getAllByText("Tarifprüfung eingeschränkt").length).toBeGreaterThan(0);
    await openLimits(screen);
    expect(screen.getByText("Grundlage des Prüfumfangs")).toBeVisible();
    expect(screen.queryByText("Tarifregel · TVöD-P")).toBeNull();
  });

  it("keeps the tariff source and explanation in the existing grouped detail path", async () => {
    const issue = finding();
    const screen = await render(
      <ComplianceDetails
        compliance={{
          month: "2026-12",
          issues: [issue],
          affectedDates: [issue.date],
          criticalCount: 0,
          warningCount: 0,
          infoCount: 1,
        }}
        shifts={[duty]}
        showPlanning={false}
      />,
    );
    await fireEvent.press(
      within(screen.getByTestId(`check-rule-card-${issue.rule}`)).getByRole("button", {
        expanded: false,
      }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    await openLimits(screen);
    expect(screen.queryByText(issue.description)).toBeNull();
    await openOriginal(screen);
    expect(screen.getByText(issue.description)).toBeVisible();
    expect(screen.getByRole("link", { name: "TVöD-AT, § 6" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "1 Dienst anzeigen" })).toBeNull();
    expect(screen.getByTestId("check-shift-duty")).toBeVisible();
  });

  it.each(["day-list", "grouped"])(
    "retains tariff-scope explanation and source through actual %s prerequisites",
    async (path) => {
      const issue = unavailable();
      const screen = await render(
        path === "day-list" ? (
          <ComplianceDayList
            compliance={compliance([issue])}
            shifts={[duty]}
            showPlanning={false}
            timeZone="Europe/Berlin"
          />
        ) : (
          <ComplianceDetails
            compliance={compliance([issue])}
            shifts={[duty]}
            showPlanning={false}
          />
        ),
      );
      expect(screen.getByRole("button", { name: /^Prüfstatus:/ })).toBeVisible();
      expect(screen.queryByText("Tarifgrundlage prüfen")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /^Prüfstatus:/ }));
      expect(screen.getByRole("button", { name: /Details ansehen:/ })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
      expect(screen.queryByTestId("check-complete")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
      expect(screen.queryByText(issue.tariff!.requirements[0])).toBeNull();
      await openLimits(screen);
      expect(screen.queryByText(issue.description)).toBeNull();
      await openOriginal(screen);
      expect(screen.getByText(issue.description)).toBeVisible();
      expect(screen.getByRole("link", { name: TARIFF_SCOPE_SOURCE.title })).toBeVisible();
      expect(screen.getByText("Grundlage des Prüfumfangs")).toBeVisible();
      expect(screen.queryByRole("button", { name: "1 Dienst anzeigen" })).toBeNull();
      expect(screen.getByTestId("check-shift-duty")).toBeVisible();
    },
  );

  it("keeps general setup available alongside specific tariff prerequisites", async () => {
    const scope = unavailable();
    const work: ComplianceIssue = {
      ...finding(),
      id: "employment-coverage",
      tariff: undefined,
      rule: "ARBZG_DATA_ALL_EMPLOYMENT",
      title: "Arbeitszeiten aus allen Jobs erfasst?",
    };
    const screen = await render(
      <ComplianceDayList
        compliance={compliance([scope, work])}
        shifts={[duty]}
        showPlanning={false}
        timeZone="Europe/Berlin"
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Prüfstatus:/ }));
    expect(screen.getByRole("button", { name: "Angaben ergänzen" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Details ansehen:/ })).toBeVisible();
  });
});
