import fixtures from "./fixtures.json";
import type { NativeRestPilot } from "./index";
import type { PilotDay, PilotShift, PilotInterval, PilotRequest, PilotResult } from "./protocol";
import { validateRequest } from "./protocol";
import { calculateNumeric } from "./reference";

interface PackedFixtures {
  readonly sourceSha256: string;
  readonly pools: {
    readonly days: readonly PilotDay[];
    readonly shifts: readonly PilotShift[];
    readonly intervals: readonly PilotInterval[];
    readonly results: readonly PilotResult[];
  };
  readonly cases: readonly {
    readonly id: string;
    readonly requests: readonly (Omit<PilotRequest, "days" | "shifts" | "intervals"> & {
      readonly days: readonly number[];
      readonly shifts: readonly number[];
      readonly intervals: readonly number[];
    })[];
    readonly expected: readonly number[];
  }[];
}

export function pilotCases() {
  const data = fixtures as unknown as PackedFixtures;
  return data.cases.map((item) => ({
    id: item.id,
    requests: item.requests.map((request): PilotRequest => ({
      ...request,
      days: request.days.map((index) => data.pools.days[index]),
      shifts: request.shifts.map((index) => data.pools.shifts[index]),
      intervals: request.intervals.map((index) => data.pools.intervals[index]),
    })),
    expected: item.expected.map((index) => data.pools.results[index]),
  }));
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
let running = false;
let serial = 0;
export async function runRestPilot(
  native: NativeRestPilot,
  options: {
    readonly rounds?: number;
    readonly signal?: AbortSignal;
    readonly progress?: (text: string) => void;
  } = {},
) {
  if (running) throw new Error("Ein Rust-Vergleich läuft bereits.");
  if (native.engineVersion !== "luna-rest-native-v1")
    throw new Error("Die native Rechenversion passt nicht.");
  const rounds = options.rounds ?? 5;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 9)
    throw new Error("Ungültige Messanzahl.");
  running = true;
  const check = () => {
    if (options.signal?.aborted) throw new Error("Vergleich abgebrochen.");
  };
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
  const probe = () => {
    const start = performance.now();
    return new Promise<number>((resolve) =>
      setTimeout(() => resolve(performance.now() - start), 0),
    );
  };
  try {
    const cases = pilotCases();
    const samples: {
      caseId: string;
      round: number;
      first: "typescript" | "rust";
      typescript: { validationMs: number; kernelMs: number; totalMs: number; timerDelayMs: number };
      rust: {
        stringifyMs: number;
        roundtripMs: number;
        responseParseMs: number;
        totalMs: number;
        nativeMs: number;
        parseMs: number;
        validationMs: number;
        kernelMs: number;
        timerDelayMs: number;
      };
    }[] = [];
    // Golden and TS comparisons are outside timed kernel/transport intervals.
    for (const item of cases) {
      check();
      item.requests.forEach(validateRequest);
      if (canonical(item.requests.map(calculateNumeric)) !== canonical(item.expected)) {
        throw new Error("TypeScript weicht von der eingefrorenen Referenz ab.");
      }
      for (let round = -1; round < rounds; round++) {
        check();
        options.progress?.(
          `${item.id.includes("plus-five") ? "Endzeitänderung" : "Jahresplan"}: ${round < 0 ? "Aufwärmen" : `${round + 1}/${rounds}`}`,
        );
        await pause();
        check();
        const typescript = async () => {
          const tick = probe();
          const start = performance.now();
          item.requests.forEach(validateRequest);
          const validated = performance.now();
          const result = item.requests.map(calculateNumeric);
          const end = performance.now();
          const timerDelayMs = await tick;
          if (canonical(result) !== canonical(item.expected))
            throw new Error("TypeScript-Ergebnis stimmt nicht überein.");
          return {
            validationMs: validated - start,
            kernelMs: end - validated,
            totalMs: end - start,
            timerDelayMs,
          };
        };
        const rust = async () => {
          const tick = probe();
          const requestId = `pilot-${++serial}`;
          const start = performance.now();
          const payload = JSON.stringify({ schemaVersion: 1, requestId, requests: item.requests });
          const encoded = performance.now();
          const response = await native.runAsync(payload);
          const returned = performance.now();
          check();
          if (
            typeof response.payload !== "string" ||
            response.payload.length > 4 * 1024 * 1024 ||
            !finite(response.nativeMs)
          )
            throw new Error("Ungültige native Antwort.");
          const reply = JSON.parse(response.payload);
          const parsed = performance.now();
          const timerDelayMs = await tick;
          if (
            reply.schemaVersion !== 1 ||
            reply.engineVersion !== native.engineVersion ||
            reply.requestId !== requestId ||
            !finite(reply.parseMs) ||
            !finite(reply.validationMs) ||
            !finite(reply.kernelMs) ||
            canonical(reply.results) !== canonical(item.expected)
          ) {
            throw new Error("Rust-Ergebnis oder Auftragskennung stimmt nicht überein.");
          }
          return {
            stringifyMs: encoded - start,
            roundtripMs: returned - encoded,
            responseParseMs: parsed - returned,
            totalMs: parsed - start,
            nativeMs: response.nativeMs,
            parseMs: reply.parseMs as number,
            validationMs: reply.validationMs as number,
            kernelMs: reply.kernelMs as number,
            timerDelayMs,
          };
        };
        const first = round % 2 === 0 ? "typescript" : "rust";
        let tsResult;
        let rustResult;
        if (first === "typescript") {
          tsResult = await typescript();
          await pause();
          check();
          rustResult = await rust();
        } else {
          rustResult = await rust();
          await pause();
          check();
          tsResult = await typescript();
        }
        if (round >= 0)
          samples.push({ caseId: item.id, round, first, typescript: tsResult, rust: rustResult });
      }
    }
    return {
      schemaVersion: 1,
      kind: "native-rest-subkernel-comparison",
      engineVersion: native.engineVersion,
      fixtureSourceSha256: fixtures.sourceSha256,
      capturedAt: new Date().toISOString(),
      rounds,
      allResultsEqual: true,
      samples,
      scope:
        "Synthetic year rest block only; no live duties, salary, SQLite, cloud or full annual report. Fixed prepared inputs; warmup excluded; pauses and full equality checks excluded from timings. timerDelayMs is a JS timer probe, not native frame time.",
    };
  } finally {
    running = false;
  }
}
