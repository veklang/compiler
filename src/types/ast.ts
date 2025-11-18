import type { LiteralType, Operator } from "@/types/shared";
import type { Token } from "./token";

export type NodeType = "Literal" | "Expression";

export type { LiteralType } from "@/types/shared";

export type ExpressionType = "Binary" | "Unary" | "Assignment";

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
