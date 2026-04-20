import type { Expression, Program, VariableDeclaration } from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";

export interface InitializerResult {
  diagnostics: Diagnostic[];
}

export function analyzeInitializers(program: Program): InitializerResult {
  const diagnostics: Diagnostic[] = [];

  // Collect top-level variable declarations that have initializers and a simple name.
  const vars = new Map<string, VariableDeclaration>();
  for (const stmt of program.body) {
    if (
      stmt.kind === "VariableDeclaration" &&
      stmt.name.kind === "Identifier" &&
      stmt.initializer
    ) {
      vars.set(stmt.name.name, stmt);
    }
  }

  const varNames = new Set(vars.keys());

  // Build dependency graph: name → set of top-level var names referenced in its initializer.
  // FunctionExpression bodies are not walked — closure captures are lazy, not eager deps.
  const deps = new Map<string, Set<string>>();
  for (const [name, decl] of vars) {
    deps.set(name, collectRefs(decl.initializer!, varNames));
  }

  // DFS cycle detection (white/gray/black coloring).
  type Color = "white" | "gray" | "black";
  const color = new Map<string, Color>();
  for (const name of varNames) color.set(name, "white");

  const reportedCycles = new Set<string>();

  function dfs(node: string, path: string[]): void {
    color.set(node, "gray");
    path.push(node);

    for (const neighbor of deps.get(node) ?? []) {
      if (color.get(neighbor) === "gray") {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart); // [neighbor, ..., node]
        const key = [...cycle].sort().join("\0");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          const display = [...cycle, neighbor].join(" → ");
          diagnostics.push({
            severity: "error",
            code: "E2700",
            message: `Cyclic top-level initializer: ${display}.`,
            span: vars.get(neighbor)!.span,
          });
        }
      } else if (color.get(neighbor) === "white") {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, "black");
  }

  for (const name of varNames) {
    if (color.get(name) === "white") dfs(name, []);
  }

  return { diagnostics };
}

function collectRefs(expr: Expression, names: Set<string>): Set<string> {
  const refs = new Set<string>();
  walk(expr);
  return refs;

  function walk(e: Expression): void {
    switch (e.kind) {
      case "IdentifierExpression":
        if (names.has(e.name)) refs.add(e.name);
        break;
      case "BinaryExpression":
        walk(e.left);
        walk(e.right);
        break;
      case "UnaryExpression":
        walk(e.argument);
        break;
      case "CallExpression":
        walk(e.callee);
        for (const a of e.args) walk(a);
        break;
      case "MemberExpression":
      case "TupleMemberExpression":
        walk(e.object);
        break;
      case "IndexExpression":
        walk(e.object);
        walk(e.index);
        break;
      case "ArrayLiteralExpression":
        for (const el of e.elements) walk(el);
        break;
      case "TupleLiteralExpression":
        for (const el of e.elements) walk(el);
        break;
      case "StructLiteralExpression":
        for (const f of e.fields) walk(f.value);
        break;
      case "GroupingExpression":
        walk(e.expression);
        break;
      case "CastExpression":
        walk(e.expression);
        break;
      case "MatchExpression":
        walk(e.expression);
        for (const arm of e.arms) walk(arm.expression);
        break;
      case "FunctionExpression":
        // Don't walk closure bodies: captures are evaluated at call time, not init time.
        break;
      case "LiteralExpression":
        break;
    }
  }
}
