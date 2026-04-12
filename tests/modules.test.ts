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
  test("resolves namespace imports with extensionless relative paths", () => {
    withProject(
      {
        "main.vek": `
import "./math" as math;
fn main() -> void { return; }
`,
        "math/index.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
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
import "foo:bar" as x;
fn main() -> void { return; }
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
import "./missing" as x;
fn main() -> void { return; }
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
import hidden, shown from "./lib";
fn main() -> void { return; }
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

  test("named imports require exported symbols only", () => {
    withProject(
      {
        "main.vek": `
import add, pi from "./lib";
fn main() -> void { return; }
`,
        "lib.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
pub const pi: i32 = 3;
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
import shown from "./lib";
fn main() -> void { return; }
`,
        "lib.vek": `
pub const shown: i32 = 1;
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
import "./lib" as lib;
fn main() -> void { return; }
`,
        "lib/index": `
pub const shown: i32 = 1;
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
import "./a" as a;
fn main() -> void { return; }
`,
        "a.vek": `
import "./b" as b;
pub fn a_fn() -> i32 { return 1; }
`,
        "b.vek": `
import "./a" as a;
pub fn b_fn() -> i32 { return 2; }
`,
      },
      (entry) => {
        assert.deepEqual(codes(entry), []);
      },
    );
  });
});
