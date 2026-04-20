import { dumpIr } from "@/ir/dump";
import { lowerProgramToIr } from "@/ir/lower";
import { validateIr } from "@/ir/validate";
import {
  assert,
  check,
  expectNoCheckDiagnostics,
  expectNoDiagnostics,
} from "./helpers";
import { describe, test } from "./tester";

const irOk = (source: string) => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  expectNoCheckDiagnostics(result.checkDiagnostics);
  const ir = lowerProgramToIr(result.program, result);
  const validation = validateIr(ir);
  assert.deepEqual(validation.diagnostics, []);
  return ir;
};

describe("ir", () => {
  test("lowers a void main function", () => {
    const ir = irOk(`
fn main() -> void {
  return;
}
`);

    assert.equal(ir.entry, "fn.main");
    assert.equal(ir.declarations.length, 1);
    assert.equal(ir.runtime.panic, false);
    assert.equal(ir.runtime.strings, false);
  });

  test("lowers locals, binary expressions, and typed returns", () => {
    const ir = irOk(`
fn add(a: i32, b: i32) -> i32 {
  let sum: i32 = a + b;
  return sum;
}
`);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("fn fn.add add(a: i32, b: i32) -> i32"));
    assert.ok(dump.includes("tmp.0: i32 = local.0 + local.1"));
    assert.ok(dump.includes("return local.2"));
  });

  test("records runtime requirements for panic and strings", () => {
    const ir = irOk(`
fn main() -> void {
  panic("boom");
}
`);

    assert.equal(ir.runtime.panic, true);
    assert.equal(ir.runtime.strings, true);
    assert.ok(dumpIr(ir).includes('call @panic("boom")'));
  });
});
