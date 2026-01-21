import type { Span } from "@/types/position";
import type { LiteralType, Operator } from "@/types/shared";

export interface BaseNode {
  type: string;
  span: Span;
}

export interface Program extends BaseNode {
  type: "Program";
  body: Statement[];
}

export type Statement = ExpressionStatement;

export interface ExpressionStatement extends BaseNode {
  type: "ExpressionStatement";
  expression: Expression;
}

export type Expression =
  | BinaryExpression
  | UnaryExpression
  | LiteralExpression
  | IdentifierExpression
  | GroupingExpression
  | AssignmentExpression;

export interface BinaryExpression extends BaseNode {
  type: "BinaryExpression";
  operator: Operator;
  left: Expression;
  right: Expression;
}

export interface AssignmentExpression extends BaseNode {
  type: "AssignmentExpression";
  operator: Operator;
  left: IdentifierExpression;
  right: Expression;
}

export interface UnaryExpression extends BaseNode {
  type: "UnaryExpression";
  operator: Operator;
  argument: Expression;
}

export interface GroupingExpression extends BaseNode {
  type: "GroupingExpression";
  expression: Expression;
}

export interface IdentifierExpression extends BaseNode {
  type: "IdentifierExpression";
  name: string;
}

export interface LiteralExpression extends BaseNode {
  type: "LiteralExpression";
  literalType: LiteralType;
  value: string | number | boolean | null;
}
