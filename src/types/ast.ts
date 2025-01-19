import type { Token } from "./token";

export type NodeType = "Literal" | "Expression";

export type LiteralType =
  | "Identifier"
  | "String"
  | "Integer"
  | "Float"
  | "True"
  | "False"
  | "Null";

export type ExpressionType = "Binary" | "Unary" | "Assignment";

// yes, this was straight up copied from `@/types/token.ts`, i'm sorry
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

export interface BaseNode {
  type: NodeType;
  children?: Node[];
  tokens?: Token[];
}

export interface Literal extends BaseNode {
  type: "Literal";
  literalType: LiteralType;
  value: string | number | boolean | null;
}

export interface Expression extends BaseNode {
  type: "Expression";
  expressionType: ExpressionType;
  operator?: Operator;
  operands: Node[];
}

export type Node = BaseNode | Literal | Expression;
