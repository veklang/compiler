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
  test("top-level declarations", () => {
    const program = parseOk(`
pub type MaybeI32 = i32?;

struct User {
  id: i32;
  name: string;
}

enum Result<T, E> {
  Ok(T);
  Err(E);
}

trait Equal<T> {
  fn equals(self, other: T) -> bool;
}

fn main() -> void {
  return;
}
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "TypeAliasDeclaration",
      "StructDeclaration",
      "EnumDeclaration",
      "TraitDeclaration",
      "FunctionDeclaration",
    ]);
  });

  test("imports", () => {
    const program = parseOk(`
import "std:io" as io;
import Map, Set from "std:collections";
import add, sub from "./math";
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "ImportDeclaration",
      "ImportDeclaration",
      "ImportDeclaration",
    ]);
  });

  test("struct members and satisfies blocks", () => {
    const program = parseOk(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  id: i32;
  name: string;

  fn new(id: i32, name: string) -> Self {
    return Self { id, name };
  }

  fn display_name(self) -> string {
    return self.name;
  }

  satisfies Printable {
    fn print(self) -> void {
      return;
    }
  }
}
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "TraitDeclaration",
      "StructDeclaration",
    ]);
  });

  test("associated type declarations and definitions are parsed", () => {
    const program = parseOk(`
trait Source {
  type Item;
  type Label: Format;

  fn get(self) -> Item;
}

struct Num {
  value: i32;

  satisfies Source {
    type Item = i32;
    type Label = string;

    fn get(self) -> i32 {
      return self.value;
    }
  }
}
`);
    const trait = program.body[0];
    const struct = program.body[1];
    assert.equal(trait.kind, "TraitDeclaration");
    assert.equal(struct.kind, "StructDeclaration");
    if (trait.kind === "TraitDeclaration") {
      assert.deepEqual(
        trait.members.map((member) => member.kind),
        [
          "AssociatedTypeDeclaration",
          "AssociatedTypeDeclaration",
          "TraitMethodSignature",
        ],
      );
    }
    if (struct.kind === "StructDeclaration") {
      const satisfies = struct.members.find(
        (member) => member.kind === "TraitSatisfiesDeclaration",
      );
      assert.equal(satisfies?.kind, "TraitSatisfiesDeclaration");
      if (satisfies?.kind === "TraitSatisfiesDeclaration") {
        assert.equal(satisfies.associatedTypes.length, 2);
      }
    }
  });

  test("associated type projections and constraints are parsed", () => {
    const program = parseOk(`
trait Source {
  type Item;
  fn get(self) -> Item;
}

fn first<S>(source: S) -> S.Item
where S: Source<Item = i32>, S.Item: Format
{
  return source.get();
}
`);
    const fn = program.body[1];
    assert.equal(fn.kind, "FunctionDeclaration");
    if (fn.kind === "FunctionDeclaration") {
      assert.equal(fn.returnType?.kind, "AssociatedTypeProjection");
      assert.equal(fn.whereClause?.length, 2);
      assert.equal(fn.whereClause?.[0]?.trait.associatedConstraints?.length, 1);
      assert.equal(
        fn.whereClause?.[1]?.target.kind,
        "AssociatedTypeProjection",
      );
    }
  });

  test("trait default methods are parsed", () => {
    const program = parseOk(`
trait Described {
  fn name(self) -> string;

  fn code(self) -> i32 {
    return 7;
  }
}
`);
    const trait = program.body[0];
    assert.equal(trait.kind, "TraitDeclaration");
    if (trait.kind === "TraitDeclaration") {
      assert.deepEqual(
        trait.members.map((member) => member.kind),
        ["TraitMethodSignature", "MethodDeclaration"],
      );
    }
  });

  test("enum members may include methods using Self", () => {
    const program = parseOk(`
enum State {
  Idle;
  Busy(i32);

  fn busy(value: i32) -> Self {
    return Busy(value);
  }

  fn value(self) -> i32? {
    return match self {
      Busy(value) => value,
      _ => null,
    };
  }
}
`);
    assert.deepEqual(getProgramBodyKinds(program), ["EnumDeclaration"]);
  });

  test("function types, array types, nullable types, and where clauses", () => {
    const program = parseOk(`
trait Hash {
  fn hash(self) -> u64;
}

trait Equal<T> {
  fn equals(self, other: T) -> bool;
}

fn lookup<K, V>(map: Map<K, V>, key: K) -> V?
where K: Equal<K>, K: Hash
{
  return null;
}

let handler: fn(mut i32[]) -> void = fn(mut xs: i32[]) -> void {
  return;
};
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "TraitDeclaration",
      "TraitDeclaration",
      "FunctionDeclaration",
      "VariableDeclaration",
    ]);
  });

  test("control flow and assignment statements", () => {
    const program = parseOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let pair: (i32, string) = (1, "a");

  if true {
    xs[0] = 2;
  } else {
    xs[1] = 3;
  }

  while false {
    break;
  }

  for x in xs {
    pair.0 = x;
  }
}
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("tuple destructuring binding patterns are parsed", () => {
    const program = parseOk(`
fn main() -> void {
  let (a, (_, b)) = (1, (2, 3));
  for (i, value) in [(1, 2)] {
    let _sum = i + value;
  }
}
`);
    const fn = program.body[0];
    assert.equal(fn.kind, "FunctionDeclaration");
    if (fn.kind !== "FunctionDeclaration" || !fn.body) return;

    const decl = fn.body.body[0];
    assert.equal(decl.kind, "VariableDeclaration");
    if (decl.kind === "VariableDeclaration") {
      assert.equal(decl.name.kind, "TupleBindingPattern");
      assert.equal(decl.name.elements[1]?.kind, "TupleBindingPattern");
    }

    const loop = fn.body.body[1];
    assert.equal(loop.kind, "ForStatement");
    if (loop.kind === "ForStatement") {
      assert.equal(loop.iterator.kind, "TupleBindingPattern");
    }
  });

  test("compound assignment statements", () => {
    const program = parseOk(`
fn main() -> void {
  let x: i32 = 1;
  x += 2;
  x -= 1;
  x *= 3;
  x /= 2;
  x %= 4;
  x <<= 1;
  x >>= 1;
  x &= 7;
  x ^= 3;
  x |= 8;
}
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
    const fn = program.body[0];
    assert.ok(fn.kind === "FunctionDeclaration" && fn.body);
    const assignments = fn.body.body
      .filter((statement) => statement.kind === "AssignmentStatement")
      .map((statement) =>
        statement.kind === "AssignmentStatement" ? statement.operator : "",
      );
    assert.deepEqual(assignments, [
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "<<=",
      ">>=",
      "&=",
      "^=",
      "|=",
    ]);
  });

  test("match statement and match expression", () => {
    const program = parseOk(`
enum Result<T, E> {
  Ok(T);
  Err(E);
}

fn main() -> void {
  let value: Result<i32, string> = Ok(1);

  match value {
    Ok(v) => {
      let x = v;
    },
    Err(e) => {
      let y = e;
    },
  }

  let label = match value {
    Ok(v) => v.format(),
    _ => "other",
  };
}
`);
    assert.equal(program.body[1].kind, "FunctionDeclaration");
  });

  test("trailing expression statements omit semicolon", () => {
    const program = parseOk(`
fn value() -> i32 {
  let x = 41;
  x + 1
}

fn unit() -> void {
  value();
}
`);
    const valueFn = program.body[0];
    assert.ok(valueFn.kind === "FunctionDeclaration" && valueFn.body);
    const valueLast = valueFn.body.body.at(-1);
    assert.ok(valueLast?.kind === "ExpressionStatement");
    assert.equal(valueLast.hasSemicolon, false);

    const unitFn = program.body[1];
    assert.ok(unitFn.kind === "FunctionDeclaration" && unitFn.body);
    const unitLast = unitFn.body.body.at(-1);
    assert.ok(unitLast?.kind === "ExpressionStatement");
    assert.equal(unitLast.hasSemicolon, true);
  });

  test("generic call type arguments and tuple member access", () => {
    const program = parseOk(`
fn id<T>(value: T) -> T {
  return value;
}

fn main() -> void {
  let pair = (1, 2);
  let first = pair.0;
  let value: i32 = id<i32>(first);
}
`);
    assert.equal(program.body.length, 2);
  });

  test("casts are parsed after lower-precedence expressions", () => {
    const program = parseOk(`
fn main() -> void {
  let value = 1 + 2 as i32;
}
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("empty and one-element tuples are parsed", () => {
    const program = parseOk(`
fn main() -> void {
  let unit: () = ();
  let single: (i32,) = (1,);
}
`);
    assert.equal(program.body[0].kind, "FunctionDeclaration");
  });

  test("anonymous functions are parsed", () => {
    const program = parseOk(`
let add_one = fn(x: i32) -> i32 {
  return x + 1;
};
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("void and null are valid in type position", () => {
    parseOk(`
fn nothing() -> void {
  return;
}

fn maybe() -> null {
  return null;
}
`);
  });

  test("nested generic type arguments parse correctly", () => {
    parseOk(`
fn main() -> void {
  let xs: Map<string, i32[]> = Map {};
}
`);
  });

  test("Self is valid as a return type", () => {
    parseOk(`
struct Foo {
  id: i32;

  fn make(id: i32) -> Self {
    return Self { id };
  }
}
`);
  });

  test("where clause on function type is parsed", () => {
    parseOk(`
let f: fn<T>(T, T) -> bool where T: Equal<T> = fn(a: i32, b: i32) -> bool {
  return a.equals(b);
};
`);
  });

  test("mut call-site argument is parsed as MutExpression", () => {
    const program = parseOk(`
fn push_one(mut xs: i32[]) -> void { return; }

fn main() -> void {
  let arr = [1, 2];
  push_one(mut arr);
}
`);
    const main = program.body[1];
    assert.ok(main.kind === "FunctionDeclaration");
    const call = main.body?.body[1];
    assert.ok(call?.kind === "ExpressionStatement");
    assert.ok(call.expression.kind === "CallExpression");
    const arg = call.expression.args[0];
    assert.equal(arg.kind, "MutExpression");
    assert.ok(arg.kind === "MutExpression");
    assert.equal(arg.expression.kind, "IdentifierExpression");
  });

  test("extern fn declaration without body is parsed", () => {
    const program = parseOk(`
pub extern fn panic(message: string) -> void;
extern fn add(a: i32, b: i32) -> i32;
extern "abs" fn c_abs(value: i32) -> i32;
unsafe extern "strlen" fn c_strlen(value: cstr) -> usize;
unsafe fn read(ptr: const_ptr<i32>) -> i32 {
  return unsafe { *ptr };
}
pub extern "vek_add" fn add_export(a: i32, b: i32) -> i32 {
  return a + b;
}
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "FunctionDeclaration",
      "FunctionDeclaration",
      "FunctionDeclaration",
      "FunctionDeclaration",
      "FunctionDeclaration",
      "FunctionDeclaration",
    ]);
    const imported = program.body[2];
    assert.ok(imported.kind === "FunctionDeclaration");
    assert.equal(imported.externName?.value, "abs");
    assert.equal(imported.name.name, "c_abs");
    assert.equal(imported.body, undefined);

    const unsafeImported = program.body[3];
    assert.ok(unsafeImported.kind === "FunctionDeclaration");
    assert.equal(unsafeImported.isUnsafe, true);
    assert.equal(unsafeImported.externName?.value, "strlen");

    const unsafeFunction = program.body[4];
    assert.ok(unsafeFunction.kind === "FunctionDeclaration");
    assert.equal(unsafeFunction.isUnsafe, true);
    const last = unsafeFunction.body?.body.at(-1);
    assert.ok(last?.kind === "ReturnStatement");
    assert.equal(last.value?.kind, "UnsafeBlockExpression");

    const exported = program.body[5];
    assert.ok(exported.kind === "FunctionDeclaration");
    assert.equal(exported.externName?.value, "vek_add");
    assert.equal(exported.name.name, "add_export");
    assert.ok(exported.body);
  });
});

describe("parser diagnostics", () => {
  test("E1020: missing semicolon reports error", () => {
    const result = parse("let x = 1");
    expectDiagnostics(result.parseDiagnostics, ["E1020"]);
  });

  test("E1050: rejects 'name: mut Type' parameter syntax", () => {
    const result = parse(`
fn push_one(xs: mut i32[]) -> void {
  return;
}
`);
    assert.equal(
      result.parseDiagnostics.some((diagnostic) => diagnostic.code === "E1050"),
      true,
    );
  });

  test("E1051: struct keyword in type position is rejected", () => {
    const result = parse(`let x: struct = 1;`);
    expectDiagnostics(result.parseDiagnostics, ["E1051"]);
  });

  test("E1051: let keyword in type position is rejected", () => {
    const result = parse(`let x: let = 1;`);
    expectDiagnostics(result.parseDiagnostics, ["E1051"]);
  });

  test("E1051: trait keyword in type position is rejected", () => {
    const result = parse(`let x: trait = 1;`);
    expectDiagnostics(result.parseDiagnostics, ["E1051"]);
  });

  test("E2825: pub fn inside trait body is rejected", () => {
    const result = parse(`
trait Foo {
  pub fn bar(self) -> void;
}
`);
    expectDiagnostics(result.parseDiagnostics, ["E2825"]);
  });

  test("E2825: pub fn inside satisfies block is rejected", () => {
    const result = parse(`
trait Bar { fn bar(self) -> void; }
struct Foo {
  x: i32;
  satisfies Bar {
    pub fn bar(self) -> void {}
  }
}
`);
    expectDiagnostics(result.parseDiagnostics, ["E2825"]);
  });

  test("E1030: malformed nested tuple pattern is rejected", () => {
    const result = parse(`
fn main() -> void {
  match (1, (2, 3)) {
    (a, (, b)) => {
      return;
    },
    _ => {
      return;
    },
  }
}
`);
    expectDiagnostics(result.parseDiagnostics, ["E1030"]);
  });
});
