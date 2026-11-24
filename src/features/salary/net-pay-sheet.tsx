import type { PropsWithChildren, ReactNode } from "react";
import { Platform, View } from "react-native";
import { SPACING } from "@/theme/tokens";
import { SelectionSheet } from "@/ui/selection-sheet";
import { SurfaceCard } from "@/ui/design-system";

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
  luna = false,
}: PropsWithChildren<{
  readonly title: string;
  readonly visible: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly footer?: ReactNode;
  readonly contentKey?: string;
  readonly luna?: boolean;
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
      luna={luna}
    >
      {() => (
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          {luna && Platform.OS === "ios" ? (
            <SurfaceCard testID="net-pay-sheet-card" style={{ paddingTop: SPACING.md }}>
              {children}
            </SurfaceCard>
          ) : (
            children
          )}
        </View>
      )}
    </SelectionSheet>
  );
}
