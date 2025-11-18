import type {
  Operator as BaseOperator,
  LiteralType,
  PunctuationType,
} from "@/types/shared";

export { keywords } from "@/types/shared";

export type Punctuation = `Punctuation:${PunctuationType}`;

export type Operator = `Operator:${BaseOperator}`;

export type Literal = `Literal:${LiteralType}`;

export type Special = "Special:EOL" | "Special:EOF";

export type TokenType =
  | Punctuation
  | Operator
  | Literal
  | Special
  | "Keyword"
  | "Identifier";

export interface Token {
  type: TokenType;
  lexeme: string;
  line: number;
  column: number;
}
