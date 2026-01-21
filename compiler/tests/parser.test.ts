import {
  assert,
  expectDiagnostics,
  expectNoDiagnostics,
  getProgramBodyKinds,
  parse,
} from "./helpers";
import { describe, test } from "./tester";

const parseOk = (source: string) => {
  const result = parse(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  return result.program;
};

describe("parser", () => {
  test("imports and export default", () => {
    const program = parseOk(`
import io from "std:io";
import { add, pi } from "./math";
pub default 3.14;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "ImportDeclaration",
      "ImportDeclaration",
      "ExportDefaultDeclaration",
    ]);
  });

  test("let/const declarations", () => {
    const program = parseOk(`
let x = 10;
const y: int = 20;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "VariableDeclaration",
      "VariableDeclaration",
    ]);
  });

  test("const must have initializer", () => {
    const result = parse("const nope: int;");
    expectDiagnostics(result.parseDiagnostics, ["PAR011"]);
  });

  test("type alias with union", () => {
    const program = parseOk("alias ID = int | string;");
    assert.equal(program.body[0].kind, "TypeAliasDeclaration");
  });

  test("function declarations", () => {
    const program = parseOk(`
inline fn add(x: int, y: int): int { return x + y; }
fn main(): void { return; }
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "FunctionDeclaration",
      "FunctionDeclaration",
    ]);
  });

  test("arrow and fn expressions", () => {
    const program = parseOk(`
let f = (x: int, y: int) => x + y;
let g = fn(x: int, y: int): int { return x + y; };
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("struct and enum", () => {
    const program = parseOk(`
struct Stuff { num: int, str: string }
enum Result<T, E> { Ok(T), Err(E) }
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "StructDeclaration",
      "EnumDeclaration",
    ]);
  });

  test("class declaration", () => {
    const program = parseOk(`
abstract class Stuff extends Base implements IFoo, IBar {
  pub static value: int;
  pub fn constructor(v: int) { return; }
  abstract fn get(): int;
}
`);
    assert.equal(program.body[0].kind, "ClassDeclaration");
  });

  test("control flow", () => {
    const program = parseOk(`
fn main(): void {
  if 1 == 1 { return; } else { return; }
  while true { break; }
  for i in range(0, 5) { continue; }
  match 50 { 1 => {}, _ => {} }
}
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("expressions and precedence", () => {
    const program = parseOk(`
let x = 1 + 2 * 3 == 7 || 4 < 5;
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("calls, member, cast", () => {
    const program = parseOk(`
let v = io.println("hi") as void;
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("array, tuple, map, struct literals", () => {
    const program = parseOk(`
let a = [1, 2, 3];
let t = (6, 9);
let m = { "hi": "mom" };
let s = Stuff { num: 69, str: "lol" };
`);
    assert.equal(program.body.length, 4);
  });

  test("return tuple literals", () => {
    const program = parseOk(`
fn pair(): (int, int) { return 1, 2; }
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("match patterns", () => {
    const program = parseOk(`
match 50 { 1 => {}, x => {}, _ => {} }
`);
    assert.equal(program.body[0].kind, "MatchStatement");
  });

  test("missing semicolon produces error", () => {
    const result = parse("let x = 1");
    expectDiagnostics(result.parseDiagnostics, ["PAR020"]);
  });
});
