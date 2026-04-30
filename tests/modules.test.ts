import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Checker } from "@/core/checker";
import {
  buildMergedProgram,
  checkModuleGraph,
  loadModuleGraph,
  makeNodeHost,
} from "@/core/modules";
import { compileFile, parseCliArgs } from "@/index";
import { assert } from "./helpers";
import { describe, test } from "./tester";

const hasCc = () =>
  spawnSync("command -v cc", {
    shell: true,
    encoding: "utf8",
    stdio: "pipe",
  }).status === 0;

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

const withPackageProject = (
  projectFiles: Record<string, string>,
  packages: Record<string, Record<string, string>>,
  run: (entry: string, pkgDirs: Record<string, string>) => void,
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vek-modules-"));
  const pkgDirs: Record<string, string> = {};
  try {
    for (const [relPath, source] of Object.entries(projectFiles)) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, source, "utf8");
    }
    for (const [pkgName, files] of Object.entries(packages)) {
      const pkgDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `vek-pkg-${pkgName}-`),
      );
      pkgDirs[pkgName] = pkgDir;
      fs.writeFileSync(
        path.join(pkgDir, "package.toml"),
        `name = "${pkgName}"\nversion = "0.1.0"\n`,
        "utf8",
      );
      for (const [relPath, source] of Object.entries(files)) {
        const fullPath = path.join(pkgDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, source, "utf8");
      }
    }
    run(path.join(root, "main.vek"), pkgDirs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    for (const dir of Object.values(pkgDirs)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

describe("modules diagnostics", () => {
  test("E2706: rejects non-std package imports", () => {
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

  test("E2707: errors when module is not found", () => {
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

  test("E2702: named import requires exported symbol", () => {
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
});

describe("multi-file compilation", () => {
  test("named import: checker resolves cross-module function type", () => {
    withProject(
      {
        "main.vek": `
import add from "./math";
fn main() -> i32 { return add(1, 2); }
`,
        "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
      },
      (entry) => {
        const graph = loadModuleGraph(entry);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
        const { program, namespaceImportExports } = buildMergedProgram(graph);
        const checked = new Checker(
          program,
          namespaceImportExports,
        ).checkProgram();
        assert.deepEqual(
          checked.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("namespace import: checker resolves member access type", () => {
    withProject(
      {
        "main.vek": `
import "./math" as math;
fn main() -> i32 { return math.add(1, 2); }
`,
        "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
      },
      (entry) => {
        const graph = loadModuleGraph(entry);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
        const { program, namespaceImportExports } = buildMergedProgram(graph);
        const checked = new Checker(
          program,
          namespaceImportExports,
        ).checkProgram();
        assert.deepEqual(
          checked.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("E2104: namespace member access on non-exported name", () => {
    withProject(
      {
        "main.vek": `
import "./math" as math;
fn main() -> i32 { return math.hidden(1, 2); }
`,
        "math.vek": `
fn hidden(a: i32, b: i32) -> i32 { return a + b; }
`,
      },
      (entry) => {
        const graph = loadModuleGraph(entry);
        const { program, namespaceImportExports } = buildMergedProgram(graph);
        const checked = new Checker(
          program,
          namespaceImportExports,
        ).checkProgram();
        assert.ok(
          checked.diagnostics.some((d) => d.code === "E2104"),
          "expected E2104 for accessing non-exported member",
        );
      },
    );
  });

  test("cross-module struct: pub struct defined in lib, used in main", () => {
    withProject(
      {
        "main.vek": `
import Point from "./geo";
fn main() -> i32 {
  let p: Point = Point { x: 40, y: 2 };
  return p.x + p.y;
}
`,
        "geo.vek": `
pub struct Point {
  x: i32;
  y: i32;
}
`,
      },
      (entry) => {
        const graph = loadModuleGraph(entry);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
        const { program, namespaceImportExports } = buildMergedProgram(graph);
        const checked = new Checker(
          program,
          namespaceImportExports,
        ).checkProgram();
        assert.deepEqual(
          checked.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("compiles and runs named import across two files", () => {
    if (!hasCc()) return;

    withProject(
      {
        "main.vek": `
import add from "./math";
fn main() -> i32 { return add(20, 22); }
`,
        "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
      },
      (entry) => {
        const options = parseCliArgs([entry]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 42);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs namespace import across two files", () => {
    if (!hasCc()) return;

    withProject(
      {
        "main.vek": `
import "./math" as math;
fn main() -> i32 { return math.add(20, 22); }
`,
        "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
      },
      (entry) => {
        const options = parseCliArgs([entry]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 42);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs three-module chain", () => {
    if (!hasCc()) return;

    withProject(
      {
        "main.vek": `
import add from "./math";
import "./fmt" as fmt;
fn main() -> i32 { return add(fmt.base(), 2); }
`,
        "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        "fmt.vek": `
pub fn base() -> i32 { return 40; }
`,
      },
      (entry) => {
        const options = parseCliArgs([entry]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 42);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs cross-module struct usage", () => {
    if (!hasCc()) return;

    withProject(
      {
        "main.vek": `
import Point from "./geo";
fn main() -> i32 {
  let p: Point = Point { x: 40, y: 2 };
  return p.x + p.y;
}
`,
        "geo.vek": `
pub struct Point {
  x: i32;
  y: i32;
}
`,
      },
      (entry) => {
        const options = parseCliArgs([entry]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 42);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });
});

describe("package imports", () => {
  test("named import from registered package resolves correctly", () => {
    withPackageProject(
      {
        "main.vek": `
import add from "mylib:math";
fn main() -> void { return; }
`,
      },
      {
        mylib: {
          "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        },
      },
      (entry, pkgDirs) => {
        const host = makeNodeHost(new Map([["mylib", pkgDirs["mylib"]]]));
        const graph = loadModuleGraph(entry, host);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("namespace import from registered package resolves correctly", () => {
    withPackageProject(
      {
        "main.vek": `
import "mylib:math" as math;
fn main() -> void { return; }
`,
      },
      {
        mylib: {
          "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        },
      },
      (entry, pkgDirs) => {
        const host = makeNodeHost(new Map([["mylib", pkgDirs["mylib"]]]));
        const graph = loadModuleGraph(entry, host);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("checker resolves function type through package namespace import", () => {
    withPackageProject(
      {
        "main.vek": `
import "mylib:math" as math;
fn main() -> i32 { return math.add(1, 2); }
`,
      },
      {
        mylib: {
          "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        },
      },
      (entry, pkgDirs) => {
        const host = makeNodeHost(new Map([["mylib", pkgDirs["mylib"]]]));
        const graph = loadModuleGraph(entry, host);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
        const { program, namespaceImportExports } = buildMergedProgram(
          graph,
          host,
        );
        const checked = new Checker(
          program,
          namespaceImportExports,
        ).checkProgram();
        assert.deepEqual(
          checked.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("package resolves through index.vek when path is a folder", () => {
    withPackageProject(
      {
        "main.vek": `
import add from "mylib:utils";
fn main() -> void { return; }
`,
      },
      {
        mylib: {
          "utils/index.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        },
      },
      (entry, pkgDirs) => {
        const host = makeNodeHost(new Map([["mylib", pkgDirs["mylib"]]]));
        const graph = loadModuleGraph(entry, host);
        assert.deepEqual(
          graph.diagnostics.map((d) => d.code ?? ""),
          [],
        );
      },
    );
  });

  test("E2706: unknown package name gives error with hint", () => {
    withProject(
      {
        "main.vek": `
import "unknown:thing" as x;
fn main() -> void { return; }
`,
      },
      (entry) => {
        assert.deepEqual(
          checkModuleGraph(entry).diagnostics.map((d) => d.code ?? ""),
          ["E2706"],
        );
      },
    );
  });

  test("E2706: std:* remains blocked regardless of registered packages", () => {
    withPackageProject(
      {
        "main.vek": `
import "std:io" as io;
fn main() -> void { return; }
`,
      },
      { mylib: { "io.vek": `pub fn write() -> void { return; }` } },
      (entry, pkgDirs) => {
        const host = makeNodeHost(new Map([["mylib", pkgDirs["mylib"]]]));
        assert.deepEqual(
          checkModuleGraph(entry, host).diagnostics.map((d) => d.code ?? ""),
          ["E2706"],
        );
      },
    );
  });

  test("compiles and runs named import from package", () => {
    if (!hasCc()) return;

    withPackageProject(
      {
        "main.vek": `
import add from "mylib:math";
fn main() -> i32 { return add(20, 22); }
`,
      },
      {
        mylib: {
          "math.vek": `
pub fn add(a: i32, b: i32) -> i32 { return a + b; }
`,
        },
      },
      (entry, pkgDirs) => {
        const options = parseCliArgs([entry, "--package", pkgDirs["mylib"]]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 42);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });
});
