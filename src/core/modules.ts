import * as fs from "node:fs";
import * as path from "node:path";
import { Checker } from "@/core/checker";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";
import type { ImportDeclaration, Program, Statement } from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";

interface ModuleExportInfo {
  named: Set<string>;
}

interface SymbolVisibility {
  isPublic: boolean;
}

export interface LoadedModule {
  id: string;
  filePath?: string;
  kind: "std" | "local";
  source: string;
  program?: Program;
  lexDiagnostics: Diagnostic[];
  parseDiagnostics: Diagnostic[];
  checkDiagnostics: Diagnostic[];
  resolutionDiagnostics: Diagnostic[];
}

export interface ModuleCheckResult {
  entry: string;
  modules: Map<string, LoadedModule>;
  diagnostics: Diagnostic[];
}

export interface ModuleGraphResult {
  entry: string;
  modules: Map<string, LoadedModule>;
  order: string[];
  diagnostics: Diagnostic[];
}

export interface MergedProgramResult {
  program: Program;
  namespaceImportExports: Map<ImportDeclaration, Set<string>>;
}

type ResolveResult =
  | { kind: "std"; id: string }
  | { kind: "local"; id: string; filePath: string };

type ResolveFailure =
  | { kind: "unsupported_package" }
  | { kind: "not_found"; attempted: string[] };

export interface ModuleHost {
  readFileSync(filePath: string): string;
  isFile(filePath: string): boolean;
  realpathSync(filePath: string): string;
}

const nodeHost: ModuleHost = {
  readFileSync: (filePath) => fs.readFileSync(filePath, "utf8"),
  isFile: (filePath) => {
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  },
  realpathSync: (filePath) => {
    try {
      return fs.realpathSync.native(filePath);
    } catch {
      return path.resolve(filePath);
    }
  },
};

const emptySpan = (): Diagnostic["span"] => ({
  start: { index: 0, line: 1, column: 1 },
  end: { index: 0, line: 1, column: 1 },
});

const moduleNotFound = (
  specifier: string,
  attempted: string[],
  span: Diagnostic["span"],
): Diagnostic => ({
  severity: "error",
  message: `Cannot resolve import '${specifier}'. Tried: ${attempted.join(", ")}.`,
  span,
  code: "E2707",
});

const unsupportedPackage = (
  specifier: string,
  span: Diagnostic["span"],
): Diagnostic => ({
  severity: "error",
  message: `Unsupported package import '${specifier}'. Only 'std:*' is available right now.`,
  span,
  code: "E2706",
});

const fileReadError = (
  filePath: string,
  span: Diagnostic["span"],
): Diagnostic => ({
  severity: "error",
  message: `Failed to read module '${filePath}'.`,
  span,
  code: "E2708",
});

const namedExports = (program: Program) => {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.kind === "FunctionDeclaration" && statement.isPublic)
      names.add(statement.name.name);

    if (statement.kind === "VariableDeclaration" && statement.isPublic) {
      names.add(statement.name.name);
      continue;
    }

    if (statement.kind === "TypeAliasDeclaration" && statement.isPublic)
      names.add(statement.name.name);
    if (statement.kind === "StructDeclaration" && statement.isPublic)
      names.add(statement.name.name);
    if (statement.kind === "EnumDeclaration" && statement.isPublic)
      names.add(statement.name.name);
    if (statement.kind === "TraitDeclaration" && statement.isPublic)
      names.add(statement.name.name);
  }
  return names;
};

const localSymbols = (program: Program) => {
  const symbols = new Map<string, SymbolVisibility>();
  const declare = (name: string, isPublic: boolean) =>
    symbols.set(name, { isPublic });

  for (const statement of program.body) {
    if (statement.kind === "FunctionDeclaration")
      declare(statement.name.name, statement.isPublic);
    if (statement.kind === "VariableDeclaration") {
      declare(statement.name.name, statement.isPublic);
      continue;
    }
    if (statement.kind === "TypeAliasDeclaration")
      declare(statement.name.name, statement.isPublic);
    if (statement.kind === "StructDeclaration")
      declare(statement.name.name, statement.isPublic);
    if (statement.kind === "EnumDeclaration")
      declare(statement.name.name, statement.isPublic);
    if (statement.kind === "TraitDeclaration")
      declare(statement.name.name, statement.isPublic);
  }
  return symbols;
};

const exportInfo = (program: Program): ModuleExportInfo => ({
  named: namedExports(program),
});

export const resolveImport = (
  fromPath: string,
  specifier: string,
  host: ModuleHost,
): ResolveResult | ResolveFailure => {
  const colon = specifier.indexOf(":");
  if (colon > 0) {
    const pkg = specifier.slice(0, colon);
    if (pkg !== "std") return { kind: "unsupported_package" };
    return { kind: "std", id: specifier };
  }

  const base = path.dirname(fromPath);
  const raw = path.resolve(base, specifier);
  const attempted = [
    raw,
    `${raw}.vek`,
    path.join(raw, "index"),
    path.join(raw, "index.vek"),
  ];
  const match = attempted.find((candidate) => host.isFile(candidate));
  if (!match) return { kind: "not_found", attempted };
  const resolved = host.realpathSync(match);
  return { kind: "local", id: resolved, filePath: resolved };
};

const importStatements = (program: Program): ImportDeclaration[] =>
  program.body.filter(
    (statement): statement is ImportDeclaration =>
      statement.kind === "ImportDeclaration",
  );

const validateImports = (
  module: LoadedModule,
  moduleExports: Map<string, ModuleExportInfo>,
  host: ModuleHost,
) => {
  if (!module.program || !module.filePath) return;
  for (const statement of importStatements(module.program)) {
    const sourceNode = statement.source;
    const specifier = sourceNode.value;
    const resolved = resolveImport(module.filePath, specifier, host);

    if (resolved.kind === "unsupported_package") {
      module.resolutionDiagnostics.push(
        unsupportedPackage(specifier, sourceNode.span),
      );
      continue;
    }

    if (resolved.kind === "not_found") {
      module.resolutionDiagnostics.push(
        moduleNotFound(specifier, resolved.attempted, sourceNode.span),
      );
      continue;
    }

    if (resolved.kind === "std") continue;

    const exports = moduleExports.get(resolved.id);
    if (!exports) continue;

    if (statement.namedImports)
      for (const imported of statement.namedImports)
        if (!exports.named.has(imported.name))
          module.resolutionDiagnostics.push({
            severity: "error",
            message: `Module '${specifier}' has no exported symbol '${imported.name}'.`,
            span: imported.span,
            code: "E2702",
          });
  }
};

function declName(stmt: Statement): string | null {
  switch (stmt.kind) {
    case "FunctionDeclaration":
    case "VariableDeclaration":
    case "TypeAliasDeclaration":
    case "StructDeclaration":
    case "EnumDeclaration":
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
      return !!stmt.isPublic;
    default:
      return false;
  }
}

export const loadModuleGraph = (
  entryFile: string,
  host: ModuleHost = nodeHost,
): ModuleGraphResult => {
  const modules = new Map<string, LoadedModule>();
  const deps = new Map<string, string[]>();
  const seen = new Set<string>();
  const root = host.realpathSync(entryFile);

  const loadModule = (modulePath: string): void => {
    const moduleId = host.realpathSync(modulePath);
    if (seen.has(moduleId)) return;
    seen.add(moduleId);

    let source = "";
    try {
      source = host.readFileSync(moduleId);
    } catch {
      modules.set(moduleId, {
        id: moduleId,
        filePath: moduleId,
        kind: "local",
        source: "",
        program: undefined,
        lexDiagnostics: [],
        parseDiagnostics: [],
        checkDiagnostics: [],
        resolutionDiagnostics: [fileReadError(moduleId, emptySpan())],
      });
      deps.set(moduleId, []);
      return;
    }

    const lexed = new Lexer(source).lex();
    const parsed = new Parser(lexed.tokens).parseProgram();
    const loaded: LoadedModule = {
      id: moduleId,
      filePath: moduleId,
      kind: "local",
      source,
      program: parsed.program,
      lexDiagnostics: lexed.diagnostics,
      parseDiagnostics: parsed.diagnostics,
      checkDiagnostics: [],
      resolutionDiagnostics: [],
    };
    modules.set(moduleId, loaded);

    const modDeps: string[] = [];
    for (const statement of importStatements(parsed.program)) {
      const specifier = statement.source.value;
      const resolved = resolveImport(moduleId, specifier, host);
      if (resolved.kind === "local") {
        loadModule(resolved.filePath);
        const depId = host.realpathSync(resolved.filePath);
        if (!modDeps.includes(depId)) modDeps.push(depId);
      }
    }
    deps.set(moduleId, modDeps);
  };

  loadModule(root);

  const moduleExports = new Map<string, ModuleExportInfo>();
  for (const [id, m] of modules) {
    if (m.program) moduleExports.set(id, exportInfo(m.program));
  }
  for (const m of modules.values()) validateImports(m, moduleExports, host);

  // Kahn's topological sort — dependencies before dependents
  const order: string[] = [];
  const inDegree = new Map<string, number>();
  const revDeps = new Map<string, string[]>();
  for (const id of modules.keys()) {
    inDegree.set(id, 0);
    revDeps.set(id, []);
  }
  for (const [id, depList] of deps) {
    for (const dep of depList) {
      if (!modules.has(dep)) continue;
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      revDeps.get(dep)!.push(id);
    }
  }
  const queue = [...modules.keys()].filter((id) => inDegree.get(id) === 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of revDeps.get(id) ?? []) {
      const deg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }
  // Append any remaining cyclic modules
  for (const id of modules.keys()) {
    if (!order.includes(id)) order.push(id);
  }

  const diagnostics: Diagnostic[] = [];
  for (const m of modules.values())
    diagnostics.push(
      ...m.lexDiagnostics,
      ...m.parseDiagnostics,
      ...m.resolutionDiagnostics,
    );

  return { entry: root, modules, order, diagnostics };
};

export const buildMergedProgram = (
  graphResult: ModuleGraphResult,
  host: ModuleHost = nodeHost,
): MergedProgramResult => {
  const { modules, order, entry } = graphResult;
  const mergedStatements: Statement[] = [];
  const namespaceImportExports = new Map<ImportDeclaration, Set<string>>();

  // Build pub export name sets per module
  const moduleExportNames = new Map<string, Set<string>>();
  for (const [id, m] of modules) {
    if (!m.program) continue;
    const names = new Set<string>();
    for (const stmt of m.program.body) {
      const name = declName(stmt);
      if (name && isPublicDecl(stmt)) names.add(name);
    }
    moduleExportNames.set(id, names);
  }

  for (const moduleId of order) {
    const m = modules.get(moduleId);
    if (!m?.program) continue;

    for (const stmt of m.program.body) {
      if (stmt.kind !== "ImportDeclaration") {
        mergedStatements.push(stmt);
        continue;
      }

      if (stmt.namespace) {
        // Keep namespace imports — checker needs them to register the Module binding
        if (m.filePath) {
          const resolved = resolveImport(m.filePath, stmt.source.value, host);
          const targetId =
            resolved.kind === "local"
              ? host.realpathSync(resolved.filePath)
              : null;
          namespaceImportExports.set(
            stmt,
            targetId
              ? (moduleExportNames.get(targetId) ?? new Set())
              : new Set(),
          );
        } else {
          namespaceImportExports.set(stmt, new Set());
        }
        mergedStatements.push(stmt);
      }
      // Named imports: skip — names are already in the merged global scope
    }
  }

  const entryModule = modules.get(entry);
  const program: Program = {
    kind: "Program",
    body: mergedStatements,
    span: entryModule?.program?.span ?? {
      start: { index: 0, line: 1, column: 1 },
      end: { index: 0, line: 1, column: 1 },
    },
  };

  return { program, namespaceImportExports };
};

export const checkModuleGraph = (
  entryFile: string,
  host: ModuleHost = nodeHost,
): ModuleCheckResult => {
  const modules = new Map<string, LoadedModule>();
  const moduleExports = new Map<string, ModuleExportInfo>();
  const seen = new Set<string>();
  const root = host.realpathSync(entryFile);

  const loadModule = (modulePath: string) => {
    const moduleId = host.realpathSync(modulePath);
    if (seen.has(moduleId)) return;
    seen.add(moduleId);

    let source = "";
    try {
      source = host.readFileSync(moduleId);
    } catch {
      modules.set(moduleId, {
        id: moduleId,
        filePath: moduleId,
        kind: "local",
        source: "",
        program: undefined,
        lexDiagnostics: [],
        parseDiagnostics: [],
        checkDiagnostics: [],
        resolutionDiagnostics: [fileReadError(moduleId, emptySpan())],
      });
      return;
    }

    const lexed = new Lexer(source).lex();
    const parsed = new Parser(lexed.tokens).parseProgram();
    const loaded: LoadedModule = {
      id: moduleId,
      filePath: moduleId,
      kind: "local",
      source,
      program: parsed.program,
      lexDiagnostics: lexed.diagnostics,
      parseDiagnostics: parsed.diagnostics,
      checkDiagnostics: [],
      resolutionDiagnostics: [],
    };
    modules.set(moduleId, loaded);

    for (const statement of importStatements(parsed.program)) {
      const specifier = statement.source.value;
      const resolved = resolveImport(moduleId, specifier, host);
      if (resolved.kind === "local") loadModule(resolved.filePath);
    }
  };

  loadModule(root);

  for (const [id, module] of modules) {
    if (!module.program) continue;
    localSymbols(module.program);
    moduleExports.set(id, exportInfo(module.program));
  }

  for (const module of modules.values())
    validateImports(module, moduleExports, host);

  for (const module of modules.values()) {
    if (!module.program) continue;
    const checked = new Checker(module.program).checkProgram();
    module.checkDiagnostics = checked.diagnostics;
  }

  const diagnostics: Diagnostic[] = [];
  for (const module of modules.values())
    diagnostics.push(
      ...module.lexDiagnostics,
      ...module.parseDiagnostics,
      ...module.resolutionDiagnostics,
      ...module.checkDiagnostics,
    );

  return { entry: root, modules, diagnostics };
};
