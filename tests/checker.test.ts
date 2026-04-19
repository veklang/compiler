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

  test("const nested mutation is rejected", () => {
    const result = check(`
struct User {
  id: i32;
}

fn main() -> void {
  const user = User { id: 1 };
  user.id = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("const array element assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  const xs: i32[] = [1, 2, 3];
  xs[0] = 9;
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

  test("readonly parameter nested mutation is rejected", () => {
    const result = check(`
struct User {
  id: i32;
}

fn bump(user: User) -> void {
  user.id = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("mutating methods may not be called through const receivers", () => {
    const result = check(`
struct Counter {
  value: i32;

  fn bump(mut self) -> void {
    self.value = self.value + 1;
  }
}

fn main() -> void {
  const counter = Counter { value: 1 };
  counter.bump();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("mutating methods may not be called through readonly parameters", () => {
    const result = check(`
struct Counter {
  value: i32;

  fn bump(mut self) -> void {
    self.value = self.value + 1;
  }
}

fn tick(counter: Counter) -> void {
  counter.bump();
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

  test("nullable aliases narrow like their underlying types", () => {
    checkOk(`
type MaybeI32 = i32?;

fn main() -> void {
  const maybe_num: MaybeI32 = 1;
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

  test("integer literals in expressions use the expected integer type", () => {
    checkOk(`
fn main() -> void {
  let x: i8 = -128;
  let y: i8 = 1 + 2;
}
`);
  });

  test("bitwise operators require integers", () => {
    const result = check(`
fn main() -> void {
  let x = 1.0 & 2.0;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("compile-time invalid shifts are rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i8 = 1 << 8;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2403"]);
  });

  test("compile-time integer overflow is rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i8 = 127 + 1;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2402"]);
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

  test("member access on invalid receivers is rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  let y = x.name;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("tuple element assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  let pair: (i32, i32) = (1, 2);
  pair.0 = 3;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2504"]);
  });

  test("empty arrays require contextual element types", () => {
    const result = check(`
fn main() -> void {
  let xs = [];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2102"]);
  });

  test("bad arguments are still checked when the callee is not callable", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  x(1 + true);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2207", "E2101"]);
  });

  test("bad arithmetic in imported-call arguments is still diagnosed", () => {
    const result = check(`
import "std:io" as io;

fn main() -> void {
  io.print(1 + true);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104", "E2101"]);
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

  test("nullable enum matches accept enum and null patterns", () => {
    checkOk(`
fn main() -> void {
  let value: Result<i32, string>? = Ok(1);

  match value {
    Ok(v) => {
      let x: i32 = v;
    },
    Err(e) => {
      let y: string = e;
    },
    null => {
      return;
    },
  }
}
`);
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

  test("statement match warns on unbounded domains without wildcard", () => {
    const result = check(`
fn main() -> void {
  let value: i32 = 1;
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

  test("function return types are inferred by default", () => {
    checkOk(`
fn add(x: i32, y: i32) {
  return x + y;
}

fn main() -> void {
  let value: i32 = add(1, 2);
}
`);
  });

  test("inferred return types reject inconsistent branches", () => {
    const result = check(`
fn pick(flag: bool) {
  if flag {
    return 1;
  }
  return "bad";
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
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

  test("anonymous function return type is inferred without annotation", () => {
    checkOk(`
fn main() -> void {
  let add = fn(x: i32, y: i32) {
    return x + y;
  };
  let result: i32 = add(1, 2);
}
`);
  });

  test("anonymous function inferred return type is used at call sites", () => {
    checkOk(`
fn apply(f: fn(i32) -> i32, x: i32) -> i32 {
  return f(x);
}

fn main() -> void {
  let double = fn(x: i32) {
    return x * 2;
  };
  let result: i32 = apply(double, 3);
}
`);
  });

  test("anonymous function with no return infers void", () => {
    checkOk(`
fn main() -> void {
  let noop = fn(x: i32) {
    let _ = x;
    return;
  };
  noop(1);
}
`);
  });

  test("anonymous function inferred return type rejects inconsistent branches", () => {
    const result = check(`
fn main() -> void {
  let pick = fn(flag: bool) {
    if flag {
      return 1;
    }
    return "bad";
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
  });

  test("anonymous function with explicit return annotation still uses annotation", () => {
    checkOk(`
fn main() -> void {
  let f: fn(i32) -> i32 = fn(x: i32) -> i32 {
    return x + 1;
  };
}
`);
  });

  test("anonymous function may not capture outer locals", () => {
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

  test("type-parameter methods resolve through trait bounds", () => {
    checkOk(`
trait Named {
  fn name(self) -> string;
}

struct User {
  name_value: string;

  satisfies Named {
    fn name(self) -> string {
      return self.name_value;
    }
  }
}

fn render<T>(value: T) -> string
where T: Named
{
  return value.name();
}

fn main() -> void {
  let user = User { name_value: "ducc" };
  let label: string = render(user);
}
`);
  });

  test("trait names are rejected as parameter types", () => {
    const result = check(`
trait Named {
  fn name(self) -> string;
}

fn render(value: Named) -> string {
  return value.name();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2818", "E2104"]);
  });

  test("ambiguous type-parameter methods are diagnosed", () => {
    const result = check(`
trait LeftName {
  fn name(self) -> string;
}

trait RightName {
  fn name(self) -> string;
}

fn render<T>(value: T) -> string
where T: LeftName, T: RightName
{
  return value.name();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2819"]);
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

  test("duplicate satisfies blocks for the same trait are rejected", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  name: string;

  satisfies Printable {
    fn print(self) -> void {
      return;
    }
  }

  satisfies Printable {
    fn print(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
  });

  test("trait methods may not conflict with inherent methods", () => {
    const result = check(`
trait Printable {
  fn show(self) -> void;
}

struct User {
  name: string;

  fn show(self) -> void {
    return;
  }

  satisfies Printable {
    fn show(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
  });

  test("multiple satisfied traits may not expose the same method name", () => {
    const result = check(`
trait Left {
  fn show(self) -> void;
}

trait Right {
  fn show(self) -> void;
}

struct User {
  name: string;

  satisfies Left {
    fn show(self) -> void {
      return;
    }
  }

  satisfies Right {
    fn show(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
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

  test("generic owner methods use concrete type arguments", () => {
    checkOk(`
trait Measure<T> {
  fn compare(self, other: T) -> Ordering;
}

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

  satisfies Measure<UserId> {
    fn compare(self, other: UserId) -> Ordering {
      if self.value < other.value {
        return Less;
      }

      if self.value > other.value {
        return Greater;
      }

      return Equal;
    }
  }
}

enum Packet<T> {
  Empty;
  Data(T);

  fn take(self) -> T? {
    return match self {
      Data(value) => value,
      _ => null,
    };
  }
}

fn main() -> void {
  let packet: Packet<UserId> = Data(UserId.new(1));
  let taken = packet.take();

  if taken != null {
    let same = taken.equals(UserId.new(1));
    let ordering = taken.compare(UserId.new(2));
    if same {
      let _label = match ordering {
        Less => "less",
        Equal => "equal",
        _ => "greater",
      };
    }
  }
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

  test("numeric casts are accepted", () => {
    checkOk(`
fn main() -> void {
  let a: i64 = 1 as i64;
  let b: f32 = 1 as f32;
  let c: i32 = 9 as i32;
  let d: u8 = 255 as u8;
}
`);
  });

  test("bool cast to integer is rejected", () => {
    const result = check(`
fn main() -> void {
  let x = true as i32;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("integer cast to bool is rejected", () => {
    const result = check(`
fn main() -> void {
  let x = 1 as bool;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("null cast is rejected", () => {
    const result = check(`
fn main() -> void {
  let x = null as i32;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("generic function value assigned to matching bounded type is accepted", () => {
    checkOk(`
trait Printable {
  fn print(self) -> void;
}

fn show<T: Printable>(a: T) -> void {
  a.print();
}

fn main() -> void {
  let f: fn<T: Printable>(T) -> void = show;
}
`);
  });

  test("generic function value assigned to differently bounded type is rejected", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

trait Loggable {
  fn log(self) -> void;
}

fn show<T: Printable>(a: T) -> void {
  a.print();
}

fn main() -> void {
  let f: fn<T: Loggable>(T) -> void = show;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });
});
