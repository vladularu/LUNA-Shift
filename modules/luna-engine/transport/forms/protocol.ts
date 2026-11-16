export const FORM_RESOURCE_LIMITS = Object.freeze({
  headerBytes: 8192,
  rawBodyBytes: 16_515_072,
  replyBytes: 33_554_432,
  metadataBytes: 1_048_576,
  dutyBodyBytes: 262_144,
  builders: 4,
  resources: 4,
  pending: 32,
});

/** The worker splits the potentially large native frame before crossing the
 * host UI boundary. planBody is the original native JSON string, never facts. */
export interface FormTransportResponse {
  readonly metadataJson: string;
  readonly planBody: string | null;
}
export interface FormEndpoint {
  invoke(headerJson: string, rawBody: string): Promise<FormTransportResponse>;
  current(): boolean;
  retire(): void;
  collectRetired(): Promise<void>;
}
declare const source: unique symbol;
declare const resource: unique symbol;
declare const permit: unique symbol;
export interface FormSourceTicket {
  readonly [source]: true;
}
export interface FormResourceTicket {
  readonly [resource]: true;
}
export interface FormWritePermit {
  readonly [permit]: true;
}

export interface FormReply {
  readonly state: string;
  readonly rowCount?: number;
  readonly validUntilEpochMilliseconds?: number | null;
  readonly values?: readonly string[];
  readonly rows?: readonly unknown[];
  readonly offset?: number;
  readonly total?: number;
  readonly view?: unknown;
  readonly presentation?: unknown;
  readonly effects?: unknown;
  readonly reason?: { readonly code: string; readonly source?: string };
  readonly error?: unknown;
  readonly feedback?: unknown;
  readonly receipt?: unknown;
  readonly terminal?: boolean;
  /** Native review metadata; source rows and permits remain private. */
  readonly review?: unknown;
  readonly reviewNotice?: unknown;
  readonly billing?: unknown;
}
/** Private native write scope for the raw SQL adapter, never renderer props. */
export interface DayWriteSelection {
  readonly shiftIds: readonly string[];
  readonly appointmentIds: readonly string[];
}
export type FormOpenOutcome =
  | { readonly state: "READY"; readonly resource: FormResourceTicket; readonly reply: FormReply }
  | { readonly state: "UNAVAILABLE"; readonly reply: FormReply };
export type FormPayrollOpenOutcome =
  FormOpenOutcome | { readonly state: "NEEDS_FINANCE"; readonly reply: FormReply };
export interface FormWriteGrant {
  readonly stamp: {
    readonly dataSpaceId: string;
    readonly inputToken: string;
    readonly databaseSchemaVersion: number;
  };
  readonly body: string;
}
