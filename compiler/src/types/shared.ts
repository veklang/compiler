/**
 * Shared type definitions used across the lexer and parser.
 */

export const keywords = [
  // Flow
  "if",
  "else",
  "match",
  "for",
  "in",
  "while",
  "break",
  "continue",
  "return",
  // Declarations
  "let",
  "const",
  "fn",
  "inline",
  "struct",
  "enum",
  "alias",
  "class",
  "abstract",
  "extends",
  "implements",
  "constructor",
  "destructor",
  "static",
  "getter",
  "setter",
  "pub",
  "import",
  "default",
  // Types / casts / misc
  "as",
  "void",
  "null",
  "mut",
  "from",
  // Literals
  "true",
  "false",
] as const;

export type Keyword = (typeof keywords)[number];

export type Operator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "=="
  | "!="
  | "is"
  | ">"
  | ">="
  | "<"
  | "<="
  | "&&"
  | "||"
  | "|"
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
