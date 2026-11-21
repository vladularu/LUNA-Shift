import { Component, type ReactNode } from "react";
import { router } from "expo-router";
import { complianceDetailsRoute } from "@/navigation/routes";
import { InlineNotice, SectionHeader } from "@/ui/design-system";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { ReportPeriodContent, ReportScrollView } from "@/ui/report-layout";
import { recordDiagnostic } from "@/infrastructure/diagnostics";

export class MonthPreparationError extends Error {
  constructor(readonly original: unknown) {
    super(
      original instanceof Error
        ? original.message
        : "Monatsauswertung konnte nicht berechnet werden.",
    );
  }
}

export function PreparationFailureView({
  month,
  annual = false,
  error,
  retry,
}: {
  month: string;
  annual?: boolean;
  error: unknown;
  retry: () => void;
}) {
  // Only stable internal identifiers may appear here. Native messages can contain local data.
  const code =
    error instanceof Error &&
    /^(?:RUST_(?:MONTH|CHECKS|ANNUAL|SALARY|NET)_[A-Z_]{2,48})$/.test(error.message)
      ? error.message
      : null;
  return (
    <ReportScrollView>
      <ReportPeriodContent>
        <SectionHeader
          title={
            annual
              ? "Jahresauswertung derzeit unvollständig"
              : "Monatsauswertung derzeit unvollständig"
          }
        />
        <InlineNotice
          message={
            "Die Berechnung für " +
            (annual ? month.slice(0, 4) : month) +
            " ist fehlgeschlagen." +
            (code ? " Diagnosecode: " + code : "")
          }
        />
        <PrimaryButton onPress={() => router.push(complianceDetailsRoute(month))}>
          Dienstplan-Check öffnen
        </PrimaryButton>
        <SecondaryButton onPress={retry}>Berechnung erneut versuchen</SecondaryButton>
      </ReportPeriodContent>
    </ReportScrollView>
  );
}

export class MonthPreparationBoundary extends Component<
  { month: string; children: ReactNode },
  { failure: MonthPreparationError | null }
> {
  state: { failure: MonthPreparationError | null } = { failure: null };
  static getDerivedStateFromError(error: unknown) {
    if (!(error instanceof MonthPreparationError)) throw error;
    return { failure: error };
  }
  componentDidUpdate(previous: Readonly<{ month: string; children: ReactNode }>) {
    if (this.state.failure && previous.month !== this.props.month) this.setState({ failure: null });
  }
  componentDidCatch(error: MonthPreparationError) {
    recordDiagnostic("reporting", "MONTH_PREPARATION_FAILED", error.original);
  }
  render() {
    return this.state.failure ? (
      <PreparationFailureView
        month={this.props.month}
        error={this.state.failure.original}
        retry={() => this.setState({ failure: null })}
      />
    ) : (
      this.props.children
    );
  }
}
