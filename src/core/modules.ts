import * as fs from "node:fs";
import * as path from "node:path";
import { Checker } from "@/core/checker";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";
import type { ImportDeclaration, Program } from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";

interface ModuleExportInfo {
  hasDefault: boolean;
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
      if (statement.name.kind === "Identifier") names.add(statement.name.name);
      if (statement.name.kind === "TupleBinding")
        for (const element of statement.name.elements) names.add(element.name);
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
      if (statement.name.kind === "Identifier")
        declare(statement.name.name, statement.isPublic);
      if (statement.name.kind === "TupleBinding")
        for (const element of statement.name.elements)
          declare(element.name, statement.isPublic);
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

const exportInfo = (program: Program): ModuleExportInfo => {
  const named = namedExports(program);
  let hasDefault = false;
  for (const statement of program.body) {
    if (statement.kind !== "ExportDefaultDeclaration") continue;
    hasDefault = true;
  }
  return { hasDefault, named };
};

const resolveImport = (
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

const validateDefaultExportSymbols = (
  program: Program,
  symbols: Map<string, SymbolVisibility>,
) => {
  const diagnostics: Diagnostic[] = [];
  for (const statement of program.body) {
    if (statement.kind !== "ExportDefaultDeclaration") continue;
    if (statement.symbols)
      for (const symbol of statement.symbols) {
        const info = symbols.get(symbol.name);
        if (info && !info.isPublic)
          diagnostics.push({
            severity: "error",
            message: `Symbol '${symbol.name}' in default export must be public.`,
            span: symbol.span,
            code: "E2705",
          });
      }

    if (statement.expression?.kind === "IdentifierExpression") {
      const info = symbols.get(statement.expression.name);
      if (info && !info.isPublic)
        diagnostics.push({
          severity: "error",
          message: `Symbol '${statement.expression.name}' in default export must be public.`,
          span: statement.expression.span,
          code: "E2705",
        });
    }
  }
  return diagnostics;
};

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

    if (statement.defaultImport && !exports.hasDefault)
      module.resolutionDiagnostics.push({
        severity: "error",
        message: `Module '${specifier}' has no default export.`,
        span: statement.defaultImport.span,
        code: "E2704",
      });

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
    const symbols = localSymbols(module.program);
    module.resolutionDiagnostics.push(
      ...validateDefaultExportSymbols(module.program, symbols),
    );
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
