import { render } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
import { CheckClearStatus } from "./check-summary-card";

describe("bounded check clear state", () => {
  it("states the supported scope when no finding is present", async () => {
    const screen = await render(<CheckClearStatus title="Gesetz & Tarif" />);
    expect(screen.getByText("Keine Auffälligkeiten in den unterstützten Prüfungen.")).toBeVisible();
  });

  it("does not suggest a clear result when the available evidence is limited", async () => {
    const screen = await render(<CheckClearStatus title="Gesetz & Tarif" limited />);
    expect(screen.getByText("Prüfung eingeschränkt")).toBeVisible();
    expect(screen.queryByText(/Keine Auffälligkeiten/)).toBeNull();
  });
});
