export interface NetPayDateSheetProps {
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly value: Date;
  readonly minimumDate: Date;
  readonly maximumDate: Date;
  readonly onChange: (value: Date) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function NetPayDateSheet(_props: NetPayDateSheetProps) {
  return null;
}
