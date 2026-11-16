import {
  checkedUtf8Length,
  EngineTransportError,
  parseBoundedTransportReply,
  TRANSPORT_LIMITS,
  type TransportReply,
} from "./protocol";
export interface EngineUtilityReceipt {
  readonly reply: TransportReply;
}
interface Capture {
  readonly owner: number;
  readonly source: number;
}
interface Environment {
  capture(): Capture;
  current(capture: Capture, sourceBound: boolean): boolean;
  ready(capture: Capture, sourceBound: boolean): Promise<void>;
  invoke(json: string): Promise<string>;
}
interface Expected {
  readonly schema: number;
  readonly engine: string;
  readonly contract: string;
  readonly guard: Record<string, unknown>;
  readonly kind: string;
  readonly channel: string;
  readonly revision: number;
  readonly sourceBound: boolean;
}
interface Channel {
  revision: number;
  last: number;
  active: number;
  kinds: Map<string, number>;
}
interface Token {
  readonly capture: Capture;
  readonly expected: Expected;
  readonly channel: Channel;
  readonly serial: number;
  readonly current?: () => boolean;
}
interface Pending extends Token {
  settled: boolean;
  resolve(receipt: EngineUtilityReceipt): void;
  reject(error: EngineTransportError): void;
}
const kinds = new Set([
  "CIVIL_CLOCK",
  "MONTH_GRID",
  "MONTH_RANGE",
  "ADD_MONTHS",
  "ISO_WEEK",
  "SHIFT_DURATION",
  "SHIFT_BOUNDS",
  "APPOINTMENT_SERIES",
  "VALIDATE_INPUT",
  "MAP_RECORD_ROWS",
  "NET_FORM",
  "PAYROLL_FORM",
  "PROFILE_FORM",
  "DUTY_FORM_FEEDBACK",
  "DUTY_FORM_COMMAND",
  "ENTRY_REMINDER",
  "TEMPLATE_ACTIONS",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function expected(json: string): Expected {
  checkedUtf8Length(json, TRANSPORT_LIMITS.utilityInputBytes);
  try {
    const value: unknown = JSON.parse(json);
    if (!object(value) || !object(value.guard) || !object(value.operation)) throw new Error();
    const guard = value.guard,
      operation = value.operation;
    if (
      typeof value.wireSchemaVersion !== "number" ||
      typeof value.expectedEngineVersion !== "string" ||
      typeof value.calculationContractVersion !== "string" ||
      typeof operation.kind !== "string" ||
      !kinds.has(operation.kind) ||
      (operation.kind === "PAYROLL_FORM" && !object(guard.snapshot)) ||
      typeof guard.requestId !== "string" ||
      guard.requestId.length === 0 ||
      guard.requestId.length > 96 ||
      typeof guard.ownerScope !== "string" ||
      typeof guard.ownerEpoch !== "number" ||
      !Number.isSafeInteger(guard.draftRevision) ||
      (guard.draftRevision as number) < 0 ||
      ("snapshot" in guard && !object(guard.snapshot))
    )
      throw new Error();
    return {
      schema: value.wireSchemaVersion,
      engine: value.expectedEngineVersion,
      contract: value.calculationContractVersion,
      guard,
      kind: operation.kind,
      channel: guard.requestId,
      revision: guard.draftRevision as number,
      sourceBound: "snapshot" in guard,
    };
  } catch {
    throw new EngineTransportError("INVALID_UTILITY_REQUEST");
  }
}
function sameRecord(actual: unknown, expected: Record<string, unknown>): boolean {
  return (
    object(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.keys(expected).every((key) =>
      key === "snapshot" && object(expected[key])
        ? sameRecord(actual[key], expected[key])
        : actual[key] === expected[key],
    )
  );
}
function checkedReply(raw: string, expected: Expected): TransportReply {
  const value = parseBoundedTransportReply(raw, TRANSPORT_LIMITS.utilityOutputBytes);
  if (!value.ok) throw new EngineTransportError("NATIVE_UTILITY_REJECTED");
  const recordError =
    expected.kind === "MAP_RECORD_ROWS" &&
    object(value.result) &&
    value.result.state === "RECORD_ERROR" &&
    typeof value.result.name === "string" &&
    typeof value.result.message === "string" &&
    typeof value.result.userFacing === "boolean";
  if (
    value.state !== "COMPLETED" ||
    value.wireSchemaVersion !== expected.schema ||
    value.engineVersion !== expected.engine ||
    value.calculationContractVersion !== expected.contract ||
    value.operation !== expected.kind ||
    !sameRecord(value.guard, expected.guard) ||
    !object(value.result) ||
    (!recordError &&
      !["VALUE", "INPUT_ERROR", "DOMAIN_ERROR", "OPERATION_LIMIT"].includes(
        value.result.state as string,
      ))
  )
    throw new EngineTransportError("INVALID_UTILITY_REPLY");
  return value;
}
/** Small raw drafts only. No calendar/source-tree arithmetic or fallback runs
 * here; source-bound utilities retain the existing snapshot in the Rust core. */
export class UtilityRequests {
  private readonly pending = new Set<Pending>();
  private readonly channels = new Map<string, Channel>();
  private readonly receipts = new WeakMap<EngineUtilityReceipt, Token>();
  private sequence = 0;
  constructor(private readonly environment: Environment) {}
  invoke(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<EngineUtilityReceipt> {
    try {
      const input = expected(json),
        capture = this.environment.capture();
      if (
        !this.environment.current(capture, input.sourceBound) ||
        !this.hostCurrent(options.isCurrent)
      )
        throw new EngineTransportError("STALE_UTILITY");
      if (this.pending.size >= 16) throw new EngineTransportError("UTILITY_QUEUE_FULL");
      if (this.sequence >= Number.MAX_SAFE_INTEGER)
        throw new EngineTransportError("UTILITY_SEQUENCE_EXHAUSTED");
      let channel = this.channels.get(input.channel);
      if (channel && channel.revision > input.revision)
        throw new EngineTransportError("STALE_UTILITY");
      if (!channel) {
        if (this.channels.size >= 128) {
          let oldest: string | undefined,
            last = Number.MAX_SAFE_INTEGER;
          for (const [key, value] of this.channels)
            if (value.active === 0 && value.last < last) {
              oldest = key;
              last = value.last;
            }
          if (oldest === undefined) throw new EngineTransportError("UTILITY_QUEUE_FULL");
          this.channels.delete(oldest);
        }
        channel = { revision: input.revision, last: 0, active: 0, kinds: new Map() };
        this.channels.set(input.channel, channel);
      }
      if (channel.revision < input.revision) {
        channel.revision = input.revision;
        channel.kinds.clear();
      }
      const serial = ++this.sequence;
      channel.last = serial;
      channel.active++;
      channel.kinds.set(input.kind, serial);
      for (const pending of this.pending) if (!this.current(pending)) this.reject(pending);
      return new Promise((resolve, reject) => {
        const pending: Pending = {
          capture,
          expected: input,
          channel,
          serial,
          current: options.isCurrent,
          resolve,
          reject,
          settled: false,
        };
        this.pending.add(pending);
        void this.run(pending, json);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  isCurrent(receipt: EngineUtilityReceipt): boolean {
    const token = this.receipts.get(receipt);
    return !!token && this.current(token);
  }
  invalidate(ownerChanged: boolean): void {
    for (const pending of this.pending)
      if (ownerChanged || pending.expected.sourceBound) this.reject(pending);
    if (ownerChanged) this.channels.clear();
  }
  private async run(pending: Pending, json: string) {
    try {
      await this.environment.ready(pending.capture, pending.expected.sourceBound);
      if (pending.settled || !this.current(pending))
        throw new EngineTransportError("STALE_UTILITY");
      const raw = await this.environment.invoke(json);
      if (pending.settled || !this.current(pending))
        throw new EngineTransportError("STALE_UTILITY");
      const reply = checkedReply(raw, pending.expected);
      if (!this.current(pending)) throw new EngineTransportError("STALE_UTILITY");
      const receipt: EngineUtilityReceipt = Object.freeze({ reply });
      this.receipts.set(receipt, pending);
      pending.settled = true;
      pending.resolve(receipt);
    } catch (error) {
      if (!pending.settled) {
        pending.settled = true;
        pending.reject(
          error instanceof EngineTransportError
            ? error
            : new EngineTransportError("UTILITY_FAILED"),
        );
      }
    } finally {
      this.pending.delete(pending);
      pending.channel.active--;
    }
  }
  private reject(pending: Pending) {
    if (!pending.settled) {
      pending.settled = true;
      pending.reject(new EngineTransportError("STALE_UTILITY"));
    }
  }
  private current(token: Token): boolean {
    return (
      this.environment.current(token.capture, token.expected.sourceBound) &&
      this.hostCurrent(token.current) &&
      this.channels.get(token.expected.channel) === token.channel &&
      token.channel.revision === token.expected.revision &&
      token.channel.kinds.get(token.expected.kind) === token.serial
    );
  }
  private hostCurrent(check?: () => boolean) {
    try {
      return !check || check();
    } catch {
      return false;
    }
  }
}
