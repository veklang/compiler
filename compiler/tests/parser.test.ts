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
const y: i32 = 20;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "VariableDeclaration",
      "VariableDeclaration",
    ]);
  });

  test("const must have initializer", () => {
    const result = parse("const nope: i32;");
    expectDiagnostics(result.parseDiagnostics, ["PAR011"]);
  });

  test("type alias with union", () => {
    const program = parseOk("alias ID = i32 | string;");
    assert.equal(program.body[0].kind, "TypeAliasDeclaration");
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
    expectDiagnostics(result.parseDiagnostics, ["PAR062"]);
  });

  test("default not allowed on mut", () => {
    const result = parse("fn bad(x: mut i32 = 1) { return; }");
    expectDiagnostics(result.parseDiagnostics, ["PAR061"]);
  });

  test("strict varargs/kwargs rules", () => {
    const dupVarargs = parse(
      "fn bad(*a: Array<i32>, *b: Array<i32>) { return; }",
    );
    expectDiagnostics(dupVarargs.parseDiagnostics, ["PAR064"]);

    const dupKw = parse(
      "fn bad(**a: Map<string, i32>, **b: Map<string, i32>) { return; }",
    );
    expectDiagnostics(dupKw.parseDiagnostics, ["PAR066"]);

    const afterKw = parse("fn bad(**a: Map<string, i32>, x: i32) { return; }");
    expectDiagnostics(afterKw.parseDiagnostics, ["PAR067"]);

    const dupSep = parse("fn bad(*, *, x: i32) { return; }");
    expectDiagnostics(dupSep.parseDiagnostics, ["PAR063"]);
  });

  test("struct and enum", () => {
    const program = parseOk(`
struct Stuff { num: i32, str: string }
enum Color { Red, Green, Blue }
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "StructDeclaration",
      "EnumDeclaration",
    ]);
  });

  test("class declaration", () => {
    const program = parseOk(`
abstract class Stuff extends Base implements IFoo, IBar {
  pub static value: i32;
  pub fn constructor(v: i32) { return; }
  abstract fn get(): i32;
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
let v = io.print("hi\\n", stream=io.stderr) as void;
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
match 50 { 1 => {}, x => {}, _ => {} }
`);
    assert.equal(program.body[0].kind, "MatchStatement");
  });

  test("missing semicolon produces error", () => {
    const result = parse("let x = 1");
    expectDiagnostics(result.parseDiagnostics, ["PAR020"]);
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

fn might_fail(flag: bool): (i32, string | null) {
  if flag {
    return 42, null;
  } else {
    return 0, "bad flag";
  }
}

fn main() {
  let result = might_fail(false);
  match result {
    _ => io.eprint("done\\n"),
  }
}
`);
    assert.equal(program.body.length, 3);
  });

  test("oop sample program", () => {
    const program = parseOk(`
class Stuff {
  value: i32;

  pub fn constructor(v: i32) {
    return;
  }

  pub fn get_value(): i32 {
    return this.value;
  }
}
`);
    assert.equal(program.body.length, 1);
  });
});
