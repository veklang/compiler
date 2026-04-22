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
      tokens.map((token) => [token.kind, token.lexeme]),
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
    const tokens = tokensOf(
      "+ += - -= ! * *= / /= % %= = == != > >= < <= && || & &= | |= ^ ^= << <<= >> >>= => ->",
    );
    assert.deepEqual(
      tokens.map((token) => [token.kind, token.lexeme]),
      [
        ["Operator", "+"],
        ["Operator", "+="],
        ["Operator", "-"],
        ["Operator", "-="],
        ["Operator", "!"],
        ["Operator", "*"],
        ["Operator", "*="],
        ["Operator", "/"],
        ["Operator", "/="],
        ["Operator", "%"],
        ["Operator", "%="],
        ["Operator", "="],
        ["Operator", "=="],
        ["Operator", "!="],
        ["Operator", ">"],
        ["Operator", ">="],
        ["Operator", "<"],
        ["Operator", "<="],
        ["Operator", "&&"],
        ["Operator", "||"],
        ["Operator", "&"],
        ["Operator", "&="],
        ["Operator", "|"],
        ["Operator", "|="],
        ["Operator", "^"],
        ["Operator", "^="],
        ["Operator", "<<"],
        ["Operator", "<<="],
        ["Operator", ">>"],
        ["Operator", ">>="],
        ["Operator", "=>"],
        ["Operator", "->"],
      ],
    );
  });

  test("keywords and identifiers", () => {
    const { tokens } = lex(`${keywords.join(" ")} self`);
    const kinds = tokenKinds(withoutEof(tokens));
    assert.equal(
      kinds.filter((kind) => kind === "Keyword").length,
      keywords.length,
    );
    assert.equal(kinds[kinds.length - 1], "Identifier");
  });

  test("numeric literals", () => {
    const tokens = tokensOf("123 6.9 2.0e5 1_000_000 0xDEAD_BEEF 0b1010_1100");
    assert.deepEqual(
      tokens.map((token) => token.lexeme),
      ["123", "6.9", "2.0e5", "1_000_000", "0xDEAD_BEEF", "0b1010_1100"],
    );
  });

  test("strings with escapes", () => {
    const tokens = tokensOf('"hi\\n\\t\\"\\\\\\u{41}\\0"');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
  });

  test("multiline strings", () => {
    const source = '"line1\nline2"';
    const tokens = tokensOf(source);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "String");
  });

  test("comments", () => {
    const tokens = tokensOf("let x = 1; // comment\n/* block */ let y = 2;");
    assert.deepEqual(
      tokens.map((token) => token.lexeme),
      ["let", "x", "=", "1", ";", "let", "y", "=", "2", ";"],
    );
  });
});

describe("lexer diagnostics", () => {
  test("E0004: invalid escapes", () => {
    expectDiagnostics(lex('"\\q"').diagnostics, ["E0004"]);
  });

  test("E0004: invalid unicode escapes", () => {
    expectDiagnostics(lex('"\\u{0G}"').diagnostics, ["E0004"]);
    expectDiagnostics(lex('"\\u{110000}"').diagnostics, ["E0004"]);
    expectDiagnostics(lex('"\\u{D800}"').diagnostics, ["E0004"]);
  });

  test("E0010/E0011/E0013: invalid numeric forms", () => {
    expectDiagnostics(lex("0x").diagnostics, ["E0010"]);
    expectDiagnostics(lex("0b").diagnostics, ["E0011"]);
    expectDiagnostics(lex("1e+").diagnostics, ["E0013"]);
  });

  test("E0002/E0003: unterminated string and block comment", () => {
    expectDiagnostics(lex('"oops').diagnostics, ["E0002"]);
    expectDiagnostics(lex("/* nope").diagnostics, ["E0003"]);
  });
});
