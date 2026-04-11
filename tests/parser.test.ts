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
import Map from "std:collections";
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

  test("anonymous functions are parsed", () => {
    const program = parseOk(`
let add_one = fn(x: i32) -> i32 {
  return x + 1;
};
`);
    assert.equal(program.body[0].kind, "VariableDeclaration");
  });

  test("missing semicolon reports error", () => {
    const result = parse("let x = 1");
    expectDiagnostics(result.parseDiagnostics, ["E1020"]);
  });
});
