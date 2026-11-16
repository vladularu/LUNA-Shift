import { EngineClient } from "./client";
import { WebSourceBackend, type SourcePair } from "./web-source";
import { FinancialResourceBackend, type FinancialEndpoint } from "./financial/backend";
import { CalendarResourceBackend } from "./calendar/backend";
import type { CalendarEndpoint } from "./calendar/protocol";
import {
  FORM_RESOURCE_LIMITS as formLimits,
  type FormEndpoint,
  type FormTransportResponse,
} from "./forms/protocol";
import {
  EngineTransportError,
  TRANSPORT_LIMITS,
  type EngineBackend,
  type EngineLane,
  type EngineOperation,
} from "./protocol";

export interface EngineWorker {
  postMessage(value: unknown): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ): void;
  terminate(): void;
}
type Rpc = {
  resolve: (json: string) => void;
  reject: (error: EngineTransportError) => void;
  readonly maximum: number;
};
interface Instance {
  worker: EngineWorker;
  ready: Promise<string>;
  resolveReady: (engine: string) => void;
  rejectReady: (error: EngineTransportError) => void;
  pending: Map<number, Rpc>;
  formPending: Map<
    number,
    {
      resolve: (reply: FormTransportResponse) => void;
      reject: (error: EngineTransportError) => void;
    }
  >;
  listener: (event: { data?: unknown }) => void;
  failure: () => void;
  timer?: ReturnType<typeof setTimeout>;
  sourceAssembly: boolean;
  calendarPreflight: boolean;
  catalogPreflight: boolean;
  profileClock: boolean;
  financialCollation: boolean;
  calendarResources: boolean;
  formResources: boolean;
}
const broadcast = new Set<EngineOperation>([
  "bindOwner",
  "advanceRevision",
  "execute",
  "reset",
  "collectRetired",
]);

/** Independent cores avoid one synchronous Wasm job blocking the other lane.
 * Snapshot/provider memory is retained separately in each worker instance. */
export class WebEngineBackend implements EngineBackend {
  readonly forms = () => this.formEndpoint();
  readonly sources = new WebSourceBackend(() => this.sourcePair());
  readonly financialCollation = new FinancialResourceBackend(() => this.financialEndpoint());
  readonly calendar = new CalendarResourceBackend(() => this.calendarEndpoint());
  private pair?: Record<EngineLane, Instance>;
  private calendarInstance?: Instance;
  private calendarReady?: Promise<void>;
  private ownerJson?: string;
  private expectedEngine?: string;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private closed = false;

  constructor(
    private readonly factory: (lane: EngineLane) => EngineWorker,
    private readonly calendarFactory?: () => EngineWorker,
  ) {}

  onFault(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  restart() {
    this.discard("WORKER_REPLACED");
  }
  close() {
    this.closed = true;
    this.discard("TRANSPORT_CLOSED");
    this.listeners.clear();
  }

  async invoke(operation: EngineOperation, json: string, lane?: EngineLane): Promise<string> {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
    const pair = this.instances();
    const identities = await Promise.all([pair.finance.ready, pair.checks.ready]);
    if (pair !== this.pair) throw new EngineTransportError("WORKER_REPLACED");
    if (identities[0] !== identities[1]) {
      this.fault();
      throw new EngineTransportError("ENGINE_IDENTITY_MISMATCH");
    }
    this.expectedEngine = identities[0];
    if (broadcast.has(operation)) {
      const responses = await Promise.all([
        this.rpc(pair.finance, operation, json),
        this.rpc(pair.checks, operation, json),
        ...((operation === "bindOwner" || operation === "reset") && this.calendarInstance
          ? [this.rpc(this.calendarInstance, operation, json)]
          : []),
      ]);
      if (pair !== this.pair) throw new EngineTransportError("WORKER_REPLACED");
      // State controls/registration must succeed in both cores atomically from
      // the caller's perspective. A divergent/failed pair cannot be reused.
      if (
        responses.some((response) => {
          try {
            return JSON.parse(response).ok !== true;
          } catch {
            return true;
          }
        })
      ) {
        this.fault();
        throw new EngineTransportError("WORKER_PAIR_REJECTED");
      }
      if (operation === "bindOwner") this.ownerJson = json;
      if (operation === "reset") this.ownerJson = undefined;
      return responses[0];
    }
    const target =
      lane ?? (operation === "runChecks" || operation === "admitChecks" ? "checks" : "finance");
    if (operation === "cancelJob" && lane === undefined)
      throw new EngineTransportError("LANE_REQUIRED");
    return this.rpc(pair[target], operation, json);
  }
  private async sourcePair(): Promise<SourcePair> {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
    const pair = this.instances();
    const identities = await Promise.all([pair.finance.ready, pair.checks.ready]);
    if (pair !== this.pair) throw new EngineTransportError("WORKER_REPLACED");
    if (identities[0] !== identities[1]) {
      this.fault();
      throw new EngineTransportError("ENGINE_IDENTITY_MISMATCH");
    }
    return {
      supported: pair.finance.sourceAssembly && pair.checks.sourceAssembly,
      profileClock: pair.finance.profileClock && pair.checks.profileClock,
      commands: [
        (operation, json) => this.rpc(pair.finance, operation, json),
        (operation, json) => this.rpc(pair.checks, operation, json),
      ],
      raw: [
        (header, source) => this.rpcMessage(pair.finance, { kind: "SOURCE", header, source }),
        (header, source) => this.rpcMessage(pair.checks, { kind: "SOURCE", header, source }),
      ],
      ranks:
        pair.finance.calendarPreflight && pair.checks.calendarPreflight
          ? [
              (header, source) =>
                this.rpcMessage(pair.finance, { kind: "CALENDAR_RANKS", header, source }),
              (header, source) =>
                this.rpcMessage(pair.checks, { kind: "CALENDAR_RANKS", header, source }),
            ]
          : undefined,
      catalogFinalize:
        pair.finance.catalogPreflight && pair.checks.catalogPreflight
          ? [
              (header, source) =>
                this.rpcMessage(pair.finance, { kind: "CATALOG_FINALIZE", header, source }),
              (header, source) =>
                this.rpcMessage(pair.checks, { kind: "CATALOG_FINALIZE", header, source }),
            ]
          : undefined,
      current: () => pair === this.pair && !this.closed,
      retire: () => {
        if (pair === this.pair) this.fault();
      },
    };
  }

  private async financialEndpoint(): Promise<FinancialEndpoint> {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
    const pair = this.instances();
    const identities = await Promise.all([pair.finance.ready, pair.checks.ready]);
    if (pair !== this.pair) throw new EngineTransportError("WORKER_REPLACED");
    if (identities[0] !== identities[1]) {
      this.fault();
      throw new EngineTransportError("ENGINE_IDENTITY_MISMATCH");
    }
    if (!pair.finance.financialCollation)
      throw new EngineTransportError("FINANCIAL_COLLATION_UNAVAILABLE");
    return {
      invoke: (operation, json) => this.rpc(pair.finance, operation, json),
      finalize: (header, source) =>
        this.rpcMessage(pair.finance, { kind: "FINANCIAL_COLLATION_FINALIZE", header, source }),
      current: () => pair === this.pair && !this.closed,
      retire: () => {
        if (pair === this.pair) this.fault();
      },
    };
  }
  private async formEndpoint(): Promise<FormEndpoint> {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
    const pair = this.instances();
    const identity = await pair.finance.ready;
    if (pair !== this.pair) throw new EngineTransportError("WORKER_REPLACED");
    if (!pair.finance.formResources || (this.expectedEngine && identity !== this.expectedEngine))
      throw new EngineTransportError("FORM_RESOURCE_UNAVAILABLE");
    return {
      invoke: (header, source) => this.formRpc(pair.finance, header, source),
      current: () => pair === this.pair && !this.closed,
      retire: () => {
        if (pair === this.pair) this.fault();
      },
      collectRetired: async () => {
        await this.rpc(pair.finance, "collectRetired", "");
      },
    };
  }

  private async calendarEndpoint(): Promise<CalendarEndpoint> {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
    const owner = this.ownerJson,
      engine = this.expectedEngine;
    if (!owner || !engine || !this.calendarFactory)
      throw new EngineTransportError("CALENDAR_UNAVAILABLE");
    if (!this.calendarInstance) {
      const instance = this.create("calendar");
      this.calendarInstance = instance;
      this.calendarReady = (async () => {
        const identity = await instance.ready;
        if (!this.current(instance) || this.ownerJson !== owner)
          throw new EngineTransportError("WORKER_REPLACED");
        if (identity !== engine || !instance.calendarResources) {
          this.fault();
          throw new EngineTransportError("ENGINE_IDENTITY_MISMATCH");
        }
        const bound = await this.rpc(instance, "bindOwner", owner);
        if (!this.current(instance) || this.ownerJson !== owner)
          throw new EngineTransportError("WORKER_REPLACED");
        if (JSON.parse(bound).ok !== true) {
          this.fault();
          throw new EngineTransportError("CALENDAR_OWNER_REJECTED");
        }
      })();
      void this.calendarReady.catch(() => {});
    }
    const instance = this.calendarInstance;
    await this.calendarReady;
    if (!this.current(instance) || this.ownerJson !== owner)
      throw new EngineTransportError("WORKER_REPLACED");
    return {
      incarnation: instance,
      invoke: (operation, json) => this.rpc(instance, operation, json),
      source: (header, source) =>
        this.rpcMessage(instance, { kind: "CALENDAR_SOURCE", header, source }),
      finalize: (header, source) =>
        this.rpcMessage(instance, { kind: "CALENDAR_WINDOW_FINALIZE", header, source }),
      current: () => !this.closed && this.calendarInstance === instance && this.ownerJson === owner,
    };
  }

  private instances(): Record<EngineLane, Instance> {
    if (this.pair) return this.pair;
    const finance = this.create("finance");
    try {
      this.pair = { finance, checks: this.create("checks") };
    } catch {
      this.destroy(finance, "WORKER_INIT_FAILED");
      throw new EngineTransportError("WORKER_INIT_FAILED");
    }
    return this.pair;
  }
  private create(lane: EngineLane | "calendar"): Instance {
    let resolveReady!: (engine: string) => void;
    let rejectReady!: (error: EngineTransportError) => void;
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void ready.catch(() => {});
    const worker = lane === "calendar" ? this.calendarFactory!() : this.factory(lane);
    const instance: Instance = {
      worker,
      ready,
      resolveReady,
      rejectReady,
      pending: new Map(),
      sourceAssembly: false,
      calendarPreflight: false,
      catalogPreflight: false,
      profileClock: false,
      formPending: new Map(),
      formResources: false,
      financialCollation: false,
      calendarResources: false,
      listener: (event) => this.receive(instance, event.data),
      failure: () => {
        if (this.current(instance)) this.fault();
      },
    };
    worker.addEventListener("message", instance.listener);
    worker.addEventListener("error", instance.failure);
    worker.addEventListener("messageerror", instance.failure);
    instance.timer = setTimeout(instance.failure, 30_000);
    return instance;
  }
  private receive(instance: Instance, raw: unknown) {
    if (!this.current(instance)) return;
    if (!raw || typeof raw !== "object") {
      this.fault();
      return;
    }
    const value = raw as Record<string, unknown>;
    if (
      value.kind === "READY" &&
      typeof value.engineVersion === "string" &&
      value.engineVersion.length <= 128 &&
      value.abiVersion === 1
    ) {
      clearTimeout(instance.timer);
      instance.sourceAssembly = value.sourceAssembly === true;
      instance.calendarPreflight = value.calendarPreflight === true;
      instance.catalogPreflight = value.catalogPreflight === true;
      instance.profileClock = value.profileClock === true;
      instance.financialCollation = value.financialCollation === true;
      instance.calendarResources = value.calendarResources === true;
      instance.formResources = value.formResources === true;
      instance.resolveReady(value.engineVersion);
      return;
    }
    if (value.kind === "FATAL") {
      this.fault();
      return;
    }
    if (Number.isSafeInteger(value.id)) {
      const form = instance.formPending.get(value.id as number);
      if (form) {
        instance.formPending.delete(value.id as number);
        if (
          value.kind === "FORM_REPLY" &&
          typeof value.metadataJson === "string" &&
          value.metadataJson.length <= formLimits.metadataBytes &&
          (value.planBody === null ||
            (typeof value.planBody === "string" &&
              value.planBody.length <= formLimits.rawBodyBytes))
        )
          form.resolve({
            metadataJson: value.metadataJson,
            planBody: value.planBody as string | null,
          });
        else form.reject(new EngineTransportError("INVALID_FORM_REPLY"));
        return;
      }
    }
    if ((value.kind !== "REPLY" && value.kind !== "ERROR") || !Number.isSafeInteger(value.id)) {
      this.fault();
      return;
    }
    const pending = instance.pending.get(value.id as number);
    if (!pending) return;
    instance.pending.delete(value.id as number);
    if (
      value.kind === "REPLY" &&
      typeof value.json === "string" &&
      value.json.length <= pending.maximum
    )
      pending.resolve(value.json);
    else pending.reject(new EngineTransportError("WORKER_REPLY_REJECTED"));
  }
  private current(instance: Instance) {
    return (
      this.pair?.finance === instance ||
      this.pair?.checks === instance ||
      this.calendarInstance === instance
    );
  }
  private rpc(instance: Instance, operation: EngineOperation, payload: string) {
    return this.rpcMessage(instance, { kind: "INVOKE", operation, payload });
  }
  private rpcMessage(instance: Instance, message: Record<string, unknown>) {
    if (instance.pending.size + instance.formPending.size >= 16)
      return Promise.reject(new EngineTransportError("WORKER_QUEUE_FULL"));
    if (this.sequence >= Number.MAX_SAFE_INTEGER)
      return Promise.reject(new EngineTransportError("RPC_SEQUENCE_EXHAUSTED"));
    const id = ++this.sequence;
    return new Promise<string>((resolve, reject) => {
      instance.pending.set(id, {
        resolve,
        reject,
        maximum:
          message.kind === "CALENDAR_SOURCE" ||
          message.operation === "runFinance" ||
          message.operation === "runChecks"
            ? TRANSPORT_LIMITS.inputBytes
            : TRANSPORT_LIMITS.outputBytes,
      });
      try {
        instance.worker.postMessage({ ...message, id });
      } catch {
        instance.pending.delete(id);
        reject(new EngineTransportError("WORKER_SEND_FAILED"));
      }
    });
  }
  private formRpc(
    instance: Instance,
    header: string,
    source: string,
  ): Promise<FormTransportResponse> {
    if (!this.current(instance)) return Promise.reject(new EngineTransportError("WORKER_REPLACED"));
    if (instance.pending.size + instance.formPending.size >= 16)
      return Promise.reject(new EngineTransportError("WORKER_QUEUE_FULL"));
    if (this.sequence >= Number.MAX_SAFE_INTEGER)
      return Promise.reject(new EngineTransportError("RPC_SEQUENCE_EXHAUSTED"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      instance.formPending.set(id, { resolve, reject });
      try {
        instance.worker.postMessage({ kind: "FORM_RESOURCE", id, header, source });
      } catch {
        instance.formPending.delete(id);
        reject(new EngineTransportError("WORKER_SEND_FAILED"));
      }
    });
  }
  private fault() {
    this.discard("WORKER_FAILED");
    for (const listener of this.listeners) listener();
  }
  private discard(code: string) {
    const pair = this.pair;
    const calendar = this.calendarInstance;
    this.pair = undefined;
    this.calendarInstance = undefined;
    this.calendarReady = undefined;
    this.ownerJson = undefined;
    this.expectedEngine = undefined;
    if (pair) {
      this.destroy(pair.finance, code);
      this.destroy(pair.checks, code);
    }
    if (calendar) this.destroy(calendar, code);
  }
  private destroy(instance: Instance, code: string) {
    clearTimeout(instance.timer);
    instance.worker.removeEventListener("message", instance.listener);
    instance.worker.removeEventListener("error", instance.failure);
    instance.worker.removeEventListener("messageerror", instance.failure);
    instance.worker.terminate();
    instance.rejectReady(new EngineTransportError(code));
    for (const pending of instance.pending.values()) pending.reject(new EngineTransportError(code));
    instance.pending.clear();
    for (const pending of instance.formPending.values())
      pending.reject(new EngineTransportError(code));
    instance.formPending.clear();
  }
}

export function createWebEngineClient(
  workerUrl: string | URL,
  factory?: (lane: EngineLane) => EngineWorker,
  calendarFactory?: () => EngineWorker,
): EngineClient {
  return new EngineClient(
    new WebEngineBackend(
      factory ??
        ((lane) =>
          new Worker(workerUrl, {
            type: "module",
            name: `luna-engine-${lane}`,
          }) as unknown as EngineWorker),
      calendarFactory ??
        (!factory
          ? () =>
              new Worker(workerUrl, {
                type: "module",
                name: "luna-engine-calendar",
              }) as unknown as EngineWorker
          : undefined),
    ),
  );
}
