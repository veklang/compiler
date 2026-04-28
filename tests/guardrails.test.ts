import { lowerProgramToIr } from "@/ir/lower";
import { assert, check, expectNoDiagnostics } from "./helpers";
import { describe, test } from "./tester";

const lowerCodes = (source: string): string[] => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  const { diagnostics } = lowerProgramToIr(result.program, result);
  return diagnostics.map((d) => d.code ?? "");
};

describe("lowerer guardrails", () => {
  test("E3005: equality on struct without Equal impl", () => {
    assert.deepEqual(
      lowerCodes(`
struct Point { x: i32; y: i32; }
fn main() -> bool {
  let a: Point = Point { x: 1, y: 2 };
  let b: Point = Point { x: 3, y: 4 };
  return a == b;
}
`),
      ["E3005"],
    );
  });

  test("E3005: inequality on struct without Equal impl", () => {
    assert.deepEqual(
      lowerCodes(`
struct Tag { id: i32; }
fn main() -> bool {
  let a: Tag = Tag { id: 1 };
  let b: Tag = Tag { id: 2 };
  return a != b;
}
`),
      ["E3005"],
    );
  });

  test("E3003: nested field assignment is rejected", () => {
    assert.deepEqual(
      lowerCodes(`
struct Inner { x: i32; }
struct Outer { inner: Inner; }
fn main() -> void {
  let o: Outer = Outer { inner: Inner { x: 1 } };
  o.inner.x = 2;
  return;
}
`),
      ["E3003"],
    );
  });

  test("no diagnostic: equality on struct with Equal impl", () => {
    assert.deepEqual(
      lowerCodes(`
struct Point {
  x: i32;
  y: i32;
  satisfies Equal<Point> {
    fn equals(self, other: Point) -> bool {
      return self.x == other.x && self.y == other.y;
    }
  }
}
fn main() -> bool {
  let a: Point = Point { x: 1, y: 2 };
  let b: Point = Point { x: 1, y: 2 };
  return a == b;
}
`),
      [],
    );
  });
});
