import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";

const CloudDataRefreshContext = createContext<(() => Promise<void>) | null>(null);

// Mount inside SQLiteProvider: consumers reread committed cloud data while
// pending native statements keep their existing database and module alive.
export function CloudDataRefreshBoundary({ children }: PropsWithChildren) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(async () => {
    setRevision((current) => current + 1);
  }, []);

  return (
    <CloudDataRefreshContext.Provider value={refresh}>
      <Fragment key={revision}>{children}</Fragment>
    </CloudDataRefreshContext.Provider>
  );
}

export function useCloudDataRefresh() {
  const refresh = useContext(CloudDataRefreshContext);
  if (!refresh) throw new Error("CloudDataRefreshBoundary fehlt");
  return refresh;
}
