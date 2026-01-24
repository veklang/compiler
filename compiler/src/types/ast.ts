import type { Span } from "@/types/position";
import type { LiteralType, Operator } from "@/types/shared";

export interface Node {
  kind: string;
  span: Span;
}

export interface Program extends Node {
  kind: "Program";
  body: Statement[];
}

export type Statement =
  | ImportDeclaration
  | ExportDefaultDeclaration
  | FunctionDeclaration
  | VariableDeclaration
  | TypeAliasDeclaration
  | StructDeclaration
  | EnumDeclaration
  | ClassDeclaration
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | MatchStatement
  | BreakStatement
  | ContinueStatement
  | BlockStatement
  | ExpressionStatement;

export interface Identifier extends Node {
  kind: "Identifier";
  name: string;
}

export interface StringLiteralExpression extends LiteralExpression {
  literalType: "String";
  value: string;
}

export interface BlockStatement extends Node {
  kind: "BlockStatement";
  body: Statement[];
}

export interface ImportDeclaration extends Node {
  kind: "ImportDeclaration";
  defaultImport?: Identifier;
  namedImports?: Identifier[];
  source: StringLiteralExpression;
}

export interface ExportDefaultDeclaration extends Node {
  kind: "ExportDefaultDeclaration";
  expression?: Expression;
  symbols?: Identifier[];
  exportAll?: boolean;
}

export interface FunctionDeclaration extends Node {
  kind: "FunctionDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  params: ParameterNode[];
  returnType?: TypeNode;
  body: BlockStatement;
  isInline: boolean;
  isPublic: boolean;
}

export interface Parameter extends Node {
  kind: "Parameter";
  name: Identifier;
  type: TypeNode;
  isMutable: boolean;
  isNamedOnly: boolean;
  defaultValue?: Expression;
}

export interface VariadicParameter extends Node {
  kind: "VariadicParameter";
  name: Identifier;
  type: TypeNode;
}

export interface KwVariadicParameter extends Node {
  kind: "KwVariadicParameter";
  name: Identifier;
  type: TypeNode;
}

export interface ParameterSeparator extends Node {
  kind: "ParameterSeparator";
  separator: "*" | "**";
}

export type ParameterNode =
  | Parameter
  | VariadicParameter
  | KwVariadicParameter
  | ParameterSeparator;

export interface VariableDeclaration extends Node {
  kind: "VariableDeclaration";
  declarationKind: "let" | "const";
  name: BindingPattern;
  typeAnnotation?: TypeNode;
  initializer?: Expression;
  isPublic: boolean;
}

export type BindingPattern = Identifier | TupleBinding;

export interface TupleBinding extends Node {
  kind: "TupleBinding";
  elements: Identifier[];
}

export interface TypeAliasDeclaration extends Node {
  kind: "TypeAliasDeclaration";
  name: Identifier;
  type: TypeNode;
  isPublic: boolean;
}

export interface StructDeclaration extends Node {
  kind: "StructDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  fields: StructField[];
  isPublic: boolean;
}

export interface StructField extends Node {
  kind: "StructField";
  name: Identifier;
  type: TypeNode;
}

export interface EnumDeclaration extends Node {
  kind: "EnumDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  variants: EnumVariant[];
  isPublic: boolean;
}

export interface EnumVariant extends Node {
  kind: "EnumVariant";
  name: Identifier;
  payload?: TypeNode[];
}

export interface ClassDeclaration extends Node {
  kind: "ClassDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  isAbstract: boolean;
  isStatic: boolean;
  isPublic: boolean;
  extendsType?: TypeNode;
  implementsTypes?: TypeNode[];
  members: ClassMember[];
}

export type ClassMember = ClassField | ClassMethod;

export interface ClassField extends Node {
  kind: "ClassField";
  name: Identifier;
  type: TypeNode;
  isPublic: boolean;
  isStatic: boolean;
}

export interface ClassMethod extends Node {
  kind: "ClassMethod";
  name: Identifier;
  params: ParameterNode[];
  returnType?: TypeNode;
  body: BlockStatement | null;
  isPublic: boolean;
  isStatic: boolean;
  isGetter: boolean;
  isSetter: boolean;
  isAbstract: boolean;
}

export interface ReturnStatement extends Node {
  kind: "ReturnStatement";
  value?: Expression;
}

export interface IfStatement extends Node {
  kind: "IfStatement";
  condition: Expression;
  thenBranch: BlockStatement;
  elseBranch?: BlockStatement | IfStatement;
}

export interface WhileStatement extends Node {
  kind: "WhileStatement";
  condition: Expression;
  body: BlockStatement;
}

export interface ForStatement extends Node {
  kind: "ForStatement";
  iterator: Identifier;
  iterable: Expression;
  body: BlockStatement;
}

export interface MatchStatement extends Node {
  kind: "MatchStatement";
  expression: Expression;
  arms: MatchArm[];
}

export interface MatchArm extends Node {
  kind: "MatchArm";
  pattern: Pattern;
  body: BlockStatement | Expression;
}

export type Pattern =
  | IdentifierPattern
  | LiteralPattern
  | WildcardPattern
  | EnumPattern;

export interface IdentifierPattern extends Node {
  kind: "IdentifierPattern";
  name: Identifier;
}

export interface LiteralPattern extends Node {
  kind: "LiteralPattern";
  literal: LiteralExpression;
}

export interface WildcardPattern extends Node {
  kind: "WildcardPattern";
}

export interface EnumPattern extends Node {
  kind: "EnumPattern";
  name: Identifier;
  bindings: Identifier[];
}

export interface BreakStatement extends Node {
  kind: "BreakStatement";
}

export interface ContinueStatement extends Node {
  kind: "ContinueStatement";
}

export interface ExpressionStatement extends Node {
  kind: "ExpressionStatement";
  expression: Expression;
}

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | BinaryExpression
  | UnaryExpression
  | AssignmentExpression
  | CallExpression
  | MemberExpression
  | ArrayLiteralExpression
  | TupleLiteralExpression
  | MapLiteralExpression
  | StructLiteralExpression
  | GroupingExpression
  | FunctionExpression
  | CastExpression;

export interface LiteralExpression extends Node {
  kind: "LiteralExpression";
  literalType: LiteralType;
  value: string;
}

export interface IdentifierExpression extends Node {
  kind: "IdentifierExpression";
  name: string;
}

export interface BinaryExpression extends Node {
  kind: "BinaryExpression";
  operator: Operator;
  left: Expression;
  right: Expression;
}

export interface AssignmentExpression extends Node {
  kind: "AssignmentExpression";
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends Node {
  kind: "UnaryExpression";
  operator: Operator;
  argument: Expression;
}

export interface CallExpression extends Node {
  kind: "CallExpression";
  callee: Expression;
  args: Argument[];
}

export type Argument =
  | PositionalArgument
  | NamedArgument
  | SpreadArgument
  | KwSpreadArgument;

export interface PositionalArgument extends Node {
  kind: "PositionalArgument";
  value: Expression;
}

export interface NamedArgument extends Node {
  kind: "NamedArgument";
  name: Identifier;
  value: Expression;
}

export interface SpreadArgument extends Node {
  kind: "SpreadArgument";
  value: Expression;
}

export interface KwSpreadArgument extends Node {
  kind: "KwSpreadArgument";
  value: Expression;
}

export interface MemberExpression extends Node {
  kind: "MemberExpression";
  object: Expression;
  property: Identifier;
}

export interface ArrayLiteralExpression extends Node {
  kind: "ArrayLiteralExpression";
  elements: Expression[];
}

export interface TupleLiteralExpression extends Node {
  kind: "TupleLiteralExpression";
  elements: Expression[];
}

export interface MapLiteralExpression extends Node {
  kind: "MapLiteralExpression";
  entries: MapEntry[];
}

export interface MapEntry extends Node {
  kind: "MapEntry";
  key: Expression;
  value: Expression;
}

export interface StructLiteralExpression extends Node {
  kind: "StructLiteralExpression";
  name: IdentifierExpression;
  fields: StructLiteralField[];
}

export interface StructLiteralField extends Node {
  kind: "StructLiteralField";
  name: Identifier;
  value: Expression;
}

export interface GroupingExpression extends Node {
  kind: "GroupingExpression";
  expression: Expression;
}

export interface FunctionExpression extends Node {
  kind: "FunctionExpression";
  params: ParameterNode[];
  returnType?: TypeNode;
  body: BlockStatement;
}

export interface CastExpression extends Node {
  kind: "CastExpression";
  expression: Expression;
  type: TypeNode;
}

export type TypeNode = NamedType | UnionType | TupleType | FunctionType;

export interface TypeParameter extends Node {
  kind: "TypeParameter";
  name: Identifier;
}

export interface NamedType extends Node {
  kind: "NamedType";
  name: Identifier;
  typeArgs?: TypeNode[];
}

export interface UnionType extends Node {
  kind: "UnionType";
  types: TypeNode[];
}

export interface TupleType extends Node {
  kind: "TupleType";
  elements: TypeNode[];
}

export interface FunctionType extends Node {
  kind: "FunctionType";
  params: TypeNode[];
  returnType: TypeNode;
}
