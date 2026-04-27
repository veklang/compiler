/**
 * Shared type definitions used across the frontend.
 */

export const keywords = [
  "if",
  "else",
  "match",
  "for",
  "in",
  "while",
  "break",
  "continue",
  "return",
  "let",
  "const",
  "fn",
  "inline",
  "extern",
  "struct",
  "type",
  "trait",
  "enum",
  "pub",
  "import",
  "mut",
  "from",
  "as",
  "where",
  "satisfies",
  "Self",
  "void",
  "null",
  "never",
  "true",
  "false",
  "NaN",
  "Infinity",
] as const;

export type Keyword = (typeof keywords)[number];

export type Operator =
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "<<="
  | ">>="
  | "&="
  | "^="
  | "|="
  | "+"
  | "-"
  | "!"
  | "*"
  | "/"
  | "%"
  | "="
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "&&"
  | "||"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "=>"
  | "->";

export type Punctuator =
  | "("
  | ")"
  | "{"
  | "}"
  | "["
  | "]"
  | ","
  | "."
  | ":"
  | ";"
  | "?";

export type LiteralType = "Integer" | "Float" | "String" | "Boolean" | "Null";
