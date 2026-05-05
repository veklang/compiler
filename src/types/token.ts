import type { Span } from "@/types/position";
import type { Keyword, Operator, Punctuator } from "@/types/shared";

export { keywords } from "@/types/shared";

export type TokenKind =
  | "Identifier"
  | "Keyword"
  | "Number"
  | "String"
  | "TemplateString"
  | "Operator"
  | "Punctuator"
  | "EOF";

export type TemplatePart =
  | { kind: "literal"; value: string; span: Span }
  | { kind: "interpolation"; source: string; span: Span };

export interface Token {
  kind: TokenKind;
  lexeme: string;
  span: Span;
  keyword?: Keyword;
  operator?: Operator;
  punctuator?: Punctuator;
  templateParts?: TemplatePart[];
}
