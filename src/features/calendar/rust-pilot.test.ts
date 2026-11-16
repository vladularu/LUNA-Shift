import { describe, expect, it, vi } from "vitest";
import { pilotCases, runRestPilot } from "../../../modules/luna-rest-pilot/benchmark";
import { calculateNumeric } from "../../../modules/luna-rest-pilot/reference";
import type { NativeRestPilot } from "../../../modules/luna-rest-pilot";

function native(change: (reply: Record<string, unknown>) => void = () => {}) {
  return {
    engineVersion: "luna-rest-native-v1",
    runAsync: vi.fn(async (payload: string) => {
      const command = JSON.parse(payload);
      const reply = {
        schemaVersion: 1,
        engineVersion: "luna-rest-native-v1",
        requestId: command.requestId,
        results: command.requests.map(calculateNumeric),
        parseMs: 1,
        validationMs: 2,
        kernelMs: 3,
      };
      change(reply);
      return { payload: JSON.stringify(reply), nativeMs: 6 };
    }),
  } satisfies NativeRestPilot;
}

describe("native rest comparison", () => {
  it("reconstructs frozen real annual calls and verifies both controls before measuring", async () => {
    const cases = pilotCases();
    expect(cases).toHaveLength(2);
    expect(cases[0].requests).toHaveLength(12);
    expect(cases[0].requests.map(calculateNumeric)).toEqual(cases[0].expected);
    expect(cases[1].requests.map(calculateNumeric)).toEqual(cases[1].expected);
    expect(cases[0].expected).not.toEqual(cases[1].expected);
    const module = native();
    const result = await runRestPilot(module, { rounds: 2 });
    expect(result.allResultsEqual).toBe(true);
    expect(result.samples).toHaveLength(4);
    expect(result.samples.map((sample) => sample.first)).toEqual([
      "typescript",
      "rust",
      "typescript",
      "rust",
    ]);
    expect(module.runAsync).toHaveBeenCalledTimes(6); // includes two excluded warmups
    expect(result.samples.every((sample) => sample.rust.totalMs >= 0)).toBe(true);
  });
  it.each(["identity", "result", "timing"])(
    "rejects wrong %s without returning successful measurements",
    async (kind) => {
      const module = native((reply) => {
        if (kind === "identity") reply.requestId = "stale";
        if (kind === "result") reply.results = [];
        if (kind === "timing") reply.kernelMs = -1;
      });
      await expect(runRestPilot(module, { rounds: 1 })).rejects.toThrow("stimmt nicht überein");
    },
  );
  it("admits one run, aborts before native execution and releases the run guard", async () => {
    const controller = new AbortController();
    const module = native();
    const active = runRestPilot(module, { signal: controller.signal, rounds: 1 });
    await expect(runRestPilot(module)).rejects.toThrow("bereits");
    controller.abort();
    await expect(active).rejects.toThrow("abgebrochen");
    expect(module.runAsync).not.toHaveBeenCalled();
    const stopped = new AbortController();
    stopped.abort();
    await expect(runRestPilot(module, { signal: stopped.signal })).rejects.toThrow("abgebrochen");
  });
});
