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
    const result = check(`
fn main() -> void {
  let x = y;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2001"]);
  });

  test("bool conditions are required", () => {
    const result = check(`
fn main() -> void {
  if 1 {
    return;
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("const assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  const x: i32 = 1;
  x = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("readonly parameter assignment is rejected", () => {
    const result = check(`
fn bump(x: i32) -> void {
  x = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("nullable narrowing works for explicit checks", () => {
    checkOk(`
fn main() -> void {
  let maybe_num: i32? = 1;
  if maybe_num != null {
    let n: i32 = maybe_num;
  } else {
    let z: null = maybe_num;
  }
}
`);
  });

  test("array and string indexing", () => {
    checkOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let first: i32 = xs[0];
  let s: string = "cat";
  let c: string = s[0];
}
`);
  });

  test("invalid index target is rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  let y = x[0];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("struct literals require complete known fields", () => {
    const result = check(`
struct User {
  id: i32;
  name: string;
}

let user = User { id: 1, name: "a", id: 2 };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2002"]);
  });

  test("match expression requires wildcard arm", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  let label = match value {
    Ok(v) => v.format(),
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2606"]);
  });

  test("statement match warns on missing enum variants", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  match value {
    Ok(v) => {
      let x = v;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("statement match warns on missing bool literals", () => {
    const result = check(`
fn main() -> void {
  let value: bool = true;
  match value {
    true => {
      return;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("statement match warns on missing null arm for nullable values", () => {
    const result = check(`
fn main() -> void {
  let value: i32? = 1;
  match value {
    1 => {
      return;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("generic function inference works", () => {
    checkOk(`
fn id<T>(value: T) -> T {
  return value;
}

fn main() -> void {
  let x: i32 = id(1);
}
`);
  });

  test("generic function explicit type arguments work", () => {
    checkOk(`
fn id<T>(value: T) -> T {
  return value;
}

fn main() -> void {
  let x: i32 = id<i32>(1);
}
`);
  });

  test("generic function inference failure is diagnosed", () => {
    const result = check(`
fn keep<T>() -> i32 {
  return 1;
}

fn main() -> void {
  let x = keep();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2820"]);
  });

  test("anonymous functions may not capture outer locals", () => {
    const result = check(`
fn main() -> void {
  let offset: i32 = 2;
  let add = fn(x: i32) -> i32 {
    return x + offset;
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2813"]);
  });

  test("traits and satisfies blocks work", () => {
    checkOk(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  satisfies Printable {
    fn print(self) -> void {
      let x: i32 = self.show();
      return;
    }
  }
}

fn main() -> void {
  let user = User { id: 1 };
  user.print();
}
`);
  });

  test("custom Equal<T> satisfactions drive ==", () => {
    checkOk(`
struct UserId {
  value: i32;

  fn new(value: i32) -> Self {
    return Self { value };
  }

  satisfies Equal<UserId> {
    fn equals(self, other: UserId) -> bool {
      return self.value == other.value;
    }
  }
}

fn same<T>(left: T, right: T) -> bool
where T: Equal<T>
{
  return left == right;
}

fn main() -> void {
  let a = UserId.new(1);
  let b = UserId.new(1);
  let ok: bool = same(a, b);
}
`);
  });

  test("structs without Equal<T> cannot use ==", () => {
    const result = check(`
struct UserId {
  value: i32;
}

fn main() -> void {
  let left = UserId { value: 1 };
  let right = UserId { value: 1 };
  let same = left == right;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("trait method mismatch is diagnosed", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  id: i32;

  satisfies Printable {
    fn print(self) -> i32 {
      return self.id;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2815"]);
  });

  test("enum methods may use Self and enum payloads", () => {
    checkOk(`
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

fn main() -> void {
  let state = State.busy(1);
  let value: i32? = state.value();
}
`);
  });

  test("type-qualified method references work", () => {
    checkOk(`
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  fn new(id: i32) -> Self {
    return Self { id };
  }
}

fn main() -> void {
  let f: fn(User) -> i32 = User.show;
  let g: fn(i32) -> User = User.new;
  let user = g(1);
  let x: i32 = f(user);
}
`);
  });

  test("for loops use array iteration item types", () => {
    checkOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  for item in xs {
    let x: i32 = item;
  }
}
`);
  });

  test("for loops use custom Iterable<T> item types", () => {
    checkOk(`
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

fn main() -> void {
  let counter = Counter.new(3);
  for item in counter {
    let x: i32 = item;
  }
}
`);
  });
});
