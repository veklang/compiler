export const keywords = [
  "in",
  "return",
  "exit",
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
  "Array",
  "Tuple",
  "Map",
  "Callable",
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
  "drop",
  "alloc",
  "typeof",
  "sizeof",
  "inline",
  "fn",
  "mod",
  "use",
] as const;

export const literals = [
  "Identifier",
  "String",
  "Integer",
  "Float",
  "True",
  "False",
  "Null",
] as const;

export const punctuation = [
  "LeftParen",
  "RightParen",
  "LeftBrace",
  "RightBrace",
  "Comma",
  "Dot",
  "Semicolon",
] as const;

export const operators = [
  "Minus",
  "Plus",
  "Slash",
  "Asterisk",
  "Bang",
  "BangEqual",
  "Equal",
  "EqualEqual",
  "Greater",
  "GreaterEqual",
  "Less",
  "LessEqual",
] as const;

export type TokenType =
  | "Punctuation"
  | "Operator"
  | "Keyword"
  | "Literal"
  | "Identifier";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}
