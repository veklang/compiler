import { keywords } from "@/types/shared";
import {
  assert,
  expectDiagnostics,
  lex,
  tokenKinds,
  withoutEof,
} from "./helpers";
import { describe, test } from "./tester";

const tokensOf = (source: string) => withoutEof(lex(source).tokens);

describe("lexer", () => {
  test("punctuators", () => {
    const tokens = tokensOf("(){}[],.:;?");
    assert.deepEqual(
      tokens.map((t) => [t.kind, t.lexeme]),
      [
        ["Punctuator", "("],
        ["Punctuator", ")"],
        ["Punctuator", "{"],
        ["Punctuator", "}"],
        ["Punctuator", "["],
        ["Punctuator", "]"],
        ["Punctuator", ","],
        ["Punctuator", "."],
        ["Punctuator", ":"],
        ["Punctuator", ";"],
        ["Punctuator", "?"],
      ],
    );
  });

  test("operators", () => {
    const tokens = tokensOf("+ - * / % = == != is > >= < <= && || | => ->");
    assert.deepEqual(
      tokens.map((t) => [t.kind, t.lexeme]),
      [
        ["Operator", "+"],
        ["Operator", "-"],
        ["Operator", "*"],
        ["Operator", "/"],
        ["Operator", "%"],
        ["Operator", "="],
        ["Operator", "=="],
        ["Operator", "!="],
        ["Operator", "is"],
        ["Operator", ">"],
        ["Operator", ">="],
        ["Operator", "<"],
        ["Operator", "<="],
        ["Operator", "&&"],
        ["Operator", "||"],
        ["Operator", "|"],
        ["Operator", "=>"],
        ["Operator", "->"],
      ],
    );
  });

  test("keywords and identifiers", () => {
    const { tokens } = lex(`${keywords.join(" ")} name`);
    const kinds = tokenKinds(withoutEof(tokens));
    assert.equal(kinds.filter((k) => k === "Keyword").length, keywords.length);
    assert.equal(kinds[kinds.length - 1], "Identifier");
  });

  test("decimal, float, exponent", () => {
    const tokens = tokensOf("123 6.9 2.0e5 1_000_000 3.14E-2");
    assert.deepEqual(
      tokens.map((t) => t.lexeme),
      ["123", "6.9", "2.0e5", "1_000_000", "3.14E-2"],
    );
  });

  test("hex and binary", () => {
    const tokens = tokensOf("0xDEAD_BEEF 0b1010_1100");
    assert.deepEqual(
      tokens.map((t) => t.lexeme),
      ["0xDEAD_BEEF", "0b1010_1100"],
    );
  });

  test("strings with escapes", () => {
    const tokens = tokensOf('"hi\\n\\t\\"\\\\"');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
    assert.equal(tokens[0].value, 'hi\n\t"\\');
  });

  test("multiline strings", () => {
    const source = '"line1\nline2"';
    const tokens = tokensOf(source);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
    assert.equal(tokens[0].value, "line1\nline2");
  });

  test("comments", () => {
    const tokens = tokensOf("let x = 1; // comment\n/* block */ let y = 2;");
    assert.deepEqual(
      tokens.map((t) => t.lexeme),
      ["let", "x", "=", "1", ";", "let", "y", "=", "2", ";"],
    );
  });

  test("errors: unterminated string", () => {
    const result = lex('"oops');
    expectDiagnostics(result.diagnostics, ["LEX002"]);
  });

  test("errors: unterminated block comment", () => {
    const result = lex("/* nope");
    expectDiagnostics(result.diagnostics, ["LEX003"]);
  });

  test("errors: invalid hex/binary/exponent", () => {
    const hex = lex("0x");
    const bin = lex("0b");
    const exp = lex("1e+");
    expectDiagnostics(hex.diagnostics, ["LEX010"]);
    expectDiagnostics(bin.diagnostics, ["LEX011"]);
    expectDiagnostics(exp.diagnostics, ["LEX013"]);
  });

  test("errors: unexpected char", () => {
    const result = lex("@");
    expectDiagnostics(result.diagnostics, ["LEX001"]);
  });

  test("full program tokenization", () => {
    const source = `
import io from "std:io";

const constant_value = 50;

fn add(x: int, y: int) {
  return x + y;
}

fn main() {
  let float_addition = 6.9 + 4.2;
  io.println("sum: " + add(6, 9));
}
`;
    const result = lex(source);
    assert.equal(result.diagnostics.length, 0);
    const kinds = tokenKinds(withoutEof(result.tokens));
    assert.ok(kinds.includes("Keyword"));
    assert.ok(kinds.includes("Identifier"));
    assert.ok(kinds.includes("Operator"));
    assert.ok(kinds.includes("Punctuator"));
    assert.ok(kinds.includes("String"));
    assert.ok(kinds.includes("Number"));
  });
});
