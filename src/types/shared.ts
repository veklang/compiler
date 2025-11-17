/**
 * Shared type definitions used across the lexer and parser.
 * This eliminates duplication between token.ts and ast.ts.
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
  | "Minus"
  | "Plus"
  | "Slash"
  | "Asterisk"
  | "Modulo"
  | "Exponentiation"
  | "Bang"
  | "BangEqual"
  | "Equal"
  | "EqualEqual"
  | "Greater"
  | "GreaterEqual"
  | "Less"
  | "LessEqual"
  | "And"
  | "AndAnd"
  | "Or"
  | "OrOr"
  | "Xor"
  | "LeftShift"
  | "RightShift"
  | "PlusEqual"
  | "MinusEqual"
  | "AsteriskEqual"
  | "SlashEqual"
  | "ModuloEqual"
  | "AndEqual"
  | "OrEqual"
  | "XorEqual"
  | "LeftShiftEqual"
  | "RightShiftEqual"
  | "PlusPlus"
  | "MinusMinus";

export type PunctuationType =
  | "LeftParen"
  | "RightParen"
  | "LeftBrace"
  | "RightBrace"
  | "Comma"
  | "Dot"
  | "Colon"
  | "Semicolon"
  | "QuestionMark";

export type LiteralType =
  | "Identifier"
  | "String"
  | "Integer"
  | "Float"
  | "True"
  | "False"
  | "Null";
