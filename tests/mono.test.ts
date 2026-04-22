import { mangleName, mangleType } from "@/passes/mono";
import { assert, mono } from "./helpers";
import { describe, test } from "./tester";

describe("monomorphization", () => {
  // --- mangling helpers ---

  test("mangleType: primitives pass through", () => {
    assert.equal(mangleType("i32"), "i32");
    assert.equal(mangleType("bool"), "bool");
    assert.equal(mangleType("string"), "string");
  });

  test("mangleType: generic instantiation", () => {
    assert.equal(mangleType("Array<i32>"), "Array_i32");
    assert.equal(mangleType("Result<i32, string>"), "Result_i32_string");
  });

  test("mangleType: nullable", () => {
    assert.equal(mangleType("i32?"), "opt_i32");
    assert.equal(mangleType("Foo?"), "opt_Foo");
  });

  test("mangleType: tuple", () => {
    assert.equal(mangleType("(i32, bool)"), "tuple_i32_bool");
  });

  test("mangleName: no type args returns base unchanged", () => {
    assert.equal(mangleName("identity", []), "identity");
  });

  test("mangleName: single type arg", () => {
    assert.equal(mangleName("identity", ["i32"]), "identity__i32");
  });

  test("mangleName: multiple type args", () => {
    assert.equal(mangleName("swap", ["i32", "bool"]), "swap__i32__bool");
  });

  // --- generic function instantiations ---

  test("generic function call produces a specialization", () => {
    const { specializations, checkDiagnostics } = mono(`
fn identity<T>(x: T) -> T {
  return x;
}
fn main() -> void {
  let _a = identity(42);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find(
      (s) => s.originalName === "identity" && s.typeArgs[0] === "i32",
    );
    assert.ok(spec, "expected identity<i32> specialization");
    assert.equal(spec!.kind, "Function");
    assert.equal(spec!.mangledName, "identity__i32");
  });

  test("duplicate calls produce one specialization", () => {
    const { specializations } = mono(`
fn identity<T>(x: T) -> T {
  return x;
}
fn main() -> void {
  let _a = identity(1);
  let _b = identity(2);
}
`);
    const specs = specializations.filter(
      (s) => s.originalName === "identity" && s.typeArgs[0] === "i32",
    );
    assert.equal(specs.length, 1);
  });

  test("distinct type args produce distinct specializations", () => {
    const { specializations } = mono(`
fn identity<T>(x: T) -> T {
  return x;
}
fn main() -> void {
  let _a = identity(1);
  let _b = identity(true);
}
`);
    const i32 = specializations.find(
      (s) => s.originalName === "identity" && s.typeArgs[0] === "i32",
    );
    const boolSpec = specializations.find(
      (s) => s.originalName === "identity" && s.typeArgs[0] === "bool",
    );
    assert.ok(i32, "expected identity<i32>");
    assert.ok(boolSpec, "expected identity<bool>");
    assert.equal(i32!.mangledName, "identity__i32");
    assert.equal(boolSpec!.mangledName, "identity__bool");
  });

  test("multi-param generic function", () => {
    const { specializations, checkDiagnostics } = mono(`
fn pair<T, U>(a: T, b: U) -> (T, U) {
  return (a, b);
}
fn main() -> void {
  let _r = pair(1, true);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find((s) => s.originalName === "pair");
    assert.ok(spec, "expected pair specialization");
    assert.deepEqual(spec!.typeArgs, ["i32", "bool"]);
    assert.equal(spec!.mangledName, "pair__i32__bool");
  });

  // --- generic struct instantiations ---

  test("generic struct literal produces a specialization", () => {
    const { specializations, checkDiagnostics } = mono(`
struct Pair<T> {
  value: T;
}
fn main() -> void {
  let _p = Pair { value: 42 };
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find(
      (s) => s.kind === "Struct" && s.originalName === "Pair",
    );
    assert.ok(spec, "expected Pair<i32> specialization");
    assert.deepEqual(spec!.typeArgs, ["i32"]);
    assert.equal(spec!.mangledName, "Pair__i32");
  });

  test("generic struct: distinct type args produce distinct specializations", () => {
    const { specializations } = mono(`
struct Box<T> {
  value: T;
}
fn main() -> void {
  let _a = Box { value: 1 };
  let _b = Box { value: true };
}
`);
    const i32 = specializations.find(
      (s) => s.kind === "Struct" && s.typeArgs[0] === "i32",
    );
    const boolSpec = specializations.find(
      (s) => s.kind === "Struct" && s.typeArgs[0] === "bool",
    );
    assert.ok(i32, "expected Box<i32>");
    assert.ok(boolSpec, "expected Box<bool>");
  });

  test("generic enum variants produce enum specializations", () => {
    const { specializations, checkDiagnostics } = mono(`
enum Option<T> {
  Some(T);
  None;
}
fn main() -> void {
  let _a: Option<i32> = Some(1);
  let _b: Option<bool> = Some(true);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const i32 = specializations.find(
      (s) => s.kind === "Enum" && s.typeArgs[0] === "i32",
    );
    const boolSpec = specializations.find(
      (s) => s.kind === "Enum" && s.typeArgs[0] === "bool",
    );
    assert.ok(i32, "expected Option<i32>");
    assert.ok(boolSpec, "expected Option<bool>");
    assert.equal(i32!.mangledName, "Option__i32");
    assert.equal(boolSpec!.mangledName, "Option__bool");
  });

  // --- method instantiations ---

  test("generic method call produces a Method specialization", () => {
    const { specializations, checkDiagnostics } = mono(`
struct Container {
  count: i32;

  fn map<T>(self, x: T) -> T {
    return x;
  }
}
fn main() -> void {
  let c = Container { count: 0 };
  let _v = c.map(42);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find(
      (s) => s.kind === "Method" && s.originalName === "map",
    );
    assert.ok(spec, "expected map<i32> method specialization");
    assert.equal(spec!.ownerName, "Container");
    assert.deepEqual(spec!.typeArgs, ["i32"]);
    assert.equal(spec!.mangledName, "Container__map__i32");
  });

  test("generic method on generic owner records owner and method type args", () => {
    const { specializations, checkDiagnostics } = mono(`
struct Box<T> {
  value: T;

  fn pair<U>(self, other: U) -> (T, U) {
    return (self.value, other);
  }
}
fn main() -> void {
  let b: Box<i32> = Box { value: 4 };
  let _p: (i32, bool) = b.pair(true);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find(
      (s) => s.kind === "Method" && s.originalName === "pair",
    );
    assert.ok(spec, "expected Box<i32>.pair<bool> method specialization");
    assert.equal(spec!.ownerName, "Box");
    assert.deepEqual(spec!.ownerTypeArgs, ["i32"]);
    assert.deepEqual(spec!.typeArgs, ["bool"]);
    assert.equal(spec!.mangledName, "Box__i32_pair__bool");
  });

  test("generic method on generic enum owner records owner and method type args", () => {
    const { specializations, checkDiagnostics } = mono(`
enum Option<T> {
  Some(T);
  None;

  fn pair<U>(self, other: U) -> (Self, U) {
    return (self, other);
  }
}
fn main() -> void {
  let value: Option<i32> = Some(4);
  let _p: (Option<i32>, bool) = value.pair(true);
}
`);
    assert.equal(
      checkDiagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const spec = specializations.find(
      (s) => s.kind === "Method" && s.originalName === "pair",
    );
    assert.ok(spec, "expected Option<i32>.pair<bool> method specialization");
    assert.equal(spec!.ownerName, "Option");
    assert.deepEqual(spec!.ownerTypeArgs, ["i32"]);
    assert.deepEqual(spec!.typeArgs, ["bool"]);
    assert.equal(spec!.mangledName, "Option__i32_pair__bool");
  });

  // --- non-generic code is not recorded ---

  test("non-generic calls produce no specializations", () => {
    const { specializations } = mono(`
fn add(a: i32, b: i32) -> i32 {
  return a + b;
}
fn main() -> void {
  let _r = add(1, 2);
}
`);
    assert.equal(specializations.length, 0);
  });
});
