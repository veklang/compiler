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
    assert.ok(
      ir.declarations.some(
        (decl) => decl.kind === "function" && decl.linkName === "main",
      ),
    );
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

  test("lowers inferred function return types", () => {
    const ir = irOk(`
fn main() {
  let sum = 0;
  for i in [1, 2, 3] {
    sum = sum + i;
  }
  return sum;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.main main() -> i32"));
    assert.ok(dump.includes("return local.0"));
  });

  test("lowers trailing expressions as implicit returns", () => {
    const ir = irOk(`
fn main() {
  42
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.main main() -> i32"));
    assert.ok(dump.includes("return 42"));
  });

  test("lowers trailing if and match values", () => {
    const ir = irOk(`
enum Choice {
  A;
  B;
}

fn pick(flag: bool) -> i32 {
  if flag {
    1
  } else {
    2
  }
}

fn label(choice: Choice) -> i32 {
  match choice {
    A => { 3 },
    _ => { 4 },
  }
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.pick pick(flag: bool) -> i32"));
    assert.ok(dump.includes("fn fn.label label(choice: Choice) -> i32"));
    assert.ok(dump.includes("__if_result"));
    assert.ok(dump.includes("__match_result"));
  });

  test("lowers short-circuit logical operators to blocks", () => {
    const ir = irOk(`
let hits: i32 = 0;

fn rhs() -> bool {
  hits = hits + 1;
  return true;
}

fn main() -> i32 {
  let left: bool = false && rhs();
  let right: bool = true || rhs();
  if left {
    return 1;
  }
  if !right {
    return 2;
  }
  return hits;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("branch"));
    assert.ok(!dump.includes(" && "));
    assert.ok(!dump.includes(" || "));
  });

  test("lowers generic function specialization for struct types", () => {
    const ir = irOk(`
struct User {
  id: i32;
}

fn id<T>(value: T) -> T {
  return value;
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let copied: User = id(user);
  return copied.id;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.id__User id__User(value: User) -> User"));
    assert.ok(!dump.includes("fn fn.id id(value: T) -> T"));
    assert.ok(dump.includes("call @id__User"));
  });

  test("lowers generic method specialization for struct types", () => {
    const ir = irOk(`
struct User {
  id: i32;
}

struct Container {
  count: i32;

  fn map<T>(self, value: T) -> T {
    return value;
  }
}

fn main() -> i32 {
  let container: Container = Container { count: 0 };
  let user: User = User { id: 42 };
  let copied: User = container.map(user);
  return copied.id;
}
`);

    const dump = dumpIr(ir);
    assert.ok(
      dump.includes(
        "fn fn.Container__map__User Container__map__User(self: Container, value: User) -> User",
      ),
    );
    assert.ok(!dump.includes("fn fn.Container_map Container_map"));
    assert.ok(dump.includes("call @Container__map__User"));
  });

  test("lowers generic struct specialization for aggregate fields", () => {
    const ir = irOk(`
struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  fn get(self) -> T {
    return self.value;
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let copied: User = box.get();
  return copied.id;
}
`);

    const dump = dumpIr(ir);
    assert.ok(
      dump.includes("struct struct.Box__User Box__User { value: User }"),
    );
    assert.ok(!dump.includes("struct struct.Box Box { value: T }"));
    assert.ok(
      dump.includes(
        "fn fn.Box__User_get Box__User_get(self: Box__User) -> User",
      ),
    );
    assert.ok(!dump.includes("fn fn.Box_get Box_get(self: Box) -> T"));
    assert.ok(dump.includes("construct_struct struct.Box__User"));
    assert.ok(dump.includes("call @Box__User_get"));
  });

  test("lowers trait satisfaction methods on generic struct owners", () => {
    const ir = irOk(`
trait Extract<T> {
  fn extract(self) -> T;
}

struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  satisfies Extract<T> {
    fn extract(self) -> T {
      return self.value;
    }
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let copied: User = box.extract();
  return copied.id;
}
`);

    const dump = dumpIr(ir);
    assert.ok(
      dump.includes(
        "fn fn.Box__User_extract Box__User_extract(self: Box__User) -> User",
      ),
    );
    assert.ok(dump.includes("call @Box__User_extract"));
  });

  test("lowers generic method specialization on generic struct owner", () => {
    const ir = irOk(`
struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  fn pair<U>(self, other: U) -> (T, U) {
    return (self.value, other);
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let pair: (User, i32) = box.pair(7);
  return pair.0.id;
}
`);

    const dump = dumpIr(ir);
    assert.ok(
      dump.includes("struct struct.Box__User Box__User { value: User }"),
    );
    assert.ok(
      dump.includes(
        "fn fn.Box__User_pair__i32 Box__User_pair__i32(self: Box__User, other: i32) -> (User, i32)",
      ),
    );
    assert.ok(!dump.includes("fn fn.Box_pair"));
    assert.ok(!dump.includes("-> (T, U)"));
    assert.ok(dump.includes("call @Box__User_pair__i32"));
  });

  test("lowers generic enum specialization and generic enum methods", () => {
    const ir = irOk(`
struct User {
  id: i32;
}

enum Option<T> {
  Some(T);
  None;

  fn value_or(self, fallback: T) -> T {
    match self {
      Some(value) => { return value; }
      None => { return fallback; }
    }
  }

  fn pair<U>(self, other: U) -> (Self, U) {
    return (self, other);
  }
}

fn main() -> i32 {
  let a: Option<i32> = Some(39);
  let b: Option<i32> = None;
  let user: User = User { id: 2 };
  let maybe_user: Option<User> = Some(user);
  let pair: (Option<i32>, bool) = a.pair(true);
  if pair.1 {
    let got: User = maybe_user.value_or(User { id: 0 });
    return a.value_or(0) + b.value_or(1) + got.id;
  }
  return 0;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("enum enum.Option__i32 Option__i32"));
    assert.ok(dump.includes("enum enum.Option__User Option__User"));
    assert.ok(!dump.includes("enum enum.Option Option"));
    assert.ok(
      dump.includes(
        "fn fn.Option__i32_value_or Option__i32_value_or(self: Option__i32, fallback: i32) -> i32",
      ),
    );
    assert.ok(
      dump.includes(
        "fn fn.Option__User_value_or Option__User_value_or(self: Option__User, fallback: User) -> User",
      ),
    );
    assert.ok(
      dump.includes(
        "fn fn.Option__i32_pair__bool Option__i32_pair__bool(self: Option__i32, other: bool) -> (Option__i32, bool)",
      ),
    );
    assert.ok(dump.includes("construct_enum enum.Option__i32::Some"));
    assert.ok(dump.includes("construct_enum enum.Option__User::Some"));
    assert.ok(dump.includes("construct_enum enum.Option__i32::None"));
    assert.ok(dump.includes("call @Option__i32_pair__bool"));
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

  test("lowers compound assignment to binary operation and assignment", () => {
    const ir = irOk(`
fn main() -> i32 {
  let x: i32 = 4;
  x += 2;
  x *= 5;
  return x;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("tmp.0: i32 = local.0 + 2"));
    assert.ok(dump.includes("tmp.1: i32 = local.0 * 5"));
    assert.ok(dump.includes("local.0 = tmp.0"));
    assert.ok(dump.includes("local.0 = tmp.1"));
  });

  test("lowers compound assignment through assignable places", () => {
    const ir = irOk(`
let total: i32 = 1;

struct Acc {
  value: i32;
  name: string;
}

fn main() -> i32 {
  let acc: Acc = Acc { value: 40, name: "ve" };
  let xs: i32[] = [1, 2, 3];
  acc.value += 2;
  xs[1] += acc.value;
  total += xs[1];
  acc.name += "k";
  return total;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("get_field local.0.value"));
    assert.ok(dump.includes("set_field local.0.value"));
    assert.ok(dump.includes("array_get"));
    assert.ok(dump.includes("array_set"));
    assert.ok(dump.includes("store_global global.total"));
    assert.ok(dump.includes("string_concat"));
  });

  test("lowers non-literal global initializers to lazy init functions", () => {
    const ir = irOk(`
fn make() -> i32 {
  return 41;
}

let answer: i32 = make();

fn main() -> i32 {
  return answer;
}
`);

    const global = ir.declarations.find(
      (d) => d.kind === "global" && d.sourceName === "answer",
    );
    assert.ok(global?.kind === "global");
    assert.equal(global.initializer, undefined);
    assert.equal(global.initializerFunction, "fn.__vek_init_global_answer");

    const initFn = ir.declarations.find(
      (d) => d.kind === "function" && d.id === "fn.__vek_init_global_answer",
    );
    assert.ok(initFn?.kind === "function");

    const dump = dumpIr(ir);
    assert.ok(dump.includes("ensure_global_initialized global.answer"));
    assert.ok(dump.includes("store_global global.answer"));
  });

  test("lowers tuple literals and tuple member access", () => {
    const ir = irOk(`
fn second() -> i32 {
  let pair: (bool, i32) = (true, 42);
  return pair.1;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("construct_tuple"));
    assert.ok(dump.includes("get_tuple_field"));
    assert.ok(dump.includes(".1"));
  });

  test("lowers nullable construction, null checks, and narrowed unwraps", () => {
    const ir = irOk(`
fn main() -> i32 {
  let maybe_num: i32? = 42;
  if maybe_num != null {
    return maybe_num;
  }
  return 0;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("make_nullable"));
    assert.ok(dump.includes("is_null"));
    assert.ok(dump.includes("unwrap_nullable"));
  });

  test("lowers aggregate and custom equality", () => {
    const ir = irOk(`
struct UserId {
  value: i32;

  satisfies Equal<UserId> {
    fn equals(self, other: UserId) -> bool {
      return self.value == other.value;
    }
  }
}

fn tuple_same(left: (i32, string), right: (i32, string)) -> bool {
  return left == right;
}

fn nullable_same(left: i32?, right: i32?) -> bool {
  return left == right;
}

fn same<T>(left: T, right: T) -> bool
where T: Equal<T>
{
  return left == right;
}

fn main() -> void {
  let left: UserId = UserId { value: 1 };
  let right: UserId = UserId { value: 1 };
  let _ok: bool = same(left, right);
  return;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("get_tuple_field"));
    assert.ok(dump.includes("string_eq"));
    assert.ok(dump.includes("is_null"));
    assert.ok(dump.includes("unwrap_nullable"));
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("call @UserId_equals"));
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

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "main",
    );
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

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "max",
    );
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

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "count",
    );
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

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "find",
    );
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("releases loop-owned locals before break", () => {
    const ir = irOk(`
fn main() -> void {
  while true {
    let s: string = "hi";
    if s == "hi" {
      break;
    }
  }
  return;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("release local.0\n  branch"));
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

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "skip",
    );
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("releases loop-owned locals before continue", () => {
    const ir = irOk(`
fn main() -> void {
  let i: i32 = 0;
  while i < 2 {
    let s: string = "hi";
    i = i + 1;
    if s == "hi" {
      continue;
    }
  }
  return;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("release local.1\n  branch"));
  });

  test("panic creates unreachable terminator and dead block", () => {
    const ir = irOk(`
fn main() -> void {
  panic("boom");
}
`);

    const fn = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "main",
    );
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

    const enumDecl = ir.declarations.find(
      (d) => d.kind === "enum_decl" && d.sourceName === "Color",
    );
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

  test("lowers match on enum to branch chain + arm blocks", () => {
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
    assert.ok(dump.includes("cond_branch"));
    assert.ok(!dump.includes("switch"));
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

  test("lowers string, nullable, and tuple match patterns", () => {
    const ir = irOk(`
fn main() -> i32 {
  let text: string = "hello";
  let pair: (i32, string) = (1, text);
  let maybe: i32? = null;

  match text {
    "hello" => { let _a: i32 = 0; }
    _ => { let _b: i32 = 1; }
  }

  match maybe {
    null => { let _c: i32 = 2; }
    _ => { let _d: i32 = 3; }
  }

  match pair {
    (1, value) => { return value.len; }
    _ => { return 4; }
  }
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("string_eq"));
    assert.ok(dump.includes("is_null"));
    assert.ok(dump.includes("get_tuple_field"));
    assert.ok(dump.includes("cond_branch"));
  });

  test("lowers named function values and indirect calls", () => {
    const ir = irOk(`
fn add_one(x: i32) -> i32 {
  return x + 1;
}

fn apply(f: fn(i32) -> i32, x: i32) -> i32 {
  return f(x);
}

fn main() -> i32 {
  let f: fn(i32) -> i32 = add_one;
  return apply(f, 41);
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("local local.0 const f: fn(i32) -> i32"));
    assert.ok(dump.includes("local.0 = @add_one"));
    assert.ok(dump.includes("call local.0(local.1)"));
  });

  test("lowers non-capturing anonymous functions to generated functions", () => {
    const ir = irOk(`
fn main() -> i32 {
  let f: fn(i32) -> i32 = fn(x: i32) -> i32 {
    return x + 1;
  };
  return f(41);
}
`);

    const generated = ir.declarations.find(
      (d) => d.kind === "function" && d.id === "fn.__vek_anon_0",
    );
    assert.ok(generated?.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.__vek_anon_0 __vek_anon_0"));
    assert.ok(dump.includes("local.0 = @__vek_anon_0"));
    assert.ok(dump.includes("call local.0(41)"));
  });

  test("lowers type-qualified method references to function operands", () => {
    const ir = irOk(`
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  fn new(id: i32) -> Self {
    return Self { id };
  }
}

fn main() -> i32 {
  let make: fn(i32) -> User = User.new;
  let show: fn(User) -> i32 = User.show;
  let user: User = make(42);
  return show(user);
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.User_show User_show(self: User) -> i32"));
    assert.ok(dump.includes("fn fn.User_new User_new(id: i32) -> User"));
    assert.ok(dump.includes("local.0 = @User_new"));
    assert.ok(dump.includes("local.1 = @User_show"));
    assert.ok(dump.includes("call local.0(42)"));
    assert.ok(dump.includes("call local.1(local.2)"));
  });

  test("lowers direct instance method calls to static method calls", () => {
    const ir = irOk(`
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  return user.show();
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.User_show User_show(self: User) -> i32"));
    assert.ok(dump.includes("call @User_show(local.0)"));
  });

  test("lowers an empty array literal and records runtime.arrays", () => {
    const ir = irOk(`
fn get() -> i32[] {
  let xs: i32[] = [];
  return xs;
}
`);

    assert.ok(ir.runtime.arrays.length > 0);
  });

  test("lowers array literal with elements to array_new", () => {
    const ir = irOk(`
fn get() -> i32[] {
  return [1, 2, 3];
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("array_new"));
  });

  test("lowers index expression to array_get", () => {
    const ir = irOk(`
fn first(xs: i32[]) -> i32 {
  return xs[0];
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("array_get"));
  });

  test("lowers string index expression to string_at", () => {
    const ir = irOk(`
fn first(s: string) -> string {
  return s[0];
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("string_at"));
    assert.equal(ir.runtime.strings, true);
  });

  test("lowers heap aliases with retain and release", () => {
    const ir = irOk(`
fn main() -> i32 {
  let a: string = "hi";
  let b: string = a;
  if b == "hi" {
    return 42;
  }
  return 0;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("retain local.0"));
    assert.ok(dump.includes("release local.0"));
    assert.ok(dump.includes("release local.1"));
    assert.equal(ir.runtime.refCounting, true);
  });

  test("lowers aggregate heap aliases with recursive retain and release", () => {
    const ir = irOk(`
struct User {
  name: string;
}

fn main() -> i32 {
  let a: User = User { name: "hi" };
  let b: User = a;
  if b.name == "hi" {
    return 42;
  }
  return 0;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("retain local.0"));
    assert.ok(dump.includes("release local.0"));
    assert.ok(dump.includes("release local.1"));
    assert.equal(ir.runtime.refCounting, true);
  });

  test("lowers indexed assignment to array_set", () => {
    const ir = irOk(`
fn set_first(mut xs: i32[]) -> void {
  xs[0] = 99;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("detach local.0"));
    assert.ok(dump.includes("array_set"));
    assert.equal(ir.runtime.copyOnWrite, true);
  });

  test("lowers for loop over array to while-style CFG", () => {
    const ir = irOk(`
fn sum(xs: i32[]) -> i32 {
  let total: i32 = 0;
  for x in xs {
    total = total + x;
  }
  return total;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("array_len"));
    assert.ok(dump.includes("array_get"));
    const fn_ = ir.declarations.find(
      (decl) => decl.kind === "function" && decl.linkName === "sum",
    );
    assert.ok(fn_.kind === "function");
    assert.ok(fn_.blocks.length > 1);
  });

  test("lowers builtin Result, Ordering, and nullable unwrapping support", () => {
    const ir = irOk(`
fn compare(a: i32, b: i32) -> Ordering {
  if a < b { return Less; }
  if a > b { return Greater; }
  return Equal;
}

fn main() -> i32 {
  let maybe: i32? = null;
  let ok: Result<i32, string> = Ok(40);
  let err: Result<i32, string> = Err("bad");
  let total = ok.unwrap() + err.unwrap_or(1) + maybe.unwrap_or(1);
  match compare(total, 42) {
    Equal => { return 42; }
    _ => { return 0; }
  }
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("enum enum.Ordering"));
    assert.ok(dump.includes("enum enum.Result__i32__string"));
    assert.ok(dump.includes("fn fn.Result__i32__string_unwrap"));
    assert.ok(dump.includes("fn fn.Result__i32__string_unwrap_or"));
    assert.ok(dump.includes("is_null"));
  });

  test("lowers for loop over custom iterable through next", () => {
    const ir = irOk(`
struct Counter {
  current: i32;
  end: i32;

  fn new(end: i32) -> Self {
    return Self { current: 0, end };
  }

  satisfies Iterable<i32> {
    fn next(mut self) -> i32? {
      if self.current == self.end {
        return null;
      }

      let value = self.current;
      self.current = self.current + 1;
      return value;
    }
  }
}

fn sum() -> i32 {
  let total: i32 = 0;
  for x in Counter.new(3) {
    total = total + x;
  }
  return total;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("call @Counter_next"));
    assert.ok(dump.includes("is_null"));
    assert.ok(dump.includes("unwrap_nullable"));
    assert.ok(!dump.includes("array_len"));
    assert.ok(!dump.includes("array_get"));
  });
});
