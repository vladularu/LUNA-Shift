export interface AnnualRestTransport {
  readonly run: (
    payload: string,
  ) => Promise<{ readonly payload: string; readonly nativeMs: number }>;
}
/** Web, host tests and builds without a supported native year engine use TypeScript. */
export function getAnnualRestTransport(): AnnualRestTransport | null {
  return null;
}
