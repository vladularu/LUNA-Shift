export class ReportExportError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "ReportExportError";
  }
}
