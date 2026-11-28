import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { EntryTextKind } from "@/features/day-editor/entry-text-editor-session";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { SoftScrollAnchor, SoftScrollScope, SoftScrollView } from "@/ui/soft-scroll-layout";
import { TextInput } from "@/ui/text";
import { TextEditorHeader } from "@/ui/text-editor-header";
import { TEXT_EDITOR_STYLES } from "@/ui/text-editor-styles";

const ENTRY_TITLE_MAX_LENGTH = 60;

export function EntryTextEditor({
  kind,
  onCancel,
  onConfirm,
  value,
}: {
  readonly kind: EntryTextKind;
  readonly onCancel: () => void;
  readonly onConfirm: (value: string) => void;
  readonly value: string;
}) {
  const palette = usePalette();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(value);
  const multiline = kind === "note";
  const title = multiline ? "Notizen" : "Titel";
  const canConfirm = draft !== value && (multiline || draft.trim().length > 0);

  function confirm() {
    if (canConfirm) onConfirm(draft);
  }

  const field = (
    <View
      style={[
        TEXT_EDITOR_STYLES.field,
        multiline && styles.noteField,
        { backgroundColor: palette.surfaceMuted },
      ]}
    >
      <TextInput
        ref={input}
        accessibilityLabel={title}
        autoCapitalize="sentences"
        autoFocus
        keyboardAppearance={palette.dark ? "dark" : "light"}
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        maxLength={multiline ? undefined : ENTRY_TITLE_MAX_LENGTH}
        multiline={multiline}
        onChangeText={setDraft}
        onSubmitEditing={multiline ? undefined : confirm}
        placeholder={multiline ? title : "Ohne Titel"}
        placeholderTextColor={palette.textMuted}
        returnKeyType={multiline ? "default" : "done"}
        selectionColor={palette.primary}
        style={[TEXT_EDITOR_STYLES.input, multiline && styles.noteInput, { color: palette.text }]}
        submitBehavior={multiline ? "newline" : "submit"}
        value={draft}
      />
      {!multiline && draft.length > 0 ? (
        <Pressable
          accessibilityLabel="Titel löschen"
          accessibilityRole="button"
          onPress={() => {
            setDraft("");
            input.current?.focus();
          }}
          style={({ pressed }) => [TEXT_EDITOR_STYLES.clear, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Ionicons color={palette.textMuted} name="close-circle" size={22} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View
      style={[TEXT_EDITOR_STYLES.sheet, { backgroundColor: palette.surface }]}
      testID="entry-text-sheet"
    >
      <SoftScrollScope>
        <SoftScrollAnchor>
          <TextEditorHeader
            title={title}
            canConfirm={canConfirm}
            onCancel={onCancel}
            onConfirm={confirm}
          />
          {multiline ? null : field}
        </SoftScrollAnchor>
        {multiline ? (
          <SoftScrollView
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            style={styles.noteScroll}
          >
            {field}
          </SoftScrollView>
        ) : null}
      </SoftScrollScope>
    </View>
  );
}

const styles = StyleSheet.create({
  noteScroll: { flex: 1 },
  noteField: { alignItems: "stretch", paddingRight: SPACING.lg },
  noteInput: {
    minHeight: 176,
    maxHeight: 296,
    paddingVertical: SPACING.md,
    textAlignVertical: "top",
  },
});
