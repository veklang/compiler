/**
 * Shared type definitions used across the lexer and parser.
 */

export const keywords = [
  "in",
  "return",
  "if",
  "else",
  "match",
  "for",
  "while",
  "break",
  "continue",
  "let",
  "const",
  "as",
  "int",
  "i8",
  "i16",
  "i32",
  "i64",
  "uint",
  "u8",
  "u16",
  "u32",
  "u64",
  "float",
  "f16",
  "f32",
  "f64",
  "char",
  "string",
  "bool",
  "true",
  "false",
  "void",
  "null",
  "enum",
  "struct",
  "alias",
  "class",
  "constructor",
  "destructor",
  "extends",
  "implements",
  "abstract",
  "pub",
  "getter",
  "setter",
  "static",
  "inline",
  "fn",
  "export",
  "import",
  "default",
] as const;

export type Operator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "!"
  | "!="
  | "="
  | "=="
  | ">"
  | ">="
  | "<"
  | "<="
  | "&&"
  | "||"
  | "^"
  | "&"
  | "|"
  | "<<"
  | ">>"
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "&="
  | "|="
  | "^="
  | "<<="
  | ">>="
  | "++"
  | "--";

export type Punctuator = "(" | ")" | "{" | "}" | "," | "." | ":" | ";" | "?";

export type LiteralType = "String" | "Number" | "Boolean" | "Null";
