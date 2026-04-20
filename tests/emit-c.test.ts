import { emitC } from "@/emit/c";
import { lowerProgramToIr } from "@/ir/lower";
import {
  assert,
  check,
  expectNoCheckDiagnostics,
  expectNoDiagnostics,
} from "./helpers";
import { describe, test } from "./tester";

const emitOk = (source: string) => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  expectNoCheckDiagnostics(result.checkDiagnostics);
  return emitC(lowerProgramToIr(result.program, result));
};

describe("C emitter", () => {
  test("emits includes and a C main wrapper for void main", () => {
    const c = emitOk(`
fn main() -> void {
  return;
}
`);

    assert.ok(c.includes("#include <stdbool.h>"));
    assert.ok(c.includes("#include <stdint.h>"));
    assert.ok(c.includes("#define VEK_RUNTIME_IMPLEMENTATION"));
    assert.ok(c.includes('#include "../runtime/dist/vek_runtime.h"'));
    assert.ok(c.includes("static void __vek_fn_main(void);"));
    assert.ok(c.includes("static void __vek_fn_main(void) {"));
    assert.ok(c.includes("int main(void) {"));
    assert.ok(c.includes("  __vek_fn_main();"));
    assert.ok(c.includes("  return 0;"));
  });

  test("emits primitive locals, arithmetic, and typed returns", () => {
    const c = emitOk(`
fn add(a: i32, b: i32) -> i32 {
  let sum: i32 = a + b;
  return sum;
}
`);

    assert.ok(
      c.includes("static int32_t __vek_fn_add(int32_t v0, int32_t v1);"),
    );
    assert.ok(c.includes("int32_t v2;"));
    assert.ok(c.includes("int32_t t0 = v0 + v1;"));
    assert.ok(c.includes("v2 = t0;"));
    assert.ok(c.includes("return v2;"));
  });

  test("lowers panic to the runtime helper", () => {
    const c = emitOk(`
fn main() -> void {
  panic("boom");
}
`);

    assert.ok(c.includes('__vek_panic_cstr("boom");'));
  });

  test("rejects f16 during C emission", () => {
    const result = check(`
fn half(x: f16) -> f16 {
  return x;
}
`);
    expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
    expectNoCheckDiagnostics(result.checkDiagnostics);
    const ir = lowerProgramToIr(result.program, result);

    assert.throws(() => emitC(ir), /f16/);
  });
});
