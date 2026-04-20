import { assert, expectDiagnostics, reach } from "./helpers";
import { describe, test } from "./tester";

describe("reachability", () => {
  test("main is always a root", () => {
    const { reachableNames } = reach(`
fn main() -> void {
  return;
}
`);
    assert.ok(reachableNames.has("main"));
  });

  test("pub declarations are always roots", () => {
    const { reachableNames } = reach(`
pub fn helper() -> void {
  return;
}
`);
    assert.ok(reachableNames.has("helper"));
  });

  test("function called from main is reachable", () => {
    const { reachableNames } = reach(`
fn greet() -> void {
  return;
}

fn main() -> void {
  greet();
}
`);
    assert.ok(reachableNames.has("greet"));
    assert.ok(reachableNames.has("main"));
  });

  test("struct referenced in main body is reachable", () => {
    const { reachableNames } = reach(`
struct Point {
  x: i32;
  y: i32;
}

fn main() -> void {
  let p: Point = Point { x: 0, y: 0 };
}
`);
    assert.ok(reachableNames.has("Point"));
  });

  test("enum referenced via variant in match is reachable", () => {
    const { reachableNames } = reach(`
enum Color {
  Red;
  Green;
  Blue;
}

fn main() -> void {
  let c: Color = Red;
  match c {
    Red => { return; },
    _ => { return; },
  }
}
`);
    assert.ok(reachableNames.has("Color"));
  });

  test("type alias used in annotation is reachable", () => {
    const { reachableNames } = reach(`
type Num = i32;

fn main() -> void {
  let x: Num = 1;
}
`);
    assert.ok(reachableNames.has("Num"));
  });

  test("transitively reachable function is reachable", () => {
    const { reachableNames } = reach(`
fn leaf() -> void { return; }
fn middle() -> void { leaf(); }
fn main() -> void { middle(); }
`);
    assert.ok(reachableNames.has("leaf"));
    assert.ok(reachableNames.has("middle"));
    assert.ok(reachableNames.has("main"));
  });

  test("names beginning with _ suppress the warning", () => {
    const { diagnostics } = reach(`
fn _unused() -> void { return; }
fn main() -> void { return; }
`);
    assert.equal(diagnostics.length, 0);
  });

  test("trait referenced in where clause makes it reachable", () => {
    const { reachableNames } = reach(`
trait Printable {
  fn print(self) -> void;
}

fn show<T>(x: T) -> void where T: Printable {
  return;
}

fn main() -> void {
  show<i32>(1);
}
`);
    assert.ok(reachableNames.has("Printable"));
  });

  test("pub item not in main is still reachable (pub is always a root)", () => {
    const { reachableNames, diagnostics } = reach(`
pub struct Config {
  value: i32;
}
`);
    assert.ok(reachableNames.has("Config"));
    assert.equal(diagnostics.length, 0);
  });

  test("function reachable only through type annotation", () => {
    const { reachableNames } = reach(`
fn compute() -> i32 { return 1; }

fn main() -> void {
  let f: fn() -> i32 = compute;
}
`);
    assert.ok(reachableNames.has("compute"));
  });
});

describe("reachability diagnostics", () => {
  test("W2900: unused private function gets W2900 warning", () => {
    const { diagnostics } = reach(`
fn unused() -> void {
  return;
}

fn main() -> void {
  return;
}
`);
    expectDiagnostics(diagnostics, ["W2900"]);
  });

  test("W2900: multiple unused private declarations each get a warning", () => {
    const { diagnostics } = reach(`
fn unused_a() -> void { return; }
fn unused_b() -> void { return; }

fn main() -> void { return; }
`);
    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.every((d) => d.code === "W2900"));
  });

  test("W2900: unreachable struct gets warning", () => {
    const { diagnostics } = reach(`
struct Unused {
  x: i32;
}

fn main() -> void { return; }
`);
    expectDiagnostics(diagnostics, ["W2900"]);
    assert.equal(diagnostics[0].message, "Declaration 'Unused' is never used.");
  });

  test("W2900: unreachable trait gets warning", () => {
    const { diagnostics } = reach(`
trait Unused {
  fn method(self) -> void;
}

fn main() -> void { return; }
`);
    expectDiagnostics(diagnostics, ["W2900"]);
  });
});
