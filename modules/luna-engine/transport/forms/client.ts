import { checkedRawSourceString, checkedUtf8Length, EngineTransportError } from "../protocol";
import {
  checkFormMetadata,
  fail,
  integer,
  object,
  readFormHeader,
  sameFormScope,
  type FormHeader,
} from "./header";
import {
  FORM_RESOURCE_LIMITS as limits,
  type FormEndpoint,
  type FormOpenOutcome,
  type FormPayrollOpenOutcome,
  type FormReply,
  type FormResourceTicket,
  type FormSourceTicket,
  type FormWriteGrant,
  type FormWritePermit,
  type DayWriteSelection,
} from "./protocol";

export interface FormEnvironment {
  capture(): number;
  current(ownerGeneration: number): boolean;
  ready(ownerGeneration: number): Promise<FormEndpoint>;
}
interface State {
  readonly domain: "PROFILE" | "PAYROLL" | "DAY" | "DAY_DETAILS";
  readonly generation: number;
  readonly opening: FormHeader;
  readonly lifetime?: () => boolean;
  endpoint?: FormEndpoint;
  phase: "STARTING" | "BUILDER" | "RESOURCE" | "CLOSED";
  id?: number;
  revision: number;
  draft: number;
  write?: number;
  selection?: DayWriteSelection;
  closeKind?: "BUILDER" | "RESOURCE";
  readonly cleanup: Set<string>;
  tail: Promise<void>;
  pending: number;
}
interface Permit {
  readonly state: State;
  readonly write: number;
  used: boolean;
}
/** IDs are private to one exact backend incarnation. No thin UI DTO is an
 * opening source, no form mutates the global report preparation generation. */
export class FormResources {
  private readonly states = new Set<State>();
  private readonly sources = new WeakMap<FormSourceTicket, State>();
  private readonly resources = new WeakMap<FormResourceTicket, State>();
  private readonly permits = new WeakMap<FormWritePermit, Permit>();
  private raw = false;
  private beginning = 0;
  private pending = 0;
  constructor(private readonly environment: FormEnvironment) {}

  beginProfile(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FormSourceTicket> {
    return this.beginSource("PROFILE", json, options);
  }
  beginDayEditor(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FormSourceTicket> {
    return this.beginSource("DAY", json, options);
  }
  beginDayDetails(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FormSourceTicket> {
    return this.beginSource("DAY_DETAILS", json, options);
  }
  private async beginSource(
    domain: "PROFILE" | "DAY" | "DAY_DETAILS",
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FormSourceTicket> {
    const header = readFormHeader(json);
    if (
      header.command.kind !==
      (domain === "DAY"
        ? "BEGIN_DAY_EDITOR"
        : domain === "DAY_DETAILS"
          ? "BEGIN_DAY_DETAILS"
          : "BEGIN_PROFILE")
    )
      return fail();
    this.prune();
    if (
      this.beginning >= limits.builders ||
      [...this.states].filter((s) => s.phase !== "RESOURCE").length >= limits.builders
    )
      return fail("FORM_QUEUE_FULL");
    const state: State = {
      domain,
      generation: this.environment.capture(),
      opening: header,
      lifetime: options.isCurrent,
      phase: "STARTING",
      revision: 0,
      draft: header.guard.draftRevision,
      tail: Promise.resolve(),
      pending: 0,
      cleanup: new Set(),
    };
    this.states.add(state);
    this.beginning++;
    try {
      this.ensure(state);
      state.endpoint = await this.environment.ready(state.generation);
      this.ensure(state);
      const bound = { ...header, guard: { ...header.guard, draftRevision: 0 } };
      const response = await state.endpoint.invoke(JSON.stringify(bound), "");
      const metadata = this.metadata(state, response, bound);
      if (
        metadata.state !==
          (domain === "DAY"
            ? "DAY_SOURCE_OPEN"
            : domain === "DAY_DETAILS"
              ? "DAY_DETAILS_SOURCE_OPEN"
              : "PROFILE_SOURCE_OPEN") ||
        !integer(metadata.builderId, 1)
      )
        return this.invalid(state);
      // Retain the original incarnation before checking a late host fence, so
      // cleanup can close its own builder rather than a replacement's ID1.
      state.id = metadata.builderId;
      state.closeKind = "BUILDER";
      if (state.phase !== "CLOSED") state.phase = "BUILDER";
      this.ensure(state);
      const ticket = Object.freeze({}) as FormSourceTicket;
      this.sources.set(ticket, state);
      return ticket;
    } catch (error) {
      this.closeState(state);
      throw this.safe(error);
    } finally {
      this.beginning--;
    }
  }
  async beginPayroll(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FormPayrollOpenOutcome> {
    const header = readFormHeader(json);
    if (header.command.kind !== "BEGIN_PAYROLL") return fail();
    this.prune();
    if (
      this.beginning >= limits.builders ||
      [...this.states].filter(
        (s) => s.phase === "RESOURCE" || (s.phase === "STARTING" && s.domain === "PAYROLL"),
      ).length >= limits.resources
    )
      return fail("FORM_QUEUE_FULL");
    const state: State = {
      domain: "PAYROLL",
      generation: this.environment.capture(),
      opening: header,
      lifetime: options.isCurrent,
      phase: "STARTING",
      revision: 0,
      draft: header.guard.draftRevision,
      tail: Promise.resolve(),
      pending: 0,
      cleanup: new Set(),
    };
    this.states.add(state);
    this.beginning++;
    try {
      this.ensure(state);
      state.endpoint = await this.environment.ready(state.generation);
      this.ensure(state);
      const bound = { ...header, guard: { ...header.guard, draftRevision: 0 } };
      const response = await state.endpoint.invoke(JSON.stringify(bound), "");
      const metadata = this.metadata(state, response, bound);
      if (metadata.state === "FORM_UNAVAILABLE" || metadata.state === "PAYROLL_NEEDS_FINANCE") {
        this.ensure(state);
        if (["resourceId", "resourceRevision", "view"].some((k) => Object.hasOwn(metadata, k)))
          return this.invalid(state);
        if (metadata.state === "FORM_UNAVAILABLE") this.unavailable(state, metadata);
        this.consumed(state);
        return {
          state: metadata.state === "FORM_UNAVAILABLE" ? "UNAVAILABLE" : "NEEDS_FINANCE",
          reply: this.publicReply(metadata),
        };
      }
      if (
        metadata.state !== "PAYROLL_READY" ||
        !integer(metadata.resourceId, 1) ||
        metadata.resourceRevision !== 0
      )
        return this.invalid(state);
      state.id = metadata.resourceId;
      state.closeKind = "RESOURCE";
      if (state.phase !== "CLOSED") state.phase = "RESOURCE";
      this.ensure(state);
      const resource = Object.freeze({}) as FormResourceTicket;
      this.resources.set(resource, state);
      return { state: "READY", resource, reply: this.publicReply(metadata) };
    } catch (error) {
      this.closeState(state);
      throw this.safe(error);
    } finally {
      this.beginning--;
    }
  }
  supply(ticket: FormSourceTicket, json: string, raw: string): Promise<FormReply> {
    return this.operation(this.source(ticket), json, raw, "SOURCE");
  }
  sourceDay(ticket: FormSourceTicket, json: string, raw: string): Promise<FormReply> {
    const state = this.source(ticket);
    if (state.domain !== "DAY") return fail();
    return this.operation(state, json, raw, "DAY_SOURCE");
  }
  open(ticket: FormSourceTicket, json: string): Promise<FormOpenOutcome> {
    return this.openSource(ticket, json, "PROFILE");
  }
  openDayEditor(ticket: FormSourceTicket, json: string): Promise<FormOpenOutcome> {
    return this.openSource(ticket, json, "DAY");
  }
  dayDetailsSource(ticket: FormSourceTicket, json: string, raw = ""): Promise<FormReply> {
    const state = this.source(ticket),
      kind = readFormHeader(json).command.kind;
    if (
      state.domain !== "DAY_DETAILS" ||
      ![
        "DAY_DETAILS_SOURCE",
        "DAY_DETAILS_CATALOG",
        "PREPARE_DAY_DETAILS",
        "DAY_DETAILS_CANDIDATES",
        "DAY_DETAILS_CALENDAR_RANKS",
      ].includes(kind)
    )
      return fail();
    return this.operation(state, json, raw, kind);
  }
  openDayDetails(ticket: FormSourceTicket, json: string, raw: string): Promise<FormOpenOutcome> {
    return this.openSource(ticket, json, "DAY_DETAILS", raw);
  }
  dayDetailsRows(ticket: FormResourceTicket, json: string): Promise<FormReply> {
    const state = this.resource(ticket);
    if (state.domain !== "DAY_DETAILS") return fail();
    return this.operation(state, json, "", "DAY_DETAILS_ROWS");
  }
  private async openSource(
    ticket: FormSourceTicket,
    json: string,
    domain: "PROFILE" | "DAY" | "DAY_DETAILS",
    raw = "",
  ): Promise<FormOpenOutcome> {
    const state = this.source(ticket);
    if (state.domain !== domain) return fail();
    if ([...this.states].filter((s) => s.phase === "RESOURCE").length >= limits.resources)
      return fail("FORM_QUEUE_FULL");
    const reply = await this.operation(
      state,
      json,
      raw,
      domain === "DAY"
        ? "OPEN_DAY_EDITOR"
        : domain === "DAY_DETAILS"
          ? "OPEN_DAY_DETAILS"
          : "OPEN_PROFILE",
    );
    if (reply.state === "FORM_UNAVAILABLE") {
      this.sources.delete(ticket);
      return { state: "UNAVAILABLE", reply };
    }
    if (state.phase !== "RESOURCE") return this.invalid(state);
    const resource = Object.freeze({}) as FormResourceTicket;
    this.resources.set(resource, state);
    this.sources.delete(ticket);
    return { state: "READY", resource, reply };
  }
  event(ticket: FormResourceTicket, json: string, raw = ""): Promise<FormReply> {
    const state = this.resource(ticket);
    if (state.domain === "DAY_DETAILS") return fail();
    if (raw) {
      const event = readFormHeader(json).command.event;
      const profileIntent =
        state.domain === "PROFILE" && object(event) && event.kind === "INTENT_BODY";
      if (state.domain !== "DAY" && !profileIntent) return fail();
      const reviewSource =
        state.domain === "DAY" &&
        object(event) &&
        ["REVIEW_CALENDAR", "REVIEW_CATALOG", "REVIEW_FINISH"].includes(String(event.kind));
      checkedRawSourceString(raw, reviewSource ? limits.rawBodyBytes : limits.dutyBodyBytes);
    }
    return this.operation(
      state,
      json,
      raw,
      state.domain === "PROFILE"
        ? "PROFILE_EVENT"
        : state.domain === "DAY"
          ? "DAY_EVENT"
          : "PAYROLL_EVENT",
    ).then((reply) => {
      if (reply.state === "CLOSED") {
        this.consumed(state);
      }
      return reply;
    });
  }
  async useDayWriteSelection<T>(
    ticket: FormResourceTicket,
    consumer: (selection: DayWriteSelection) => Promise<T>,
  ): Promise<T> {
    const state = this.resource(ticket),
      write = state.write;
    if (state.domain !== "DAY" || !write || !state.selection) return fail("STALE_FORM_WRITE");
    if (this.pending >= limits.pending) return fail("FORM_QUEUE_FULL");
    this.pending++;
    state.pending++;
    const task = state.tail.then(async () => {
      this.ensure(state);
      if (state.write !== write || !state.selection) return fail("STALE_FORM_WRITE");
      const value = await consumer(state.selection);
      this.ensure(state);
      if (state.write !== write) return fail("STALE_FORM_WRITE");
      return value;
    });
    state.tail = task.then(
      () => {},
      () => {},
    );
    return task.finally(() => {
      this.pending--;
      state.pending--;
    });
  }
  async writeContext(
    ticket: FormResourceTicket,
    json: string,
    raw: string,
  ): Promise<{ readonly reply: FormReply; readonly permit?: FormWritePermit }> {
    const state = this.resource(ticket);
    const reply = await this.operation(state, json, raw, "WRITE_CONTEXT");
    if (reply.state !== "WRITE_PERMIT_READY") return { reply };
    if (!state.write) return this.invalid(state);
    const permit = Object.freeze({}) as FormWritePermit;
    this.permits.set(permit, { state, write: state.write, used: false });
    return { reply, permit };
  }
  async takeWrite(
    permit: FormWritePermit,
    json: string,
    current: () => boolean,
  ): Promise<FormWriteGrant> {
    const p = this.permits.get(permit);
    if (!p || p.used || p.state.write !== p.write || !this.host(current))
      return fail("STALE_FORM_WRITE");
    p.used = true;
    let grant: FormWriteGrant | undefined;
    await this.operation(p.state, json, "", "TAKE_WRITE", (metadata, body) => {
      if (
        metadata.state !== "WRITE_PLAN_TAKEN" ||
        typeof body !== "string" ||
        !object(metadata.stamp)
      )
        return this.invalid(p.state);
      const s = metadata.stamp;
      if (
        Object.keys(s).length !== 3 ||
        typeof s.dataSpaceId !== "string" ||
        !/^[a-f0-9]{32}$/.test(s.dataSpaceId) ||
        typeof s.inputToken !== "string" ||
        !/^[a-f0-9]{32}$/.test(s.inputToken) ||
        !integer(s.databaseSchemaVersion, 1)
      )
        return this.invalid(p.state);
      grant = {
        stamp: {
          dataSpaceId: s.dataSpaceId,
          inputToken: s.inputToken,
          databaseSchemaVersion: s.databaseSchemaVersion,
        },
        body,
      };
    });
    if (!grant || !this.host(current)) return fail("STALE_FORM_WRITE");
    return grant;
  }
  async ack(ticket: FormResourceTicket, json: string): Promise<FormReply> {
    const state = this.resource(ticket);
    const reply = await this.operation(state, json, "", "ACK_WRITE");
    if (state.domain === "PAYROLL") {
      this.consumed(state);
    }
    return reply;
  }
  abortWrite(ticket: FormResourceTicket, json: string): Promise<FormReply> {
    return this.operation(this.resource(ticket), json, "", "ABORT_WRITE");
  }
  close(ticket: FormSourceTicket | FormResourceTicket): void {
    const state =
      this.sources.get(ticket as FormSourceTicket) ??
      this.resources.get(ticket as FormResourceTicket);
    if (!state) return fail("INVALID_FORM_TICKET");
    this.closeState(state);
  }
  isCurrent(ticket: FormSourceTicket | FormResourceTicket): boolean {
    const s =
      this.sources.get(ticket as FormSourceTicket) ??
      this.resources.get(ticket as FormResourceTicket);
    return !!s && this.current(s);
  }
  invalidate(): void {
    for (const state of [...this.states]) this.closeState(state);
  }

  private operation(
    state: State,
    json: string,
    raw: string,
    kind: string,
    consume?: (metadata: Record<string, unknown>, body: string | null) => void,
  ): Promise<FormReply> {
    try {
      this.ensure(state);
      const header = readFormHeader(json);
      if (
        header.command.kind !== kind ||
        !sameFormScope(state.opening, header) ||
        header.guard.draftRevision < state.draft
      )
        return fail();
      checkedRawSourceString(raw, limits.rawBodyBytes);
      const isRaw = raw.length > 0;
      if (isRaw && this.raw) return fail("FORM_BUSY");
      if (this.pending >= limits.pending) return fail("FORM_QUEUE_FULL");
      if (isRaw) this.raw = true;
      state.draft = header.guard.draftRevision;
      state.pending++;
      this.pending++;
      const task = state.tail.then(async () => {
        this.ensure(state);
        const builder = state.phase === "BUILDER";
        if (
          [
            "SOURCE",
            "DAY_SOURCE",
            "OPEN_PROFILE",
            "OPEN_DAY_EDITOR",
            "DAY_DETAILS_SOURCE",
            "DAY_DETAILS_CATALOG",
            "PREPARE_DAY_DETAILS",
            "DAY_DETAILS_CANDIDATES",
            "DAY_DETAILS_CALENDAR_RANKS",
            "OPEN_DAY_DETAILS",
          ].includes(kind) !== builder
        )
          return fail("STALE_FORM_RESOURCE");
        if (
          ["WRITE_CONTEXT", "TAKE_WRITE", "ACK_WRITE", "ABORT_WRITE"].includes(kind) &&
          !state.write
        )
          return fail("STALE_FORM_WRITE");
        const command = {
          ...header.command,
          ...(builder
            ? { builderId: state.id }
            : { resourceId: state.id, resourceRevision: state.revision }),
          ...(["WRITE_CONTEXT", "TAKE_WRITE", "ACK_WRITE", "ABORT_WRITE"].includes(kind)
            ? { writeId: state.write }
            : {}),
        };
        // Caller drafts order host intents. Only the private serial resource
        // queue knows the native revision; the UI cannot provide that proof.
        const bound = {
          ...header,
          guard: { ...header.guard, draftRevision: builder ? 0 : state.revision },
          command,
        };
        const wire = JSON.stringify(bound);
        checkedUtf8Length(wire, limits.headerBytes);
        const response = await state.endpoint!.invoke(wire, raw);
        const metadata = this.metadata(state, response, bound);
        if (
          ["OPEN_PROFILE", "OPEN_DAY_EDITOR", "OPEN_DAY_DETAILS"].includes(kind) &&
          metadata.state === "FORM_UNAVAILABLE"
        ) {
          this.ensure(state);
          this.unavailable(state, metadata);
          // The native builder was consumed, but no resource or readiness
          // proof was created. It is a legitimate independent IO outcome.
          this.consumed(state);
          return this.publicReply(metadata);
        }
        this.update(state, metadata, kind);
        // Late OPEN may have produced a different private ID. Adopt it only
        // for cleanup before rejecting a closed or obsolete host resource.
        this.ensure(state);
        consume?.(metadata, response.planBody);
        return this.publicReply(metadata);
      });
      state.tail = task.then(
        () => {},
        () => {},
      );
      return task
        .catch((error) => {
          if (!this.current(state)) this.closeState(state);
          throw this.safe(error);
        })
        .finally(() => {
          state.pending--;
          this.pending--;
          if (isRaw) this.raw = false;
        });
    } catch (error) {
      return Promise.reject(this.safe(error));
    }
  }
  private update(state: State, m: Record<string, unknown>, kind: string): void {
    if (m.terminal !== undefined && typeof m.terminal !== "boolean") return this.invalid(state);
    if (["OPEN_PROFILE", "OPEN_DAY_EDITOR", "OPEN_DAY_DETAILS"].includes(kind)) {
      if (
        !(state.domain === "DAY_DETAILS"
          ? ["DAY_DETAILS_READY", "DAY_DETAILS_LOADING"].includes(m.state as string)
          : m.state === (state.domain === "DAY" ? "DAY_READY" : "PROFILE_READY")) ||
        !integer(m.resourceId, 1) ||
        m.resourceRevision !== 0
      )
        return this.invalid(state);
      state.id = m.resourceId;
      state.closeKind = "RESOURCE";
      state.revision = 0;
      if (state.phase !== "CLOSED") state.phase = "RESOURCE";
    } else if (state.phase === "RESOURCE" || state.closeKind === "RESOURCE") {
      if (m.resourceId !== undefined && m.resourceId !== state.id) return this.invalid(state);
      if (m.resourceRevision !== undefined) {
        if (!integer(m.resourceRevision) || m.resourceRevision < state.revision)
          return this.invalid(state);
        state.revision = m.resourceRevision;
      }
    }
    if (state.domain === "DAY_DETAILS") {
      if (
        ["writeId", "selection", "planBody", "stamp", "effects", "receipt"].some((k) =>
          Object.hasOwn(m, k),
        )
      )
        return this.invalid(state);
      if (
        kind === "DAY_DETAILS_CANDIDATES" &&
        (m.state !== "DAY_DETAILS_CANDIDATES" ||
          !integer(m.offset) ||
          !integer(m.total) ||
          m.total > 100000 ||
          !Array.isArray(m.values) ||
          m.values.length > 128 ||
          !m.values.every((v) => typeof v === "string" && v.length <= 300000) ||
          m.offset + m.values.length > m.total)
      )
        return this.invalid(state);
      if (
        kind === "DAY_DETAILS_ROWS" &&
        (m.state !== "DAY_DETAILS_ROWS" ||
          !integer(m.offset) ||
          !integer(m.total) ||
          !Array.isArray(m.rows) ||
          m.rows.length > 128 ||
          m.offset + m.rows.length > m.total)
      )
        return this.invalid(state);
      if (
        kind === "OPEN_DAY_DETAILS" &&
        (!integer(m.rowCount) ||
          (m.validUntilEpochMilliseconds !== undefined &&
            m.validUntilEpochMilliseconds !== null &&
            !Number.isSafeInteger(m.validUntilEpochMilliseconds)))
      )
        return this.invalid(state);
    }
    if (m.writeId !== undefined) {
      if (!integer(m.writeId, 1)) return this.invalid(state);
      if (state.write !== m.writeId) state.selection = undefined;
      state.write = m.writeId;
    }
    if (m.selection !== undefined) {
      const selection = m.selection;
      const ids = (v: unknown): v is string[] =>
        Array.isArray(v) &&
        v.length <= 100000 &&
        v.every((id) => typeof id === "string" && id.length > 0 && id.length <= 300000);
      if (
        state.domain !== "DAY" ||
        !state.write ||
        !object(selection) ||
        Object.keys(selection).length !== 2 ||
        !ids(selection.shiftIds) ||
        !ids(selection.appointmentIds)
      )
        return this.invalid(state);
      state.selection = Object.freeze({
        shiftIds: Object.freeze([...selection.shiftIds]),
        appointmentIds: Object.freeze([...selection.appointmentIds]),
      });
    }
    if (["ACK_WRITE", "ABORT_WRITE"].includes(kind)) {
      state.write = undefined;
      state.selection = undefined;
    }
    if (
      ["PROFILE_READY", "PAYROLL_READY", "DAY_READY"].includes(m.state as string) &&
      m.writeId === undefined
    ) {
      state.write = undefined;
      state.selection = undefined;
    }
    if (
      state.domain === "DAY" &&
      ["WRITE_CONTEXT_REQUIRED", "WRITE_PERMIT_READY"].includes(m.state as string) &&
      !state.selection
    )
      return this.invalid(state);
  }
  private publicReply(m: Record<string, unknown>): FormReply {
    // Explicit public surface; private IDs, guards and plan text stay here.
    return {
      state: m.state as string,
      ...(Object.hasOwn(m, "view") ? { view: m.view } : {}),
      ...(Object.hasOwn(m, "presentation") ? { presentation: m.presentation } : {}),
      ...(Object.hasOwn(m, "effects") ? { effects: m.effects } : {}),
      ...(Object.hasOwn(m, "reason") ? { reason: m.reason as FormReply["reason"] } : {}),
      ...(Object.hasOwn(m, "error") ? { error: m.error } : {}),
      ...(Object.hasOwn(m, "feedback") ? { feedback: m.feedback } : {}),
      ...(Object.hasOwn(m, "receipt") ? { receipt: m.receipt } : {}),
      ...(Object.hasOwn(m, "terminal") ? { terminal: m.terminal as boolean } : {}),
      ...(Object.hasOwn(m, "review") ? { review: m.review } : {}),
      ...(Object.hasOwn(m, "reviewNotice") ? { reviewNotice: m.reviewNotice } : {}),
      ...(Object.hasOwn(m, "billing") ? { billing: m.billing } : {}),
      ...(Object.hasOwn(m, "validUntilEpochMilliseconds")
        ? { validUntilEpochMilliseconds: m.validUntilEpochMilliseconds as number | null }
        : {}),
      ...(Object.hasOwn(m, "rowCount") ? { rowCount: m.rowCount as number } : {}),
      ...(Object.hasOwn(m, "values") ? { values: m.values as readonly string[] } : {}),
      ...(Object.hasOwn(m, "rows") ? { rows: m.rows as readonly unknown[] } : {}),
      ...(Object.hasOwn(m, "offset") ? { offset: m.offset as number } : {}),
      ...(Object.hasOwn(m, "total") ? { total: m.total as number } : {}),
    };
  }
  private unavailable(state: State, metadata: Record<string, unknown>): void {
    if (
      !object(metadata.reason) ||
      typeof metadata.reason.code !== "string" ||
      !metadata.reason.code ||
      metadata.reason.code.length > 96 ||
      Object.keys(metadata.reason).some((k) => k !== "code" && k !== "source") ||
      (metadata.reason.source !== undefined &&
        (typeof metadata.reason.source !== "string" || metadata.reason.source.length > 96)) ||
      ["resourceId", "resourceRevision", "view"].some((k) => Object.hasOwn(metadata, k))
    )
      return this.invalid(state);
  }
  private source(t: FormSourceTicket): State {
    const s = this.sources.get(t);
    if (!s || s.phase !== "BUILDER") return fail("INVALID_FORM_TICKET");
    this.ensure(s);
    return s;
  }
  private resource(t: FormResourceTicket): State {
    const s = this.resources.get(t);
    if (!s || s.phase !== "RESOURCE") return fail("INVALID_FORM_TICKET");
    this.ensure(s);
    return s;
  }
  private ensure(s: State): void {
    if (!this.current(s)) return fail("STALE_FORM_RESOURCE");
  }
  private current(s: State): boolean {
    return (
      s.phase !== "CLOSED" &&
      this.environment.current(s.generation) &&
      (!s.endpoint || s.endpoint.current()) &&
      this.host(s.lifetime)
    );
  }
  private host(check?: () => boolean): boolean {
    try {
      return !check || check();
    } catch {
      return false;
    }
  }
  private invalid(s: State): never {
    s.endpoint?.retire();
    this.closeState(s);
    return fail("INVALID_FORM_REPLY");
  }
  private prune(): void {
    for (const s of [...this.states]) if (!this.current(s)) this.closeState(s);
  }
  private closeState(s: State): void {
    s.phase = "CLOSED";
    this.states.delete(s);
    const endpoint = s.endpoint,
      id = s.id;
    if (!endpoint || !id || !s.closeKind || !endpoint.current()) return;
    const key = `${s.closeKind}:${id}`;
    if (s.cleanup.has(key)) return;
    s.cleanup.add(key);
    const closeKind = s.closeKind;
    // A pending native event may advance the revision even after its UI has
    // closed. Consume that private reply for cleanup, then close its own ID.
    void s.tail
      .then(() => {
        if (!endpoint.current()) return;
        const header = {
          ...s.opening,
          guard: { ...s.opening.guard, draftRevision: closeKind === "BUILDER" ? 0 : s.revision },
          command:
            closeKind === "BUILDER"
              ? { kind: "CLOSE_BUILDER", builderId: id }
              : { kind: "CLOSE_RESOURCE", resourceId: id },
        };
        return endpoint.invoke(JSON.stringify(header), "");
      })
      .then(() => (endpoint.current() ? endpoint.collectRetired() : undefined))
      .catch(() => {});
  }
  private consumed(s: State): void {
    s.phase = "CLOSED";
    this.states.delete(s);
    // The controller has already retired the resource; do not issue a second
    // close or keep large native owners idle until another form is opened.
    if (s.endpoint?.current()) void s.endpoint.collectRetired().catch(() => {});
  }
  private metadata(
    s: State,
    response: Parameters<typeof checkFormMetadata>[0],
    header: FormHeader,
  ): Record<string, unknown> {
    try {
      return checkFormMetadata(response, header);
    } catch (error) {
      if (!(error instanceof EngineTransportError) || error.code !== "FORM_RESOURCE_REJECTED")
        return this.invalid(s);
      throw error;
    }
  }
  private safe(error: unknown): EngineTransportError {
    return error instanceof EngineTransportError
      ? error
      : new EngineTransportError("FORM_RESOURCE_FAILED");
  }
}
