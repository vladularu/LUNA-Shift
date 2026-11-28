import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { EntryTextEditor } from "@/features/day-editor/entry-text-editor";
import {
  clearEntryTextEditorRequest,
  pendingEntryTextEditor,
} from "@/features/day-editor/entry-text-editor-session";

export default function EntryTextEditorRoute() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  const [session] = useState(() => pendingEntryTextEditor(request));
  const closed = useRef(false);

  useEffect(() => {
    clearEntryTextEditorRequest(request);
  }, [request]);

  if (!session) return <Redirect href="/" />;

  function close(onConfirm?: () => void) {
    if (closed.current) return;
    closed.current = true;
    Keyboard.dismiss();
    onConfirm?.();
    router.back();
  }

  return (
    <EntryTextEditor
      kind={session.kind}
      value={session.value}
      onCancel={() => close()}
      onConfirm={(value) => close(() => session.onConfirm(value))}
    />
  );
}
