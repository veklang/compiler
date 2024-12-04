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
  "export",
  "import",
  "default",
];

export type Punctuation =
  | "Punctuation:LeftParen"
  | "Punctuation:RightParen"
  | "Punctuation:LeftBrace"
  | "Punctuation:RightBrace"
  | "Punctuation:Comma"
  | "Punctuation:Dot"
  | "Punctuation:Colon"
  | "Punctuation:Semicolon"
  | "Punctuation:QuestionMark";

export type Operator =
  | "Operator:Minus"
  | "Operator:Plus"
  | "Operator:Slash"
  | "Operator:Asterisk"
  | "Operator:Modulo"
  | "Operator:Exponentiation"
  | "Operator:Bang"
  | "Operator:BangEqual"
  | "Operator:Equal"
  | "Operator:EqualEqual"
  | "Operator:Greater"
  | "Operator:GreaterEqual"
  | "Operator:Less"
  | "Operator:LessEqual"
  | "Operator:And"
  | "Operator:AndAnd"
  | "Operator:Or"
  | "Operator:OrOr"
  | "Operator:Xor"
  | "Operator:LeftShift"
  | "Operator:RightShift"
  | "Operator:PlusEqual"
  | "Operator:MinusEqual"
  | "Operator:AsteriskEqual"
  | "Operator:SlashEqual"
  | "Operator:ModuloEqual"
  | "Operator:AndEqual"
  | "Operator:OrEqual"
  | "Operator:XorEqual"
  | "Operator:LeftShiftEqual"
  | "Operator:RightShiftEqual"
  | "Operator:PlusPlus"
  | "Operator:MinusMinus";

export type Literal =
  | "Literal:Identifier"
  | "Literal:String"
  | "Literal:Integer"
  | "Literal:Float"
  | "Literal:True"
  | "Literal:False"
  | "Literal:Null";

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
