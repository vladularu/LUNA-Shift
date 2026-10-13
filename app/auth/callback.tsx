import { useEffect } from "react";
import { router } from "expo-router";
import { LoadingView } from "@/ui/loading-view";
/** The correlated PKCE browser flow owns the code; routing never exchanges tokens. */
export default function AuthCallback() {
  useEffect(() => {
    router.replace("/calendar-sharing");
  }, []);
  return <LoadingView />;
}
