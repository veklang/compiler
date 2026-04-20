import { assert, expectDiagnostics, initCheck } from "./helpers";
import { describe, test } from "./tester";

describe("top-level initializer cycle detection", () => {
  test("independent declarations produce no diagnostics", () => {
    const { diagnostics } = initCheck(`
let a: i32 = 1;
let b: i32 = 2;
`);
    assert.equal(diagnostics.length, 0);
  });

  test("forward reference without cycle is fine", () => {
    const { diagnostics } = initCheck(`
let a: i32 = 1;
let b: i32 = a + 1;
`);
    assert.equal(diagnostics.length, 0);
  });

  test("self-cycle emits E2700", () => {
    const { diagnostics } = initCheck(`
let a: i32 = a;
`);
    expectDiagnostics(diagnostics, ["E2700"]);
  });

  test("direct two-way cycle emits E2700", () => {
    const { diagnostics } = initCheck(`
let a: i32 = b;
let b: i32 = a;
`);
    expectDiagnostics(diagnostics, ["E2700"]);
  });

  test("transitive three-way cycle emits E2700", () => {
    const { diagnostics } = initCheck(`
let a: i32 = b;
let b: i32 = c;
let c: i32 = a;
`);
    expectDiagnostics(diagnostics, ["E2700"]);
  });

  test("two independent cycles each emit E2700", () => {
    const { diagnostics } = initCheck(`
let a: i32 = b;
let b: i32 = a;
let c: i32 = d;
let d: i32 = c;
`);
    expectDiagnostics(diagnostics, ["E2700", "E2700"]);
  });

  test("cycle among subset does not affect non-cyclic declarations", () => {
    const { diagnostics } = initCheck(`
let x: i32 = 1;
let a: i32 = b;
let b: i32 = a;
let y: i32 = x + 1;
`);
    expectDiagnostics(diagnostics, ["E2700"]);
  });

  test("function declarations are not tracked as initializer deps", () => {
    const { diagnostics } = initCheck(`
fn foo() -> i32 { return 0; }
let a: i32 = foo();
let b: i32 = a + 1;
`);
    assert.equal(diagnostics.length, 0);
  });

  test("closure body references are not treated as eager deps", () => {
    const { diagnostics } = initCheck(`
let a: i32 = 1;
let f = fn() -> i32 { return a; };
`);
    assert.equal(diagnostics.length, 0);
  });

  test("cycle error message includes the cycle path", () => {
    const { diagnostics } = initCheck(`
let x: i32 = y;
let y: i32 = x;
`);
    assert.equal(diagnostics.length, 1);
    assert.ok(
      diagnostics[0].message.includes("x") &&
        diagnostics[0].message.includes("y"),
      `expected cycle path in message, got: ${diagnostics[0].message}`,
    );
    assert.equal(diagnostics[0].code, "E2700");
  });

  test("top-level const declarations are also checked", () => {
    const { diagnostics } = initCheck(`
const a: i32 = b;
const b: i32 = a;
`);
    expectDiagnostics(diagnostics, ["E2700"]);
  });

  test("declaration without initializer is not tracked", () => {
    const { diagnostics } = initCheck(`
let a: i32 = 1;
`);
    assert.equal(diagnostics.length, 0);
  });
});
