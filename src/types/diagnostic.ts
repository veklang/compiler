import type { Span } from "@/types/position";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  span: Span;
  code?: string;
}
