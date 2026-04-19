import * as fs from "node:fs";
import * as path from "node:path";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";
import type {
  ArrayLiteralExpression,
  AssignmentStatement,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  CastExpression,
  EnumDeclaration,
  EnumPattern,
  EnumVariant,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  IdentifierExpression,
  IfStatement,
  ImportDeclaration,
  IndexExpression,
  LiteralExpression,
  MatchExpression,
  MatchStatement,
  MemberExpression,
  MethodDeclaration,
  NamedType,
  Node,
  Parameter,
  Pattern,
  Program,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructField,
  StructLiteralExpression,
  TraitDeclaration,
  TraitMethodSignature,
  TraitSatisfiesDeclaration,
  TupleLiteralExpression,
  TupleMemberExpression,
  TypeAliasDeclaration,
  TypeNode,
  TypeParameter,
  VariableDeclaration,
  WhereConstraint,
  WhileStatement,
} from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";
import type { Span } from "@/types/position";

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
  | NullableRefType
  | TupleRefType
  | FunctionRefType
  | TypeParamRefType
  | UnknownType
  | ErrorType;

interface BaseType {
  kind: string;
}

interface PrimitiveType extends BaseType {
  kind: "Primitive";
  name: PrimitiveName;
}

interface NamedRefType extends BaseType {
  kind: "Named";
  name: string;
  symbol?: TypeSymbol;
  typeArgs?: Type[];
}

interface NullableRefType extends BaseType {
  kind: "Nullable";
  base: Type;
}

interface TupleRefType extends BaseType {
  kind: "Tuple";
  elements: Type[];
}

interface FunctionParamType {
  name?: string;
  type: Type;
  isMutable: boolean;
}

interface TypeParamSpec {
  name: string;
  bounds: NamedRefType[];
}

interface CallableTarget {
  kind: "function" | "method" | "variant";
  name: string;
  typeParams: TypeParamSpec[];
  params: FunctionParamType[];
  returnType: Type;
  receiver?: {
    type: Type;
    isMutable: boolean;
  };
}

interface FunctionRefType extends BaseType {
  kind: "Function";
  typeParams: TypeParamSpec[];
  params: FunctionParamType[];
  returnType: Type;
  target?: CallableTarget;
}

interface TypeParamRefType extends BaseType {
  kind: "TypeParam";
  name: string;
  bounds: NamedRefType[];
}

interface UnknownType extends BaseType {
  kind: "Unknown";
}

interface ErrorType extends BaseType {
  kind: "Error";
}

interface Scope {
  parent?: Scope;
  values: Map<string, ValueSymbol>;
  types: Map<string, TypeSymbol>;
  typeParams: Map<string, TypeParamSpec>;
  overrides: Map<string, Type>;
  selfType?: NamedRefType;
}

interface BaseSymbol {
  kind: string;
  name: string;
  node: Node;
  isPublic?: boolean;
}

interface ValueSymbol extends BaseSymbol {
  kind: "Value" | "Function" | "Variant" | "BuiltinFunction";
  type: Type;
  functionDepth: number;
  isGlobal: boolean;
  isConst?: boolean;
  isMutableParam?: boolean;
}

interface MethodInfo {
  name: string;
  node: MethodDeclaration | TraitMethodSignature;
  receiver?: {
    type: Type;
    isMutable: boolean;
  };
  typeParams: TypeParamSpec[];
  params: FunctionParamType[];
  returnType: Type;
}

interface TraitSatisfactionInfo {
  span: Span;
  trait: NamedRefType;
  methods: Map<string, MethodDeclaration>;
}

interface TypeSymbol extends BaseSymbol {
  kind: "BuiltinType" | "Alias" | "Struct" | "Enum" | "Trait";
  typeParams: TypeParameter[];
  aliasTarget?: TypeAliasDeclaration;
  traitDecl?: TraitDeclaration;
  structDecl?: StructDeclaration;
  enumDecl?: EnumDeclaration;
  fields?: Map<string, StructField>;
  methods?: Map<string, MethodDeclaration>;
  variants?: Map<string, EnumVariant>;
  satisfactions?: TraitSatisfactionInfo[];
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
  private diagnosticSet = new Set<string>();
  private types = new WeakMap<Node, Type>();
  private globalScope: Scope;
  private currentFunctionReturnType: Type | null = null;
  private currentFunctionDepth = 0;
  private currentFunctionInferReturn = false;
  private currentFunctionInferredReturn: Type | null = null;

  constructor(private program: Program) {
    this.globalScope = this.createScope();
    this.installBuiltins();
  }

  public checkProgram(): CheckResult {
    const coreStatements = this.loadCoreLibraryStatements();
    this.predeclareTypes(coreStatements);
    this.predeclareFunctions(coreStatements);
    this.predeclareTypes();
    this.predeclareFunctions();
    this.materializeTypes();
    for (const statement of this.program.body)
      this.checkStatement(statement, this.globalScope);
    return {
      diagnostics: this.diagnostics,
      types: this.types,
    };
  }

  private loadCoreLibraryStatements(): Statement[] {
    const builtinsDir = path.resolve(__dirname, "../../builtins/core");
    const files = ["panic.vek", "traits.vek", "enums.vek"];
    const statements: Statement[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(builtinsDir, file), "utf8");
      const lexed = new Lexer(source).lex();
      const parsed = new Parser(lexed.tokens).parseProgram();
      statements.push(...parsed.program.body);
    }
    return statements;
  }

  private createScope(parent?: Scope, selfType?: NamedRefType): Scope {
    return {
      parent,
      values: new Map(),
      types: new Map(),
      typeParams: new Map(),
      overrides: new Map(),
      selfType,
    };
  }

  private installBuiltins() {
    for (const name of primitiveNames) {
      this.globalScope.types.set(name, {
        kind: "BuiltinType",
        name,
        node: this.program,
        typeParams: [],
      });
    }
    this.globalScope.types.set("Array", {
      kind: "BuiltinType",
      name: "Array",
      node: this.program,
      typeParams: [this.syntheticTypeParam("T")],
    });
    this.globalScope.types.set("Map", {
      kind: "BuiltinType",
      name: "Map",
      node: this.program,
      typeParams: [this.syntheticTypeParam("K"), this.syntheticTypeParam("V")],
    });
  }

  private predeclareTypes(statements: Statement[] = this.program.body) {
    for (const statement of statements) {
      if (statement.kind === "TypeAliasDeclaration") {
        this.declareType(this.globalScope, {
          kind: "Alias",
          name: statement.name.name,
          node: statement,
          typeParams: [],
          aliasTarget: statement,
          isPublic: statement.isPublic,
        });
      } else if (statement.kind === "StructDeclaration") {
        this.declareType(this.globalScope, {
          kind: "Struct",
          name: statement.name.name,
          node: statement,
          typeParams: statement.typeParams ?? [],
          structDecl: statement,
          isPublic: statement.isPublic,
        });
      } else if (statement.kind === "EnumDeclaration") {
        this.declareType(this.globalScope, {
          kind: "Enum",
          name: statement.name.name,
          node: statement,
          typeParams: statement.typeParams ?? [],
          enumDecl: statement,
          isPublic: statement.isPublic,
        });
      } else if (statement.kind === "TraitDeclaration") {
        this.declareType(this.globalScope, {
          kind: "Trait",
          name: statement.name.name,
          node: statement,
          typeParams: statement.typeParams ?? [],
          traitDecl: statement,
          isPublic: statement.isPublic,
        });
      }
    }
  }

  private predeclareFunctions(statements: Statement[] = this.program.body) {
    for (const statement of statements) {
      if (statement.kind !== "FunctionDeclaration") continue;
      const type = this.resolveFunctionDeclarationSignature(
        statement,
        this.globalScope,
      );
      this.declareValue(this.globalScope, {
        kind: "Function",
        name: statement.name.name,
        node: statement,
        type,
        functionDepth: 0,
        isGlobal: true,
      });
    }
  }

  private materializeTypes() {
    for (const symbol of this.globalScope.types.values()) {
      if (symbol.kind === "Struct") this.materializeStruct(symbol);
      if (symbol.kind === "Enum") this.materializeEnum(symbol);
    }
  }

  private materializeStruct(symbol: TypeSymbol) {
    if (!symbol.structDecl) return;
    const scope = this.createTypeScope(symbol, this.globalScope);
    symbol.fields = new Map();
    symbol.methods = new Map();
    symbol.satisfactions = [];

    for (const member of symbol.structDecl.members) {
      if (member.kind === "StructField") {
        if (symbol.fields.has(member.name.name)) {
          this.report(
            `Duplicate field '${member.name.name}'.`,
            member.span,
            "E2002",
          );
          continue;
        }
        symbol.fields.set(member.name.name, member);
      } else if (member.kind === "MethodDeclaration") {
        if (symbol.methods.has(member.name.name)) {
          this.report(
            `Duplicate method '${member.name.name}'.`,
            member.span,
            "E2002",
          );
          continue;
        }
        symbol.methods.set(member.name.name, member);
      } else {
        symbol.satisfactions.push(
          this.materializeSatisfaction(member, symbol, scope),
        );
      }
    }

    this.validateTypeMemberConflicts(symbol);
  }

  private materializeEnum(symbol: TypeSymbol) {
    if (!symbol.enumDecl) return;
    const scope = this.createTypeScope(symbol, this.globalScope);
    symbol.variants = new Map();
    symbol.methods = new Map();
    symbol.satisfactions = [];

    for (const member of symbol.enumDecl.members) {
      if (member.kind === "EnumVariant") {
        if (symbol.variants.has(member.name.name)) {
          this.report(
            `Duplicate variant '${member.name.name}'.`,
            member.span,
            "E2002",
          );
          continue;
        }
        symbol.variants.set(member.name.name, member);
      } else if (member.kind === "MethodDeclaration") {
        if (symbol.methods.has(member.name.name)) {
          this.report(
            `Duplicate method '${member.name.name}'.`,
            member.span,
            "E2002",
          );
          continue;
        }
        symbol.methods.set(member.name.name, member);
      } else {
        symbol.satisfactions.push(
          this.materializeSatisfaction(member, symbol, scope),
        );
      }
    }

    this.validateTypeMemberConflicts(symbol);

    const enumTypeArgs = symbol.typeParams.map((param) =>
      this.typeParamType(
        param.name.name,
        this.lookupTypeParamBounds(param.name.name, scope),
      ),
    );
    const enumType = this.namedType(symbol.name, symbol, enumTypeArgs);

    for (const variant of symbol.variants.values()) {
      const payload = (variant.payload ?? []).map((node) =>
        this.resolveType(node, scope),
      );
      const type =
        payload.length === 0
          ? enumType
          : ({
              kind: "Function",
              typeParams: this.resolveTypeParams(
                symbol.typeParams,
                undefined,
                this.globalScope,
              ),
              params: payload.map((type, index) => ({
                name: `arg${index}`,
                type,
                isMutable: false,
              })),
              returnType: enumType,
              target: {
                kind: "variant",
                name: variant.name.name,
                typeParams: this.resolveTypeParams(
                  symbol.typeParams,
                  undefined,
                  this.globalScope,
                ),
                params: payload.map((type, index) => ({
                  name: `arg${index}`,
                  type,
                  isMutable: false,
                })),
                returnType: enumType,
              },
            } as FunctionRefType);

      this.declareValue(this.globalScope, {
        kind: "Variant",
        name: variant.name.name,
        node: variant,
        type,
        functionDepth: 0,
        isGlobal: true,
      });
    }
  }

  private materializeSatisfaction(
    declaration: TraitSatisfiesDeclaration,
    _owner: TypeSymbol,
    ownerScope: Scope,
  ): TraitSatisfactionInfo {
    const trait = this.resolveNamedReference(declaration.trait, ownerScope);
    const methods = new Map<string, MethodDeclaration>();
    for (const method of declaration.methods) {
      if (methods.has(method.name.name)) {
        this.report(
          `Duplicate method '${method.name.name}'.`,
          method.span,
          "E2002",
        );
        continue;
      }
      methods.set(method.name.name, method);
    }
    return { span: declaration.trait.span, trait, methods };
  }

  private validateTypeMemberConflicts(symbol: TypeSymbol) {
    const satisfactions = symbol.satisfactions ?? [];
    const methods = symbol.methods ?? new Map<string, MethodDeclaration>();

    const seenTraits: NamedRefType[] = [];
    for (const satisfaction of satisfactions) {
      if (
        seenTraits.some((trait) =>
          this.namedTypeEquals(trait, satisfaction.trait),
        )
      ) {
        this.report(
          `Duplicate satisfies block for trait '${satisfaction.trait.name}'.`,
          satisfaction.span,
          "E2817",
        );
      } else {
        seenTraits.push(satisfaction.trait);
      }
    }

    const traitMethodOwners = new Map<string, string>();
    for (const satisfaction of satisfactions) {
      const ownerName = satisfaction.trait.name;
      const methodNames = this.traitSurfaceMethodNames(satisfaction);
      for (const methodName of methodNames) {
        if (methods.has(methodName)) {
          this.report(
            `Trait method '${methodName}' conflicts with inherent method '${methodName}'.`,
            satisfaction.span,
            "E2817",
          );
        }

        const previousOwner = traitMethodOwners.get(methodName);
        if (previousOwner && previousOwner !== ownerName) {
          this.report(
            `Trait method '${methodName}' is provided by multiple satisfied traits.`,
            satisfaction.span,
            "E2817",
          );
        } else {
          traitMethodOwners.set(methodName, ownerName);
        }
      }
    }
  }

  private traitSurfaceMethodNames(
    satisfaction: TraitSatisfactionInfo,
  ): string[] {
    const traitSymbol = satisfaction.trait.symbol;
    if (traitSymbol?.kind === "Trait" && traitSymbol.traitDecl) {
      return traitSymbol.traitDecl.methods.map((method) => method.name.name);
    }
    return Array.from(satisfaction.methods.keys());
  }

  private createTypeScope(symbol: TypeSymbol, parent: Scope) {
    const typeArgs = symbol.typeParams.map((param) =>
      this.typeParamType(param.name.name, []),
    );
    const selfType = this.namedType(symbol.name, symbol, typeArgs);
    const scope = this.createScope(parent, selfType);
    for (const param of this.resolveTypeParams(
      symbol.typeParams,
      undefined,
      parent,
    )) {
      scope.typeParams.set(param.name, param);
    }
    return scope;
  }

  private checkStatement(statement: Statement, scope: Scope) {
    switch (statement.kind) {
      case "ImportDeclaration":
        this.checkImport(statement, scope);
        return;
      case "VariableDeclaration":
        this.checkVariableDeclaration(statement, scope);
        return;
      case "FunctionDeclaration":
        this.checkFunctionDeclaration(statement, scope);
        return;
      case "TypeAliasDeclaration":
        this.resolveType(statement.type, scope);
        return;
      case "StructDeclaration":
        this.checkTypeDeclaration(
          this.requireTypeSymbol(statement.name.name, scope),
          scope,
        );
        return;
      case "EnumDeclaration":
        this.checkTypeDeclaration(
          this.requireTypeSymbol(statement.name.name, scope),
          scope,
        );
        return;
      case "TraitDeclaration":
        this.checkTraitDeclaration(
          this.requireTypeSymbol(statement.name.name, scope),
          scope,
        );
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
      case "AssignmentStatement":
        this.checkAssignmentStatement(statement, scope);
        return;
      case "BlockStatement":
        this.checkBlockStatement(
          statement,
          this.createScope(scope, scope.selfType),
        );
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
    if (statement.namespace) {
      this.declareValue(scope, {
        kind: "Value",
        name: statement.namespace.name,
        node: statement.namespace,
        type: this.unknownType(),
        functionDepth: this.currentFunctionDepth,
        isGlobal: this.currentFunctionDepth === 0,
      });
    }
    for (const imported of statement.namedImports ?? []) {
      this.declareValue(scope, {
        kind: "Value",
        name: imported.name,
        node: imported,
        type: this.unknownType(),
        functionDepth: this.currentFunctionDepth,
        isGlobal: this.currentFunctionDepth === 0,
      });
    }
  }

  private checkVariableDeclaration(node: VariableDeclaration, scope: Scope) {
    const declaredType = node.typeAnnotation
      ? this.resolveType(node.typeAnnotation, scope)
      : undefined;
    const initializerType = node.initializer
      ? this.checkExpression(node.initializer, scope, declaredType)
      : undefined;

    if (node.declarationKind === "const" && !node.initializer) {
      this.report(
        "Const declarations require an initializer.",
        node.span,
        "E2106",
      );
    }

    if (!declaredType && !initializerType) {
      this.report(
        "Cannot infer type without annotation or initializer.",
        node.span,
        "E2102",
      );
    }

    const finalType = declaredType ?? initializerType ?? this.errorType();
    if (
      declaredType &&
      initializerType &&
      !this.isAssignable(initializerType, declaredType)
    ) {
      this.report("Type mismatch in variable initializer.", node.span, "E2101");
    }

    if (node.name.kind === "Identifier") {
      this.declareValue(scope, {
        kind: "Value",
        name: node.name.name,
        node,
        type: finalType,
        functionDepth: this.currentFunctionDepth,
        isGlobal: this.currentFunctionDepth === 0,
        isConst: node.declarationKind === "const",
      });
    }
  }

  private checkFunctionDeclaration(node: FunctionDeclaration, scope: Scope) {
    const symbol = this.lookupValue(node.name.name, scope);
    if (!symbol || symbol.type.kind !== "Function") return;

    const functionType = symbol.type;
    const bodyScope = this.createScope(scope, scope.selfType);
    for (const param of functionType.typeParams)
      bodyScope.typeParams.set(param.name, param);
    for (const param of functionType.params) {
      if (!param.name) continue;
      this.declareValue(bodyScope, {
        kind: "Value",
        name: param.name,
        node,
        type: param.type,
        functionDepth: this.currentFunctionDepth + 1,
        isGlobal: false,
        isMutableParam: param.isMutable,
      });
    }

    if (node.isExtern) return;

    const previousReturnType = this.currentFunctionReturnType;
    const previousDepth = this.currentFunctionDepth;
    const previousInfer = this.currentFunctionInferReturn;
    const previousInferred = this.currentFunctionInferredReturn;
    this.currentFunctionInferReturn = !node.returnType;
    this.currentFunctionInferredReturn = null;
    this.currentFunctionReturnType = node.returnType
      ? functionType.returnType
      : this.unknownType();
    this.currentFunctionDepth++;
    this.checkBlockStatement(node.body!, bodyScope);
    if (this.currentFunctionInferReturn) {
      const inferred =
        this.currentFunctionInferredReturn ?? this.primitive("void");
      symbol.type = {
        ...symbol.type,
        returnType: inferred,
        target: symbol.type.target
          ? { ...symbol.type.target, returnType: inferred }
          : undefined,
      };
    }
    this.currentFunctionDepth = previousDepth;
    this.currentFunctionReturnType = previousReturnType;
    this.currentFunctionInferReturn = previousInfer;
    this.currentFunctionInferredReturn = previousInferred;
  }

  private checkTypeDeclaration(symbol: TypeSymbol | undefined, scope: Scope) {
    if (!symbol) return;
    if (symbol.kind === "Struct") this.checkStructDeclaration(symbol, scope);
    if (symbol.kind === "Enum") this.checkEnumDeclaration(symbol, scope);
  }

  private checkStructDeclaration(symbol: TypeSymbol, scope: Scope) {
    const typeScope = this.createTypeScope(symbol, scope);
    for (const field of symbol.fields?.values() ?? []) {
      this.resolveType(field.type, typeScope);
    }
    for (const method of symbol.methods?.values() ?? []) {
      this.checkMethodDeclaration(method, symbol, typeScope);
    }
    for (const satisfaction of symbol.satisfactions ?? []) {
      this.checkTraitSatisfaction(satisfaction, symbol, typeScope);
    }
  }

  private checkEnumDeclaration(symbol: TypeSymbol, scope: Scope) {
    const typeScope = this.createTypeScope(symbol, scope);
    for (const variant of symbol.variants?.values() ?? []) {
      for (const payload of variant.payload ?? [])
        this.resolveType(payload, typeScope);
    }
    for (const method of symbol.methods?.values() ?? []) {
      this.checkMethodDeclaration(method, symbol, typeScope);
    }
    for (const satisfaction of symbol.satisfactions ?? []) {
      this.checkTraitSatisfaction(satisfaction, symbol, typeScope);
    }
  }

  private checkTraitDeclaration(symbol: TypeSymbol | undefined, scope: Scope) {
    if (!symbol?.traitDecl) return;
    const typeScope = this.createScope(scope, scope.selfType);
    for (const param of this.resolveTypeParams(
      symbol.typeParams,
      undefined,
      scope,
    )) {
      typeScope.typeParams.set(param.name, param);
    }
    typeScope.selfType = this.namedType("Self", symbol);

    const seen = new Set<string>();
    for (const method of symbol.traitDecl.methods) {
      if (seen.has(method.name.name)) {
        this.report(
          `Duplicate method '${method.name.name}'.`,
          method.span,
          "E2002",
        );
        continue;
      }
      seen.add(method.name.name);
      this.resolveTraitMethod(method, symbol, typeScope);
    }
  }

  private checkTraitSatisfaction(
    satisfaction: TraitSatisfactionInfo,
    owner: TypeSymbol,
    scope: Scope,
  ) {
    if (
      !satisfaction.trait.symbol ||
      satisfaction.trait.symbol.kind !== "Trait"
    ) {
      this.report(
        "Unknown trait in satisfies block.",
        satisfaction.span,
        "E2812",
      );
      return;
    }

    const traitSymbol = satisfaction.trait.symbol;
    const required = this.resolveTraitMethodsForReference(
      traitSymbol,
      satisfaction.trait,
      this.namedType(owner.name, owner, this.ownerTypeArgs(owner, scope)),
      scope,
    );

    for (const [name, requiredMethod] of required) {
      const impl = satisfaction.methods.get(name);
      if (!impl) {
        this.report(
          `Missing trait method '${name}'.`,
          owner.node.span,
          "E2814",
        );
        continue;
      }
      const actual = this.resolveMethod(impl, owner, scope);
      if (!this.methodEquals(actual, requiredMethod)) {
        this.report(
          `Trait method signature mismatch for '${name}'.`,
          impl.span,
          "E2815",
        );
      }
      this.checkMethodBody(impl, actual, owner, scope);
    }
  }

  private checkMethodDeclaration(
    method: MethodDeclaration,
    owner: TypeSymbol,
    scope: Scope,
  ) {
    const resolved = this.resolveMethod(method, owner, scope);
    this.checkMethodBody(method, resolved, owner, scope);
  }

  private checkMethodBody(
    method: MethodDeclaration,
    resolved: MethodInfo,
    owner: TypeSymbol,
    scope: Scope,
  ) {
    const bodyScope = this.createScope(
      scope,
      this.namedType(owner.name, owner, this.ownerTypeArgs(owner, scope)),
    );
    for (const param of this.resolveTypeParams(
      owner.typeParams,
      undefined,
      this.globalScope,
    )) {
      bodyScope.typeParams.set(param.name, param);
    }
    for (const param of resolved.typeParams)
      bodyScope.typeParams.set(param.name, param);
    if (resolved.receiver && method.params[0]?.kind === "SelfParameter") {
      this.declareValue(bodyScope, {
        kind: "Value",
        name: "self",
        node: method.params[0],
        type: resolved.receiver.type,
        functionDepth: this.currentFunctionDepth + 1,
        isGlobal: false,
        isMutableParam: resolved.receiver.isMutable,
      });
    }
    for (const param of resolved.params) {
      if (!param.name) continue;
      this.declareValue(bodyScope, {
        kind: "Value",
        name: param.name,
        node: method,
        type: param.type,
        functionDepth: this.currentFunctionDepth + 1,
        isGlobal: false,
        isMutableParam: param.isMutable,
      });
    }

    const previousReturnType = this.currentFunctionReturnType;
    const previousDepth = this.currentFunctionDepth;
    const previousInfer = this.currentFunctionInferReturn;
    const previousInferred = this.currentFunctionInferredReturn;
    this.currentFunctionInferReturn =
      method.kind === "MethodDeclaration" && !method.returnType;
    this.currentFunctionInferredReturn = null;
    this.currentFunctionReturnType = method.returnType
      ? resolved.returnType
      : this.unknownType();
    this.currentFunctionDepth++;
    this.checkBlockStatement(method.body, bodyScope);
    if (this.currentFunctionInferReturn) {
      resolved.returnType =
        this.currentFunctionInferredReturn ?? this.primitive("void");
    }
    this.currentFunctionDepth = previousDepth;
    this.currentFunctionReturnType = previousReturnType;
    this.currentFunctionInferReturn = previousInfer;
    this.currentFunctionInferredReturn = previousInferred;
  }

  private checkBlockStatement(block: BlockStatement, scope: Scope) {
    const blockScope = this.createScope(scope, scope.selfType);
    blockScope.typeParams = new Map(scope.typeParams);
    for (const statement of block.body)
      this.checkStatement(statement, blockScope);
  }

  private checkReturnStatement(node: ReturnStatement, scope: Scope) {
    if (!this.currentFunctionReturnType) return;
    const valueType = node.value
      ? this.checkExpression(node.value, scope, this.currentFunctionReturnType)
      : this.primitive("void");
    if (this.currentFunctionInferReturn) {
      if (!this.currentFunctionInferredReturn) {
        this.currentFunctionInferredReturn = valueType;
        return;
      }
      const merged = this.mergeBranchTypes(
        this.currentFunctionInferredReturn,
        valueType,
      );
      if (!merged) {
        this.report("Return type mismatch.", node.span, "E2302");
      } else {
        this.currentFunctionInferredReturn = merged;
      }
      return;
    }
    if (!this.isAssignable(valueType, this.currentFunctionReturnType)) {
      this.report("Return type mismatch.", node.span, "E2302");
    }
  }

  private checkIfStatement(node: IfStatement, scope: Scope) {
    const conditionType = this.checkExpression(node.condition, scope);
    if (!this.isBooleanType(conditionType)) {
      this.report("Condition must be bool.", node.condition.span, "E2101");
    }

    const thenScope = this.createScope(scope, scope.selfType);
    thenScope.typeParams = new Map(scope.typeParams);
    const elseScope = this.createScope(scope, scope.selfType);
    elseScope.typeParams = new Map(scope.typeParams);

    const thenNarrow = this.narrowNullComparison(node.condition, true, scope);
    const elseNarrow = this.narrowNullComparison(node.condition, false, scope);
    for (const [name, type] of thenNarrow) thenScope.overrides.set(name, type);
    for (const [name, type] of elseNarrow) elseScope.overrides.set(name, type);

    this.checkBlockStatement(node.thenBranch, thenScope);
    if (!node.elseBranch) return;
    if (node.elseBranch.kind === "IfStatement")
      this.checkIfStatement(node.elseBranch, elseScope);
    else this.checkBlockStatement(node.elseBranch, elseScope);
  }

  private checkWhileStatement(node: WhileStatement, scope: Scope) {
    const conditionType = this.checkExpression(node.condition, scope);
    if (!this.isBooleanType(conditionType)) {
      this.report("Condition must be bool.", node.condition.span, "E2101");
    }
    this.checkBlockStatement(
      node.body,
      this.createScope(scope, scope.selfType),
    );
  }

  private checkForStatement(node: ForStatement, scope: Scope) {
    const iterableType = this.checkExpression(node.iterable, scope);
    const itemType = this.iterableItemType(iterableType, scope);
    if (!itemType) {
      this.report(
        "For loop requires an iterable value.",
        node.iterable.span,
        "E2101",
      );
    }
    const bodyScope = this.createScope(scope, scope.selfType);
    bodyScope.typeParams = new Map(scope.typeParams);
    this.declareValue(bodyScope, {
      kind: "Value",
      name: node.iterator.name,
      node: node.iterator,
      type: itemType ?? this.unknownType(),
      functionDepth: this.currentFunctionDepth,
      isGlobal: false,
    });
    this.checkBlockStatement(node.body, bodyScope);
  }

  private checkMatchStatement(node: MatchStatement, scope: Scope) {
    const matchedType = this.checkExpression(node.expression, scope);
    const coverage = this.createCoverageTracker(matchedType);
    const priorPatterns: Pattern[] = [];

    for (const arm of node.arms) {
      if (
        priorPatterns.some((pattern) =>
          this.patternCovers(pattern, arm.pattern, matchedType, scope),
        )
      ) {
        this.warn(
          "Match arm is shadowed by an earlier arm.",
          arm.span,
          "W2602",
        );
      }
      const armScope = this.createScope(scope, scope.selfType);
      armScope.typeParams = new Map(scope.typeParams);
      this.bindPattern(arm.pattern, matchedType, armScope, scope, coverage);
      this.checkBlockStatement(arm.body, armScope);
      priorPatterns.push(arm.pattern);
    }

    const missing = this.coverageMissing(coverage);
    if (missing.length > 0) {
      this.warn(
        `Match is not exhaustive; missing ${missing.join(", ")}.`,
        node.span,
        "W2601",
      );
      return;
    }

    if (coverage.kind === "other" && !coverage.seen.has("_")) {
      this.warn(
        "Match may be non-exhaustive; add a catch-all '_' arm.",
        node.span,
        "W2601",
      );
    }
  }

  private checkAssignmentStatement(node: AssignmentStatement, scope: Scope) {
    if (!this.isAssignableTarget(node.target)) {
      this.report("Invalid assignment target.", node.target.span, "E2504");
      return;
    }

    const targetType = this.checkAssignableTarget(node.target, scope);
    const valueType = this.checkExpression(node.value, scope, targetType);

    if (!this.isAssignable(valueType, targetType)) {
      this.report("Type mismatch in assignment.", node.span, "E2101");
    }
  }

  private isAssignableTarget(node: Expression): boolean {
    return (
      node.kind === "IdentifierExpression" ||
      node.kind === "MemberExpression" ||
      node.kind === "IndexExpression"
    );
  }

  private checkAssignableTarget(node: Expression, scope: Scope): Type {
    if (node.kind === "IdentifierExpression") {
      const symbol = this.lookupValue(node.name, scope);
      if (!symbol) {
        this.report(`Unknown identifier '${node.name}'.`, node.span, "E2001");
        return this.errorType();
      }
      if (symbol.isConst)
        this.report("Cannot assign to const binding.", node.span, "E2501");
      if (symbol.isMutableParam === false) {
        this.report("Cannot assign to readonly parameter.", node.span, "E2503");
      }
      return symbol.type;
    }

    if (node.kind === "MemberExpression") {
      this.ensureMutableRoot(node.object, node.span, scope);
      return this.checkMember(node, scope);
    }

    if (node.kind === "IndexExpression") {
      this.ensureMutableRoot(node.object, node.span, scope);
      return this.checkIndex(node, scope);
    }

    this.report("Invalid assignment target.", node.span, "E2504");
    return this.errorType();
  }

  private ensureMutableRoot(node: Expression, span: Span, scope: Scope) {
    const root = this.findRootIdentifier(node);
    if (!root) return;
    const symbol = this.lookupValue(root, scope);
    if (!symbol) return;
    if (symbol.isConst)
      this.report("Cannot mutate through const binding.", span, "E2501");
    if (symbol.isMutableParam === false) {
      this.report("Cannot mutate through readonly parameter.", span, "E2503");
    }
  }

  private findRootIdentifier(node: Expression): string | null {
    if (node.kind === "IdentifierExpression") return node.name;
    if (node.kind === "MemberExpression")
      return this.findRootIdentifier(node.object);
    if (node.kind === "TupleMemberExpression")
      return this.findRootIdentifier(node.object);
    if (node.kind === "IndexExpression")
      return this.findRootIdentifier(node.object);
    return null;
  }

  private checkExpression(
    node: Expression,
    scope: Scope,
    expected?: Type,
  ): Type {
    let type: Type;
    switch (node.kind) {
      case "LiteralExpression":
        type = this.checkLiteral(node, expected);
        break;
      case "IdentifierExpression":
        type = this.checkIdentifier(node, scope);
        break;
      case "BinaryExpression":
        type = this.checkBinary(node, scope, expected);
        break;
      case "UnaryExpression":
        type = this.checkUnary(node, scope, expected);
        break;
      case "CallExpression":
        type = this.checkCall(node, scope, expected);
        break;
      case "MemberExpression":
        type = this.checkMember(node, scope);
        break;
      case "TupleMemberExpression":
        type = this.checkTupleMember(node, scope);
        break;
      case "IndexExpression":
        type = this.checkIndex(node, scope);
        break;
      case "ArrayLiteralExpression":
        type = this.checkArrayLiteral(node, scope, expected);
        break;
      case "TupleLiteralExpression":
        type = this.checkTupleLiteral(node, scope);
        break;
      case "StructLiteralExpression":
        type = this.checkStructLiteral(node, scope, expected);
        break;
      case "GroupingExpression":
        type = this.checkExpression(node.expression, scope, expected);
        break;
      case "FunctionExpression":
        type = this.checkFunctionExpression(node, scope, expected);
        break;
      case "CastExpression":
        type = this.checkCast(node, scope);
        break;
      case "MatchExpression":
        type = this.checkMatchExpression(node, scope, expected);
        break;
      default:
        type = this.errorType();
        break;
    }
    this.types.set(node, type);
    return type;
  }

  private checkLiteral(node: LiteralExpression, expected?: Type): Type {
    if (node.literalType === "Integer") {
      const type = this.pickNumericType(expected, true);
      this.checkIntegerLiteral(node, type);
      return type;
    }
    if (node.literalType === "Float")
      return this.pickNumericType(expected, false);
    if (node.literalType === "Boolean") return this.primitive("bool");
    if (node.literalType === "String") return this.primitive("string");
    return this.primitive("null");
  }

  private pickNumericType(expected: Type | undefined, integer: boolean): Type {
    const candidate = expected?.kind === "Nullable" ? expected.base : expected;
    if (candidate) {
      if (integer && this.isIntegerType(candidate)) return candidate;
      if (!integer && this.isFloatType(candidate)) return candidate;
    }
    return this.primitive(integer ? defaultIntType : defaultFloatType);
  }

  private checkIntegerLiteral(node: LiteralExpression, target: Type) {
    if (!this.isIntegerType(target)) return;
    try {
      const value = BigInt(node.value);
      const [min, max] = this.intRange(target.name);
      if (value < min || value > max) {
        this.report("Integer literal out of range.", node.span, "E2401");
      }
    } catch {
      return;
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

  private intBitWidth(name: PrimitiveName): bigint {
    return BigInt(Number(name.slice(1)));
  }

  private checkIdentifier(node: IdentifierExpression, scope: Scope): Type {
    const override = this.lookupOverride(node.name, scope);
    if (override) return override;

    const symbol = this.lookupValue(node.name, scope);
    if (!symbol) {
      this.report(`Unknown identifier '${node.name}'.`, node.span, "E2001");
      return this.errorType();
    }

    if (
      this.currentFunctionDepth > 0 &&
      symbol.functionDepth > 0 &&
      symbol.functionDepth < this.currentFunctionDepth &&
      !symbol.isGlobal
    ) {
      this.report(
        "Anonymous functions may not capture outer locals.",
        node.span,
        "E2813",
      );
    }

    return symbol.type;
  }

  private checkBinary(
    node: BinaryExpression,
    scope: Scope,
    expected?: Type,
  ): Type {
    if (node.operator === "&&" || node.operator === "||") {
      const left = this.checkExpression(node.left, scope);
      const right = this.checkExpression(node.right, scope);
      if (!this.isBooleanType(left) || !this.isBooleanType(right)) {
        this.report(
          "Logical operators require bool operands.",
          node.span,
          "E2101",
        );
      }
      return this.primitive("bool");
    }

    if (node.operator === "==" || node.operator === "!=") {
      const left = this.checkExpression(node.left, scope);
      const right = this.checkExpression(node.right, scope);
      if (!this.canCompareForEquality(left, right, scope)) {
        this.report("Incompatible operands for equality.", node.span, "E2101");
      }
      return this.primitive("bool");
    }

    if (["<", "<=", ">", ">="].includes(node.operator)) {
      const left = this.checkExpression(node.left, scope);
      const right = this.checkExpression(node.right, scope);
      if (
        !this.isNumericType(left) ||
        !this.isNumericType(right) ||
        !this.typeEquals(left, right)
      ) {
        this.report(
          "Comparison requires matching numeric types.",
          node.span,
          "E2101",
        );
      }
      return this.primitive("bool");
    }

    const numericExpected =
      expected?.kind === "Nullable" ? expected.base : expected;
    const left = this.checkExpression(node.left, scope, numericExpected);
    const right = this.checkExpression(node.right, scope, numericExpected);

    if (node.operator === "+") {
      if (this.isStringType(left) || this.isStringType(right)) {
        if (!this.isStringType(left) || !this.isStringType(right)) {
          this.report(
            "String concatenation requires string operands.",
            node.span,
            "E2101",
          );
        }
        return this.primitive("string");
      }
    }

    if (["&", "|", "^"].includes(node.operator)) {
      if (!this.isIntegerType(left) || !this.isIntegerType(right)) {
        this.report(
          "Bitwise operators require integer operands.",
          node.span,
          "E2101",
        );
        return this.errorType();
      }
      if (!this.typeEquals(left, right)) {
        this.report(
          "Bitwise operators require matching integer types.",
          node.span,
          "E2101",
        );
      } else {
        this.validateIntegerBinary(node, left);
      }
      return left;
    }

    if (["<<", ">>"].includes(node.operator)) {
      if (!this.isIntegerType(left) || !this.isIntegerType(right)) {
        this.report(
          "Shift operators require integer operands.",
          node.span,
          "E2101",
        );
        return this.errorType();
      }
      if (!this.typeEquals(left, right)) {
        this.report(
          "Shift operators require matching integer types.",
          node.span,
          "E2101",
        );
      } else {
        this.validateIntegerBinary(node, left);
      }
      return left;
    }

    if (["+", "-", "*", "/", "%"].includes(node.operator)) {
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
      } else if (this.isIntegerType(left)) {
        this.validateIntegerBinary(node, left);
      }
      return left;
    }

    return this.errorType();
  }

  private checkUnary(node: any, scope: Scope, expected?: Type): Type {
    const numericExpected =
      expected?.kind === "Nullable" ? expected.base : expected;
    const argument =
      node.operator === "-" &&
      numericExpected &&
      this.isSignedIntegerType(numericExpected) &&
      this.evaluateIntegerConstant(node.argument) !== null
        ? numericExpected
        : this.checkExpression(node.argument, scope, numericExpected);
    if (node.operator === "!") {
      if (!this.isBooleanType(argument)) {
        this.report("Unary '!' requires a bool operand.", node.span, "E2101");
      }
      return this.primitive("bool");
    }
    if (!this.isNumericType(argument)) {
      this.report("Unary '-' requires a numeric operand.", node.span, "E2101");
    } else if (this.isIntegerType(argument)) {
      this.validateIntegerUnary(node, argument);
    }
    return argument;
  }

  private validateIntegerUnary(node: any, target: PrimitiveType) {
    const value = this.evaluateIntegerConstant(node);
    if (value === null) return;
    const [min, max] = this.intRange(target.name);
    if (value < min || value > max) {
      this.report("Compile-time integer overflow.", node.span, "E2402");
    }
  }

  private validateIntegerBinary(node: BinaryExpression, target: PrimitiveType) {
    const left = this.evaluateIntegerConstant(node.left);
    const right = this.evaluateIntegerConstant(node.right);
    if (left === null || right === null) return;

    if (
      (node.operator === "<<" || node.operator === ">>") &&
      (right < 0 || right >= this.intBitWidth(target.name))
    ) {
      this.report("Compile-time invalid shift.", node.span, "E2403");
      return;
    }

    let result: bigint | null = null;
    if (node.operator === "+") result = left + right;
    if (node.operator === "-") result = left - right;
    if (node.operator === "*") result = left * right;
    if (node.operator === "<<") result = left << right;
    if (result === null) return;

    const [min, max] = this.intRange(target.name);
    if (result < min || result > max) {
      this.report("Compile-time integer overflow.", node.span, "E2402");
    }
  }

  private evaluateIntegerConstant(node: Expression): bigint | null {
    if (node.kind === "LiteralExpression" && node.literalType === "Integer") {
      try {
        return BigInt(node.value);
      } catch {
        return null;
      }
    }
    if (node.kind === "UnaryExpression" && node.operator === "-") {
      const value = this.evaluateIntegerConstant(node.argument);
      return value === null ? null : -value;
    }
    if (node.kind === "GroupingExpression") {
      return this.evaluateIntegerConstant(node.expression);
    }
    return null;
  }

  private checkCall(node: CallExpression, scope: Scope, expected?: Type): Type {
    const calleeType = this.checkExpression(node.callee, scope);
    if (calleeType.kind === "Error") {
      for (const arg of node.args) this.checkExpression(arg, scope);
      return this.errorType();
    }
    if (calleeType.kind !== "Function") {
      this.report("Callee is not callable.", node.callee.span, "E2207");
      for (const arg of node.args) this.checkExpression(arg, scope);
      return this.errorType();
    }

    const instantiated = this.instantiateCallable(
      calleeType,
      node,
      scope,
      expected,
    );
    if (
      node.callee.kind === "MemberExpression" &&
      instantiated.target?.kind === "method" &&
      instantiated.target.receiver?.isMutable
    ) {
      this.ensureMutableRoot(node.callee.object, node.callee.span, scope);
    }
    for (let i = 0; i < node.args.length; i++) {
      const param = instantiated.params[i];
      const arg = node.args[i];
      if (!param) {
        this.report("Too many arguments.", arg.span, "E2207");
        this.checkExpression(arg, scope);
        continue;
      }
      const argType = this.checkExpression(arg, scope, param.type);
      if (!this.isAssignable(argType, param.type)) {
        this.report("Argument type mismatch.", arg.span, "E2207");
      }
      if (param.isMutable) this.requireMutableArgument(arg, scope);
    }
    if (node.args.length < instantiated.params.length) {
      this.report("Missing arguments.", node.span, "E2207");
    }
    return instantiated.returnType;
  }

  private instantiateCallable(
    callable: FunctionRefType,
    node: CallExpression,
    scope: Scope,
    expected?: Type,
  ): FunctionRefType {
    if (callable.typeParams.length === 0) return callable;

    const bindings = new Map<string, Type>();
    if (node.typeArgs) {
      const explicit = node.typeArgs.map((arg) => this.resolveType(arg, scope));
      if (explicit.length !== callable.typeParams.length) {
        this.report("Type argument count mismatch.", node.span, "E2005");
      }
      for (
        let i = 0;
        i < Math.min(explicit.length, callable.typeParams.length);
        i++
      ) {
        bindings.set(callable.typeParams[i].name, explicit[i]);
      }
    } else {
      for (
        let i = 0;
        i < Math.min(node.args.length, callable.params.length);
        i++
      ) {
        const argType = this.checkExpression(
          node.args[i],
          scope,
          callable.params[i].type,
        );
        this.inferBindingsFromTypes(callable.params[i].type, argType, bindings);
      }
      if (expected) {
        this.inferBindingsFromTypes(callable.returnType, expected, bindings);
        if (expected.kind === "Nullable") {
          this.inferBindingsFromTypes(
            callable.returnType,
            expected.base,
            bindings,
          );
        }
      }
    }

    for (const typeParam of callable.typeParams) {
      const inferred = bindings.get(typeParam.name);
      if (!inferred) {
        this.report(
          `Cannot infer type argument for '${typeParam.name}'.`,
          node.span,
          "E2820",
        );
        continue;
      }
      for (const bound of typeParam.bounds) {
        const concreteBound = this.substituteNamedType(bound, bindings);
        if (!this.typeSatisfiesTrait(inferred, concreteBound, scope)) {
          this.report(
            `Type does not satisfy trait bound '${this.displayType(concreteBound)}'.`,
            node.span,
            "E2816",
          );
        }
      }
    }

    return {
      ...callable,
      typeParams: [],
      params: callable.params.map((param) => ({
        ...param,
        type: this.substituteType(param.type, bindings),
      })),
      returnType: this.substituteType(callable.returnType, bindings),
      target: callable.target
        ? {
            ...callable.target,
            params: callable.target.params.map((param) => ({
              ...param,
              type: this.substituteType(param.type, bindings),
            })),
            returnType: this.substituteType(
              callable.target.returnType,
              bindings,
            ),
            receiver: callable.target.receiver
              ? {
                  ...callable.target.receiver,
                  type: this.substituteType(
                    callable.target.receiver.type,
                    bindings,
                  ),
                }
              : undefined,
          }
        : undefined,
    };
  }

  private inferBindingsFromTypes(
    template: Type,
    actual: Type,
    bindings: Map<string, Type>,
  ) {
    if (template.kind === "TypeParam") {
      if (!bindings.has(template.name)) bindings.set(template.name, actual);
      return;
    }
    if (template.kind === "Named" && actual.kind === "Named") {
      if (template.name !== actual.name) return;
      const left = template.typeArgs ?? [];
      const right = actual.typeArgs ?? [];
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        this.inferBindingsFromTypes(left[i], right[i], bindings);
      }
      return;
    }
    if (template.kind === "Tuple" && actual.kind === "Tuple") {
      for (
        let i = 0;
        i < Math.min(template.elements.length, actual.elements.length);
        i++
      ) {
        this.inferBindingsFromTypes(
          template.elements[i],
          actual.elements[i],
          bindings,
        );
      }
      return;
    }
    if (template.kind === "Nullable" && actual.kind === "Nullable") {
      this.inferBindingsFromTypes(template.base, actual.base, bindings);
    }
  }

  private requireMutableArgument(node: Expression, scope: Scope) {
    if (node.kind !== "IdentifierExpression") {
      this.report(
        "Mut parameter requires a mutable identifier.",
        node.span,
        "E2204",
      );
      return;
    }
    const symbol = this.lookupValue(node.name, scope);
    if (!symbol || symbol.isConst || symbol.isMutableParam === false) {
      this.report(
        "Mut parameter requires a mutable identifier.",
        node.span,
        "E2204",
      );
    }
  }

  private checkMember(node: MemberExpression, scope: Scope): Type {
    if (node.object.kind === "IdentifierExpression") {
      const typeSymbol = this.lookupType(node.object.name, scope);
      const valueSymbol = this.lookupValue(node.object.name, scope);
      if (typeSymbol && !valueSymbol) {
        return this.checkTypeQualifiedMember(
          typeSymbol,
          node.property.name,
          node.span,
          scope,
        );
      }
    }

    const objectType = this.checkExpression(node.object, scope);
    if (objectType.kind === "TypeParam") {
      return this.checkTypeParamMember(node, objectType, scope);
    }

    if (objectType.kind !== "Named" || !objectType.symbol) {
      const traitMethod = this.lookupTraitMethodOnType(
        objectType,
        node.property.name,
        scope,
      );
      if (traitMethod) return this.methodCallType(traitMethod);
      this.report(
        `Unknown member '${node.property.name}'.`,
        node.property.span,
        "E2104",
      );
      return this.errorType();
    }

    if (objectType.symbol.kind === "Struct") {
      const field = objectType.symbol.fields?.get(node.property.name);
      if (field)
        return this.resolveTypeWithOwnerBindings(
          field.type,
          objectType.symbol,
          objectType.typeArgs,
          scope,
        );
    }

    const method = this.lookupInstanceMethod(
      objectType,
      node.property.name,
      scope,
    );
    if (method) return this.methodCallType(method);

    const traitMethod = this.lookupTraitMethodOnType(
      objectType,
      node.property.name,
      scope,
    );
    if (traitMethod) return this.methodCallType(traitMethod);

    this.report(
      `Unknown member '${node.property.name}'.`,
      node.property.span,
      "E2104",
    );
    return this.errorType();
  }

  private checkTypeQualifiedMember(
    symbol: TypeSymbol,
    memberName: string,
    span: Span,
    scope: Scope,
  ): Type {
    const method = this.lookupStaticOrQualifiedMethod(
      symbol,
      memberName,
      scope,
    );
    if (!method) {
      this.report(`Unknown member '${memberName}'.`, span, "E2104");
      return this.errorType();
    }

    if (!method.receiver) return this.methodCallType(method);

    return {
      kind: "Function",
      typeParams: method.typeParams,
      params: [
        {
          name: "self",
          type: method.receiver.type,
          isMutable: method.receiver.isMutable,
        },
        ...method.params,
      ],
      returnType: method.returnType,
      target: {
        kind: "method",
        name: method.name,
        typeParams: method.typeParams,
        params: [
          {
            name: "self",
            type: method.receiver.type,
            isMutable: method.receiver.isMutable,
          },
          ...method.params,
        ],
        returnType: method.returnType,
      },
    };
  }

  private checkTypeParamMember(
    node: MemberExpression,
    objectType: TypeParamRefType,
    scope: Scope,
  ): Type {
    const matches: MethodInfo[] = [];
    for (const bound of objectType.bounds) {
      if (!bound.symbol || bound.symbol.kind !== "Trait") continue;
      const methods = this.resolveTraitMethodsForReference(
        bound.symbol,
        bound,
        objectType,
        scope,
      );
      const method = methods.get(node.property.name);
      if (method) matches.push(method);
    }
    if (matches.length === 1) return this.methodCallType(matches[0]);
    if (matches.length > 1) {
      this.report(
        `Ambiguous trait method '${node.property.name}'.`,
        node.property.span,
        "E2819",
      );
      return this.errorType();
    }
    this.report(
      `Unknown member '${node.property.name}'.`,
      node.property.span,
      "E2104",
    );
    return this.errorType();
  }

  private checkTupleMember(node: TupleMemberExpression, scope: Scope): Type {
    const objectType = this.checkExpression(node.object, scope);
    if (objectType.kind !== "Tuple") {
      this.report(
        "Tuple member access requires a tuple value.",
        node.span,
        "E2104",
      );
      return this.errorType();
    }
    if (node.index < 0 || node.index >= objectType.elements.length) {
      this.report("Tuple index out of range.", node.span, "E2104");
      return this.errorType();
    }
    return objectType.elements[node.index];
  }

  private checkIndex(node: IndexExpression, scope: Scope): Type {
    const objectType = this.checkExpression(node.object, scope);
    const indexType = this.checkExpression(
      node.index,
      scope,
      this.primitive("i32"),
    );
    if (!this.typeEquals(indexType, this.primitive("i32"))) {
      this.report("Index must be i32.", node.index.span, "E2101");
    }
    if (objectType.kind === "Named" && objectType.name === "Array") {
      return objectType.typeArgs?.[0] ?? this.unknownType();
    }
    if (this.isStringType(objectType)) return this.primitive("string");
    this.report(
      "Indexing is only supported on arrays and strings.",
      node.span,
      "E2104",
    );
    return this.errorType();
  }

  private checkArrayLiteral(
    node: ArrayLiteralExpression,
    scope: Scope,
    expected?: Type,
  ): Type {
    const expectedElement =
      expected?.kind === "Named" && expected.name === "Array"
        ? expected.typeArgs?.[0]
        : undefined;
    const elementTypes = node.elements.map((element) =>
      this.checkExpression(element, scope, expectedElement),
    );
    let elementType = expectedElement ?? this.unknownType();
    if (!expectedElement && node.elements.length === 0) {
      this.report(
        "Empty array literal requires contextual element type.",
        node.span,
        "E2102",
      );
      elementType = this.errorType();
    }
    if (!expectedElement && elementTypes.length > 0)
      elementType = elementTypes[0];
    for (const current of elementTypes) {
      if (
        !this.isUnknownType(elementType) &&
        !this.typeEquals(current, elementType)
      ) {
        this.report(
          "Array literal elements must have a single type.",
          node.span,
          "E2101",
        );
      }
    }
    return this.namedType("Array", this.lookupType("Array", scope), [
      elementType,
    ]);
  }

  private checkTupleLiteral(node: TupleLiteralExpression, scope: Scope): Type {
    return {
      kind: "Tuple",
      elements: node.elements.map((element) =>
        this.checkExpression(element, scope),
      ),
    };
  }

  private checkStructLiteral(
    node: StructLiteralExpression,
    scope: Scope,
    expected?: Type,
  ): Type {
    const symbol =
      node.name.name === "Self" && scope.selfType?.kind === "Named"
        ? scope.selfType.symbol
        : this.lookupType(node.name.name, scope);
    if (!symbol || symbol.kind !== "Struct") {
      this.report(
        `Unknown struct '${node.name.name}'.`,
        node.name.span,
        "E2003",
      );
      return this.errorType();
    }

    const typeArgs =
      expected?.kind === "Named" && expected.symbol === symbol
        ? expected.typeArgs
        : this.inferStructTypeArgs(symbol, node, scope);
    const structType = this.namedType(symbol.name, symbol, typeArgs);

    const seen = new Set<string>();
    for (const field of node.fields) {
      if (seen.has(field.name.name)) {
        this.report(
          `Duplicate field '${field.name.name}'.`,
          field.span,
          "E2002",
        );
        continue;
      }
      seen.add(field.name.name);
      const target = symbol.fields?.get(field.name.name);
      if (!target) {
        this.report(
          `Unknown struct field '${field.name.name}'.`,
          field.span,
          "E2104",
        );
        continue;
      }
      const targetType = this.resolveTypeWithOwnerBindings(
        target.type,
        symbol,
        typeArgs,
        scope,
      );
      const valueType = this.checkExpression(field.value, scope, targetType);
      if (!this.isAssignable(valueType, targetType)) {
        this.report("Struct field type mismatch.", field.span, "E2101");
      }
    }

    for (const [name] of symbol.fields ?? []) {
      if (!seen.has(name)) {
        this.report(`Missing struct field '${name}'.`, node.span, "E2103");
      }
    }

    return structType;
  }

  private inferStructTypeArgs(
    symbol: TypeSymbol,
    node: StructLiteralExpression,
    scope: Scope,
  ): Type[] | undefined {
    if (symbol.typeParams.length === 0) return undefined;
    const bindings = new Map<string, Type>();
    for (const field of node.fields) {
      const target = symbol.fields?.get(field.name.name);
      if (!target) continue;
      const valueType = this.checkExpression(field.value, scope);
      this.inferBindingsFromAstType(
        target.type,
        valueType,
        bindings,
        this.createTypeScope(symbol, scope),
      );
    }
    const resolved: Type[] = [];
    for (const param of symbol.typeParams) {
      const inferred = bindings.get(param.name.name);
      if (!inferred) {
        this.report(
          `Cannot infer type argument for '${param.name.name}'.`,
          node.span,
          "E2820",
        );
        resolved.push(this.unknownType());
      } else {
        resolved.push(inferred);
      }
    }
    return resolved;
  }

  private inferBindingsFromAstType(
    template: TypeNode,
    actual: Type,
    bindings: Map<string, Type>,
    scope: Scope,
  ) {
    if (
      template.kind === "NamedType" &&
      scope.typeParams.has(template.name.name)
    ) {
      if (!bindings.has(template.name.name))
        bindings.set(template.name.name, actual);
      return;
    }

    if (
      template.kind === "ArrayType" &&
      actual.kind === "Named" &&
      actual.name === "Array"
    ) {
      this.inferBindingsFromAstType(
        template.element,
        actual.typeArgs?.[0] ?? this.unknownType(),
        bindings,
        scope,
      );
      return;
    }

    if (template.kind === "NullableType" && actual.kind === "Nullable") {
      this.inferBindingsFromAstType(
        template.base,
        actual.base,
        bindings,
        scope,
      );
      return;
    }

    if (template.kind === "TupleType" && actual.kind === "Tuple") {
      for (
        let i = 0;
        i < Math.min(template.elements.length, actual.elements.length);
        i++
      ) {
        this.inferBindingsFromAstType(
          template.elements[i],
          actual.elements[i],
          bindings,
          scope,
        );
      }
    }
  }

  private checkFunctionExpression(
    node: FunctionExpression,
    scope: Scope,
    expected?: Type,
  ): Type {
    const functionType = this.resolveAnonymousFunctionSignature(
      node,
      scope,
      expected,
    );
    const bodyScope = this.createScope(scope, scope.selfType);
    bodyScope.typeParams = new Map(scope.typeParams);
    for (const param of functionType.params) {
      if (!param.name) continue;
      this.declareValue(bodyScope, {
        kind: "Value",
        name: param.name,
        node,
        type: param.type,
        functionDepth: this.currentFunctionDepth + 1,
        isGlobal: false,
        isMutableParam: param.isMutable,
      });
    }

    const previousReturnType = this.currentFunctionReturnType;
    const previousDepth = this.currentFunctionDepth;
    const previousInfer = this.currentFunctionInferReturn;
    const previousInferred = this.currentFunctionInferredReturn;

    const shouldInfer = !node.returnType && expected?.kind !== "Function";
    this.currentFunctionInferReturn = shouldInfer;
    this.currentFunctionInferredReturn = null;
    this.currentFunctionReturnType = functionType.returnType;
    this.currentFunctionDepth++;
    this.checkBlockStatement(node.body, bodyScope);

    let result: FunctionRefType = functionType;
    if (shouldInfer) {
      const inferred =
        this.currentFunctionInferredReturn ?? this.primitive("void");
      result = { ...functionType, returnType: inferred };
    }

    this.currentFunctionDepth = previousDepth;
    this.currentFunctionReturnType = previousReturnType;
    this.currentFunctionInferReturn = previousInfer;
    this.currentFunctionInferredReturn = previousInferred;
    return result;
  }

  private checkCast(node: CastExpression, scope: Scope): Type {
    const from = this.checkExpression(node.expression, scope);
    const to = this.resolveType(node.type, scope);
    if (this.isValidCast(from, to)) return to;
    this.report(
      `Cannot cast '${this.displayType(from)}' to '${this.displayType(to)}'.`,
      node.span,
      "E2105",
    );
    return this.errorType();
  }

  private isValidCast(from: Type, to: Type): boolean {
    if (from.kind === "Error" || to.kind === "Error") return true;
    return this.isNumericType(from) && this.isNumericType(to);
  }

  private checkMatchExpression(
    node: MatchExpression,
    scope: Scope,
    expected?: Type,
  ): Type {
    const matchedType = this.checkExpression(node.expression, scope);
    let resultType: Type | null = expected ?? null;
    let hasWildcard = false;

    for (const arm of node.arms) {
      if (arm.pattern.kind === "WildcardPattern") hasWildcard = true;
      const armScope = this.createScope(scope, scope.selfType);
      armScope.typeParams = new Map(scope.typeParams);
      this.bindPattern(arm.pattern, matchedType, armScope, scope);
      const armType = this.checkExpression(arm.expression, armScope, expected);
      if (!resultType) resultType = armType;
      else {
        const merged = this.mergeBranchTypes(resultType, armType);
        if (!merged) {
          this.report(
            "Match expression arms must have a single type.",
            arm.span,
            "E2101",
          );
        } else {
          resultType = merged;
        }
      }
    }

    if (!hasWildcard) {
      this.report(
        "Match expressions require a catch-all '_' arm.",
        node.span,
        "E2606",
      );
    }

    return resultType ?? this.primitive("void");
  }

  private mergeBranchTypes(left: Type, right: Type): Type | null {
    if (this.typeEquals(left, right)) return left;
    if (this.isAssignable(left, right)) return right;
    if (this.isAssignable(right, left)) return left;
    if (this.typeEquals(left, this.primitive("null")))
      return { kind: "Nullable", base: right };
    if (this.typeEquals(right, this.primitive("null")))
      return { kind: "Nullable", base: left };
    return null;
  }

  private bindPattern(
    pattern: Pattern,
    matchedType: Type,
    targetScope: Scope,
    checkScope: Scope,
    coverage?: CoverageTracker,
  ) {
    if (pattern.kind === "WildcardPattern") {
      coverage?.seen.add("_");
      return;
    }

    if (pattern.kind === "IdentifierPattern") {
      const unitVariant = this.matchUnitVariant(
        pattern.name.name,
        matchedType,
        checkScope,
      );
      if (unitVariant) {
        coverage?.seen.add(unitVariant);
        return;
      }
      this.declareValue(targetScope, {
        kind: "Value",
        name: pattern.name.name,
        node: pattern,
        type: matchedType,
        functionDepth: this.currentFunctionDepth,
        isGlobal: false,
      });
      return;
    }

    if (pattern.kind === "LiteralPattern") {
      const literalType = this.checkExpression(pattern.literal, checkScope);
      if (!this.isAssignable(literalType, matchedType)) {
        this.report("Pattern type mismatch.", pattern.span, "E2602");
      }
      const label = this.patternLabel(pattern);
      if (label) coverage?.seen.add(label);
      return;
    }

    if (pattern.kind === "TuplePattern") {
      if (matchedType.kind !== "Tuple") {
        this.report("Pattern type mismatch.", pattern.span, "E2602");
        return;
      }
      if (pattern.elements.length !== matchedType.elements.length) {
        this.report("Tuple pattern arity mismatch.", pattern.span, "E2601");
      }
      for (let i = 0; i < pattern.elements.length; i++) {
        this.bindPattern(
          pattern.elements[i],
          matchedType.elements[i] ?? this.unknownType(),
          targetScope,
          checkScope,
          coverage,
        );
      }
      return;
    }

    const enumInfo = this.resolveEnumVariantPattern(
      pattern,
      matchedType,
      checkScope,
    );
    if (!enumInfo) return;
    coverage?.seen.add(enumInfo.name);
    for (let i = 0; i < pattern.args.length; i++) {
      this.bindPattern(
        pattern.args[i],
        enumInfo.payload[i] ?? this.unknownType(),
        targetScope,
        checkScope,
        coverage,
      );
    }
  }

  private resolveEnumVariantPattern(
    pattern: EnumPattern,
    matchedType: Type,
    scope: Scope,
  ): { name: string; payload: Type[] } | null {
    const enumType = this.extractEnumType(matchedType);
    if (!enumType) {
      this.report(
        "Enum pattern used with non-enum match target.",
        pattern.span,
        "E2604",
      );
      return null;
    }
    const variant = enumType.symbol?.variants?.get(pattern.name.name);
    if (!variant) {
      this.report(
        `Unknown enum variant '${pattern.name.name}'.`,
        pattern.span,
        "E2603",
      );
      return null;
    }
    const payload = (variant.payload ?? []).map((node) =>
      this.resolveTypeWithOwnerBindings(
        node,
        enumType.symbol!,
        enumType.typeArgs,
        scope,
      ),
    );
    if (payload.length !== pattern.args.length) {
      this.report("Enum payload arity mismatch.", pattern.span, "E2601");
    }
    return { name: pattern.name.name, payload };
  }

  private createCoverageTracker(matchedType: Type): CoverageTracker {
    return {
      kind: this.coverageKind(matchedType),
      seen: new Set(),
      enumType: this.extractEnumType(matchedType),
      nullableBase: matchedType.kind === "Nullable" ? matchedType.base : null,
    };
  }

  private coverageKind(type: Type): "enum" | "bool" | "nullable" | "other" {
    if (this.extractEnumType(type)) return "enum";
    if (this.isBooleanType(type)) return "bool";
    if (
      type.kind === "Nullable" &&
      this.typeEquals(type.base, this.primitive("null")) === false
    ) {
      return "nullable";
    }
    return "other";
  }

  private coverageMissing(tracker: CoverageTracker): string[] {
    if (tracker.seen.has("_")) return [];
    if (tracker.kind === "enum" && tracker.enumType?.symbol?.variants) {
      return Array.from(tracker.enumType.symbol.variants.keys()).filter(
        (name) => !tracker.seen.has(name),
      );
    }
    if (tracker.kind === "bool") {
      return ["true", "false"].filter((name) => !tracker.seen.has(name));
    }
    if (tracker.kind === "nullable") {
      return [
        ...this.finiteCoverageLabels(tracker.nullableBase),
        "null",
      ].filter((name) => !tracker.seen.has(name));
    }
    return [];
  }

  private finiteCoverageLabels(type: Type | null): string[] {
    if (!type) return [];
    if (this.isBooleanType(type)) return ["true", "false"];
    const enumType = this.extractEnumType(type);
    if (enumType?.symbol?.variants)
      return Array.from(enumType.symbol.variants.keys());
    return [];
  }

  private patternLabel(pattern: Pattern): string | null {
    if (pattern.kind !== "LiteralPattern") return null;
    if (pattern.literal.literalType === "Boolean") return pattern.literal.value;
    if (pattern.literal.literalType === "Null") return "null";
    return null;
  }

  private patternCovers(
    previous: Pattern,
    current: Pattern,
    matchedType: Type,
    scope: Scope,
  ): boolean {
    if (previous.kind === "WildcardPattern") return true;
    if (previous.kind === "IdentifierPattern") {
      return !this.matchUnitVariant(previous.name.name, matchedType, scope);
    }
    if (
      previous.kind === "LiteralPattern" &&
      current.kind === "LiteralPattern"
    ) {
      return (
        previous.literal.literalType === current.literal.literalType &&
        previous.literal.value === current.literal.value
      );
    }
    if (previous.kind === "EnumPattern" && current.kind === "EnumPattern") {
      return previous.name.name === current.name.name;
    }
    return false;
  }

  private narrowNullComparison(
    condition: Expression,
    truthy: boolean,
    scope: Scope,
  ): Map<string, Type> {
    const result = new Map<string, Type>();
    if (condition.kind !== "BinaryExpression") return result;
    if (condition.operator !== "==" && condition.operator !== "!=")
      return result;

    const isNull = (expr: Expression) =>
      expr.kind === "LiteralExpression" && expr.literalType === "Null";

    const left = condition.left;
    const right = condition.right;

    if (left.kind === "IdentifierExpression" && isNull(right)) {
      const original = this.lookupValueType(left.name, scope);
      if (!original) return result;
      result.set(
        left.name,
        this.computeNarrowedNullType(original, condition.operator, truthy),
      );
    } else if (right.kind === "IdentifierExpression" && isNull(left)) {
      const original = this.lookupValueType(right.name, scope);
      if (!original) return result;
      result.set(
        right.name,
        this.computeNarrowedNullType(original, condition.operator, truthy),
      );
    }

    return result;
  }

  private computeNarrowedNullType(
    original: Type,
    operator: "==" | "!=",
    truthy: boolean,
  ): Type {
    const positive =
      operator === "!=" ? this.removeNull(original) : this.primitive("null");
    const negative =
      operator === "!=" ? this.primitive("null") : this.removeNull(original);
    return truthy ? positive : negative;
  }

  private removeNull(type: Type): Type {
    if (type.kind === "Nullable") return type.base;
    return type;
  }

  private resolveType(node: TypeNode, scope: Scope): Type {
    if (node.kind === "SelfType") {
      if (!scope.selfType) {
        this.report(
          "Self is only valid inside type declarations.",
          node.span,
          "E2003",
        );
        return this.errorType();
      }
      return scope.selfType;
    }

    if (node.kind === "NamedType") return this.resolveNamedType(node, scope);
    if (node.kind === "ArrayType") {
      const element = this.resolveType(node.element, scope);
      return this.namedType("Array", this.lookupType("Array", scope), [
        element,
      ]);
    }
    if (node.kind === "NullableType") {
      return { kind: "Nullable", base: this.resolveType(node.base, scope) };
    }
    if (node.kind === "TupleType") {
      return {
        kind: "Tuple",
        elements: node.elements.map((element) =>
          this.resolveType(element, scope),
        ),
      };
    }
    if (node.kind === "FunctionType") {
      const typeScope = this.createScope(scope, scope.selfType);
      typeScope.typeParams = new Map(scope.typeParams);
      const typeParams = this.resolveTypeParams(
        node.typeParams,
        node.whereClause,
        scope,
      );
      for (const param of typeParams)
        typeScope.typeParams.set(param.name, param);
      return {
        kind: "Function",
        typeParams,
        params: node.params.map((param) => ({
          type: this.resolveType(param.type, typeScope),
          isMutable: param.isMutable,
        })),
        returnType: this.resolveType(node.returnType, typeScope),
      };
    }

    return this.errorType();
  }

  private resolveNamedType(node: NamedType, scope: Scope): Type {
    if (scope.typeParams.has(node.name.name)) {
      const spec = scope.typeParams.get(node.name.name)!;
      return this.typeParamType(spec.name, spec.bounds);
    }

    if (primitiveNames.includes(node.name.name as PrimitiveName)) {
      return this.primitive(node.name.name as PrimitiveName);
    }

    const symbol = this.lookupType(node.name.name, scope);
    if (!symbol) {
      this.report(`Unknown type '${node.name.name}'.`, node.span, "E2003");
      return this.namedType(node.name.name, undefined);
    }

    if (symbol.kind === "Alias" && symbol.aliasTarget) {
      return this.resolveAliasType(symbol, scope);
    }

    const typeArgs = node.typeArgs?.map((arg) => this.resolveType(arg, scope));
    const expected = symbol.typeParams.length;
    if ((typeArgs?.length ?? 0) !== expected) {
      if (expected !== 0 || (typeArgs?.length ?? 0) !== 0) {
        this.report(
          `Type argument count mismatch for '${node.name.name}'.`,
          node.span,
          "E2005",
        );
      }
    }

    const named = this.namedType(node.name.name, symbol, typeArgs);
    if (typeArgs) {
      const ownerScope = this.createTypeScope(symbol, scope);
      const bounds = this.resolveTypeParams(
        symbol.typeParams,
        undefined,
        scope,
      );
      for (let i = 0; i < Math.min(bounds.length, typeArgs.length); i++) {
        for (const bound of bounds[i].bounds) {
          const concrete = this.substituteNamedType(
            bound,
            new Map([[bounds[i].name, typeArgs[i]]]),
          );
          if (!this.typeSatisfiesTrait(typeArgs[i], concrete, ownerScope)) {
            this.report(
              `Type does not satisfy trait bound '${this.displayType(concrete)}'.`,
              node.span,
              "E2816",
            );
          }
        }
      }
    }
    return named;
  }

  private resolveNamedReference(node: NamedType, scope: Scope): NamedRefType {
    const resolved = this.resolveNamedType(node, scope);
    if (resolved.kind === "Named") return resolved;
    this.report("Expected named type.", node.span, "E2003");
    return this.namedType(node.name.name);
  }

  private resolveAliasType(symbol: TypeSymbol, scope: Scope): Type {
    if (!symbol.aliasTarget) return this.namedType(symbol.name, symbol);
    return this.resolveType(symbol.aliasTarget.type, scope);
  }

  private resolveTypeParams(
    typeParams: TypeParameter[] | undefined,
    whereClause: WhereConstraint[] | undefined,
    scope: Scope,
  ): TypeParamSpec[] {
    const resolved = new Map<string, TypeParamSpec>();
    const typeScope = this.createScope(scope, scope.selfType);
    typeScope.typeParams = new Map(scope.typeParams);
    for (const param of typeParams ?? []) {
      // Pre-register with empty bounds so self-referential bounds like Equal<T>
      // can resolve T when processing this param's own bound list.
      const spec: TypeParamSpec = { name: param.name.name, bounds: [] };
      resolved.set(param.name.name, spec);
      typeScope.typeParams.set(param.name.name, spec);
      spec.bounds = (param.bounds ?? []).map((bound) =>
        this.resolveNamedReference(bound, typeScope),
      );
    }
    for (const clause of whereClause ?? []) {
      const target =
        resolved.get(clause.typeName.name) ??
        (() => {
          this.report(
            `Unknown type parameter '${clause.typeName.name}' in where clause.`,
            clause.span,
            "E2812",
          );
          const spec = {
            name: clause.typeName.name,
            bounds: [] as NamedRefType[],
          };
          resolved.set(clause.typeName.name, spec);
          typeScope.typeParams.set(clause.typeName.name, spec);
          return spec;
        })();
      target.bounds.push(this.resolveNamedReference(clause.trait, typeScope));
    }
    return Array.from(resolved.values());
  }

  private resolveFunctionDeclarationSignature(
    node: FunctionDeclaration,
    scope: Scope,
  ): FunctionRefType {
    const typeScope = this.createScope(scope, scope.selfType);
    const typeParams = this.resolveTypeParams(
      node.typeParams,
      node.whereClause,
      scope,
    );
    for (const param of typeParams) typeScope.typeParams.set(param.name, param);

    const params = node.params.map((param) =>
      this.resolveParameter(param, typeScope),
    );
    const returnType = node.returnType
      ? this.resolveType(node.returnType, typeScope)
      : this.unknownType();

    return {
      kind: "Function",
      typeParams,
      params,
      returnType,
      target: {
        kind: "function",
        name: node.name.name,
        typeParams,
        params,
        returnType,
      },
    };
  }

  private resolveAnonymousFunctionSignature(
    node: FunctionExpression,
    scope: Scope,
    expected?: Type,
  ): FunctionRefType {
    const params = node.params.map((param, index) =>
      this.resolveParameter(
        param,
        scope,
        expected?.kind === "Function" ? expected.params[index] : undefined,
      ),
    );
    const returnType = node.returnType
      ? this.resolveType(node.returnType, scope)
      : expected?.kind === "Function"
        ? expected.returnType
        : this.unknownType();
    return {
      kind: "Function",
      typeParams: [],
      params,
      returnType,
    };
  }

  private resolveParameter(
    param: Parameter,
    scope: Scope,
    _expected?: FunctionParamType,
  ): FunctionParamType {
    if (param.kind === "SelfParameter") {
      if (!scope.selfType) {
        this.report("self is only valid inside methods.", param.span, "E2813");
        return {
          name: "self",
          type: this.errorType(),
          isMutable: param.isMutable,
        };
      }
      return {
        name: "self",
        type: scope.selfType,
        isMutable: param.isMutable,
      };
    }

    if (
      param.type.kind === "NamedType" &&
      !scope.typeParams.has(param.type.name.name)
    ) {
      const symbol = this.lookupType(param.type.name.name, scope);
      if (symbol?.kind === "Trait") {
        this.report(
          "Trait names are not allowed as parameter types. Use explicit generics with trait bounds.",
          param.type.span,
          "E2818",
        );
        return {
          name: param.name.name,
          type: this.errorType(),
          isMutable: param.isMutable,
        };
      }
    }

    return {
      name: param.name.name,
      type: this.resolveType(param.type, scope),
      isMutable: param.isMutable,
    };
  }

  private resolveMethod(
    method: MethodDeclaration | TraitMethodSignature,
    owner: TypeSymbol,
    scope: Scope,
  ): MethodInfo {
    const selfType = this.namedType(
      owner.name,
      owner,
      this.ownerTypeArgs(owner, scope),
    );
    const methodScope = this.createScope(scope, selfType);
    for (const param of this.resolveTypeParams(
      owner.typeParams,
      undefined,
      this.globalScope,
    )) {
      methodScope.typeParams.set(param.name, param);
    }
    const typeParams = this.resolveTypeParams(
      method.typeParams,
      method.whereClause,
      methodScope,
    );
    for (const param of typeParams)
      methodScope.typeParams.set(param.name, param);

    let receiver: MethodInfo["receiver"];
    const params: FunctionParamType[] = [];
    method.params.forEach((param, index) => {
      const resolved = this.resolveParameter(param, methodScope);
      if (param.kind === "SelfParameter") {
        if (index !== 0) {
          this.report("self must be the first parameter.", param.span, "E2813");
        }
        receiver = { type: resolved.type, isMutable: resolved.isMutable };
      } else {
        params.push(resolved);
      }
    });

    const returnType = method.returnType
      ? this.resolveType(method.returnType, methodScope)
      : method.kind === "TraitMethodSignature"
        ? this.primitive("void")
        : this.unknownType();

    return {
      name: method.name.name,
      node: method,
      receiver,
      typeParams,
      params,
      returnType,
    };
  }

  private resolveTraitMethod(
    method: TraitMethodSignature,
    trait: TypeSymbol,
    scope: Scope,
  ) {
    return this.resolveMethod(method, trait, scope);
  }

  private resolveTraitMethodsForReference(
    trait: TypeSymbol,
    reference: NamedRefType,
    selfType: Type,
    scope: Scope,
  ): Map<string, MethodInfo> {
    const methods = new Map<string, MethodInfo>();
    if (!trait.traitDecl) return methods;

    const traitScope = this.createScope(
      scope,
      selfType.kind === "Named" ? selfType : scope.selfType,
    );
    const traitParams = this.resolveTypeParams(
      trait.typeParams,
      undefined,
      scope,
    );
    const bindings = new Map<string, Type>();
    for (
      let i = 0;
      i < Math.min(traitParams.length, reference.typeArgs?.length ?? 0);
      i++
    ) {
      bindings.set(traitParams[i].name, reference.typeArgs![i]);
      traitScope.typeParams.set(traitParams[i].name, {
        name: traitParams[i].name,
        bounds: traitParams[i].bounds,
      });
    }
    if (selfType.kind === "Named") traitScope.selfType = selfType;

    for (const method of trait.traitDecl.methods) {
      const resolved = this.resolveMethod(method, trait, traitScope);
      methods.set(method.name.name, {
        ...resolved,
        receiver: resolved.receiver
          ? {
              ...resolved.receiver,
              type: selfType,
            }
          : undefined,
        params: resolved.params.map((param) => ({
          ...param,
          type: this.substituteType(param.type, bindings),
        })),
        returnType: this.substituteType(resolved.returnType, bindings),
      });
    }

    return methods;
  }

  private methodEquals(left: MethodInfo, right: MethodInfo): boolean {
    if (!!left.receiver !== !!right.receiver) return false;
    if (left.receiver && right.receiver) {
      if (left.receiver.isMutable !== right.receiver.isMutable) return false;
      if (!this.typeEquals(left.receiver.type, right.receiver.type))
        return false;
    }
    if (left.typeParams.length !== right.typeParams.length) return false;
    if (left.params.length !== right.params.length) return false;
    if (!this.typeEquals(left.returnType, right.returnType)) return false;
    return left.params.every(
      (param, index) =>
        param.isMutable === right.params[index].isMutable &&
        this.typeEquals(param.type, right.params[index].type),
    );
  }

  private methodCallType(method: MethodInfo): FunctionRefType {
    return {
      kind: "Function",
      typeParams: method.typeParams,
      params: method.params,
      returnType: method.returnType,
      target: {
        kind: "method",
        name: method.name,
        typeParams: method.typeParams,
        params: method.params,
        returnType: method.returnType,
        receiver: method.receiver,
      },
    };
  }

  private lookupInstanceMethod(
    owner: NamedRefType,
    name: string,
    scope: Scope,
  ): MethodInfo | null {
    if (!owner.symbol) return null;
    const direct = owner.symbol.methods?.get(name);
    if (direct)
      return this.instantiateMethodForOwner(
        this.resolveMethod(
          direct,
          owner.symbol,
          this.createTypeScope(owner.symbol, scope),
        ),
        owner,
      );

    for (const satisfaction of owner.symbol.satisfactions ?? []) {
      const impl = satisfaction.methods.get(name);
      if (impl)
        return this.instantiateMethodForOwner(
          this.resolveMethod(
            impl,
            owner.symbol,
            this.createTypeScope(owner.symbol, scope),
          ),
          owner,
        );
    }

    return null;
  }

  private lookupTraitMethodOnType(
    type: Type,
    memberName: string,
    scope: Scope,
  ): MethodInfo | null {
    const candidates: NamedRefType[] = [];

    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Formattable", []),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Formattable", []));
    }
    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Hashable", []),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Hashable", []));
    }
    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Cloneable", []),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Cloneable", []));
    }
    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Defaultable", []),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Defaultable", []));
    }
    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Equal", [type]),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Equal", [type]));
    }
    if (
      this.typeSatisfiesTrait(
        type,
        this.resolveBuiltinTrait("Ordered", [type]),
        scope,
      )
    ) {
      candidates.push(this.resolveBuiltinTrait("Ordered", [type]));
    }
    if (type.kind === "Named" && type.name === "Array" && type.typeArgs?.[0]) {
      candidates.push(this.resolveBuiltinTrait("Iterable", [type.typeArgs[0]]));
    }
    if (type.kind === "Named" && type.name === "Result" && type.typeArgs?.[0]) {
      candidates.push(
        this.resolveBuiltinTrait("Unwrappable", [type.typeArgs[0]]),
      );
    }
    if (type.kind === "Nullable") {
      candidates.push(this.resolveBuiltinTrait("Unwrappable", [type.base]));
    }
    if (type.kind === "Named") {
      for (const satisfaction of type.symbol?.satisfactions ?? []) {
        candidates.push(satisfaction.trait);
      }
    }

    for (const candidate of candidates) {
      if (!candidate.symbol || candidate.symbol.kind !== "Trait") continue;
      const methods = this.resolveTraitMethodsForReference(
        candidate.symbol,
        candidate,
        type,
        scope,
      );
      const method = methods.get(memberName);
      if (method) return method;
    }

    return null;
  }

  private lookupStaticOrQualifiedMethod(
    owner: TypeSymbol,
    name: string,
    scope: Scope,
  ): MethodInfo | null {
    const method = owner.methods?.get(name);
    if (method)
      return this.resolveMethod(
        method,
        owner,
        this.createTypeScope(owner, scope),
      );

    for (const satisfaction of owner.satisfactions ?? []) {
      const impl = satisfaction.methods.get(name);
      if (impl)
        return this.resolveMethod(
          impl,
          owner,
          this.createTypeScope(owner, scope),
        );
    }

    return null;
  }

  private instantiateMethodForOwner(
    method: MethodInfo,
    owner: NamedRefType,
  ): MethodInfo {
    if (!owner.symbol?.typeParams.length || !owner.typeArgs?.length)
      return method;

    const bindings = new Map<string, Type>();
    for (
      let i = 0;
      i < Math.min(owner.symbol.typeParams.length, owner.typeArgs.length);
      i++
    ) {
      bindings.set(owner.symbol.typeParams[i].name.name, owner.typeArgs[i]);
    }

    if (bindings.size === 0) return method;

    return {
      ...method,
      typeParams: method.typeParams.map((param) => ({
        ...param,
        bounds: param.bounds.map((bound) =>
          this.substituteNamedType(bound, bindings),
        ),
      })),
      receiver: method.receiver
        ? {
            ...method.receiver,
            type: this.substituteType(method.receiver.type, bindings),
          }
        : undefined,
      params: method.params.map((param) => ({
        ...param,
        type: this.substituteType(param.type, bindings),
      })),
      returnType: this.substituteType(method.returnType, bindings),
    };
  }

  private resolveTypeWithOwnerBindings(
    node: TypeNode,
    owner: TypeSymbol,
    ownerArgs: Type[] | undefined,
    scope: Scope,
  ): Type {
    const ownerScope = this.createTypeScope(owner, scope);
    const params = this.resolveTypeParams(owner.typeParams, undefined, scope);
    for (let i = 0; i < Math.min(params.length, ownerArgs?.length ?? 0); i++) {
      ownerScope.typeParams.set(params[i].name, {
        name: params[i].name,
        bounds: params[i].bounds,
      });
      ownerScope.overrides.set(params[i].name, ownerArgs![i]);
    }
    return this.substituteType(
      this.resolveType(node, ownerScope),
      new Map(
        params.map((param, index) => [
          param.name,
          ownerArgs?.[index] ?? this.unknownType(),
        ]),
      ),
    );
  }

  private substituteType(type: Type, bindings: Map<string, Type>): Type {
    if (type.kind === "TypeParam") return bindings.get(type.name) ?? type;
    if (type.kind === "Nullable") {
      return {
        kind: "Nullable",
        base: this.substituteType(type.base, bindings),
      };
    }
    if (type.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: type.elements.map((element) =>
          this.substituteType(element, bindings),
        ),
      };
    }
    if (type.kind === "Named") {
      return {
        ...type,
        typeArgs: type.typeArgs?.map((arg) =>
          this.substituteType(arg, bindings),
        ),
      };
    }
    if (type.kind === "Function") {
      return {
        ...type,
        params: type.params.map((param) => ({
          ...param,
          type: this.substituteType(param.type, bindings),
        })),
        returnType: this.substituteType(type.returnType, bindings),
      };
    }
    return type;
  }

  private substituteNamedType(
    type: NamedRefType,
    bindings: Map<string, Type>,
  ): NamedRefType {
    return this.substituteType(type, bindings) as NamedRefType;
  }

  private ownerTypeArgs(owner: TypeSymbol, scope: Scope): Type[] | undefined {
    const params = this.resolveTypeParams(owner.typeParams, undefined, scope);
    if (params.length === 0) return undefined;
    return params.map((param) => this.typeParamType(param.name, param.bounds));
  }

  private iterableItemType(type: Type, scope: Scope): Type | null {
    if (type.kind === "Named" && type.name === "Array")
      return type.typeArgs?.[0] ?? this.unknownType();
    const satisfied = this.findSatisfiedTrait(type, "Iterable", scope);
    const iterable =
      satisfied ?? this.resolveBuiltinTrait("Iterable", [this.unknownType()]);
    if (this.typeSatisfiesTrait(type, iterable, scope)) {
      return iterable.typeArgs?.[0] ?? this.unknownType();
    }
    return null;
  }

  private findSatisfiedTrait(
    type: Type,
    traitName: string,
    scope: Scope,
  ): NamedRefType | null {
    if (type.kind === "TypeParam") {
      return type.bounds.find((bound) => bound.name === traitName) ?? null;
    }
    if (type.kind === "Named") {
      if (
        type.name === "Array" &&
        traitName === "Iterable" &&
        type.typeArgs?.[0]
      ) {
        return this.resolveBuiltinTrait("Iterable", [type.typeArgs[0]]);
      }
      if (
        type.name === "Result" &&
        traitName === "Unwrappable" &&
        type.typeArgs?.[0]
      ) {
        return this.resolveBuiltinTrait("Unwrappable", [type.typeArgs[0]]);
      }
      if (traitName === "Formattable" && this.isFormattable(type)) {
        return this.resolveBuiltinTrait("Formattable", []);
      }
      if (
        traitName === "Equal" &&
        this.isBuiltinEquatable(type, this.resolveBuiltinTrait("Equal", [type]))
      ) {
        return this.resolveBuiltinTrait("Equal", [type]);
      }
      if (
        traitName === "Ordered" &&
        this.typeSatisfiesTrait(
          type,
          this.resolveBuiltinTrait("Ordered", [type]),
          scope,
        )
      ) {
        return this.resolveBuiltinTrait("Ordered", [type]);
      }
      return (
        type.symbol?.satisfactions?.find(
          (entry) => entry.trait.name === traitName,
        )?.trait ?? null
      );
    }
    if (type.kind === "Primitive") {
      if (traitName === "Formattable" && this.isFormattable(type)) {
        return this.resolveBuiltinTrait("Formattable", []);
      }
      if (traitName === "Equal") {
        const equal = this.resolveBuiltinTrait("Equal", [type]);
        return this.isBuiltinEquatable(type, equal) ? equal : null;
      }
    }
    if (type.kind === "Tuple" && traitName === "Equal") {
      const equal = this.resolveBuiltinTrait("Equal", [type]);
      return this.typeSatisfiesTrait(type, equal, scope) ? equal : null;
    }
    return null;
  }

  private canCompareForEquality(
    left: Type,
    right: Type,
    scope: Scope,
  ): boolean {
    if (this.typeEquals(left, right)) {
      if (left.kind === "Named") {
        const equalTrait = this.resolveBuiltinTrait("Equal", [left]);
        return this.typeSatisfiesTrait(left, equalTrait, scope);
      }
      if (left.kind === "Tuple")
        return left.elements.every((element) =>
          this.canCompareForEquality(element, element, scope),
        );
      return true;
    }
    if (
      left.kind === "Nullable" &&
      this.typeEquals(right, this.primitive("null"))
    )
      return true;
    if (
      right.kind === "Nullable" &&
      this.typeEquals(left, this.primitive("null"))
    )
      return true;
    return false;
  }

  private typeSatisfiesTrait(
    type: Type,
    trait: NamedRefType,
    scope: Scope,
  ): boolean {
    if (type.kind === "TypeParam") {
      return type.bounds.some((bound) => this.namedTypeEquals(bound, trait));
    }

    if (type.kind === "Named") {
      if (type.name === "Array" && trait.name === "Iterable") return true;
      if (trait.name === "Equal" && this.isBuiltinEquatable(type, trait))
        return true;
      if (trait.name === "Formattable") {
        if (this.isFormattable(type)) return true;
        if (type.name === "Ordering") return true;
        if (type.name === "Array" && type.typeArgs?.[0])
          return this.typeSatisfiesTrait(
            type.typeArgs[0],
            this.resolveBuiltinTrait("Formattable", []),
            scope,
          );
        if (type.name === "Result" && type.typeArgs?.length === 2)
          return (
            this.typeSatisfiesTrait(
              type.typeArgs[0],
              this.resolveBuiltinTrait("Formattable", []),
              scope,
            ) &&
            this.typeSatisfiesTrait(
              type.typeArgs[1],
              this.resolveBuiltinTrait("Formattable", []),
              scope,
            )
          );
      }
      if (trait.name === "Hashable") {
        if (type.name === "string") return true;
      }
      if (trait.name === "Ordered" && type.name === "string") {
        const typeArg = trait.typeArgs?.[0];
        if (typeArg && this.typeEquals(type, typeArg)) return true;
      }
      if (trait.name === "Cloneable") {
        if (type.name === "string") return true;
        if (type.name === "Array" && type.typeArgs?.[0])
          return this.typeSatisfiesTrait(
            type.typeArgs[0],
            this.resolveBuiltinTrait("Cloneable", []),
            scope,
          );
      }
      if (trait.name === "Defaultable") {
        if (type.name === "string" || type.name === "Array") return true;
      }
      return (
        type.symbol?.satisfactions?.some((entry) =>
          this.namedTypeEquals(
            this.substituteOwnerTypeArgs(entry.trait, type),
            trait,
          ),
        ) ?? false
      );
    }

    if (type.kind === "Primitive") {
      if (trait.name === "Formattable") return this.isFormattable(type);
      if (trait.name === "Equal") return this.isBuiltinEquatable(type, trait);
      if (trait.name === "Hashable") return true;
      if (trait.name === "Ordered") {
        const typeArg = trait.typeArgs?.[0];
        if (!typeArg || !this.typeEquals(type, typeArg)) return false;
        return type.name !== "bool";
      }
      if (trait.name === "Cloneable") return true;
      if (trait.name === "Defaultable") return true;
    }

    if (type.kind === "Tuple") {
      const allSatisfy = (t: NamedRefType) =>
        type.elements.every((el) => this.typeSatisfiesTrait(el, t, scope));
      if (trait.name === "Equal")
        return (
          allSatisfy(this.resolveBuiltinTrait("Equal", [type])) ||
          type.elements.every((el) =>
            this.typeSatisfiesTrait(
              el,
              this.resolveBuiltinTrait("Equal", [el]),
              scope,
            ),
          )
        );
      if (trait.name === "Formattable")
        return allSatisfy(this.resolveBuiltinTrait("Formattable", []));
      if (trait.name === "Hashable")
        return allSatisfy(this.resolveBuiltinTrait("Hashable", []));
      if (trait.name === "Cloneable")
        return allSatisfy(this.resolveBuiltinTrait("Cloneable", []));
    }

    if (type.kind === "Nullable") {
      if (trait.name === "Equal")
        return this.typeSatisfiesTrait(
          type.base,
          this.resolveBuiltinTrait("Equal", [type.base]),
          scope,
        );
      if (trait.name === "Formattable")
        return this.typeSatisfiesTrait(
          type.base,
          this.resolveBuiltinTrait("Formattable", []),
          scope,
        );
      if (trait.name === "Unwrappable") {
        const typeArg = trait.typeArgs?.[0];
        if (!typeArg) return false;
        return this.typeEquals(type.base, typeArg);
      }
    }

    return false;
  }

  private substituteOwnerTypeArgs(
    trait: NamedRefType,
    owner: NamedRefType,
  ): NamedRefType {
    if (!owner.typeArgs?.length || !owner.symbol?.typeParams.length)
      return trait;
    const bindings = new Map<string, Type>();
    for (
      let i = 0;
      i < Math.min(owner.symbol.typeParams.length, owner.typeArgs.length);
      i++
    )
      bindings.set(owner.symbol.typeParams[i].name.name, owner.typeArgs[i]);
    return this.substituteNamedType(trait, bindings);
  }

  private isBuiltinEquatable(type: Type, trait: NamedRefType): boolean {
    if (trait.typeArgs?.length !== 1) return false;
    if (!this.typeEquals(type, trait.typeArgs[0])) return false;
    return (
      type.kind === "Primitive" ||
      (type.kind === "Named" && type.name === "string")
    );
  }

  private isFormattable(type: Type): boolean {
    return (
      (type.kind === "Primitive" &&
        [
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
        ].includes(type.name)) ||
      (type.kind === "Named" && type.name === "string")
    );
  }

  private resolveBuiltinTrait(name: string, typeArgs: Type[]): NamedRefType {
    return this.namedType(name, this.globalScope.types.get(name), typeArgs);
  }

  private extractEnumType(type: Type): NamedRefType | null {
    if (type.kind === "Nullable") return this.extractEnumType(type.base);
    return type.kind === "Named" && type.symbol?.kind === "Enum" ? type : null;
  }

  private matchUnitVariant(
    name: string,
    matchedType: Type,
    _scope: Scope,
  ): string | null {
    const enumType = this.extractEnumType(matchedType);
    if (!enumType?.symbol?.variants?.has(name)) return null;
    const variant = enumType.symbol.variants.get(name)!;
    return (variant.payload?.length ?? 0) === 0 ? name : null;
  }

  private primitive(name: PrimitiveName): PrimitiveType {
    return { kind: "Primitive", name };
  }

  private namedType(
    name: string,
    symbol?: TypeSymbol,
    typeArgs?: Type[],
  ): NamedRefType {
    return { kind: "Named", name, symbol, typeArgs };
  }

  private typeParamType(
    name: string,
    bounds: NamedRefType[],
  ): TypeParamRefType {
    return { kind: "TypeParam", name, bounds };
  }

  private unknownType(): UnknownType {
    return { kind: "Unknown" };
  }

  private errorType(): ErrorType {
    return { kind: "Error" };
  }

  private isUnknownType(type: Type): type is UnknownType {
    return type.kind === "Unknown";
  }

  private isIntegerType(type: Type): type is PrimitiveType {
    return (
      type.kind === "Primitive" &&
      ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"].includes(type.name)
    );
  }

  private isSignedIntegerType(type: Type): type is PrimitiveType {
    return (
      type.kind === "Primitive" &&
      ["i8", "i16", "i32", "i64"].includes(type.name)
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

  private isBooleanType(type: Type) {
    return type.kind === "Primitive" && type.name === "bool";
  }

  private isStringType(type: Type) {
    return (
      (type.kind === "Primitive" && type.name === "string") ||
      (type.kind === "Named" && type.name === "string")
    );
  }

  private typeEquals(left: Type, right: Type): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === "Primitive" && right.kind === "Primitive")
      return left.name === right.name;
    if (left.kind === "Named" && right.kind === "Named")
      return this.namedTypeEquals(left, right);
    if (left.kind === "Nullable" && right.kind === "Nullable")
      return this.typeEquals(left.base, right.base);
    if (left.kind === "Tuple" && right.kind === "Tuple") {
      return (
        left.elements.length === right.elements.length &&
        left.elements.every((element, index) =>
          this.typeEquals(element, right.elements[index]),
        )
      );
    }
    if (left.kind === "Function" && right.kind === "Function") {
      if (left.typeParams.length !== right.typeParams.length) return false;
      if (left.params.length !== right.params.length) return false;

      // Normalize right's type param names to left's so structural comparisons
      // treat fn<T: Equal<T>>(...) and fn<U: Equal<U>>(...) as identical.
      const subst = new Map<string, Type>();
      for (let i = 0; i < left.typeParams.length; i++) {
        subst.set(
          right.typeParams[i].name,
          this.typeParamType(
            left.typeParams[i].name,
            left.typeParams[i].bounds,
          ),
        );
      }

      // Compare bounds on each type parameter after normalization.
      for (let i = 0; i < left.typeParams.length; i++) {
        const lb = left.typeParams[i].bounds;
        const rb = right.typeParams[i].bounds.map((b) =>
          this.substituteNamedType(b, subst),
        );
        if (lb.length !== rb.length) return false;
        if (!lb.every((lbound, j) => this.namedTypeEquals(lbound, rb[j])))
          return false;
      }

      return (
        left.params.every(
          (param, index) =>
            param.isMutable === right.params[index].isMutable &&
            this.typeEquals(
              param.type,
              this.substituteType(right.params[index].type, subst),
            ),
        ) &&
        this.typeEquals(
          left.returnType,
          this.substituteType(right.returnType, subst),
        )
      );
    }
    if (left.kind === "TypeParam" && right.kind === "TypeParam")
      return left.name === right.name;
    if (left.kind === "Unknown" && right.kind === "Unknown") return true;
    if (left.kind === "Error" && right.kind === "Error") return true;
    return false;
  }

  private namedTypeEquals(left: NamedRefType, right: NamedRefType): boolean {
    return (
      left.name === right.name &&
      (left.typeArgs?.length ?? 0) === (right.typeArgs?.length ?? 0) &&
      (left.typeArgs ?? []).every((arg, index) =>
        this.typeEquals(arg, right.typeArgs?.[index] ?? this.errorType()),
      )
    );
  }

  private isAssignable(from: Type, to: Type): boolean {
    if (
      from.kind === "Error" ||
      to.kind === "Error" ||
      from.kind === "Unknown" ||
      to.kind === "Unknown"
    ) {
      return true;
    }
    if (this.typeEquals(from, to)) return true;
    if (to.kind === "Nullable") {
      return (
        this.typeEquals(from, this.primitive("null")) ||
        this.isAssignable(from, to.base)
      );
    }
    return false;
  }

  private displayType(type: Type): string {
    if (type.kind === "Primitive") return type.name;
    if (type.kind === "Named") {
      if (!type.typeArgs?.length) return type.name;
      return `${type.name}<${type.typeArgs.map((arg) => this.displayType(arg)).join(", ")}>`;
    }
    if (type.kind === "Nullable") return `${this.displayType(type.base)}?`;
    if (type.kind === "Tuple")
      return `(${type.elements.map((element) => this.displayType(element)).join(", ")})`;
    if (type.kind === "Function") {
      const params = type.params
        .map(
          (param) =>
            `${param.isMutable ? "mut " : ""}${this.displayType(param.type)}`,
        )
        .join(", ");
      return `fn(${params}) -> ${this.displayType(type.returnType)}`;
    }
    if (type.kind === "TypeParam") return type.name;
    return type.kind.toLowerCase();
  }

  private lookupValue(name: string, scope: Scope): ValueSymbol | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      const override = current.overrides.get(name);
      if (override) {
        return {
          kind: "Value",
          name,
          node: this.program,
          type: override,
          functionDepth: this.currentFunctionDepth,
          isGlobal: false,
        };
      }
      const value = current.values.get(name);
      if (value) return value;
      current = current.parent;
    }
    return undefined;
  }

  private lookupValueType(name: string, scope: Scope): Type | undefined {
    const symbol = this.lookupValue(name, scope);
    return symbol?.type;
  }

  private lookupType(name: string, scope: Scope): TypeSymbol | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      const type = current.types.get(name);
      if (type) return type;
      current = current.parent;
    }
    return undefined;
  }

  private lookupOverride(name: string, scope: Scope): Type | undefined {
    let current: Scope | undefined = scope;
    while (current) {
      const override = current.overrides.get(name);
      if (override) return override;
      current = current.parent;
    }
    return undefined;
  }

  private requireTypeSymbol(name: string, scope: Scope) {
    return this.lookupType(name, scope);
  }

  private declareType(scope: Scope, symbol: TypeSymbol) {
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

  private declareValue(scope: Scope, symbol: ValueSymbol) {
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

  private lookupTypeParamBounds(name: string, scope: Scope): NamedRefType[] {
    let current: Scope | undefined = scope;
    while (current) {
      const found = current.typeParams.get(name);
      if (found) return found.bounds;
      current = current.parent;
    }
    return [];
  }

  private syntheticIdentifier(name: string) {
    return {
      kind: "Identifier" as const,
      span: this.program.span,
      name,
    };
  }

  private syntheticTypeParam(name: string): TypeParameter {
    return {
      kind: "TypeParameter",
      span: this.program.span,
      name: this.syntheticIdentifier(name),
    };
  }

  private report(message: string, span: Span, code: string) {
    const key = `error|${code}|${message}|${span.start.index}:${span.end.index}`;
    if (this.diagnosticSet.has(key)) return;
    this.diagnosticSet.add(key);
    this.diagnostics.push({ severity: "error", message, span, code });
  }

  private warn(message: string, span: Span, code: string) {
    const key = `warning|${code}|${message}|${span.start.index}:${span.end.index}`;
    if (this.diagnosticSet.has(key)) return;
    this.diagnosticSet.add(key);
    this.diagnostics.push({ severity: "warning", message, span, code });
  }
}

interface CoverageTracker {
  kind: "enum" | "bool" | "nullable" | "other";
  seen: Set<string>;
  enumType: NamedRefType | null;
  nullableBase: Type | null;
}
