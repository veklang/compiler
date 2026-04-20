import { dumpIr } from "@/ir/dump";
import { lowerProgramToIr } from "@/ir/lower";
import { validateIr } from "@/ir/validate";
import {
  assert,
  check,
  expectNoCheckDiagnostics,
  expectNoDiagnostics,
} from "./helpers";
import { describe, test } from "./tester";

const irOk = (source: string) => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  expectNoCheckDiagnostics(result.checkDiagnostics);
  const ir = lowerProgramToIr(result.program, result);
  const validation = validateIr(ir);
  assert.deepEqual(validation.diagnostics, []);
  return ir;
};

describe("ir", () => {
  test("lowers a void main function", () => {
    const ir = irOk(`
fn main() -> void {
  return;
}
`);

    assert.equal(ir.entry, "fn.main");
    assert.equal(ir.declarations.length, 1);
    assert.equal(ir.runtime.panic, false);
    assert.equal(ir.runtime.strings, false);
  });

  test("lowers locals, binary expressions, and typed returns", () => {
    const ir = irOk(`
fn add(a: i32, b: i32) -> i32 {
  let sum: i32 = a + b;
  return sum;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.add add(a: i32, b: i32) -> i32"));
    assert.ok(dump.includes("tmp.0: i32 = local.0 + local.1"));
    assert.ok(dump.includes("return local.2"));
  });

  test("records runtime requirements for panic and strings", () => {
    const ir = irOk(`
fn main() -> void {
  panic("boom");
}
`);

    assert.equal(ir.runtime.panic, true);
    assert.equal(ir.runtime.strings, true);
    assert.ok(dumpIr(ir).includes('call @panic("boom")'));
  });

  test("lowers top-level declarations to globals", () => {
    const ir = irOk(`
let counter: i32 = 41;
const label: string = "count";

fn get_counter() -> i32 {
  return counter;
}
`);

    const globals = ir.declarations.filter((d) => d.kind === "global");
    assert.equal(globals.length, 2);
    assert.ok(globals[0].kind === "global");
    assert.equal(globals[0].sourceName, "counter");
    assert.equal(globals[0].mutable, true);
    assert.ok(globals[1].kind === "global");
    assert.equal(globals[1].sourceName, "label");
    assert.equal(globals[1].mutable, false);
    assert.equal(ir.runtime.strings, true);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("global global.counter let counter: i32 = 41"));
    assert.ok(
      dump.includes('global global.label const label: string = "count"'),
    );
    assert.ok(dump.includes("return global.counter"));
  });

  test("lowers assignment to a top-level let as store_global", () => {
    const ir = irOk(`
let counter: i32 = 0;

fn inc() -> i32 {
  counter = counter + 1;
  return counter;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("store_global global.counter"));
    assert.ok(dump.includes("return global.counter"));
  });

  test("lowers if with no else to cond_branch + join", () => {
    const ir = irOk(`
fn main() -> void {
  let x: i32 = 1;
  if x > 0 {
    return;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 3);
    assert.equal(fn.blocks[0].id, "bb.0");
    assert.equal(fn.blocks[1].id, "bb.1");
    assert.equal(fn.blocks[2].id, "bb.2");

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("bb.1"));
    assert.ok(dump.includes("bb.2"));
  });

  test("lowers if/else to cond_branch with two branches and join", () => {
    const ir = irOk(`
fn max(a: i32, b: i32) -> i32 {
  if a > b {
    return a;
  } else {
    return b;
  }
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 4);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("return local.0"));
    assert.ok(dump.includes("return local.1"));
  });

  test("lowers while loop to condition/body/exit blocks", () => {
    const ir = irOk(`
fn count() -> void {
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 4);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("branch bb."));
  });

  test("lowers break to branch to loop exit", () => {
    const ir = irOk(`
fn find() -> void {
  let i: i32 = 0;
  while i < 100 {
    if i > 50 {
      break;
    }
    i = i + 1;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("lowers continue to branch to loop condition", () => {
    const ir = irOk(`
fn skip() -> void {
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
    if i > 5 {
      continue;
    }
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("panic creates unreachable terminator and dead block", () => {
    const ir = irOk(`
fn main() -> void {
  panic("boom");
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const hasUnreachable = fn.blocks.some(
      (b) => b.terminator?.kind === "unreachable",
    );
    assert.ok(hasUnreachable);
  });

  test("validates branch targets exist", () => {
    const ir = irOk(`
fn main() -> void {
  let x: i32 = 1;
  if x > 0 {
    return;
  }
  return;
}
`);
    const result = validateIr(ir);
    assert.deepEqual(result.diagnostics, []);
  });

  test("lowers struct declaration to struct_decl", () => {
    const ir = irOk(`
struct Point {
  x: i32;
  y: i32;
}
fn main() -> void {
  return;
}
`);

    const structDecl = ir.declarations.find((d) => d.kind === "struct_decl");
    assert.ok(structDecl);
    assert.ok(structDecl.kind === "struct_decl");
    assert.equal(structDecl.sourceName, "Point");
    assert.equal(structDecl.fields.length, 2);
    assert.equal(structDecl.fields[0].name, "x");
    assert.equal(structDecl.fields[1].name, "y");

    const dump = dumpIr(ir);
    assert.ok(dump.includes("struct struct.Point Point { x: i32, y: i32 }"));
  });

  test("lowers struct literal to construct_struct", () => {
    const ir = irOk(`
struct Point {
  x: i32;
  y: i32;
}
fn make() -> Point {
  let p: Point = Point { x: 1, y: 2 };
  return p;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("construct_struct struct.Point"));
    assert.ok(dump.includes("x:"));
    assert.ok(dump.includes("y:"));
  });

  test("lowers member access to get_field", () => {
    const ir = irOk(`
struct Point {
  x: i32;
  y: i32;
}
fn get_x(p: Point) -> i32 {
  return p.x;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("get_field"));
    assert.ok(dump.includes(".x"));
  });

  test("lowers field assignment to set_field", () => {
    const ir = irOk(`
struct Point {
  x: i32;
  y: i32;
}
fn move_right(mut p: Point) -> void {
  p.x = p.x + 1;
  return;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("set_field"));
    assert.ok(dump.includes(".x"));
  });

  test("lowers enum declaration to enum_decl", () => {
    const ir = irOk(`
enum Color {
  Red;
  Green;
  Blue;
}
fn main() -> void { return; }
`);

    const enumDecl = ir.declarations.find((d) => d.kind === "enum_decl");
    assert.ok(enumDecl?.kind === "enum_decl");
    assert.equal(enumDecl.sourceName, "Color");
    assert.equal(enumDecl.variants.length, 3);
    assert.equal(enumDecl.variants[0].name, "Red");
    assert.equal(enumDecl.variants[0].tag, 0);
    assert.equal(enumDecl.variants[1].name, "Green");
    assert.equal(enumDecl.variants[2].tag, 2);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("enum enum.Color Color"));
    assert.ok(dump.includes("Red[0]"));
    assert.ok(dump.includes("Green[1]"));
    assert.ok(dump.includes("Blue[2]"));
  });

  test("lowers unit variant construction to construct_enum", () => {
    const ir = irOk(`
enum Color {
  Red;
  Green;
  Blue;
}
fn make() -> Color {
  let c: Color = Red;
  return c;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("construct_enum enum.Color::Red[0]"));
  });

  test("lowers payload variant construction to construct_enum", () => {
    const ir = irOk(`
enum Shape {
  Circle(i32);
  Rect(i32, i32);
}
fn make(r: i32) -> Shape {
  return Circle(r);
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("construct_enum enum.Shape::Circle[0]"));
  });

  test("lowers match on enum to switch + arm blocks", () => {
    const ir = irOk(`
enum Color {
  Red;
  Green;
  Blue;
}
fn describe(c: Color) -> void {
  match c {
    Red => { return; }
    Green => { return; }
    _ => { return; }
  }
}
`);

    const fn = ir.declarations.find((d) => d.kind === "function");
    assert.ok(fn?.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("get_tag"));
    assert.ok(dump.includes("switch"));
  });

  test("lowers match arm payload binding to get_enum_payload", () => {
    const ir = irOk(`
enum Shape {
  Circle(i32);
  Rect(i32, i32);
}
fn area(s: Shape) -> i32 {
  match s {
    Circle(r) => { return r; }
    Rect(w, _h) => { return w; }
    _ => { return 0; }
  }
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("get_enum_payload"));
    assert.ok(dump.includes("Circle"));
  });
});
