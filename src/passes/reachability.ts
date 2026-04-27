import type {
  Expression,
  MethodDeclaration,
  Pattern,
  Program,
  Statement,
  TraitSatisfiesDeclaration,
  TypeNode,
  WhereConstraint,
} from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";

export interface ReachabilityResult {
  reachableNames: Set<string>;
  diagnostics: Diagnostic[];
}

export function analyzeReachability(program: Program): ReachabilityResult {
  // Index all top-level declarations by name.
  const topLevel = new Map<string, Statement>();
  // Map enum variant names → their enclosing enum's name for reachability.
  const variantToEnum = new Map<string, string>();

  for (const stmt of program.body) {
    const name = declName(stmt);
    if (name) {
      topLevel.set(name, stmt);
      if (stmt.kind === "EnumDeclaration") {
        for (const member of stmt.members) {
          if (member.kind === "EnumVariant")
            variantToEnum.set(member.name.name, name);
        }
      }
    }
  }

  // BFS from roots.
  const reachable = new Set<string>();
  const queue: string[] = [];

  const reach = (name: string) => {
    if (!reachable.has(name) && topLevel.has(name)) {
      reachable.add(name);
      queue.push(name);
    }
  };

  // Roots: `main` function and any `pub` declaration.
  for (const [name, stmt] of topLevel) {
    if (name === "main" || isPublicDecl(stmt)) reach(name);
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    const stmt = topLevel.get(name)!;
    const refs = collectRefs(stmt);
    for (const ref of refs) {
      reach(ref);
      const enumName = variantToEnum.get(ref);
      if (enumName) reach(enumName);
    }
  }

  // Warn on unreachable private top-level declarations.
  // Names beginning with `_` are suppressed per spec/11 conventions.
  const diagnostics: Diagnostic[] = [];
  for (const [name, stmt] of topLevel) {
    if (reachable.has(name) || isPublicDecl(stmt) || name.startsWith("_"))
      continue;
    diagnostics.push({
      severity: "warning",
      code: "W2900",
      message: `Declaration '${name}' is never used.`,
      span: stmt.span,
    });
  }

  return { reachableNames: reachable, diagnostics };
}

function declName(stmt: Statement): string | null {
  switch (stmt.kind) {
    case "FunctionDeclaration":
      return stmt.name.name;
    case "VariableDeclaration":
      return stmt.name.kind === "Identifier" ? stmt.name.name : null;
    case "TypeAliasDeclaration":
      return stmt.name.name;
    case "StructDeclaration":
      return stmt.name.name;
    case "EnumDeclaration":
      return stmt.name.name;
    case "TraitDeclaration":
      return stmt.name.name;
    default:
      return null;
  }
}

function isPublicDecl(stmt: Statement): boolean {
  switch (stmt.kind) {
    case "FunctionDeclaration":
    case "VariableDeclaration":
    case "TypeAliasDeclaration":
    case "StructDeclaration":
    case "EnumDeclaration":
    case "TraitDeclaration":
      return stmt.isPublic;
    default:
      return false;
  }
}

function collectRefs(stmt: Statement): Set<string> {
  const refs = new Set<string>();
  walkStmt(stmt, refs);
  return refs;
}

function walkStmt(stmt: Statement, refs: Set<string>): void {
  switch (stmt.kind) {
    case "FunctionDeclaration":
      walkTypeParams(stmt.typeParams, refs);
      for (const p of stmt.params)
        if (p.kind === "NamedParameter") walkTypeNode(p.type, refs);
      if (stmt.returnType) walkTypeNode(stmt.returnType, refs);
      walkWhereClause(stmt.whereClause, refs);
      if (stmt.body) for (const s of stmt.body.body) walkStmt(s, refs);
      break;

    case "VariableDeclaration":
      if (stmt.typeAnnotation) walkTypeNode(stmt.typeAnnotation, refs);
      if (stmt.initializer) walkExpr(stmt.initializer, refs);
      break;

    case "TypeAliasDeclaration":
      walkTypeNode(stmt.type, refs);
      break;

    case "StructDeclaration":
      walkTypeParams(stmt.typeParams, refs);
      for (const member of stmt.members) {
        if (member.kind === "StructField") walkTypeNode(member.type, refs);
        else if (member.kind === "MethodDeclaration") walkMethod(member, refs);
        else if (member.kind === "TraitSatisfiesDeclaration")
          walkSatisfies(member, refs);
      }
      break;

    case "EnumDeclaration":
      walkTypeParams(stmt.typeParams, refs);
      for (const member of stmt.members) {
        if (member.kind === "EnumVariant")
          for (const p of member.payload ?? []) walkTypeNode(p, refs);
        else if (member.kind === "MethodDeclaration") walkMethod(member, refs);
        else if (member.kind === "TraitSatisfiesDeclaration")
          walkSatisfies(member, refs);
      }
      break;

    case "TraitDeclaration":
      walkTypeParams(stmt.typeParams, refs);
      for (const method of stmt.methods) {
        for (const p of method.params)
          if (p.kind === "NamedParameter") walkTypeNode(p.type, refs);
        if (method.returnType) walkTypeNode(method.returnType, refs);
        walkWhereClause(method.whereClause, refs);
      }
      break;

    case "ReturnStatement":
      if (stmt.value) walkExpr(stmt.value, refs);
      break;

    case "IfStatement":
      walkExpr(stmt.condition, refs);
      for (const s of stmt.thenBranch.body) walkStmt(s, refs);
      if (stmt.elseBranch) {
        if (stmt.elseBranch.kind === "BlockStatement")
          for (const s of stmt.elseBranch.body) walkStmt(s, refs);
        else walkStmt(stmt.elseBranch, refs);
      }
      break;

    case "WhileStatement":
      walkExpr(stmt.condition, refs);
      for (const s of stmt.body.body) walkStmt(s, refs);
      break;

    case "ForStatement":
      walkExpr(stmt.iterable, refs);
      for (const s of stmt.body.body) walkStmt(s, refs);
      break;

    case "MatchStatement":
      walkExpr(stmt.expression, refs);
      for (const arm of stmt.arms) {
        walkPattern(arm.pattern, refs);
        for (const s of arm.body.body) walkStmt(s, refs);
      }
      break;

    case "AssignmentStatement":
      walkExpr(stmt.target, refs);
      walkExpr(stmt.value, refs);
      break;

    case "BlockStatement":
      for (const s of stmt.body) walkStmt(s, refs);
      break;

    case "ExpressionStatement":
      walkExpr(stmt.expression, refs);
      break;
  }
}

function walkMethod(method: MethodDeclaration, refs: Set<string>): void {
  walkTypeParams(method.typeParams, refs);
  for (const p of method.params)
    if (p.kind === "NamedParameter") walkTypeNode(p.type, refs);
  if (method.returnType) walkTypeNode(method.returnType, refs);
  walkWhereClause(method.whereClause, refs);
  for (const s of method.body.body) walkStmt(s, refs);
}

function walkSatisfies(
  sat: TraitSatisfiesDeclaration,
  refs: Set<string>,
): void {
  refs.add(sat.trait.name.name);
  for (const method of sat.methods) walkMethod(method, refs);
}

function walkTypeParams(
  typeParams:
    | { bounds?: { name: { name: string }; typeArgs?: TypeNode[] }[] }[]
    | undefined,
  refs: Set<string>,
): void {
  if (!typeParams) return;
  for (const tp of typeParams)
    for (const bound of tp.bounds ?? []) {
      refs.add(bound.name.name);
      for (const arg of (bound as { typeArgs?: TypeNode[] }).typeArgs ?? [])
        walkTypeNode(arg, refs);
    }
}

function walkWhereClause(
  clause: WhereConstraint[] | undefined,
  refs: Set<string>,
): void {
  if (!clause) return;
  for (const c of clause) {
    refs.add(c.trait.name.name);
    for (const arg of c.trait.typeArgs ?? []) walkTypeNode(arg, refs);
  }
}

function walkExpr(expr: Expression, refs: Set<string>): void {
  switch (expr.kind) {
    case "IdentifierExpression":
      refs.add(expr.name);
      break;
    case "BinaryExpression":
      walkExpr(expr.left, refs);
      walkExpr(expr.right, refs);
      break;
    case "UnaryExpression":
      walkExpr(expr.argument, refs);
      break;
    case "CallExpression":
      walkExpr(expr.callee, refs);
      for (const t of expr.typeArgs ?? []) walkTypeNode(t, refs);
      for (const a of expr.args) walkExpr(a, refs);
      break;
    case "MemberExpression":
      walkExpr(expr.object, refs);
      break;
    case "TupleMemberExpression":
      walkExpr(expr.object, refs);
      break;
    case "IndexExpression":
      walkExpr(expr.object, refs);
      walkExpr(expr.index, refs);
      break;
    case "ArrayLiteralExpression":
      for (const el of expr.elements) walkExpr(el, refs);
      break;
    case "TupleLiteralExpression":
      for (const el of expr.elements) walkExpr(el, refs);
      break;
    case "StructLiteralExpression":
      refs.add(expr.name.name);
      for (const f of expr.fields) walkExpr(f.value, refs);
      break;
    case "GroupingExpression":
      walkExpr(expr.expression, refs);
      break;
    case "FunctionExpression":
      for (const p of expr.params)
        if (p.kind === "NamedParameter") walkTypeNode(p.type, refs);
      if (expr.returnType) walkTypeNode(expr.returnType, refs);
      for (const s of expr.body.body) walkStmt(s, refs);
      break;
    case "CastExpression":
      walkExpr(expr.expression, refs);
      walkTypeNode(expr.type, refs);
      break;
    case "IfExpression":
      walkExpr(expr.condition, refs);
      for (const s of expr.thenBranch.body) walkStmt(s, refs);
      if (expr.elseBranch.kind === "BlockStatement")
        for (const s of expr.elseBranch.body) walkStmt(s, refs);
      else walkExpr(expr.elseBranch, refs);
      break;
    case "MatchExpression":
      walkExpr(expr.expression, refs);
      for (const arm of expr.arms) {
        walkPattern(arm.pattern, refs);
        if (arm.expression.kind === "BlockStatement")
          for (const s of arm.expression.body) walkStmt(s, refs);
        else walkExpr(arm.expression, refs);
      }
      break;
    case "LiteralExpression":
      break;
  }
}

function walkPattern(pattern: Pattern, refs: Set<string>): void {
  switch (pattern.kind) {
    case "EnumPattern":
      // Variant or enum constructor name — resolve to enum via variantToEnum at call site.
      refs.add(pattern.name.name);
      for (const arg of pattern.args) walkPattern(arg, refs);
      break;
    case "TuplePattern":
      for (const el of pattern.elements) walkPattern(el, refs);
      break;
    case "IdentifierPattern":
    case "LiteralPattern":
    case "WildcardPattern":
      break;
  }
}

function walkTypeNode(typeNode: TypeNode, refs: Set<string>): void {
  switch (typeNode.kind) {
    case "NamedType":
      refs.add(typeNode.name.name);
      for (const arg of typeNode.typeArgs ?? []) walkTypeNode(arg, refs);
      break;
    case "NullableType":
      walkTypeNode(typeNode.base, refs);
      break;
    case "ArrayType":
      walkTypeNode(typeNode.element, refs);
      break;
    case "TupleType":
      for (const el of typeNode.elements) walkTypeNode(el, refs);
      break;
    case "FunctionType":
      for (const p of typeNode.params) walkTypeNode(p.type, refs);
      walkTypeNode(typeNode.returnType, refs);
      walkWhereClause(typeNode.whereClause, refs);
      break;
    case "SelfType":
      break;
  }
}
