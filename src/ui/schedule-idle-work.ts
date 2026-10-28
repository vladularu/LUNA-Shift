export interface IdleWorkBudget {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}
export function scheduleIdleWork(
  work: (budget?: IdleWorkBudget) => void,
  options: { readonly timeout?: number; readonly fallbackDelayMs?: number } = { timeout: 250 },
): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(
      work,
      options.timeout === undefined ? undefined : { timeout: options.timeout },
    );
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(work, options.fallbackDelayMs ?? 0);
  return () => clearTimeout(handle);
}
