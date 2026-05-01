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
  | FunctionDeclaration
  | VariableDeclaration
  | TypeAliasDeclaration
  | StructDeclaration
  | TraitDeclaration
  | EnumDeclaration
  | BuiltinDeclaration
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | MatchStatement
  | BreakStatement
  | ContinueStatement
  | AssignmentStatement
  | BlockStatement
  | ExpressionStatement;

export interface Identifier extends Node {
  kind: "Identifier";
  name: string;
}

export interface BlockStatement extends Node {
  kind: "BlockStatement";
  body: Statement[];
}

export interface ImportDeclaration extends Node {
  kind: "ImportDeclaration";
  source: StringLiteralExpression;
  namespace?: Identifier;
  namedImports?: Identifier[];
}

export interface FunctionDeclaration extends Node {
  kind: "FunctionDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  params: Parameter[];
  returnType?: TypeNode;
  whereClause?: WhereConstraint[];
  body?: BlockStatement;
  externName?: StringLiteralExpression;
  isInline: boolean;
  isUnsafe: boolean;
  isExtern: boolean;
  isPublic: boolean;
}

export interface MethodDeclaration extends Node {
  kind: "MethodDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  params: Parameter[];
  returnType?: TypeNode;
  whereClause?: WhereConstraint[];
  body: BlockStatement;
  isInline: boolean;
  isUnsafe: boolean;
}

export interface TraitMethodSignature extends Node {
  kind: "TraitMethodSignature";
  name: Identifier;
  typeParams?: TypeParameter[];
  params: Parameter[];
  returnType?: TypeNode;
  whereClause?: WhereConstraint[];
}

export interface AssociatedTypeDeclaration extends Node {
  kind: "AssociatedTypeDeclaration";
  name: Identifier;
  bound?: NamedType;
}

export interface AssociatedTypeDefinition extends Node {
  kind: "AssociatedTypeDefinition";
  name: Identifier;
  type: TypeNode;
}

export interface VariableDeclaration extends Node {
  kind: "VariableDeclaration";
  declarationKind: "let" | "const";
  name: BindingPattern;
  typeAnnotation?: TypeNode;
  initializer?: Expression;
  isPublic: boolean;
}

export type BindingPattern =
  | Identifier
  | WildcardBindingPattern
  | TupleBindingPattern;

export interface WildcardBindingPattern extends Node {
  kind: "WildcardBindingPattern";
}

export interface TupleBindingPattern extends Node {
  kind: "TupleBindingPattern";
  elements: BindingPattern[];
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
  members: StructMember[];
  isPublic: boolean;
}

export type StructMember =
  | StructField
  | MethodDeclaration
  | TraitSatisfiesDeclaration;

export interface StructField extends Node {
  kind: "StructField";
  name: Identifier;
  type: TypeNode;
}

export interface EnumDeclaration extends Node {
  kind: "EnumDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  members: EnumMember[];
  isPublic: boolean;
}

export type EnumMember =
  | EnumVariant
  | MethodDeclaration
  | TraitSatisfiesDeclaration;

export interface EnumVariant extends Node {
  kind: "EnumVariant";
  name: Identifier;
  payload?: TypeNode[];
}

export interface TraitDeclaration extends Node {
  kind: "TraitDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  members: TraitMember[];
  isPublic: boolean;
}

export type TraitMember = TraitMethodSignature | AssociatedTypeDeclaration;

export interface TraitSatisfiesDeclaration extends Node {
  kind: "TraitSatisfiesDeclaration";
  trait: NamedType;
  associatedTypes: AssociatedTypeDefinition[];
  methods: MethodDeclaration[];
}

export interface BuiltinDeclaration extends Node {
  kind: "BuiltinDeclaration";
  name: Identifier;
  typeParams?: TypeParameter[];
  members: BuiltinMember[];
}

export type BuiltinMember = TraitMethodSignature | BuiltinSatisfiesBlock;

export interface BuiltinSatisfiesBlock extends Node {
  kind: "BuiltinSatisfiesBlock";
  trait: NamedType;
  whereClause?: WhereConstraint[];
  associatedTypes: AssociatedTypeDefinition[];
  methods: TraitMethodSignature[];
}

export interface TypeParameter extends Node {
  kind: "TypeParameter";
  name: Identifier;
  bounds?: NamedType[];
}

export interface WhereConstraint extends Node {
  kind: "WhereConstraint";
  typeName: Identifier;
  trait: NamedType;
}

export type Parameter = NamedParameter | SelfParameter;

export interface NamedParameter extends Node {
  kind: "NamedParameter";
  name: Identifier;
  type: TypeNode;
  isMutable: boolean;
}

export interface SelfParameter extends Node {
  kind: "SelfParameter";
  isMutable: boolean;
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
  iterator: BindingPattern;
  iterable: Expression;
  body: BlockStatement;
}

export interface MatchStatement extends Node {
  kind: "MatchStatement";
  expression: Expression;
  arms: MatchStatementArm[];
}

export interface MatchStatementArm extends Node {
  kind: "MatchStatementArm";
  pattern: Pattern;
  body: BlockStatement;
}

export interface AssignmentStatement extends Node {
  kind: "AssignmentStatement";
  operator: Operator;
  target: AssignableExpression;
  value: Expression;
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
  hasSemicolon: boolean;
}

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | BinaryExpression
  | UnaryExpression
  | CallExpression
  | MemberExpression
  | TupleMemberExpression
  | IndexExpression
  | ArrayLiteralExpression
  | TupleLiteralExpression
  | StructLiteralExpression
  | GroupingExpression
  | FunctionExpression
  | CastExpression
  | UnsafeBlockExpression
  | IfExpression
  | MatchExpression;

export type AssignableExpression =
  | IdentifierExpression
  | MemberExpression
  | TupleMemberExpression
  | IndexExpression
  | UnaryExpression;

export interface LiteralExpression extends Node {
  kind: "LiteralExpression";
  literalType: LiteralType;
  value: string;
}

export interface StringLiteralExpression extends LiteralExpression {
  literalType: "String";
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

export interface UnaryExpression extends Node {
  kind: "UnaryExpression";
  operator: Operator;
  argument: Expression;
}

export interface CallExpression extends Node {
  kind: "CallExpression";
  callee: Expression;
  typeArgs?: TypeNode[];
  args: Expression[];
}

export interface MemberExpression extends Node {
  kind: "MemberExpression";
  object: Expression;
  property: Identifier;
}

export interface TupleMemberExpression extends Node {
  kind: "TupleMemberExpression";
  object: Expression;
  index: number;
}

export interface IndexExpression extends Node {
  kind: "IndexExpression";
  object: Expression;
  index: Expression;
}

export interface ArrayLiteralExpression extends Node {
  kind: "ArrayLiteralExpression";
  elements: Expression[];
}

export interface TupleLiteralExpression extends Node {
  kind: "TupleLiteralExpression";
  elements: Expression[];
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
  params: Parameter[];
  returnType?: TypeNode;
  body: BlockStatement;
}

export interface CastExpression extends Node {
  kind: "CastExpression";
  expression: Expression;
  type: TypeNode;
}

export interface UnsafeBlockExpression extends Node {
  kind: "UnsafeBlockExpression";
  body: BlockStatement;
}

export interface IfExpression extends Node {
  kind: "IfExpression";
  condition: Expression;
  thenBranch: BlockStatement;
  elseBranch: BlockStatement | IfExpression;
}

export interface MatchExpression extends Node {
  kind: "MatchExpression";
  expression: Expression;
  arms: MatchExpressionArm[];
}

export interface MatchExpressionArm extends Node {
  kind: "MatchExpressionArm";
  pattern: Pattern;
  expression: Expression | BlockStatement;
}

export type Pattern =
  | IdentifierPattern
  | LiteralPattern
  | WildcardPattern
  | EnumPattern
  | TuplePattern;

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
  args: Pattern[];
}

export interface TuplePattern extends Node {
  kind: "TuplePattern";
  elements: Pattern[];
}

export type TypeNode =
  | NamedType
  | SelfType
  | NullableType
  | ArrayType
  | TupleType
  | FunctionType;

export interface NamedType extends Node {
  kind: "NamedType";
  name: Identifier;
  typeArgs?: TypeNode[];
}

export interface SelfType extends Node {
  kind: "SelfType";
}

export interface NullableType extends Node {
  kind: "NullableType";
  base: TypeNode;
}

export interface ArrayType extends Node {
  kind: "ArrayType";
  element: TypeNode;
}

export interface TupleType extends Node {
  kind: "TupleType";
  elements: TypeNode[];
}

export interface FunctionType extends Node {
  kind: "FunctionType";
  typeParams?: TypeParameter[];
  params: FunctionTypeParameter[];
  returnType: TypeNode;
  whereClause?: WhereConstraint[];
}

export interface FunctionTypeParameter extends Node {
  kind: "FunctionTypeParameter";
  type: TypeNode;
  isMutable: boolean;
}
