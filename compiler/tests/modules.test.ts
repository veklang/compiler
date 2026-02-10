import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkModuleGraph } from "@/core/modules";
import { assert } from "./helpers";
import { describe, test } from "./tester";

const withProject = (
  files: Record<string, string>,
  run: (entry: string) => void,
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vek-modules-"));
  try {
    for (const [relPath, source] of Object.entries(files)) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, source, "utf8");
    }
    run(path.join(root, "main.vek"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const codes = (entry: string) =>
  checkModuleGraph(entry).diagnostics.map((d) => d.code ?? "");

describe("modules", () => {
  test("resolves relative imports with extensionless path", () => {
    withProject(
      {
        "main.vek": `
import math from "./math";
fn main(): void { return; }
`,
        "math/index.vek": `
pub fn add(a: i32, b: i32): i32 { return a + b; }
pub default add;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });

  test("rejects non-std package imports", () => {
    withProject(
      {
        "main.vek": `
import x from "foo:bar";
fn main(): void { return; }
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2706"]);
      },
    );
  });

  test("errors when module is not found", () => {
    withProject(
      {
        "main.vek": `
import x from "./missing";
fn main(): void { return; }
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2707"]);
      },
    );
  });

  test("named import requires exported symbol", () => {
    withProject(
      {
        "main.vek": `
import { hidden, shown } from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
const hidden: i32 = 1;
pub const shown: i32 = 2;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2702"]);
      },
    );
  });

  test("default import requires default export", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
pub fn add(a: i32, b: i32): i32 { return a + b; }
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2704"]);
      },
    );
  });

  test("default export list symbols must be public", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
fn hidden(): i32 { return 1; }
pub default hidden;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2705"]);
      },
    );
  });

  test("default export star is accepted and exports pub symbols snapshot", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
pub fn add(a: i32, b: i32): i32 { return a + b; }
const hidden: i32 = 1;
pub default *;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });

  test("resolves to path.vek variant", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
pub default 1;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });

  test("resolves to path/index variant without extension", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib/index": `
pub default 1;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });

  test("handles cyclic imports without hanging", () => {
    withProject(
      {
        "main.vek": `
import a from "./a";
fn main(): void { return; }
`,
        "a.vek": `
import b from "./b";
pub fn a_fn(): i32 { return 1; }
pub default a_fn;
`,
        "b.vek": `
import a from "./a";
pub fn b_fn(): i32 { return 2; }
pub default b_fn;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });

  test("default export list with mixed visibility fails on private symbols", () => {
    withProject(
      {
        "main.vek": `
import lib from "./lib";
fn main(): void { return; }
`,
        "lib.vek": `
pub fn shown(): i32 { return 1; }
fn hidden(): i32 { return 2; }
pub default shown, hidden;
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), ["E2705"]);
      },
    );
  });
});
