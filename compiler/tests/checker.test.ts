import {
  assert,
  check,
  expectDiagnostics,
  expectNoCheckDiagnostics,
  expectNoDiagnostics,
} from "./helpers";
import { describe, test } from "./tester";

const checkOk = (source: string) => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  expectNoCheckDiagnostics(result.checkDiagnostics);
  return result;
};

describe("checker", () => {
  test("unknown identifier", () => {
    const result = check("fn main(): void { let x = y; }");
    expectDiagnostics(result.checkDiagnostics, ["E2001"]);
  });

  test("duplicate symbol", () => {
    const result = check("let x = 1; let x = 2;");
    expectDiagnostics(result.checkDiagnostics, ["E2002"]);
  });

  test("const assignment", () => {
    const result = check(`
const x: i32 = 1;
x = 2;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("const member mutation", () => {
    const result = check(`
struct Stuff { num: i32, str: string }
const s: Stuff = Stuff { num: 1, str: "hi" };
s.num = 2;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("type mismatch in initializer", () => {
    const result = check('let x: i32 = "hi";');
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("no implicit string coercion", () => {
    const result = check(`
fn main() {
  let x = "hi" + 1;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("explicit cast for mixed numeric types", () => {
    checkOk(`
fn main() {
  let x: i32 = 1;
  let y: f32 = x as f32;
}
`);
  });

  test("struct casts are not allowed by default", () => {
    const result = check(`
struct Stuff { num: i32 }
fn main() {
  let s = Stuff { num: 1 };
  let t = s as Stuff;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("cannot infer type without annotation", () => {
    const result = check("let x;");
    expectDiagnostics(result.checkDiagnostics, ["E2102"]);
  });

  test("tuple binding mismatch", () => {
    const result = check("let (a, b) = 1;");
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("struct literal missing field", () => {
    const result = check(`
struct Stuff { num: i32, str: string }
let s = Stuff { num: 1 };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2103"]);
  });

  test("struct literal shorthand", () => {
    checkOk(`
struct Stuff { num: i32, str: string }
let num = 1;
let str = "hi";
let s = Stuff { num, str };
`);
  });

  test("map literal shorthand", () => {
    checkOk(`
let role = "admin";
let meta = { role };
`);
  });

  test("struct literal unknown field", () => {
    const result = check(`
struct Stuff { num: i32 }
let s = Stuff { num: 1, bad: 2 };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("struct field type mismatch", () => {
    const result = check(`
struct Stuff { num: i32 }
let s = Stuff { num: "nope" };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("member access unknown field", () => {
    const result = check(`
struct Stuff { num: i32 }
let s = Stuff { num: 1 };
let v = s.bad;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("impl method call", () => {
    checkOk(`
struct User { id: i32, name: string }
impl User {
  fn display_name(self: User): string { return self.name; }
}
fn main() {
  let u = User { id: 1, name: "sam" };
  let s = u.display_name();
}
`);
  });

  test("trait impl missing method", () => {
    const result = check(`
struct User { id: i32 }
trait Printable {
  fn print(self: User): void;
  fn id(self: User): i32;
}
impl Printable for User {
  fn print(self: User): void { return; }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2814"]);
  });

  test("trait impl signature mismatch", () => {
    const result = check(`
struct User { id: i32 }
trait Printable {
  fn id(self: User): i32;
}
impl Printable for User {
  fn id(self: User): f32 { return 1.0; }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2815"]);
  });

  test("impl method requires self parameter", () => {
    const result = check(`
struct User { id: i32 }
impl User {
  fn nope(x: i32): i32 { return x; }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2813"]);
  });

  test("only structs can be impl targets", () => {
    const result = check(`
enum Value { A }
impl Value {
  fn bad(self: Value): i32 { return 1; }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2811"]);
  });

  test("enum pattern arity mismatch", () => {
    const result = check(`
enum Pair<A, B> { Pair(A, B) }
match Pair(1, 2) { Pair(a) => {} }
`);
    expectDiagnostics(result.checkDiagnostics, ["E2601"]);
  });

  test("unknown enum variant", () => {
    const result = check(`
enum Pair<A, B> { Pair(A, B) }
match Pair(1, 2) { Nope() => {} }
`);
    expectDiagnostics(result.checkDiagnostics, ["E2603"]);
  });

  test("non-exhaustive enum match warns", () => {
    const result = check(`
enum Result<T, E> { Ok(T), Err(E) }
match Ok(1) { Ok(v) => {} }
`);
    assert.equal(
      result.checkDiagnostics.some((d) => d.code === "W2601"),
      true,
    );
  });

  test("is operator requires aliasable types", () => {
    const result = check("let x = 1 is 2;");
    expectDiagnostics(result.checkDiagnostics, ["E2502"]);
  });

  test("readonly parameter assignment", () => {
    const result = check(`
fn f(x: i32) {
  x = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("readonly parameter member mutation", () => {
    const result = check(`
struct Stuff { num: i32 }
fn f(s: Stuff) {
  s.num = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("mut parameter requires mutable argument", () => {
    const result = check(`
fn bump(mut x: i32) {
  x = 2;
}
fn main() {
  const y: i32 = 1;
  bump(y);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2204"]);
  });

  test("logical not with truthy values", () => {
    checkOk('fn main() { let x = !0; let y = !""; let z = !null; }');
  });

  test("logical not accepts arrays/maps", () => {
    checkOk("fn main() { let x = ![]; let y = ![1]; let z = !{}; }");
  });

  test("unknown type", () => {
    const result = check("let x: Nope = 1;");
    expectDiagnostics(result.checkDiagnostics, ["E2003"]);
  });

  test("cyclic type alias", () => {
    const result = check(`
type A = B;
type B = A;
let x: A = 1;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2004"]);
  });

  test("generic arity mismatch", () => {
    const result = check(`
struct Box<T> { value: T }
let x: Box = Box { value: 1 };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2005", "E2003"]);
  });

  test("all truthy/falsy conditions allowed", () => {
    checkOk(`
fn main() {
  // falsy
  if false {}
  if null {}
  if 0 {}
  if 0.0 {}
  if -0.0 {}
  if "" {}
  if NaN {}
  if [] {}
  if {} {}

  // truthy
  if true {}
  if 1 {}
  if -1 {}
  if 0.1 {}
  if "x" {}
  if Infinity {}
  if -Infinity {}
  if [1] {}
  if { "a": 1 } {}
}
`);
  });

  test("all conditions are allowed", () => {
    checkOk("if [1, 2] {} if {} {}");
  });

  test("return type mismatch", () => {
    const result = check(`fn f(): i32 { return "nope"; }`);
    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
  });

  test("integer literal range", () => {
    const result = check("let x: i8 = 999;");
    expectDiagnostics(result.checkDiagnostics, ["E2401"]);
  });

  test("unknown keyword argument", () => {
    const result = check(`
fn f(a: i32, b: i32) { return; }
f(a=1, b=2, c=3);
`);
    expectDiagnostics(result.checkDiagnostics, ["E2201"]);
  });

  test("duplicate keyword argument", () => {
    const result = check(`
fn f(a: i32, b: i32) { return; }
f(a=1, b=2, a=3);
`);
    expectDiagnostics(result.checkDiagnostics, ["E2202"]);
  });

  test("kwspread overlap with explicit", () => {
    const result = check(`
fn f(a: i32, b: i32) { return; }
f(a=1, b=2, **{ "a": 2 });
`);
    expectDiagnostics(result.checkDiagnostics, ["E2203"]);
  });

  test("kwspread must be map", () => {
    const result = check(`
fn f(**a: Map<string, i32>) { return; }
f(**[1, 2]);
`);
    expectDiagnostics(result.checkDiagnostics, ["E2206"]);
  });

  test("spread requires array or tuple", () => {
    const result = check(`
fn f(*a: Array<i32>) { return; }
f(*1);
`);
    expectDiagnostics(result.checkDiagnostics, ["E2206"]);
  });

  test("variadic param type must be array", () => {
    const result = check("fn f(*a: i32) { return; }");
    expectDiagnostics(result.checkDiagnostics, ["E2209"]);
  });

  test("kw-variadic param type must be map", () => {
    const result = check("fn f(**a: i32) { return; }");
    expectDiagnostics(result.checkDiagnostics, ["E2210"]);
  });

  test("missing arguments", () => {
    const result = check("fn f(a: i32, b: i32) { return; } f(1);");
    expectDiagnostics(result.checkDiagnostics, ["E2207"]);
  });

  test("default export unknown symbol", () => {
    const result = check("pub default a, b;");
    expectDiagnostics(result.checkDiagnostics, ["E2701", "E2701"]);
  });

  test("checker happy path", () => {
    checkOk(`
import io from "std:io";

struct Stuff { num: i32, str: string }
enum Result<T, E> { Ok(T), Err(E) }

fn add(a: i32, b: i32): i32 { return a + b; }

fn main() {
  let s = Stuff { num: 1, str: "hi" };
  let xs = [1, 2, 3];
  let ys = xs;
  let ok: Result<i32, string> | null = Ok(1);
  if ok != null { io.print("ok\\n"); }
  match ok {
    Ok(v) => io.print(v + "\\n"),
    Err(e) => io.eprint(e + "\\n"),
  }
  add(1, 2);
}
`);
  });
});
