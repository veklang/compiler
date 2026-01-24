import { strict as nodeAssert } from "node:assert";
import { Checker } from "@/lang/checker";
import { Lexer } from "@/lang/lexer";
import { Parser } from "@/lang/parser";
import type { Program } from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";
import type { Token } from "@/types/token";

export const lex = (source: string) => new Lexer(source).lex();

export const parse = (source: string) => {
  const { tokens, diagnostics: lexDiagnostics } = lex(source);
  const { program, diagnostics: parseDiagnostics } = new Parser(
    tokens,
  ).parseProgram();
  return { tokens, lexDiagnostics, program, parseDiagnostics };
};

export const check = (source: string) => {
  const parsed = parse(source);
  const { diagnostics: checkDiagnostics, types } = new Checker(
    parsed.program,
  ).checkProgram();
  return { ...parsed, checkDiagnostics, types };
};

export const expectNoDiagnostics = (
  lexDiagnostics: Diagnostic[],
  parseDiagnostics: Diagnostic[],
) => {
  const messages = [
    ...lexDiagnostics.map((d) => `DIAG ${d.code ?? ""} ${d.message}`),
    ...parseDiagnostics.map((d) => `DIAG ${d.code ?? ""} ${d.message}`),
  ].join("\n");
  assert.equal(
    lexDiagnostics.length + parseDiagnostics.length,
    0,
    messages.length
      ? `Unexpected diagnostics:\n${messages}`
      : "Unexpected diagnostics",
  );
};

export const expectNoCheckDiagnostics = (diagnostics: Diagnostic[]) => {
  const messages = diagnostics
    .map((d) => `DIAG ${d.code ?? ""} ${d.message}`)
    .join("\n");
  assert.equal(
    diagnostics.length,
    0,
    messages.length
      ? `Unexpected diagnostics:\n${messages}`
      : "Unexpected diagnostics",
  );
};

export const expectDiagnostics = (
  diagnostics: Diagnostic[],
  codes: string[],
) => {
  const actual = diagnostics.map((d) => d.code ?? "").filter(Boolean);
  assert.deepEqual(
    actual,
    codes,
    `Expected diagnostics [${codes.join(", ")}], got [${actual.join(", ")}]`,
  );
};

export const tokenKinds = (tokens: Token[]) => tokens.map((t) => t.kind);

export const withoutEof = (tokens: Token[]) =>
  tokens.filter((t) => t.kind !== "EOF");

export const assert: typeof nodeAssert = nodeAssert;

export const getProgramBodyKinds = (program: Program) =>
  program.body.map((node) => node.kind);
