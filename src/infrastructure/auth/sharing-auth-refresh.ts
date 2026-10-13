export type SessionRefreshPort = {
  startAutoRefresh(): void | Promise<void>;
  stopAutoRefresh(): void | Promise<void>;
};
export type AuthLifecyclePort = {
  currentState: string | null;
  subscribe(listener: (status: string) => void): () => void;
};

export function bindSharingSessionRefresh(
  auth: SessionRefreshPort,
  lifecycle: AuthLifecyclePort,
): () => void {
  function changed(status: string | null) {
    if (status === "active") void Promise.resolve(auth.startAutoRefresh()).catch(() => undefined);
    else void Promise.resolve(auth.stopAutoRefresh()).catch(() => undefined);
  }
  changed(lifecycle.currentState);
  const remove = lifecycle.subscribe(changed);
  return () => {
    remove();
    void Promise.resolve(auth.stopAutoRefresh()).catch(() => undefined);
  };
}
