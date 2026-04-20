#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Checker } from "@/core/checker";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";
import { emitC } from "@/emit/c";
import { lowerProgramToIr } from "@/ir/lower";
import { analyzeInitializers } from "@/passes/initializers";
import type { Diagnostic } from "@/types/diagnostic";

export const defaultToolchainPrefix =
  "musl-gcc -Wall -Wextra -O3 -s -flto -ffunction-sections -fdata-sections -Wl,--gc-sections -D_FORTIFY_SOURCE=2 -fstack-protector-strong -static";

export const defaultRuntimeHeaderPath = path.resolve(
  __dirname,
  "../../runtime/dist/vek_runtime.h",
);

interface CliOptions {
  sourcePath: string;
  runtimeHeaderPath: string;
  toolchainPrefix: string;
  preserveTemps: boolean;
  outputPath: string;
}

interface CompileResult {
  outputPath: string;
  cPath: string;
  tempDir: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let sourcePath: string | undefined;
  let runtimeHeaderPath = defaultRuntimeHeaderPath;
  let toolchainPrefix = defaultToolchainPrefix;
  let preserveTemps = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      throw new CliUsage(usage(), 0);
    }

    if (arg === "--runtime-header") {
      runtimeHeaderPath = requireFlagValue(argv, ++i, arg);
      continue;
    }

    if (arg === "--toolchain-prefix") {
      toolchainPrefix = requireFlagValue(argv, ++i, arg);
      continue;
    }

    if (arg === "--preserve-temp" || arg === "--preserve-temps") {
      preserveTemps = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliUsage(`Unknown flag: ${arg}\n\n${usage()}`, 1);
    }

    if (sourcePath) {
      throw new CliUsage(`Unexpected extra path: ${arg}\n\n${usage()}`, 1);
    }
    sourcePath = arg;
  }

  if (!sourcePath) throw new CliUsage(usage(), 1);

  const absoluteSource = path.resolve(sourcePath);
  return {
    sourcePath: absoluteSource,
    runtimeHeaderPath: path.resolve(runtimeHeaderPath),
    toolchainPrefix,
    preserveTemps,
    outputPath: defaultOutputPath(absoluteSource),
  };
}

export function compileFile(options: CliOptions): CompileResult {
  const source = fs.readFileSync(options.sourcePath, "utf8");
  const lexed = new Lexer(source).lex();
  const parsed = new Parser(lexed.tokens).parseProgram();
  const checked = new Checker(parsed.program).checkProgram();
  const initialized = analyzeInitializers(parsed.program);
  const diagnostics = [
    ...lexed.diagnostics,
    ...parsed.diagnostics,
    ...checked.diagnostics,
    ...initialized.diagnostics,
  ];

  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(diagnostics));
  }

  const ir = lowerProgramToIr(parsed.program, checked, {
    sourcePath: options.sourcePath,
  });
  const c = emitC(ir, { runtimeHeader: options.runtimeHeaderPath });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vek-"));
  const cPath = path.join(
    tempDir,
    `${path.basename(options.sourcePath, path.extname(options.sourcePath))}.c`,
  );
  fs.writeFileSync(cPath, c, "utf8");

  try {
    runToolchain(options.toolchainPrefix, cPath, options.outputPath);
  } finally {
    if (!options.preserveTemps) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return { outputPath: options.outputPath, cPath, tempDir };
}

export function buildToolchainCommand(
  toolchainPrefix: string,
  cPath: string,
  outputPath: string,
): string {
  return `${toolchainPrefix} ${shellQuote(cPath)} -o ${shellQuote(outputPath)}`;
}

function runToolchain(
  toolchainPrefix: string,
  cPath: string,
  outputPath: string,
) {
  const command = buildToolchainCommand(toolchainPrefix, cPath, outputPath);
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

function defaultOutputPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  return path.join(path.dirname(sourcePath), path.basename(sourcePath, ext));
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const code = diagnostic.code ? ` (${diagnostic.code})` : "";
      return `${diagnostic.severity}: ${diagnostic.message}${code}`;
    })
    .join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function usage(): string {
  return [
    "Usage: vekc <path-to-file.vek> [flags]",
    "",
    "Flags:",
    "  --runtime-header <path>       Runtime header path. Defaults to ../runtime/dist/vek_runtime.h from this compiler.",
    "  --toolchain-prefix <command>  C toolchain command before source path, -o, and output path.",
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
