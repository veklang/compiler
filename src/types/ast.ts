import type { Token } from "./token";

export type NodeType =
  | "Program"
  | "Block"
  | "VarDeclaration"
  | "FunctionDeclaration"
  | "ClassDeclaration"
  | "IfStatement"
  | "WhileStatement"
  | "ForStatement"
  | "ReturnStatement"
  | "ExpressionStatement"
  | "BinaryExpression"
  | "UnaryExpression"
  | "CallExpression"
  | "MemberExpression"
  | "AssignmentExpression"
  | "Identifier"
  | "Literal";

export interface Node {
  type: NodeType;
  location: {
    start: Token;
    end: Token;
  };
}

export interface Program extends Node {
  type: "Program";
  body: Statement[];
}

export interface Block extends Node {
  type: "Block";
  statements: Statement[];
}

export interface VarDeclaration extends Node {
  type: "VarDeclaration";
  name: Token;
  typeAnnotation?: Token;
  initializer?: Expression;
  isConst: boolean;
}

export interface FunctionDeclaration extends Node {
  type: "FunctionDeclaration";
  name: Token;
  params: {
    name: Token;
    type: Token;
  }[];
  returnType?: Token;
  body: Block;
  isStatic?: boolean;
  isPublic?: boolean;
}

export interface ClassDeclaration extends Node {
  type: "ClassDeclaration";
  name: Token;
  superClass?: Token;
  implements?: Token[];
  methods: FunctionDeclaration[];
  fields: VarDeclaration[];
}

export interface IfStatement extends Node {
  type: "IfStatement";
  condition: Expression;
  thenBranch: Statement;
  elseBranch?: Statement;
}

export interface WhileStatement extends Node {
  type: "WhileStatement";
  condition: Expression;
  body: Statement;
}

export interface ForStatement extends Node {
  type: "ForStatement";
  initializer?: VarDeclaration | Expression;
  condition?: Expression;
  increment?: Expression;
  body: Statement;
}

export interface ReturnStatement extends Node {
  type: "ReturnStatement";
  value?: Expression;
}

export interface ExpressionStatement extends Node {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface BinaryExpression extends Node {
  type: "BinaryExpression";
  operator: Token;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends Node {
  type: "UnaryExpression";
  operator: Token;
  operand: Expression;
}

export interface CallExpression extends Node {
  type: "CallExpression";
  callee: Expression;
  args: Expression[];
}

export interface MemberExpression extends Node {
  type: "MemberExpression";
  object: Expression;
  property: Token;
}

export interface AssignmentExpression extends Node {
  type: "AssignmentExpression";
  operator: Token;
  left: Expression;
  right: Expression;
}

export interface Identifier extends Node {
  type: "Identifier";
  name: Token;
}

export interface Literal extends Node {
  type: "Literal";
  value: Token;
}

export type Expression =
  | BinaryExpression
  | UnaryExpression
  | CallExpression
  | MemberExpression
  | AssignmentExpression
  | Identifier
  | Literal;

export type Statement =
  | Block
  | VarDeclaration
  | FunctionDeclaration
  | ClassDeclaration
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | ExpressionStatement;
