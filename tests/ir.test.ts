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

  test("lowers if with no else to cond_branch + join", () => {
    const ir = irOk(`
fn main() -> void {
  let x: i32 = 1;
  if x > 0 {
    return;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 3);
    assert.equal(fn.blocks[0].id, "bb.0");
    assert.equal(fn.blocks[1].id, "bb.1");
    assert.equal(fn.blocks[2].id, "bb.2");

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("bb.1"));
    assert.ok(dump.includes("bb.2"));
  });

  test("lowers if/else to cond_branch with two branches and join", () => {
    const ir = irOk(`
fn max(a: i32, b: i32) -> i32 {
  if a > b {
    return a;
  } else {
    return b;
  }
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 4);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("return local.0"));
    assert.ok(dump.includes("return local.1"));
  });

  test("lowers while loop to condition/body/exit blocks", () => {
    const ir = irOk(`
fn count() -> void {
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    assert.equal(fn.blocks.length, 4);

    const dump = dumpIr(ir);
    assert.ok(dump.includes("cond_branch"));
    assert.ok(dump.includes("branch bb."));
  });

  test("lowers break to branch to loop exit", () => {
    const ir = irOk(`
fn find() -> void {
  let i: i32 = 0;
  while i < 100 {
    if i > 50 {
      break;
    }
    i = i + 1;
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("lowers continue to branch to loop condition", () => {
    const ir = irOk(`
fn skip() -> void {
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
    if i > 5 {
      continue;
    }
  }
  return;
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const dump = dumpIr(ir);
    assert.ok(dump.includes("branch bb."));
  });

  test("panic creates unreachable terminator and dead block", () => {
    const ir = irOk(`
fn main() -> void {
  panic("boom");
}
`);

    const fn = ir.declarations[0];
    assert.ok(fn.kind === "function");
    const hasUnreachable = fn.blocks.some(
      (b) => b.terminator?.kind === "unreachable",
    );
    assert.ok(hasUnreachable);
  });

  test("validates branch targets exist", () => {
    const ir = irOk(`
fn main() -> void {
  let x: i32 = 1;
  if x > 0 {
    return;
  }
  return;
}
`);
    const result = validateIr(ir);
    assert.deepEqual(result.diagnostics, []);
  });
});
