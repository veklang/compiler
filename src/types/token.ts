export type TokenType =
  | "Keyword"
  | "Identifier"
  | "Operator"
  | "OperatorCompound"
  | "String"
  | "Integer"
  | "Float"
  | "True"
  | "False"
  | "Null"
  | "Punctuation"
  | "Delimiter"
  | "Whitespace";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}
