import type { ReactNode } from "react";

export interface LunaChoiceMenuProps<T extends string> {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly layout?: "row" | "field" | "inline";
  readonly displayLabel?: string;
  readonly displayValue?: string;
  readonly accessibilityLabel?: string;
  readonly testPrefix?: string;
  readonly field?: {
    readonly inlineLabel: boolean;
    readonly leadingSymbol?: "mappin";
    readonly error?: string;
  };
  readonly fallback?: ReactNode;
}

export function LunaChoiceMenu<T extends string>({ fallback }: LunaChoiceMenuProps<T>) {
  return fallback ?? null;
}
