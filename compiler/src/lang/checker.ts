import type {
  Argument,
  ArrayLiteralExpression,
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  CastExpression,
  ClassDeclaration,
  EnumDeclaration,
  EnumPattern,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  FunctionType,
  Identifier,
  IdentifierExpression,
  IfStatement,
  ImportDeclaration,
  LiteralExpression,
  MapLiteralExpression,
  MatchStatement,
  MemberExpression,
  NamedType,
  Node,
  ParameterNode,
  Pattern,
  Program,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructLiteralExpression,
  TupleBinding,
  TupleLiteralExpression,
  TupleType,
  TypeAliasDeclaration,
  TypeNode,
  TypeParameter,
  UnaryExpression,
  UnionType,
  VariableDeclaration,
  WhileStatement,
} from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";
import type { Span } from "@/types/position";

type SymbolKind =
  | "Value"
  | "Function"
  | "Type"
  | "Struct"
  | "Enum"
  | "Class"
  | "Alias"
  | "Variant"
  | "TypeParam";

interface Symbol {
  kind: SymbolKind;
  name: string;
  node: Node;
  type?: Type;
  params?: ParamInfo[];
  isConst?: boolean;
  isMutable?: boolean;
  isParam?: boolean;
  isPublic?: boolean;
  parentEnum?: Symbol;
  payloadTypes?: Type[];
}

type PrimitiveName =
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "f16"
  | "f32"
  | "f64"
  | "bool"
  | "string"
  | "void"
  | "null";

type Type =
  | PrimitiveType
  | NamedRefType
  | UnionRefType
  | TupleRefType
  | FunctionRefType
  | TypeParamType
  | ErrorType
  | UnknownType;

interface BaseType {
  kind: string;
  aliasable: boolean;
}

interface PrimitiveType extends BaseType {
  kind: "Primitive";
  name: PrimitiveName;
}

interface NamedRefType extends BaseType {
  kind: "Named";
  name: string;
  symbol?: Symbol;
  typeArgs?: Type[];
}

interface UnionRefType extends BaseType {
  kind: "Union";
  types: Type[];
}

interface TupleRefType extends BaseType {
  kind: "Tuple";
  elements: Type[];
}

interface FunctionRefType extends BaseType {
  kind: "Function";
  params: Type[];
  returnType: Type;
}

interface TypeParamType extends BaseType {
  kind: "TypeParam";
  name: string;
}

interface ErrorType extends BaseType {
  kind: "Error";
}

interface UnknownType extends BaseType {
  kind: "Unknown";
}

interface Scope {
  parent?: Scope;
  values: Map<string, Symbol>;
  types: Map<string, Symbol>;
  overrides: Map<string, Type>;
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  types: WeakMap<Node, Type>;
}

const primitiveNames: PrimitiveName[] = [
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
  "void",
  "null",
];

const defaultIntType: PrimitiveName = "i32";
const defaultFloatType: PrimitiveName = "f32";

export class Checker {
  private diagnostics: Diagnostic[] = [];
  private types = new WeakMap<Node, Type>();
  private currentScope: Scope;
  private currentFunction: Symbol | null = null;
  private resolvingAliases = new Set<string>();
  private reportedAliasCycles = new Set<string>();

  constructor(private program: Program) {
    this.currentScope = this.createScope();
    for (const name of primitiveNames) {
      this.declareType(
        {
          kind: "Type",
          name,
          node: this.program,
          type: this.primitive(name),
        },
        this.currentScope,
      );
    }
    for (const name of ["Array", "Map"]) {
      this.declareType(
        {
          kind: "Type",
          name,
          node: this.program,
        },
        this.currentScope,
      );
    }
  }

  public checkProgram(): CheckResult {
    this.predeclareTypes(this.program.body, this.currentScope);
    this.checkStatements(this.program.body, this.currentScope);
    return { diagnostics: this.diagnostics, types: this.types };
  }

  private createScope(parent?: Scope): Scope {
    return {
      parent,
      values: new Map(),
      types: new Map(),
      overrides: new Map(),
    };
  }

  private report(message: string, span: Span, code: string) {
    this.diagnostics.push({ severity: "error", message, span, code });
  }

  private warn(message: string, span: Span, code: string) {
    this.diagnostics.push({ severity: "warning", message, span, code });
  }

  private primitive(name: PrimitiveName): PrimitiveType {
    return { kind: "Primitive", name, aliasable: false };
  }

  private errorType(): ErrorType {
    return { kind: "Error", aliasable: false };
  }

  private unknownType(): UnknownType {
    return { kind: "Unknown", aliasable: false };
  }

  private isError(type: Type) {
    return type.kind === "Error";
  }

  private isUnknown(type: Type) {
    return type.kind === "Unknown" || type.kind === "TypeParam";
  }

  private typeEquals(a: Type, b: Type): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "Primitive" && b.kind === "Primitive")
      return a.name === b.name;
    if (a.kind === "Named" && b.kind === "Named")
      return (
        a.name === b.name &&
        (a.typeArgs === undefined ||
          b.typeArgs === undefined ||
          ((a.typeArgs?.length ?? 0) === (b.typeArgs?.length ?? 0) &&
            (a.typeArgs ?? []).every((t, i) =>
              this.typeEquals(t, b.typeArgs![i]),
            )))
      );
    if (a.kind === "Union" && b.kind === "Union") {
      if (a.types.length !== b.types.length) return false;
      return a.types.every((t, i) => this.typeEquals(t, b.types[i]));
    }
    if (a.kind === "Tuple" && b.kind === "Tuple") {
      if (a.elements.length !== b.elements.length) return false;
      return a.elements.every((t, i) => this.typeEquals(t, b.elements[i]));
    }
    if (a.kind === "Function" && b.kind === "Function") {
      if (a.params.length !== b.params.length) return false;
      if (!this.typeEquals(a.returnType, b.returnType)) return false;
      return a.params.every((t, i) => this.typeEquals(t, b.params[i]));
    }
    if (a.kind === "TypeParam" && b.kind === "TypeParam")
      return a.name === b.name;
    if (a.kind === "Error" && b.kind === "Error") return true;
    if (a.kind === "Unknown" && b.kind === "Unknown") return true;
    return false;
  }

  private isAssignable(from: Type, to: Type): boolean {
    if (this.isError(from) || this.isError(to)) return true;
    if (this.isUnknown(from) || this.isUnknown(to)) return true;
    if (this.typeEquals(from, to)) return true;

    if (from.kind === "Named" && to.kind === "Named")
      if (from.name === to.name && (!from.typeArgs || !to.typeArgs))
        return true;

    if (to.kind === "Union")
      return to.types.some((t) => this.isAssignable(from, t));
    if (from.kind === "Union")
      return from.types.every((t) => this.isAssignable(t, to));
    return false;
  }

  private makeUnion(types: Type[]): Type {
    const flattened: Type[] = [];
    for (const t of types) {
      if (t.kind === "Union") flattened.push(...t.types);
      else flattened.push(t);
    }
    const unique: Type[] = [];
    for (const t of flattened)
      if (!unique.some((u) => this.typeEquals(u, t))) unique.push(t);
    if (unique.length === 0) return this.errorType();
    if (unique.length === 1) return unique[0];
    return {
      kind: "Union",
      types: unique,
      aliasable: unique.every((t) => t.aliasable),
    };
  }

  private removeNull(type: Type): Type {
    const nullType = this.primitive("null");
    if (this.typeEquals(type, nullType)) return this.errorType();
    if (type.kind !== "Union") return type;
    const filtered = type.types.filter((t) => !this.typeEquals(t, nullType));
    if (filtered.length === 0) return this.errorType();
    return this.makeUnion(filtered);
  }

  private isIntegerType(type: Type): type is PrimitiveType {
    return (
      type.kind === "Primitive" &&
      ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"].includes(type.name)
    );
  }

  private isFloatType(type: Type): type is PrimitiveType {
    return (
      type.kind === "Primitive" && ["f16", "f32", "f64"].includes(type.name)
    );
  }

  private isNumericType(type: Type) {
    return this.isIntegerType(type) || this.isFloatType(type);
  }

  private isTruthyType(type: Type): boolean {
    if (type.kind === "Union")
      return type.types.every((t) => this.isTruthyType(t));
    if (type.kind === "Primitive") {
      const name = (type as PrimitiveType).name;
      return (
        name === "bool" ||
        name === "null" ||
        this.isNumericType(type) ||
        name === "string"
      );
    }
    if (type.aliasable) return true;
    return false;
  }

  private isBooleanType(type: Type) {
    return type.kind === "Primitive" && type.name === "bool";
  }

  private isStringType(type: Type) {
    return type.kind === "Primitive" && type.name === "string";
  }

  private isAliasable(type: Type): boolean {
    return type.aliasable;
  }

  private isArrayLike(type: Type): boolean {
    return type.kind === "Named" && type.name === "Array";
  }

  private isMapLike(type: Type): boolean {
    return type.kind === "Named" && type.name === "Map";
  }

  private declareValue(symbol: Symbol, scope: Scope) {
    if (scope.values.has(symbol.name)) {
      this.report(
        `Duplicate symbol '${symbol.name}'.`,
        symbol.node.span,
        "E2002",
      );
      return;
    }
    scope.values.set(symbol.name, symbol);
  }

  private declareType(symbol: Symbol, scope: Scope) {
    if (scope.types.has(symbol.name)) {
      this.report(
        `Duplicate type '${symbol.name}'.`,
        symbol.node.span,
        "E2002",
      );
      return;
    }
    scope.types.set(symbol.name, symbol);
  }

  private lookupValue(name: string, scope: Scope): Symbol | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      if (current.values.has(name)) return current.values.get(name);
      current = current.parent;
    }
    return undefined;
  }

  private lookupTypeSymbol(name: string, scope: Scope): Symbol | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      if (current.types.has(name)) return current.types.get(name);
      current = current.parent;
    }
    return undefined;
  }

  private lookupValueType(name: string, scope: Scope): Type | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      if (current.overrides.has(name)) return current.overrides.get(name);
      if (current.values.has(name)) return current.values.get(name)?.type;
      current = current.parent;
    }
    return undefined;
  }

  private predeclareTypes(statements: Statement[], scope: Scope) {
    for (const statement of statements) {
      if (statement.kind === "StructDeclaration")
        this.declareType(
          {
            kind: "Struct",
            name: statement.name.name,
            node: statement,
            isPublic: statement.isPublic,
          },
          scope,
        );

      if (statement.kind === "EnumDeclaration")
        this.declareType(
          {
            kind: "Enum",
            name: statement.name.name,
            node: statement,
            isPublic: statement.isPublic,
          },
          scope,
        );

      if (statement.kind === "ClassDeclaration")
        this.declareType(
          {
            kind: "Class",
            name: statement.name.name,
            node: statement,
            isPublic: statement.isPublic,
          },
          scope,
        );

      if (statement.kind === "TypeAliasDeclaration")
        this.declareType(
          {
            kind: "Alias",
            name: statement.name.name,
            node: statement,
            isPublic: statement.isPublic,
          },
          scope,
        );
    }
  }

  private checkStatements(statements: Statement[], scope: Scope) {
    for (const statement of statements) this.checkStatement(statement, scope);
  }

  private checkStatement(statement: Statement, scope: Scope) {
    switch (statement.kind) {
      case "ImportDeclaration":
        this.checkImport(statement, scope);
        return;
      case "ExportDefaultDeclaration":
        this.checkExportDefault(statement, scope);
        return;
      case "VariableDeclaration":
        this.checkVariableDeclaration(statement, scope);
        return;
      case "FunctionDeclaration":
        this.checkFunctionDeclaration(statement, scope);
        return;
      case "TypeAliasDeclaration":
        this.checkTypeAlias(statement, scope);
        return;
      case "StructDeclaration":
        this.checkStructDeclaration(statement, scope);
        return;
      case "EnumDeclaration":
        this.checkEnumDeclaration(statement, scope);
        return;
      case "ClassDeclaration":
        this.checkClassDeclaration(statement, scope);
        return;
      case "ReturnStatement":
        this.checkReturnStatement(statement, scope);
        return;
      case "IfStatement":
        this.checkIfStatement(statement, scope);
        return;
      case "WhileStatement":
        this.checkWhileStatement(statement, scope);
        return;
      case "ForStatement":
        this.checkForStatement(statement, scope);
        return;
      case "MatchStatement":
        this.checkMatchStatement(statement, scope);
        return;
      case "BlockStatement":
        this.checkBlockStatement(statement, scope);
        return;
      case "ExpressionStatement":
        this.checkExpression(statement.expression, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      default:
        return;
    }
  }

  private checkImport(statement: ImportDeclaration, scope: Scope) {
    if (statement.defaultImport)
      this.declareValue(
        {
          kind: "Value",
          name: statement.defaultImport.name,
          node: statement.defaultImport,
          type: this.unknownType(),
        },
        scope,
      );

    if (statement.namedImports)
      for (const name of statement.namedImports) {
        this.declareValue(
          {
            kind: "Value",
            name: name.name,
            node: name,
            type: this.unknownType(),
          },
          scope,
        );
      }
  }

  private checkExportDefault(statement: Statement, scope: Scope) {
    if (statement.kind !== "ExportDefaultDeclaration") return;
    if (statement.expression) this.checkExpression(statement.expression, scope);
    if (statement.symbols)
      for (const sym of statement.symbols) {
        const found = this.lookupValue(sym.name, scope);
        if (!found) {
          this.report(
            `Unknown symbol '${sym.name}' in default export.`,
            sym.span,
            "E2701",
          );
        }
      }
  }

  private checkVariableDeclaration(node: VariableDeclaration, scope: Scope) {
    const declaredType = node.typeAnnotation
      ? this.resolveType(node.typeAnnotation, scope)
      : undefined;
    const initType = node.initializer
      ? this.checkExpression(node.initializer, scope, declaredType)
      : undefined;

    if (node.declarationKind === "const" && !node.initializer) {
      this.report(
        "Const declarations require an initializer.",
        node.span,
        "E2106",
      );
    }

    if (!declaredType && !initType) {
      this.report(
        "Cannot infer type without annotation or initializer.",
        node.span,
        "E2102",
      );
    }

    const finalType = declaredType ?? initType ?? this.errorType();

    if (
      declaredType &&
      initType &&
      !this.isAssignable(initType, declaredType)
    ) {
      this.report("Type mismatch in variable initializer.", node.span, "E2101");
    }

    this.bindPattern(
      node.name,
      finalType,
      node.declarationKind === "const",
      scope,
    );
  }

  private bindPattern(
    pattern: Identifier | TupleBinding,
    type: Type,
    isConst: boolean,
    scope: Scope,
  ) {
    if (pattern.kind === "Identifier") {
      this.declareValue(
        {
          kind: "Value",
          name: pattern.name,
          node: pattern,
          type,
          isConst,
        },
        scope,
      );
      return;
    }

    const tuple = pattern as TupleBinding;
    if (
      type.kind === "Tuple" &&
      type.elements.length === tuple.elements.length
    ) {
      for (let i = 0; i < tuple.elements.length; i++) {
        this.declareValue(
          {
            kind: "Value",
            name: tuple.elements[i].name,
            node: tuple.elements[i],
            type: type.elements[i],
            isConst,
          },
          scope,
        );
      }
      return;
    }

    for (const element of tuple.elements) {
      this.declareValue(
        {
          kind: "Value",
          name: element.name,
          node: element,
          type: this.unknownType(),
          isConst,
        },
        scope,
      );
    }
    this.report(
      "Tuple binding requires a matching tuple type.",
      pattern.span,
      "E2104",
    );
  }

  private checkFunctionDeclaration(node: FunctionDeclaration, scope: Scope) {
    const typeScope = this.createScope(scope);
    this.bindTypeParams(node.typeParams, typeScope);
    const params = this.resolveParameters(node.params, typeScope);
    const returnType = node.returnType
      ? this.resolveType(node.returnType, typeScope)
      : this.unknownType();

    const fnType: FunctionRefType = {
      kind: "Function",
      params: params.map((p) => p.type),
      returnType,
      aliasable: false,
    };

    const symbol: Symbol = {
      kind: "Function",
      name: node.name.name,
      node,
      type: fnType,
      params,
      isPublic: node.isPublic,
    };

    this.declareValue(symbol, scope);

    const bodyScope = this.createScope(typeScope);
    this.declareParameters(params, bodyScope);

    const prevFunction = this.currentFunction;
    this.currentFunction = symbol;
    const returnTypes: Type[] = [];
    this.checkBlockStatement(node.body, bodyScope, returnTypes);
    this.currentFunction = prevFunction;

    if (!node.returnType) {
      const inferred =
        returnTypes.length === 0
          ? this.primitive("void")
          : this.makeUnion(returnTypes);
      fnType.returnType = inferred;
    }
  }

  private resolveParameters(params: ParameterNode[], scope: Scope) {
    const resolved: ParamInfo[] = [];
    const paramScope = this.createScope(scope);
    for (const param of params) {
      if (param.kind === "ParameterSeparator") continue;
      if (param.kind === "Parameter") {
        const type = this.resolveType(param.type, scope);
        if (param.defaultValue) {
          const defType = this.checkExpression(
            param.defaultValue,
            paramScope,
            type,
          );
          if (!this.isAssignable(defType, type)) {
            this.report(
              "Default value type mismatch.",
              param.defaultValue.span,
              "E2208",
            );
          }
        }
        resolved.push({
          name: param.name.name,
          type,
          isNamedOnly: param.isNamedOnly,
          hasDefault: !!param.defaultValue,
          isVariadic: false,
          isKwVariadic: false,
          isMutable: param.isMutable,
          span: param.span,
        });
        this.declareValue(
          {
            kind: "Value",
            name: param.name.name,
            node: param,
            type,
            isConst: false,
          },
          paramScope,
        );
        continue;
      }
      if (param.kind === "VariadicParameter") {
        const type = this.resolveType(param.type, scope);
        if (!this.isArrayLike(type)) {
          this.report(
            "Variadic parameter must be an Array type.",
            param.span,
            "E2209",
          );
        }
        resolved.push({
          name: param.name.name,
          type,
          isNamedOnly: true,
          hasDefault: false,
          isVariadic: true,
          isKwVariadic: false,
          isMutable: false,
          span: param.span,
        });
        continue;
      }
      if (param.kind === "KwVariadicParameter") {
        const type = this.resolveType(param.type, scope);
        if (!this.isMapLike(type)) {
          this.report(
            "Kw-variadic parameter must be a Map type.",
            param.span,
            "E2210",
          );
        }
        resolved.push({
          name: param.name.name,
          type,
          isNamedOnly: true,
          hasDefault: false,
          isVariadic: false,
          isKwVariadic: true,
          isMutable: false,
          span: param.span,
        });
      }
    }
    return resolved;
  }

  private declareParameters(params: ParamInfo[], scope: Scope) {
    for (const param of params) {
      this.declareValue(
        {
          kind: "Value",
          name: param.name,
          node: this.program,
          type: param.type,
          isConst: false,
          isMutable: param.isMutable,
          isParam: true,
        },
        scope,
      );
    }
  }

  private checkTypeAlias(node: TypeAliasDeclaration, scope: Scope) {
    const symbol = this.lookupTypeSymbol(node.name.name, scope);
    if (!symbol) return;
    symbol.type = this.resolveType(node.type, scope);
  }

  private checkStructDeclaration(node: StructDeclaration, scope: Scope) {
    const symbol = this.lookupTypeSymbol(node.name.name, scope);
    if (!symbol) return;
    const typeScope = this.createScope(scope);
    this.bindTypeParams(node.typeParams, typeScope);
    symbol.type = this.namedType(node.name.name, symbol, undefined);
    for (const field of node.fields) {
      this.resolveType(field.type, typeScope);
    }
  }

  private checkEnumDeclaration(node: EnumDeclaration, scope: Scope) {
    const symbol = this.lookupTypeSymbol(node.name.name, scope);
    if (!symbol) return;
    const typeScope = this.createScope(scope);
    this.bindTypeParams(node.typeParams, typeScope);
    symbol.type = this.namedType(node.name.name, symbol, undefined);

    for (const variant of node.variants) {
      const payloadTypes = variant.payload
        ? variant.payload.map((t) => this.resolveType(t, typeScope))
        : [];
      const variantSymbol: Symbol = {
        kind: "Variant",
        name: variant.name.name,
        node: variant,
        parentEnum: symbol,
        payloadTypes,
        type: this.makeVariantType(symbol, payloadTypes),
      };
      this.declareValue(variantSymbol, scope);
    }
  }

  private makeVariantType(
    enumSymbol: Symbol,
    payloadTypes: Type[],
  ): FunctionRefType {
    return {
      kind: "Function",
      params: payloadTypes,
      returnType: this.namedType(enumSymbol.name, enumSymbol, undefined),
      aliasable: false,
    };
  }

  private checkClassDeclaration(node: ClassDeclaration, scope: Scope) {
    const symbol = this.lookupTypeSymbol(node.name.name, scope);
    if (!symbol) return;
    const typeScope = this.createScope(scope);
    this.bindTypeParams(node.typeParams, typeScope);
    symbol.type = this.namedType(node.name.name, symbol, undefined);
    if (node.extendsType) {
      const base = this.resolveType(node.extendsType, typeScope);
      if (!(base.kind === "Named" && base.symbol?.kind === "Class")) {
        this.report(
          "Class extends must reference a class type.",
          node.extendsType.span,
          "E2801",
        );
      }
    }
    if (node.implementsTypes) {
      for (const impl of node.implementsTypes) {
        const implType = this.resolveType(impl, typeScope);
        if (!(implType.kind === "Named" && implType.symbol?.kind === "Class")) {
          this.report(
            "Class implements must reference a class type.",
            impl.span,
            "E2802",
          );
        }
      }
    }
    for (const member of node.members) {
      if (member.kind === "ClassField")
        this.resolveType(member.type, typeScope);
      if (member.kind === "ClassMethod") {
        if (member.isAbstract && !node.isAbstract) {
          this.report(
            "Abstract method declared in non-abstract class.",
            member.span,
            "E2803",
          );
        }
        const params = this.resolveParameters(member.params, typeScope);
        const returnType = member.returnType
          ? this.resolveType(member.returnType, typeScope)
          : this.unknownType();
        const methodType: FunctionRefType = {
          kind: "Function",
          params: params.map((p) => p.type),
          returnType,
          aliasable: false,
        };
        const methodSymbol: Symbol = {
          kind: "Function",
          name: member.name.name,
          node: member,
          type: methodType,
          params,
        };
        const bodyScope = this.createScope(typeScope);
        this.declareParameters(params, bodyScope);
        bodyScope.values.set("this", {
          kind: "Value",
          name: "this",
          node: member,
          type: symbol.type ?? this.unknownType(),
        });
        if (member.body) {
          const prev = this.currentFunction;
          this.currentFunction = methodSymbol;
          const returns: Type[] = [];
          this.checkBlockStatement(member.body, bodyScope, returns);
          this.currentFunction = prev;
          if (!member.returnType) {
            methodType.returnType =
              returns.length === 0
                ? this.primitive("void")
                : this.makeUnion(returns);
          }
        }
      }
    }
  }

  private checkReturnStatement(node: ReturnStatement, scope: Scope) {
    if (!this.currentFunction) return;
    const functionType = this.currentFunction.type;
    if (!functionType || functionType.kind !== "Function") return;
    if (!node.value) {
      if (!this.isAssignable(this.primitive("void"), functionType.returnType)) {
        this.report("Return type mismatch.", node.span, "E2302");
      }
      return;
    }
    const valueType = this.checkExpression(
      node.value,
      scope,
      functionType.returnType,
    );
    if (!this.isAssignable(valueType, functionType.returnType)) {
      this.report("Return type mismatch.", node.span, "E2302");
    }
  }

  private checkIfStatement(node: IfStatement, scope: Scope) {
    const condType = this.checkExpression(node.condition, scope);
    void condType;

    const thenScope = this.createScope(scope);
    const elseScope = this.createScope(scope);

    const narrowThen = this.narrowByCondition(node.condition, true, scope);
    const narrowElse = this.narrowByCondition(node.condition, false, scope);
    for (const [name, type] of narrowThen) thenScope.overrides.set(name, type);
    for (const [name, type] of narrowElse) elseScope.overrides.set(name, type);

    this.checkBlockStatement(node.thenBranch, thenScope);
    if (node.elseBranch) {
      if (node.elseBranch.kind === "IfStatement") {
        this.checkIfStatement(node.elseBranch, elseScope);
      } else {
        this.checkBlockStatement(node.elseBranch, elseScope);
      }
    }
  }

  private narrowByCondition(
    expr: Expression,
    truthy: boolean,
    scope: Scope,
  ): Map<string, Type> {
    const result = new Map<string, Type>();
    if (expr.kind !== "BinaryExpression") return result;
    const op = expr.operator;
    if (op !== "==" && op !== "!=") return result;
    const left = expr.left;
    const right = expr.right;
    const isNullLiteral = (node: Expression) =>
      node.kind === "LiteralExpression" && node.literalType === "Null";
    const isId = (node: Expression): node is IdentifierExpression =>
      node.kind === "IdentifierExpression";

    if (isId(left) && isNullLiteral(right)) {
      const original = this.lookupValueType(left.name, scope);
      if (original) {
        const narrowed =
          op === "!=" ? this.removeNull(original) : this.primitive("null");
        const final = truthy
          ? narrowed
          : op === "!="
            ? this.primitive("null")
            : this.removeNull(original);
        result.set(left.name, final);
      }
    }
    if (isId(right) && isNullLiteral(left)) {
      const original = this.lookupValueType(right.name, scope);
      if (original) {
        const narrowed =
          op === "!=" ? this.removeNull(original) : this.primitive("null");
        const final = truthy
          ? narrowed
          : op === "!="
            ? this.primitive("null")
            : this.removeNull(original);
        result.set(right.name, final);
      }
    }
    return result;
  }

  private checkWhileStatement(node: WhileStatement, scope: Scope) {
    const condType = this.checkExpression(node.condition, scope);
    void condType;
    this.checkBlockStatement(node.body, this.createScope(scope));
  }

  private checkForStatement(node: ForStatement, scope: Scope) {
    this.checkExpression(node.iterable, scope);
    const bodyScope = this.createScope(scope);
    this.declareValue(
      {
        kind: "Value",
        name: node.iterator.name,
        node: node.iterator,
        type: this.unknownType(),
      },
      bodyScope,
    );
    this.checkBlockStatement(node.body, bodyScope);
  }

  private checkMatchStatement(node: MatchStatement, scope: Scope) {
    const exprType = this.checkExpression(node.expression, scope);
    const enumSymbol = this.extractEnumSymbol(exprType);
    const seenVariants = new Set<string>();
    let hasWildcard = false;
    let hasPatternError = false;

    for (const arm of node.arms) {
      const armScope = this.createScope(scope);
      const ok = this.checkPattern(
        arm.pattern,
        exprType,
        enumSymbol,
        armScope,
        seenVariants,
      );
      if (!ok) hasPatternError = true;
      if (arm.pattern.kind === "WildcardPattern") hasWildcard = true;
      if (arm.body.kind === "BlockStatement")
        this.checkBlockStatement(arm.body, armScope);
      else this.checkExpression(arm.body, armScope);
    }

    if (enumSymbol && !hasWildcard && !hasPatternError) {
      const enumNode = enumSymbol.node as EnumDeclaration;
      const total = enumNode.variants.map((v) => v.name.name);
      const missing = total.filter((v) => !seenVariants.has(v));
      if (missing.length > 0) {
        this.warn(
          `Match is not exhaustive; missing ${missing.join(", ")}.`,
          node.span,
          "W2601",
        );
      }
    }
  }

  private extractEnumSymbol(type: Type): Symbol | undefined {
    if (type.kind === "Named" && type.symbol?.kind === "Enum")
      return type.symbol;
    if (type.kind === "Union") {
      const enums = type.types
        .map((t) => this.extractEnumSymbol(t))
        .filter(Boolean) as Symbol[];
      if (enums.length === 1) return enums[0];
    }
    return undefined;
  }

  private checkPattern(
    pattern: Pattern,
    exprType: Type,
    enumSymbol: Symbol | undefined,
    scope: Scope,
    seenVariants: Set<string>,
  ): boolean {
    if (pattern.kind === "IdentifierPattern") {
      this.declareValue(
        {
          kind: "Value",
          name: pattern.name.name,
          node: pattern,
          type: exprType,
        },
        scope,
      );
      return true;
    }
    if (pattern.kind === "LiteralPattern") {
      const litType = this.checkExpression(pattern.literal, scope);
      if (!this.isAssignable(litType, exprType)) {
        this.report("Pattern type mismatch.", pattern.span, "E2602");
      }
      return true;
    }
    if (pattern.kind === "WildcardPattern") return true;

    const enumPattern = pattern as EnumPattern;
    if (!enumSymbol) return false;
    const variantSymbol = this.lookupValue(enumPattern.name.name, scope);
    if (!variantSymbol || variantSymbol.parentEnum !== enumSymbol) {
      this.report(
        `Unknown enum variant '${enumPattern.name.name}'.`,
        enumPattern.span,
        "E2603",
      );
      return false;
    }
    seenVariants.add(enumPattern.name.name);
    const payloadTypes = variantSymbol.payloadTypes ?? [];
    if (payloadTypes.length !== enumPattern.bindings.length) {
      this.report("Enum payload arity mismatch.", enumPattern.span, "E2601");
    }
    for (let i = 0; i < enumPattern.bindings.length; i++) {
      const binding = enumPattern.bindings[i];
      const type =
        i < payloadTypes.length ? payloadTypes[i] : this.unknownType();
      this.declareValue(
        {
          kind: "Value",
          name: binding.name,
          node: binding,
          type,
        },
        scope,
      );
    }
    return true;
  }

  private checkBlockStatement(
    node: BlockStatement,
    scope: Scope,
    returnTypes?: Type[],
  ) {
    const blockScope = this.createScope(scope);
    for (const statement of node.body) {
      if (statement.kind === "ReturnStatement" && returnTypes) {
        const type = statement.value
          ? this.checkExpression(statement.value, blockScope)
          : this.primitive("void");
        returnTypes.push(type);
      }
      this.checkStatement(statement, blockScope);
    }
  }

  private resolveType(node: TypeNode, scope: Scope): Type {
    if (node.kind === "NamedType") return this.resolveNamedType(node, scope);
    if (node.kind === "UnionType") {
      const types = (node as UnionType).types.map((t) =>
        this.resolveType(t, scope),
      );
      return this.makeUnion(types);
    }
    if (node.kind === "TupleType") {
      const elements = (node as TupleType).elements.map((t) =>
        this.resolveType(t, scope),
      );
      return { kind: "Tuple", elements, aliasable: false };
    }
    if (node.kind === "FunctionType") {
      const fn = node as FunctionType;
      const params = fn.params.map((p) => this.resolveType(p, scope));
      const returnType = this.resolveType(fn.returnType, scope);
      return { kind: "Function", params, returnType, aliasable: false };
    }
    return this.errorType();
  }

  private resolveNamedType(node: NamedType, scope: Scope): Type {
    const name = node.name.name;
    if (primitiveNames.includes(name as PrimitiveName)) {
      return this.primitive(name as PrimitiveName);
    }
    const symbol = this.lookupTypeSymbol(name, scope);
    if (!symbol) {
      this.report(`Unknown type '${name}'.`, node.span, "E2003");
      return this.errorType();
    }
    if (symbol.kind === "TypeParam") {
      return { kind: "TypeParam", name: symbol.name, aliasable: false };
    }
    if (symbol.kind === "Alias") {
      if (node.typeArgs && node.typeArgs.length > 0) {
        this.report(
          `Type argument count mismatch for '${name}'.`,
          node.span,
          "E2005",
        );
      }
      if (this.resolvingAliases.has(name)) {
        if (!this.reportedAliasCycles.has(name)) {
          this.report(`Cyclic type alias '${name}'.`, node.span, "E2004");
          for (const alias of this.resolvingAliases) {
            this.reportedAliasCycles.add(alias);
          }
        }
        return this.errorType();
      }
      this.resolvingAliases.add(name);
      const aliasNode = symbol.node as TypeAliasDeclaration;
      const resolved = this.resolveType(aliasNode.type, scope);
      symbol.type = resolved;
      this.resolvingAliases.delete(name);
      return resolved;
    }
    const typeArgs = node.typeArgs?.map((t) => this.resolveType(t, scope));
    const expected = this.expectedTypeArgs(symbol, name);
    const provided = typeArgs?.length ?? 0;
    if (expected !== null && expected !== provided) {
      this.report(
        `Type argument count mismatch for '${name}'.`,
        node.span,
        "E2005",
      );
    }
    return this.namedType(name, symbol, typeArgs);
  }

  private expectedTypeArgs(symbol: Symbol, name: string): number | null {
    if (name === "Array") return 1;
    if (name === "Map") return 2;
    if (symbol.kind === "Struct") {
      const node = symbol.node as StructDeclaration;
      return node.typeParams?.length ?? 0;
    }
    if (symbol.kind === "Enum") {
      const node = symbol.node as EnumDeclaration;
      return node.typeParams?.length ?? 0;
    }
    if (symbol.kind === "Class") {
      const node = symbol.node as ClassDeclaration;
      return node.typeParams?.length ?? 0;
    }
    if (symbol.kind === "Alias" || symbol.kind === "Type") return 0;
    return null;
  }

  private bindTypeParams(
    typeParams: TypeParameter[] | undefined,
    scope: Scope,
  ) {
    if (!typeParams) return;
    for (const param of typeParams) {
      const name = param.name.name;
      if (scope.types.has(name)) {
        this.report(`Duplicate type parameter '${name}'.`, param.span, "E2002");
        continue;
      }
      scope.types.set(name, {
        kind: "TypeParam",
        name,
        node: param,
      });
    }
  }

  private namedType(
    name: string,
    symbol: Symbol,
    typeArgs?: Type[],
  ): NamedRefType {
    let aliasable = false;
    if (name === "Array" || name === "Map") aliasable = true;
    if (symbol.kind === "Class") aliasable = true;
    return { kind: "Named", name, symbol, typeArgs, aliasable };
  }

  private checkExpression(
    node: Expression,
    scope: Scope,
    expected?: Type,
  ): Type {
    switch (node.kind) {
      case "LiteralExpression":
        return this.checkLiteral(node, expected);
      case "IdentifierExpression":
        return this.checkIdentifier(node, scope);
      case "BinaryExpression":
        return this.checkBinary(node, scope);
      case "UnaryExpression":
        return this.checkUnary(node, scope);
      case "AssignmentExpression":
        return this.checkAssignment(node, scope);
      case "CallExpression":
        return this.checkCall(node, scope);
      case "MemberExpression":
        return this.checkMember(node, scope);
      case "ArrayLiteralExpression":
        return this.checkArrayLiteral(node, scope);
      case "TupleLiteralExpression":
        return this.checkTupleLiteral(node, scope);
      case "MapLiteralExpression":
        return this.checkMapLiteral(node, scope);
      case "StructLiteralExpression":
        return this.checkStructLiteral(node, scope);
      case "GroupingExpression":
        return this.checkExpression(node.expression, scope, expected);
      case "FunctionExpression":
        return this.checkFunctionExpression(node, scope);
      case "CastExpression":
        return this.checkCastExpression(node, scope);
      default:
        return this.errorType();
    }
  }

  private checkLiteral(node: LiteralExpression, expected?: Type): Type {
    let type: Type;
    if (node.literalType === "Integer") {
      type = this.pickNumericType(expected, "int");
      this.checkIntegerLiteral(node, type);
    } else if (node.literalType === "Float") {
      type = this.pickNumericType(expected, "float");
    } else if (node.literalType === "Boolean") {
      type = this.primitive("bool");
    } else if (node.literalType === "String") {
      type = this.primitive("string");
    } else {
      type = this.primitive("null");
    }
    this.types.set(node, type);
    return type;
  }

  private pickNumericType(
    expected: Type | undefined,
    kind: "int" | "float",
  ): Type {
    if (expected) {
      if (kind === "int" && this.isIntegerType(expected)) return expected;
      if (kind === "float" && this.isFloatType(expected)) return expected;
      if (expected.kind === "Union") {
        for (const t of expected.types) {
          if (kind === "int" && this.isIntegerType(t)) return t;
          if (kind === "float" && this.isFloatType(t)) return t;
        }
      }
    }
    return this.primitive(kind === "int" ? defaultIntType : defaultFloatType);
  }

  private checkIntegerLiteral(node: LiteralExpression, target: Type) {
    if (!this.isIntegerType(target)) return;
    const value = node.value.replace(/_/g, "");
    let bigintValue: bigint;
    try {
      if (value.startsWith("0x") || value.startsWith("0X")) {
        bigintValue = BigInt(value);
      } else if (value.startsWith("0b") || value.startsWith("0B")) {
        bigintValue = BigInt(value);
      } else {
        bigintValue = BigInt(value);
      }
    } catch {
      return;
    }
    const [min, max] = this.intRange(target.name);
    if (bigintValue < min || bigintValue > max) {
      this.report("Integer literal out of range.", node.span, "E2401");
    }
  }

  private intRange(name: PrimitiveName): [bigint, bigint] {
    const bits = Number(name.slice(1));
    if (name.startsWith("u")) {
      return [BigInt(0), (BigInt(1) << BigInt(bits)) - BigInt(1)];
    }
    const max = (BigInt(1) << BigInt(bits - 1)) - BigInt(1);
    const min = -(BigInt(1) << BigInt(bits - 1));
    return [min, max];
  }

  private checkIdentifier(node: IdentifierExpression, scope: Scope): Type {
    const type = this.lookupValueType(node.name, scope);
    if (!type) {
      this.report(`Unknown identifier '${node.name}'.`, node.span, "E2001");
      return this.errorType();
    }
    return type;
  }

  private checkBinary(node: BinaryExpression, scope: Scope): Type {
    const left = this.checkExpression(node.left, scope);
    const right = this.checkExpression(node.right, scope);
    const op = node.operator;

    if (op === "is") {
      if (!this.isAliasable(left) || !this.isAliasable(right)) {
        this.report(
          "Operator 'is' requires aliasable operands.",
          node.span,
          "E2502",
        );
      }
      return this.primitive("bool");
    }

    if (["&&", "||"].includes(op)) {
      if (!this.isBooleanType(left) || !this.isBooleanType(right)) {
        this.report(
          "Logical operators require boolean operands.",
          node.span,
          "E2101",
        );
      }
      return this.primitive("bool");
    }

    if (["==", "!="].includes(op)) {
      if (!this.isAssignable(left, right) && !this.isAssignable(right, left)) {
        this.report("Incompatible operands for equality.", node.span, "E2101");
      }
      return this.primitive("bool");
    }

    if (["<", "<=", ">", ">="].includes(op)) {
      if (!this.isNumericType(left) || !this.isNumericType(right)) {
        this.report(
          "Comparison requires numeric operands.",
          node.span,
          "E2101",
        );
      } else if (!this.typeEquals(left, right)) {
        this.report(
          "Comparison requires matching numeric types.",
          node.span,
          "E2101",
        );
      }
      return this.primitive("bool");
    }

    if (op === "+") {
      if (this.isStringType(left) || this.isStringType(right)) {
        if (!this.isStringType(left) || !this.isStringType(right)) {
          this.report(
            "String concatenation requires both operands to be string.",
            node.span,
            "E2101",
          );
        }
        return this.primitive("string");
      }
    }

    if (["+", "-", "*", "/", "%", "|"].includes(op)) {
      if (!this.isNumericType(left) || !this.isNumericType(right)) {
        this.report(
          "Arithmetic requires numeric operands.",
          node.span,
          "E2101",
        );
        return this.errorType();
      }
      if (!this.typeEquals(left, right)) {
        this.report(
          "Arithmetic requires matching numeric types.",
          node.span,
          "E2101",
        );
      }
      return left;
    }

    return this.errorType();
  }

  private checkUnary(node: UnaryExpression, scope: Scope): Type {
    const arg = this.checkExpression(node.argument, scope);
    if (node.operator === "!") {
      return this.primitive("bool");
    }
    if (!this.isNumericType(arg)) {
      this.report(
        "Unary operator requires numeric operand.",
        node.span,
        "E2101",
      );
    }
    return arg;
  }

  private checkAssignment(node: AssignmentExpression, scope: Scope): Type {
    const leftType = this.checkExpression(node.left, scope);
    const rightType = this.checkExpression(node.right, scope, leftType);

    if (node.left.kind === "IdentifierExpression") {
      const sym = this.lookupValue(node.left.name, scope);
      if (sym?.isConst) {
        this.report("Cannot assign to const binding.", node.span, "E2501");
      }
      if (sym?.isParam && !sym.isMutable) {
        this.report("Cannot assign to readonly parameter.", node.span, "E2503");
      }
    }

    if (node.left.kind === "MemberExpression") {
      const base = node.left.object;
      if (base.kind === "IdentifierExpression") {
        const sym = this.lookupValue(base.name, scope);
        if (sym?.isConst) {
          this.report(
            "Cannot mutate through const binding.",
            node.span,
            "E2501",
          );
        }
        if (sym?.isParam && !sym.isMutable) {
          this.report(
            "Cannot mutate through readonly parameter.",
            node.span,
            "E2503",
          );
        }
      }
    }

    if (!this.isAssignable(rightType, leftType)) {
      this.report("Type mismatch in assignment.", node.span, "E2101");
    }
    return leftType;
  }

  private checkCall(node: CallExpression, scope: Scope): Type {
    const calleeType = this.checkExpression(node.callee, scope);
    if (calleeType.kind !== "Function") {
      return this.errorType();
    }

    const paramInfo = this.lookupParamInfo(node.callee, scope);
    if (paramInfo) {
      this.checkArgumentsWithInfo(node.args, paramInfo, scope);
    } else {
      this.checkArgumentsByType(node.args, calleeType.params, scope);
    }
    return calleeType.returnType;
  }

  private lookupParamInfo(
    callee: Expression,
    scope: Scope,
  ): ParamInfo[] | null {
    if (callee.kind === "IdentifierExpression") {
      const sym = this.lookupValue(callee.name, scope);
      if (sym?.params) return sym.params;
    }
    if (callee.kind === "MemberExpression") {
      const objectType = this.checkExpression(callee.object, scope);
      if (objectType.kind === "Named" && objectType.symbol?.kind === "Class") {
        const classNode = objectType.symbol.node as ClassDeclaration;
        const member = classNode.members.find(
          (m) => m.name.name === callee.property.name,
        );
        if (member && member.kind === "ClassMethod") {
          return this.resolveParameters(member.params, scope);
        }
      }
    }
    return null;
  }

  private checkArgumentsByType(args: Argument[], params: Type[], scope: Scope) {
    let position = 0;
    for (const arg of args) {
      if (arg.kind === "NamedArgument" || arg.kind === "KwSpreadArgument") {
        this.report("Named arguments are not allowed here.", arg.span, "E2201");
        continue;
      }
      if (arg.kind === "PositionalArgument") {
        if (position >= params.length) {
          this.report("Too many positional arguments.", arg.span, "E2205");
          continue;
        }
        const paramType = params[position];
        const argType = this.checkExpression(arg.value, scope, paramType);
        if (!this.isAssignable(argType, paramType)) {
          this.report("Argument type mismatch.", arg.span, "E2207");
        }
        position++;
        continue;
      }
      if (arg.kind === "SpreadArgument") {
        this.checkExpression(arg.value, scope);
      }
    }
  }

  private checkArgumentsWithInfo(
    args: Argument[],
    params: ParamInfo[],
    scope: Scope,
  ) {
    const paramByName = new Map<string, ParamInfo>();
    const provided = new Set<string>();
    const namedFromSpread = new Set<string>();
    let positionalIndex = 0;
    const variadic = params.find((p) => p.isVariadic);
    const kwVariadic = params.find((p) => p.isKwVariadic);
    const positionalProvided = new Set<string>();

    for (const param of params) {
      paramByName.set(param.name, param);
    }

    for (const arg of args) {
      if (arg.kind === "PositionalArgument") {
        const nextParam = this.nextPositionalParam(params, positionalIndex);
        if (!nextParam && !variadic) {
          this.report("Too many positional arguments.", arg.span, "E2205");
          continue;
        }
        if (nextParam) {
          const argType = this.checkExpression(
            arg.value,
            scope,
            nextParam.type,
          );
          if (!this.isAssignable(argType, nextParam.type)) {
            this.report("Argument type mismatch.", arg.span, "E2207");
          }
          if (nextParam.isMutable) {
            this.requireMutableArgument(arg.value, arg.span, scope);
          }
          positionalProvided.add(nextParam.name);
          positionalIndex++;
        } else if (variadic) {
          this.checkVariadicArg(arg.value, variadic.type, scope);
        }
        continue;
      }

      if (arg.kind === "NamedArgument") {
        const name = arg.name.name;
        if (provided.has(name)) {
          this.report(
            `Duplicate keyword argument '${name}'.`,
            arg.span,
            "E2202",
          );
        }
        provided.add(name);
        const param = paramByName.get(name);
        if (!param) {
          if (kwVariadic) {
            const valueType = this.checkExpression(arg.value, scope);
            const kwType = this.mapValueType(kwVariadic.type);
            if (kwType && !this.isAssignable(valueType, kwType)) {
              this.report("Argument type mismatch.", arg.span, "E2207");
            }
          } else {
            this.report(
              `Unknown keyword argument '${name}'.`,
              arg.span,
              "E2201",
            );
          }
          continue;
        }
        const argType = this.checkExpression(arg.value, scope, param.type);
        if (!this.isAssignable(argType, param.type)) {
          this.report("Argument type mismatch.", arg.span, "E2207");
        }
        if (param.isMutable) {
          this.requireMutableArgument(arg.value, arg.span, scope);
        }
        continue;
      }

      if (arg.kind === "SpreadArgument") {
        const argType = this.checkExpression(arg.value, scope);
        if (arg.value.kind === "TupleLiteralExpression") {
          for (const element of arg.value.elements) {
            const nextParam = this.nextPositionalParam(params, positionalIndex);
            if (!nextParam && !variadic) {
              this.report("Too many positional arguments.", arg.span, "E2205");
              break;
            }
            const elementType = this.checkExpression(element, scope);
            if (nextParam) {
              if (!this.isAssignable(elementType, nextParam.type)) {
                this.report("Argument type mismatch.", arg.span, "E2207");
              }
              if (nextParam.isMutable) {
                this.requireMutableArgument(element, element.span, scope);
              }
              positionalIndex++;
              positionalProvided.add(nextParam.name);
            } else if (variadic) {
              this.checkVariadicArg(element, variadic.type, scope);
            }
          }
        } else if (this.isArrayLike(argType)) {
          if (!variadic) {
            this.report(
              "Spread argument requires variadic parameter.",
              arg.span,
              "E2206",
            );
          }
        } else {
          this.report(
            "Spread argument must be an array or tuple.",
            arg.span,
            "E2206",
          );
        }
        continue;
      }

      if (arg.kind === "KwSpreadArgument") {
        const argType = this.checkExpression(arg.value, scope);
        if (!this.isMapLike(argType)) {
          this.report("Kw-spread argument must be a map.", arg.span, "E2206");
          continue;
        }
        if (arg.value.kind === "MapLiteralExpression") {
          const { entries, hasNonString } = this.extractStringEntries(
            arg.value,
          );
          if (hasNonString) {
            this.report("Kw-spread keys must be strings.", arg.span, "E2206");
          }
          for (const [key, valueExpr] of entries.entries()) {
            if (provided.has(key) || namedFromSpread.has(key)) {
              this.report(
                `Duplicate keyword argument '${key}'.`,
                arg.span,
                "E2203",
              );
              continue;
            }
            namedFromSpread.add(key);
            const param = paramByName.get(key);
            if (param) {
              const valueType = this.checkExpression(
                valueExpr,
                scope,
                param.type,
              );
              if (!this.isAssignable(valueType, param.type)) {
                this.report("Argument type mismatch.", valueExpr.span, "E2207");
              }
              if (param.isMutable) {
                this.requireMutableArgument(valueExpr, valueExpr.span, scope);
              }
            } else if (kwVariadic) {
              const valueType = this.checkExpression(valueExpr, scope);
              const kwType = this.mapValueType(kwVariadic.type);
              if (kwType && !this.isAssignable(valueType, kwType)) {
                this.report("Argument type mismatch.", valueExpr.span, "E2207");
              }
            } else {
              this.report(
                `Unknown keyword argument '${key}'.`,
                arg.span,
                "E2201",
              );
            }
          }
        }
      }
    }

    for (const param of params) {
      if (param.isVariadic || param.isKwVariadic) continue;
      const supplied =
        provided.has(param.name) || positionalProvided.has(param.name);
      if (!supplied && !param.hasDefault) {
        this.report(`Missing argument '${param.name}'.`, param.span, "E2207");
      }
    }
  }

  private requireMutableArgument(expr: Expression, span: Span, scope: Scope) {
    if (expr.kind !== "IdentifierExpression") {
      this.report(
        "Mut parameter requires a mutable identifier.",
        span,
        "E2204",
      );
      return;
    }
    const sym = this.lookupValue(expr.name, scope);
    if (!sym) return;
    if (sym.isConst || (sym.isParam && !sym.isMutable)) {
      this.report(
        "Mut parameter requires a mutable identifier.",
        span,
        "E2204",
      );
    }
  }

  private nextPositionalParam(
    params: ParamInfo[],
    index: number,
  ): ParamInfo | null {
    let count = 0;
    for (const param of params) {
      if (param.isVariadic || param.isKwVariadic) continue;
      if (param.isNamedOnly) continue;
      if (count === index) return param;
      count++;
    }
    return null;
  }

  private checkVariadicArg(expr: Expression, variadicType: Type, scope: Scope) {
    const elementType = this.arrayElementType(variadicType);
    if (!elementType) return;
    const argType = this.checkExpression(expr, scope, elementType);
    if (!this.isAssignable(argType, elementType)) {
      this.report("Argument type mismatch.", expr.span, "E2207");
    }
  }

  private arrayElementType(type: Type): Type | null {
    if (type.kind === "Named" && type.name === "Array" && type.typeArgs?.[0]) {
      return type.typeArgs[0];
    }
    return null;
  }

  private mapValueType(type: Type): Type | null {
    if (type.kind === "Named" && type.name === "Map" && type.typeArgs?.[1]) {
      return type.typeArgs[1];
    }
    return null;
  }

  private extractStringEntries(node: MapLiteralExpression): {
    entries: Map<string, Expression>;
    hasNonString: boolean;
  } {
    const entries = new Map<string, Expression>();
    let hasNonString = false;
    for (const entry of node.entries) {
      if (
        entry.key.kind === "LiteralExpression" &&
        entry.key.literalType === "String"
      ) {
        entries.set(entry.key.value, entry.value);
      } else {
        hasNonString = true;
      }
    }
    return { entries, hasNonString };
  }

  private checkMember(node: MemberExpression, scope: Scope): Type {
    const objectType = this.checkExpression(node.object, scope);
    if (objectType.kind === "Named" && objectType.symbol) {
      if (objectType.symbol.kind === "Struct") {
        const structNode = objectType.symbol.node as StructDeclaration;
        const field = structNode.fields.find(
          (f) => f.name.name === node.property.name,
        );
        if (!field) {
          this.report(
            `Unknown struct field '${node.property.name}'.`,
            node.property.span,
            "E2104",
          );
          return this.errorType();
        }
        return this.resolveType(field.type, scope);
      }
      if (objectType.symbol.kind === "Class") {
        const classNode = objectType.symbol.node as ClassDeclaration;
        const member = classNode.members.find(
          (m) => m.name.name === node.property.name,
        );
        if (!member) {
          this.report(
            `Unknown class member '${node.property.name}'.`,
            node.property.span,
            "E2104",
          );
          return this.errorType();
        }
        if (member.kind === "ClassField")
          return this.resolveType(member.type, scope);
        if (member.kind === "ClassMethod") {
          const params = this.resolveParameters(member.params, scope);
          const returnType = member.returnType
            ? this.resolveType(member.returnType, scope)
            : this.unknownType();
          return {
            kind: "Function",
            params: params.map((p) => p.type),
            returnType,
            aliasable: false,
          };
        }
      }
    }
    return this.unknownType();
  }

  private checkArrayLiteral(node: ArrayLiteralExpression, scope: Scope): Type {
    const elements = node.elements.map((e) => this.checkExpression(e, scope));
    const elementType = elements.length
      ? this.makeUnion(elements)
      : this.unknownType();
    return {
      kind: "Named",
      name: "Array",
      symbol: this.lookupTypeSymbol("Array", scope),
      typeArgs: [elementType],
      aliasable: true,
    };
  }

  private checkTupleLiteral(node: TupleLiteralExpression, scope: Scope): Type {
    const elements = node.elements.map((e) => this.checkExpression(e, scope));
    return { kind: "Tuple", elements, aliasable: false };
  }

  private checkMapLiteral(node: MapLiteralExpression, scope: Scope): Type {
    const keys = node.entries.map((e) => this.checkExpression(e.key, scope));
    const values = node.entries.map((e) =>
      this.checkExpression(e.value, scope),
    );
    const keyType = keys.length ? this.makeUnion(keys) : this.unknownType();
    const valueType = values.length
      ? this.makeUnion(values)
      : this.unknownType();
    return {
      kind: "Named",
      name: "Map",
      symbol: this.lookupTypeSymbol("Map", scope),
      typeArgs: [keyType, valueType],
      aliasable: true,
    };
  }

  private checkStructLiteral(
    node: StructLiteralExpression,
    scope: Scope,
  ): Type {
    const structName = node.name.name;
    const symbol = this.lookupTypeSymbol(structName, scope);
    if (!symbol || symbol.kind !== "Struct") {
      this.report(`Unknown struct '${structName}'.`, node.span, "E2003");
      return this.errorType();
    }
    const structNode = symbol.node as StructDeclaration;
    const provided = new Set<string>();
    for (const field of node.fields) {
      provided.add(field.name.name);
      const target = structNode.fields.find(
        (f) => f.name.name === field.name.name,
      );
      if (!target) {
        this.report(
          `Unknown struct field '${field.name.name}'.`,
          field.span,
          "E2104",
        );
        continue;
      }
      const targetType = this.resolveType(target.type, scope);
      const valueType = this.checkExpression(field.value, scope, targetType);
      if (!this.isAssignable(valueType, targetType)) {
        this.report("Struct field type mismatch.", field.span, "E2101");
      }
    }
    for (const field of structNode.fields) {
      if (!provided.has(field.name.name)) {
        this.report(
          `Missing struct field '${field.name.name}'.`,
          node.span,
          "E2103",
        );
      }
    }
    return this.namedType(structName, symbol, undefined);
  }

  private checkFunctionExpression(
    node: FunctionExpression,
    scope: Scope,
  ): Type {
    const params = this.resolveParameters(node.params, scope);
    const returnType = node.returnType
      ? this.resolveType(node.returnType, scope)
      : this.unknownType();
    const fnType: FunctionRefType = {
      kind: "Function",
      params: params.map((p) => p.type),
      returnType,
      aliasable: false,
    };
    const bodyScope = this.createScope(scope);
    this.declareParameters(params, bodyScope);
    const returns: Type[] = [];
    this.checkBlockStatement(node.body, bodyScope, returns);
    if (!node.returnType) {
      fnType.returnType =
        returns.length === 0 ? this.primitive("void") : this.makeUnion(returns);
    }
    return fnType;
  }

  private checkCastExpression(node: CastExpression, scope: Scope): Type {
    const from = this.checkExpression(node.expression, scope);
    const to = this.resolveType(node.type, scope);

    if (from.kind === "Primitive" && to.kind === "Primitive") return to;

    this.report("Invalid cast.", node.span, "E2105");
    return to;
  }
}

interface ParamInfo {
  name: string;
  type: Type;
  isNamedOnly: boolean;
  hasDefault: boolean;
  isVariadic: boolean;
  isKwVariadic: boolean;
  isMutable: boolean;
  span: Span;
}
