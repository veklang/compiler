import type { Span } from "@/types/position";
import type { Operator, Punctuator } from "@/types/shared";

export { keywords } from "@/types/shared";

export type TokenKind =
  | "Identifier"
  | "Keyword"
  | "Number"
  | "String"
  | "Operator"
  | "Punctuator"
  | "EOL"
  | "EOF";

export interface Token {
  kind: TokenKind;
  lexeme: string;
  span: Span;
  value?: number | string;
  operator?: Operator;
  punctuator?: Punctuator;
}
