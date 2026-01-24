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
    const tokens = tokensOf("+ - * ** / % = == != is > >= < <= && || | => ->");
    assert.deepEqual(
      tokens.map((t) => [t.kind, t.lexeme]),
      [
        ["Operator", "+"],
        ["Operator", "-"],
        ["Operator", "*"],
        ["Operator", "**"],
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

  test("decimal, f32, exponent", () => {
    const tokens = tokensOf("123 6.9 2.0e5 1_000_000 3.14E-2");
    assert.deepEqual(
      tokens.map((t) => t.lexeme),
      ["123", "6.9", "2.0e5", "1_000_000", "3.14E-2"],
    );
  });

  test("NaN and Infinity literals", () => {
    const tokens = tokensOf("NaN Infinity");
    assert.deepEqual(
      tokens.map((t) => [t.kind, t.lexeme]),
      [
        ["Keyword", "NaN"],
        ["Keyword", "Infinity"],
      ],
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
    assert.equal(tokens[0].lexeme, '"hi\\n\\t\\"\\\\"');
  });

  test("unicode escapes", () => {
    const tokens = tokensOf('"\\u{41}\\u{1f600}"');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
  });

  test("invalid escapes", () => {
    const bad = lex('"\\q"');
    expectDiagnostics(bad.diagnostics, ["E0004"]);
  });

  test("invalid unicode escape", () => {
    const bad = lex('"\\u{0G}"');
    expectDiagnostics(bad.diagnostics, ["E0004"]);
  });

  test("unicode escape out of range", () => {
    const bad = lex('"\\u{110000}"');
    expectDiagnostics(bad.diagnostics, ["E0004"]);
  });

  test("unicode escape surrogate", () => {
    const bad = lex('"\\u{D800}"');
    expectDiagnostics(bad.diagnostics, ["E0004"]);
  });

  test("multiline strings", () => {
    const source = '"line1\nline2"';
    const tokens = tokensOf(source);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
    assert.equal(tokens[0].lexeme, source);
  });

  test("comments", () => {
    const tokens = tokensOf("let x = 1; // comment\n/* block */ let y = 2;");
    assert.deepEqual(
      tokens.map((t) => t.lexeme),
      ["let", "x", "=", "1", ";", "let", "y", "=", "2", ";"],
    );
  });

  test("unterminated string", () => {
    const result = lex('"oops');
    expectDiagnostics(result.diagnostics, ["E0002"]);
  });

  test("unterminated block comment", () => {
    const result = lex("/* nope");
    expectDiagnostics(result.diagnostics, ["E0003"]);
  });

  test("invalid hex/binary/exponent", () => {
    const hex = lex("0x");
    const bin = lex("0b");
    const exp = lex("1e+");
    expectDiagnostics(hex.diagnostics, ["E0010"]);
    expectDiagnostics(bin.diagnostics, ["E0011"]);
    expectDiagnostics(exp.diagnostics, ["E0013"]);
  });

  test("unexpected char", () => {
    const result = lex("@");
    expectDiagnostics(result.diagnostics, ["E0001"]);
  });

  test("full program tokenization", () => {
    const source = `
import io from "std:io";

const constant_value = 50;

fn add(x: i32, y: i32) {
  return x + y;
}

fn main() {
  let float_addition = 6.9 + 4.2;
  io.print("sum: " + add(6, 9) + "\\n");
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
