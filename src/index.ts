#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Checker } from "@/core/checker";
import {
  buildMergedProgram,
  loadModuleGraph,
  makeNodeHost,
} from "@/core/modules";
import { emitC } from "@/emit/c";
import { lowerProgramToIr } from "@/ir/lower";
import { analyzeInitializers } from "@/passes/initializers";
import type { Diagnostic } from "@/types/diagnostic";

export const defaultToolchainCommand = "cc -std=c99 -Wall -Wextra";

export const defaultRuntimeHeaderPath = path.resolve(
  __dirname,
  "../../runtime/dist/vek_runtime.h",
);

interface CliOptions {
  sourcePath: string;
  nativeInputs: string[];
  runtimeHeaderPath: string;
  optimizationLevel: "0" | "1" | "2" | "3" | "s";
  staticLink: boolean;
  stripSymbols: boolean;
  lto: boolean;
  libraryPaths: string[];
  libraries: string[];
  rawFlags: string[];
  preserveTemps: boolean;
  outputPath: string;
  packages: Map<string, string>;
}

interface CompileResult {
  outputPath: string;
  cPath: string;
  tempDir: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let sourcePath: string | undefined;
  let runtimeHeaderPath = defaultRuntimeHeaderPath;
  const nativeInputs: string[] = [];
  let optimizationLevel: CliOptions["optimizationLevel"] = "2";
  let staticLink = false;
  let stripSymbols = false;
  let lto = false;
  const libraryPaths: string[] = [];
  const libraries: string[] = [];
  const rawFlags: string[] = [];
  let preserveTemps = false;
  const packages = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      throw new CliUsage(usage(), 0);
    }

    if (arg === "--runtime-header") {
      runtimeHeaderPath = requireFlagValue(argv, ++i, arg);
      continue;
    }

    if (arg === "--optimization-level") {
      optimizationLevel = parseOptimizationLevel(
        requireFlagValue(argv, ++i, arg),
        arg,
      );
      continue;
    }

    if (/^-O[0123s]$/.test(arg)) {
      optimizationLevel = arg.slice(2) as CliOptions["optimizationLevel"];
      continue;
    }

    if (arg === "--static") {
      staticLink = true;
      continue;
    }

    if (arg === "--strip") {
      stripSymbols = true;
      continue;
    }

    if (arg === "--lto") {
      lto = true;
      continue;
    }

    if (arg === "--library-path" || arg === "-L") {
      libraryPaths.push(validateLibraryPath(requireFlagValue(argv, ++i, arg)));
      continue;
    }

    if (arg.startsWith("-L") && arg.length > 2) {
      libraryPaths.push(validateLibraryPath(arg.slice(2)));
      continue;
    }

    if (arg === "--library" || arg === "-l") {
      libraries.push(validateLibraryName(requireFlagValue(argv, ++i, arg)));
      continue;
    }

    if (arg.startsWith("-l") && arg.length > 2) {
      libraries.push(validateLibraryName(arg.slice(2)));
      continue;
    }

    if (arg === "--raw-flags") {
      rawFlags.push(requireRawFlagValue(argv, ++i, arg));
      continue;
    }

    if (arg === "--preserve-temp" || arg === "--preserve-temps") {
      preserveTemps = true;
      continue;
    }

    if (arg === "--package") {
      const value = requireFlagValue(argv, ++i, arg);
      const { name, rootPath } = loadPackageDir(path.resolve(value));
      packages.set(name, rootPath);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliUsage(`Unknown flag: ${arg}\n\n${usage()}`, 1);
    }

    const inputPath = resolveExistingInput(arg);
    const ext = path.extname(inputPath);
    if (ext === ".vek") {
      if (sourcePath) {
        throw new CliUsage(
          `Multiple Vek entry files are not supported: ${arg}\n\n${usage()}`,
          1,
        );
      }
      sourcePath = inputPath;
      continue;
    }
    if (ext === ".c" || ext === ".o" || ext === ".a") {
      nativeInputs.push(inputPath);
      continue;
    }
    throw new CliUsage(
      `Unsupported input extension '${ext || "<none>"}' for ${arg}\n\n${usage()}`,
      1,
    );
  }

  if (!sourcePath) throw new CliUsage(usage(), 1);

  const absoluteSource = path.resolve(sourcePath);
  return {
    sourcePath: absoluteSource,
    nativeInputs,
    runtimeHeaderPath: path.resolve(runtimeHeaderPath),
    optimizationLevel,
    staticLink,
    stripSymbols,
    lto,
    libraryPaths,
    libraries,
    rawFlags,
    preserveTemps,
    outputPath: defaultOutputPath(absoluteSource),
    packages,
  };
}

export function compileFile(options: CliOptions): CompileResult {
  const host = makeNodeHost(options.packages);
  const graph = loadModuleGraph(options.sourcePath, host);

  if (graph.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(graph.diagnostics));
  }

  const { program, namespaceImportExports } = buildMergedProgram(graph);
  const checked = new Checker(program, namespaceImportExports).checkProgram();
  const initialized = analyzeInitializers(program);
  const diagnostics = [...checked.diagnostics, ...initialized.diagnostics];

  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(diagnostics));
  }

  const { program: ir, diagnostics: lowerDiagnostics } = lowerProgramToIr(
    program,
    checked,
    { sourcePath: options.sourcePath },
  );
  if (lowerDiagnostics.length > 0) {
    throw new Error(formatDiagnostics(lowerDiagnostics));
  }
  const c = emitC(ir, { runtimeHeader: options.runtimeHeaderPath });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vek-"));
  const cPath = path.join(
    tempDir,
    `${path.basename(options.sourcePath, path.extname(options.sourcePath))}.c`,
  );
  fs.writeFileSync(cPath, c, "utf8");

  try {
    runToolchain(options, cPath);
  } finally {
    if (!options.preserveTemps) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return { outputPath: options.outputPath, cPath, tempDir };
}

export function buildToolchainCommand(
  options: Pick<
    CliOptions,
    | "nativeInputs"
    | "optimizationLevel"
    | "staticLink"
    | "stripSymbols"
    | "lto"
    | "libraryPaths"
    | "libraries"
    | "rawFlags"
    | "outputPath"
  >,
  cPath: string,
): string {
  const parts = [
    defaultToolchainCommand,
    `-O${options.optimizationLevel}`,
    ...(options.lto ? ["-flto"] : []),
    ...(options.staticLink ? ["-static"] : []),
    ...(options.stripSymbols ? ["-s"] : []),
    shellQuote(cPath),
    ...options.nativeInputs.map(shellQuote),
    ...options.libraryPaths.flatMap((p) => ["-L", shellQuote(p)]),
    ...options.libraries.map((name) => `-l${shellQuote(name)}`),
    ...options.rawFlags.map(shellQuote),
    "-o",
    shellQuote(options.outputPath),
  ];
  return parts.join(" ");
}

function runToolchain(options: CliOptions, cPath: string) {
  const command = buildToolchainCommand(options, cPath);
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) return;

  const details = [
    `Toolchain failed: ${command}`,
    result.stdout.trim(),
    result.stderr.trim(),
  ].filter(Boolean);
  throw new Error(details.join("\n"));
}

function requireFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new CliUsage(`Missing value for ${flag}\n\n${usage()}`, 1);
  }
  return value;
}

function requireRawFlagValue(
  argv: string[],
  index: number,
  flag: string,
): string {
  const value = argv[index];
  if (!value) throw new CliUsage(`Missing value for ${flag}\n\n${usage()}`, 1);
  return value;
}

function parseOptimizationLevel(
  value: string,
  flag: string,
): CliOptions["optimizationLevel"] {
  if (value === "0" || value === "1" || value === "2" || value === "3")
    return value;
  if (value === "s" || value === "S") return "s";
  throw new CliUsage(
    `Invalid value for ${flag}: ${value}. Expected 0, 1, 2, 3, or s.\n\n${usage()}`,
    1,
  );
}

function resolveExistingInput(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new CliUsage(`Input path '${inputPath}' does not exist`, 1);
  }
  if (!stat.isFile())
    throw new CliUsage(`Input path '${inputPath}' is not a file`, 1);
  return resolved;
}

function validateLibraryPath(libraryPath: string): string {
  const resolved = path.resolve(libraryPath);
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new CliUsage(`Library path '${libraryPath}' does not exist`, 1);
  }
  if (!stat.isDirectory()) {
    throw new CliUsage(`Library path '${libraryPath}' is not a directory`, 1);
  }
  return resolved;
}

function validateLibraryName(name: string): string {
  if (!/^[A-Za-z0-9_+.:=-]+$/.test(name)) {
    throw new CliUsage(
      `Invalid library name '${name}'. Library names may contain letters, numbers, '_', '+', '.', ':', '=', and '-'.`,
      1,
    );
  }
  return name;
}

function loadPackageDir(rootPath: string): { name: string; rootPath: string } {
  let stat: ReturnType<typeof fs.statSync> | undefined;
  try {
    stat = fs.statSync(rootPath);
  } catch {
    throw new CliUsage(`--package: path '${rootPath}' does not exist`, 1);
  }
  if (!stat.isDirectory())
    throw new CliUsage(`--package: path '${rootPath}' is not a directory`, 1);

  const manifestPath = path.join(rootPath, "package.toml");
  let source: string;
  try {
    source = fs.readFileSync(manifestPath, "utf8");
  } catch {
    throw new CliUsage(`--package: no package.toml found in '${rootPath}'`, 1);
  }

  const name = parseTomlString(source)["name"];
  if (!name)
    throw new CliUsage(
      `--package: package.toml in '${rootPath}' has no 'name' field`,
      1,
    );

  return { name, rootPath };
}

function parseTomlString(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function defaultOutputPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  return path.join(path.dirname(sourcePath), path.basename(sourcePath, ext));
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map((diagnostic) => JSON.stringify(diagnostic)).join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function usage(): string {
  return [
    "Usage: vekc [flags] <path-to-file.vek> [native.c native.o lib.a ...]",
    "",
    "Flags:",
    "  --runtime-header <path>       Runtime header path. Defaults to ../runtime/dist/vek_runtime.h from this compiler.",
    "  --optimization-level <level>  Set C optimization level: 0, 1, 2, 3, or s. Defaults to 2.",
    "  -O0|-O1|-O2|-O3|-Os          Shorthand for --optimization-level.",
    "  --static                     Request static linking.",
    "  --strip                      Strip symbols from the output binary.",
    "  --lto                        Enable C compiler link-time optimization.",
    "  --library-path <path>, -L    Add a native library search path. May be repeated.",
    "  --library <name>, -l         Link a native library by name. May be repeated.",
    "  --raw-flags <arg>            Append one raw toolchain flag. May be repeated.",
    "  --package <path>              Register a package from its directory (reads name from package.toml). May be repeated.",
    "  --preserve-temp              Keep temporary emitted C files under /tmp.",
    "  -h, --help                   Show this help.",
  ].join("\n");
}

class CliUsage extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
  }
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = compileFile(options);
    console.log(`wrote ${result.outputPath}`);
    if (options.preserveTemps) console.log(`kept ${result.cPath}`);
  } catch (error) {
    if (error instanceof CliUsage) {
      const write = error.exitCode === 0 ? console.log : console.error;
      write(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
