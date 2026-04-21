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
trait Hashable {
  fn hash(self) -> u64;
}

trait Equal<T> {
  fn equals(self, other: T) -> bool;
}

fn lookup<K, V>(map: Map<K, V>, key: K) -> V?
where K: Equal<K>, K: Hashable
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

  test("extern fn declaration without body is parsed", () => {
    const program = parseOk(`
pub extern fn panic(message: string) -> void;
extern fn add(a: i32, b: i32) -> i32;
`);
    assert.deepEqual(getProgramBodyKinds(program), [
      "FunctionDeclaration",
      "FunctionDeclaration",
    ]);
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
