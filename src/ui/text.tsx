import { forwardRef, type ComponentRef } from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";

import { APP_FONT_FAMILY } from "@/theme/app-font";

export type Text = ComponentRef<typeof NativeText>;
export type TextInput = ComponentRef<typeof NativeTextInput>;

function fontStyle(style: TextProps["style"]): TextStyle {
  const resolved = StyleSheet.flatten(style);
  const family = resolved?.fontFamily;
  return {
    fontFamily: family && !family.startsWith("Inter-") ? family : APP_FONT_FAMILY,
  };
}

// Preserve native props, refs, weight, italics, accessibility and Dynamic Type.
// Legacy Inter overrides use the same system font as the rest of the app.
// The native component contract uses the same name for its value and ref type.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const Text = forwardRef<ComponentRef<typeof NativeText>, TextProps>(function DesignText(
  { style, ...props },
  ref,
) {
  return <NativeText ref={ref} {...props} style={[style, fontStyle(style)]} />;
});

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const TextInput = Object.assign(
  forwardRef<ComponentRef<typeof NativeTextInput>, TextInputProps>(function DesignTextInput(
    { style, hitSlop = 2, ...props },
    ref,
  ) {
    return (
      <NativeTextInput ref={ref} {...props} hitSlop={hitSlop} style={[style, fontStyle(style)]} />
    );
  }),
  { State: NativeTextInput.State },
);
