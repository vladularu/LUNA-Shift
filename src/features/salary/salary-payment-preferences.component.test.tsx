import { act, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useLayoutEffect } from "react";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  setSalaryPaymentEmptyMonth,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import {
  SalaryPaymentPreferencesProvider,
  useSalaryPaymentPreferences,
} from "./salary-payment-preferences";

const mockDatabase = {};
const mockLoad = jest.fn<() => Promise<SalaryPaymentPreferences>>();
const mockSave =
  jest.fn<
    (
      db: unknown,
      next: SalaryPaymentPreferences,
      expected: SalaryPaymentPreferences,
    ) => Promise<void>
  >();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDatabase }));
jest.mock("@/infrastructure/database/salary-payment-repository", () => ({
  loadSalaryPaymentPreferences: () => mockLoad(),
  saveSalaryPaymentPreferences: (
    db: unknown,
    next: SalaryPaymentPreferences,
    expected: SalaryPaymentPreferences,
  ) => mockSave(db, next, expected),
}));
let state: ReturnType<typeof useSalaryPaymentPreferences>;
function Probe() {
  const value = useSalaryPaymentPreferences();
  useLayoutEffect(() => {
    state = value;
  }, [value]);
  return null;
}
const tree = () => (
  <SalaryPaymentPreferencesProvider>
    <Probe />
  </SalaryPaymentPreferencesProvider>
);

describe("salary payment preferences", () => {
  beforeEach(() => {
    mockLoad.mockReset().mockResolvedValue(DEFAULT_SALARY_PAYMENT_PREFERENCES);
    mockSave.mockReset().mockResolvedValue();
  });
  it("shares a cash perspective without creating an unconfirmed payment rule", async () => {
    await render(tree());
    await waitFor(() => expect(state.ready).toBe(true));
    expect(state.perspective).toBe("PAYOUT");
    expect(state.preferences.periods).toEqual([]);
    await act(() => state.setPerspective("EARNED"));
    expect(state.perspective).toBe("EARNED");
    expect(mockSave).not.toHaveBeenCalled();
  });
  it("shows a confirmed empty month only after its durable save and uses the previous version", async () => {
    let finish!: () => void;
    mockSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await render(tree());
    await waitFor(() => expect(state.ready).toBe(true));
    const next = setSalaryPaymentEmptyMonth(state.preferences, "2026-09", true);
    let saving!: Promise<void>;
    await act(() => {
      saving = state.save(next);
    });
    expect(state.saving).toBe(true);
    expect(state.preferences.reviewedEmptyMonths).toEqual([]);
    expect(mockSave).toHaveBeenCalledWith(mockDatabase, next, DEFAULT_SALARY_PAYMENT_PREFERENCES);
    await act(async () => {
      finish();
      await saving;
    });
    expect(state.preferences.reviewedEmptyMonths).toEqual(["2026-09"]);
    expect(state.saving).toBe(false);
  });
  it("keeps the last saved rules after a write conflict and permits an explicit reload", async () => {
    await render(tree());
    await waitFor(() => expect(state.ready).toBe(true));
    const next = setSalaryPaymentEmptyMonth(state.preferences, "2026-09", true);
    mockSave.mockRejectedValueOnce(new Error("changed in another transaction"));
    await act(async () => {
      await expect(state.save(next)).rejects.toThrow("changed in another transaction");
    });
    expect(state.preferences).toEqual(DEFAULT_SALARY_PAYMENT_PREFERENCES);
    expect(state.error).toContain("Nicht gespeichert");
    mockLoad.mockResolvedValueOnce(next);
    await act(() => state.reload());
    expect(state.preferences).toEqual(next);
    expect(state.error).toBeNull();
  });
});
