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
pub default add, sub, mul, div;
pub default *;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "ImportDeclaration",
      "ImportDeclaration",
      "ExportDefaultDeclaration",
      "ExportDefaultDeclaration",
      "ExportDefaultDeclaration",
    ]);
  });

  test("default export list requires identifiers", () => {
    const result = parse("pub default add, 123;");
    expectDiagnostics(result.parseDiagnostics, ["E1070", "E1020"]);
  });

  test("let/const declarations", () => {
    const program = parseOk(`
let x = 10;
const y: i32 = 20;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "VariableDeclaration",
      "VariableDeclaration",
    ]);
  });

  test("const must have initializer", () => {
    const result = parse("const nope: i32;");
    expectDiagnostics(result.parseDiagnostics, ["E1011"]);
  });

  test("type alias with union", () => {
    const program = parseOk("type ID = i32 | string;");
    assert.equal(program.body[0].kind, "TypeAliasDeclaration");
  });

  test("frozen oop keywords are reserved", () => {
    const result = parse(`
let class = 1;
let static = 2;
`);
    expectDiagnostics(result.parseDiagnostics, ["E1001", "E1001"]);
  });

  test("function declarations", () => {
    const program = parseOk(`
inline fn add(x: i32, y: i32): i32 { return x + y; }
fn main(): void { return; }
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "FunctionDeclaration",
      "FunctionDeclaration",
    ]);
  });

  test("function expressions", () => {
    const program = parseOk(`
let g = fn(x: i32, y: i32): i32 { return x + y; };
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("named args, defaults, and varargs", () => {
    const program = parseOk(`
fn print(message: string, *, stream: Stream = io.stdout) {
  return;
}

fn sum(*values: Array<i32>) {
  return;
}

fn log(**meta: Map<string, string>) {
  return;
}

fn open(path: string, mode: string = "r", timeout: i32 | null = null) {
  return;
}

fn main() {
  print("hello\\n", stream=io.stderr);
  sum(*values);
  log(**meta);
}
`);
    assert.equal(program.body.length, 5);
  });

  test("invalid default ordering", () => {
    const result = parse("fn bad(x: i32 = 1, y: i32) { return; }");
    expectDiagnostics(result.parseDiagnostics, ["E1062"]);
  });

  test("default not allowed on mut", () => {
    const result = parse("fn bad(x: mut i32 = 1) { return; }");
    expectDiagnostics(result.parseDiagnostics, ["E1061"]);
  });

  test("strict varargs/kwargs rules", () => {
    const dupVarargs = parse(
      "fn bad(*a: Array<i32>, *b: Array<i32>) { return; }",
    );
    expectDiagnostics(dupVarargs.parseDiagnostics, ["E1064"]);

    const dupKw = parse(
      "fn bad(**a: Map<string, i32>, **b: Map<string, i32>) { return; }",
    );
    expectDiagnostics(dupKw.parseDiagnostics, ["E1066"]);

    const afterKw = parse("fn bad(**a: Map<string, i32>, x: i32) { return; }");
    expectDiagnostics(afterKw.parseDiagnostics, ["E1067"]);

    const dupSep = parse("fn bad(*, *, x: i32) { return; }");
    expectDiagnostics(dupSep.parseDiagnostics, ["E1063"]);
  });

  test("struct and enum", () => {
    const program = parseOk(`
struct Stuff { num: i32, str: string }
enum Result<T, E> { Ok(T), Err(E) }
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "StructDeclaration",
      "EnumDeclaration",
    ]);
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
let x = !false || 1 + 2 * 3 == 7 || 4 < 5;
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("calls, member, cast", () => {
    const program = parseOk(`
let v = io.print("hi\\n", stream=io.stderr) as void;
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("string unescape supports unicode and null", () => {
    const program = parseOk(`let s = "a\\u{41}\\0";`);
    const decl = program.body[0] as any;
    const literal = decl.initializer as any;
    assert.equal(literal.value, "aA\0");
  });

  test("duplicate keyword args", () => {
    const result = parse(`
fn f(a: i32) { return; }
f(a=1, a=2);
`);
    expectDiagnostics(result.parseDiagnostics, ["E1069"]);
  });

  test("array, tuple, map, struct literals", () => {
    const program = parseOk(`
let a = [1, 2, 3];
let t = (6, 9);
let m = { "hi": "mom" };
let name = "sam";
let m2 = { name };
let num = 69;
let str = "lol";
let s = Stuff { num: 69, str: "lol" };
let s2 = Stuff { num, str };
`);
    assert.equal(program.body.length, 9);
  });

  test("return tuple literals", () => {
    const program = parseOk(`
fn pair(): (i32, i32) { return 1, 2; }
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("tuple destructuring in let", () => {
    const program = parseOk(`
fn pair(): (i32, i32) { return 1, 2; }
let x, y = pair();
let (a, b) = pair();
`);
    assert.equal(program.body.length, 3);
  });

  test("match patterns", () => {
    const program = parseOk(`
match 50 { 1 => {}, x => {}, _ => {}, Pair(a, b) => {} }
`);
    assert.equal(program.body[0].kind, "MatchStatement");
  });

  test("enum pattern bindings", () => {
    const program = parseOk(`
match Pair(1, 2) { Pair(a, b) => {} }
`);
    const match = program.body[0] as any;
    const arm = match.arms[0];
    assert.equal(arm.pattern.kind, "EnumPattern");
    assert.equal(arm.pattern.bindings.length, 2);
  });

  test("missing semicolon produces error", () => {
    const result = parse("let x = 1");
    expectDiagnostics(result.parseDiagnostics, ["E1020"]);
  });

  test("full program sample (functions + io)", () => {
    const program = parseOk(`
import io from "std:io";

const constant_value = 50;

fn add(x: i32, y: i32) {
  return x + y;
}

fn main() {
  let float_addition = 6.9 + 4.2;
  io.print("sum: " + add(6, 9) + "\\n");
}
`);
    assert.equal(program.body.length, 4);
  });

  test("match and loops sample", () => {
    const program = parseOk(`
import io from "std:io";

fn main() {
  match 50 {
    1 => io.print("one\\n"),
    50 => io.print("fifty\\n"),
    _ => io.print("other\\n"),
  }

  for i in range(0, 5) {
    io.print(i + "\\n");
  }

  for val in [6, 9, 4, 2, 0] {
    io.print(val + "\\n");
  }
}
`);
    assert.equal(program.body.length, 2);
  });

  test("result-based errors sample", () => {
    const program = parseOk(`
import io from "std:io";

enum Result<T, E> {
  Ok(T),
  Err(E),
}

enum Pair<A, B> {
  Pair(A, B),
}

fn might_fail(flag: bool): Result<i32, string> {
  if flag {
    return Ok(42);
  } else {
    return Err("bad flag");
  }
}

fn main() {
  match might_fail(false) {
    Ok(v)  => io.print("value: " + v + "\\n"),
    Err(e) => io.eprint("error: " + e + "\\n"),
  }
  match Pair(1, 2) {
    Pair(a, b) => io.print(a + b + "\\n"),
  }
}
`);
    assert.equal(program.body.length, 5);
  });
});
