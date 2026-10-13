import type { Session, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

/** Private per-user invalidations only. Every read still passes through the authorized RPC. */
export function watchSharingChanges(client: SupabaseClient, invalidate: () => void): () => void {
  let stopped = false;
  let epoch = 0;
  let channel: RealtimeChannel | null = null;
  let account: string | null = null;
  async function connect(session: Session | null, ticket: number) {
    if (stopped || ticket !== epoch) return;
    const next = session?.user.id ?? null;
    if (next === account && channel) return;
    const previous = channel;
    channel = null;
    account = next;
    if (previous) await client.removeChannel(previous);
    if (!session || stopped || ticket !== epoch) return;
    await client.realtime.setAuth(session.access_token);
    if (stopped || ticket !== epoch) return;
    channel = client
      .channel(`sharing:${session.user.id}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => {
        if (!stopped && ticket === epoch) invalidate();
      })
      .subscribe((status) => {
        if (!stopped && ticket === epoch && status === "SUBSCRIBED") invalidate();
      });
  }
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id === account && channel) return;
    const ticket = ++epoch;
    // Never run asynchronous auth work under Supabase's auth callback lock.
    void Promise.resolve()
      .then(() => connect(session, ticket))
      .catch(() => {});
  });
  const ticket = epoch;
  void client.auth
    .getSession()
    .then(({ data }) => connect(data.session, ticket))
    .catch(() => {});
  return () => {
    stopped = true;
    ++epoch;
    subscription.data.subscription.unsubscribe();
    if (channel) void client.removeChannel(channel).catch(() => {});
    channel = null;
  };
}
