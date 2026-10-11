import type { PropsWithChildren, ReactNode } from "react";
import { View } from "react-native";
import { SPACING } from "@/theme/tokens";
import { SelectionSheet } from "@/ui/selection-sheet";

export function NetPaySheet({
  title,
  visible,
  busy,
  onClose,
  onBack,
  backLabel,
  footer,
  contentKey,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly visible: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly footer?: ReactNode;
  readonly contentKey?: string;
}>) {
  if (!visible) return null;
  return (
    <SelectionSheet
      title={title}
      visible={visible}
      disabled={busy}
      onClose={onClose}
      cancelLabel="Schließen"
      keyboardAware
      closeInHeader
      onBack={onBack}
      backLabel={backLabel}
      footer={footer}
      contentKey={contentKey}
    >
      {() => <View style={{ padding: SPACING.lg, gap: SPACING.md }}>{children}</View>}
    </SelectionSheet>
  );
}
