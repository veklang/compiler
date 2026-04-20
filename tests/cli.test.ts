import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildToolchainCommand,
  compileFile,
  defaultToolchainPrefix,
  parseCliArgs,
} from "@/index";
import { assert } from "./helpers";
import { describe, test } from "./tester";

const withTempFile = (source: string, run: (filePath: string) => void) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vek-cli-test-"));
  try {
    const filePath = path.join(root, "main.vek");
    fs.writeFileSync(filePath, source, "utf8");
    run(filePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const hasMuslGcc = () =>
  spawnSync("command -v musl-gcc", {
    shell: true,
    encoding: "utf8",
    stdio: "pipe",
  }).status === 0;

describe("cli", () => {
  test("parses source path and optional backend flags", () => {
    const options = parseCliArgs([
      "main.vek",
      "--runtime-header",
      "../runtime/dist/vek_runtime.h",
      "--toolchain-prefix",
      "cc -O2",
      "--preserve-temp",
    ]);

    assert.equal(options.sourcePath, path.resolve("main.vek"));
    assert.equal(
      options.runtimeHeaderPath,
      path.resolve("../runtime/dist/vek_runtime.h"),
    );
    assert.equal(options.toolchainPrefix, "cc -O2");
    assert.equal(options.preserveTemps, true);
    assert.equal(options.outputPath, path.resolve("main"));
  });

  test("uses the default musl-oriented toolchain prefix", () => {
    const options = parseCliArgs(["main.vek"]);

    assert.equal(options.toolchainPrefix, defaultToolchainPrefix);
    assert.ok(options.toolchainPrefix.startsWith("musl-gcc "));
    assert.ok(options.toolchainPrefix.includes("-static"));
  });

  test("appends emitted C path and output path to the toolchain prefix", () => {
    const command = buildToolchainCommand(
      "musl-gcc -O3",
      "/tmp/a file.c",
      "/tmp/a file",
    );

    assert.equal(command, "musl-gcc -O3 '/tmp/a file.c' -o '/tmp/a file'");
  });

  test("can preserve emitted C while using a fake successful toolchain", () => {
    withTempFile(
      `
fn main() -> void {
  return;
}
`,
      (filePath) => {
        const options = {
          ...parseCliArgs([
            filePath,
            "--toolchain-prefix",
            "true",
            "--preserve-temp",
          ]),
        };
        const result = compileFile(options);

        try {
          assert.equal(fs.existsSync(result.cPath), true);
          assert.equal(
            fs.readFileSync(result.cPath, "utf8").includes("int main(void)"),
            true,
          );
        } finally {
          fs.rmSync(result.tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  test("compiles and runs a void main with the default toolchain", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> void {
  return;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
        compileFile(options);

        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 0);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs panic through the runtime", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> void {
  panic("boom");
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
        compileFile(options);

        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 1);
          assert.equal(result.stderr.includes("panic: boom"), true);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs global reads and writes", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
let counter: i32 = 40;

fn main() -> i32 {
  counter = counter + 2;
  return counter;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
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

  test("compiles and runs lazy global initialization once", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
let hits: i32 = 0;
let value: i32 = bump();

fn bump() -> i32 {
  hits = hits + 1;
  return 41;
}

fn main() -> i32 {
  let _a: i32 = value;
  let _b: i32 = value;
  return hits;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
        compileFile(options);

        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 1);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("panics on re-entrant lazy global initialization", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
let a: i32 = read_b();
let b: i32 = read_a();

fn read_a() -> i32 {
  return a;
}

fn read_b() -> i32 {
  return b;
}

fn main() -> i32 {
  return a;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
        compileFile(options);

        try {
          const result = spawnSync(options.outputPath, {
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.equal(result.status, 1);
          assert.equal(
            result.stderr.includes("cyclic top-level initializer"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs tuple construction and field access", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn make_pair() -> (i32, i32) {
  return (17, 25);
}

fn main() -> i32 {
  let pair: (i32, i32) = make_pair();
  return pair.0 + pair.1;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
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
