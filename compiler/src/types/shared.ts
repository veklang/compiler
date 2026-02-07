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
  "impl",
  "trait",
  "enum",
  "type",
  // Reserved/frozen OOP words (not active syntax)
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
  "i8",
  "i16",
  "i32",
  "i64",
  "u8",
  "u16",
  "u32",
  "u64",
  "f16",
  "f32",
  "f64",
  "bool",
  "string",
  // Literals
  "true",
  "false",
  "NaN",
  "Infinity",
] as const;

export type Keyword = (typeof keywords)[number];

export type Operator =
  | "+"
  | "-"
  | "!"
  | "*"
  | "**"
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
