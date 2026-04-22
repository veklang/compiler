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

  test("compiles and runs nullable narrowing", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let maybe_num: i32? = 42;
  if maybe_num != null {
    return maybe_num;
  }
  return 0;
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

  test("compiles and runs function values", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn add_one(x: i32) -> i32 {
  return x + 1;
}

fn apply(f: fn(i32) -> i32, x: i32) -> i32 {
  return f(x);
}

fn choose() -> fn(i32) -> i32 {
  return fn(x: i32) -> i32 {
    return x + 1;
  };
}

fn main() -> i32 {
  let named: fn(i32) -> i32 = add_one;
  let anon: fn(i32) -> i32 = choose();
  return apply(named, 20) + anon(20);
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

  test("compiles and runs type-qualified method references", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  fn new(id: i32) -> Self {
    return Self { id };
  }
}

fn main() -> i32 {
  let make: fn(i32) -> User = User.new;
  let show: fn(User) -> i32 = User.show;
  let user: User = make(42);
  return show(user);
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

  test("compiles and runs array creation, index read, and for loop", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let xs: i32[] = [3, 5, 7];
  let total: i32 = 0;
  for x in xs {
    total = total + x;
  }
  return total;
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
          assert.equal(result.status, 15);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs direct instance method calls", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  return user.show();
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

  test("compiles and runs generic function specialization for struct types", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  id: i32;
}

fn id<T>(value: T) -> T {
  return value;
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let copied: User = id(user);
  return copied.id;
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

  test("compiles and runs generic method specialization for struct types", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  id: i32;
}

struct Container {
  count: i32;

  fn map<T>(self, value: T) -> T {
    return value;
  }
}

fn main() -> i32 {
  let container: Container = Container { count: 0 };
  let user: User = User { id: 42 };
  let copied: User = container.map(user);
  return copied.id;
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

  test("compiles and runs generic struct specialization for aggregate fields", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  fn get(self) -> T {
    return self.value;
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let copied: User = box.get();
  return copied.id;
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

  test("compiles and runs string len, concat, and eq", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let a: string = "hello";
  let b: string = "world";
  let c: string = a + b;
  if c.len == 10 {
    if a == "hello" {
      return 42;
    }
  }
  return 0;
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

  test("compiles and runs UTF-8 scalar string len and indexing", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let s: string = "a\\u{E9}\\u{2603}\\u{1D11E}";
  if s.len == 4 {
    if s[1] == "\\u{E9}" {
      if s[2] == "\\u{2603}" {
        if s[3] == "\\u{1D11E}" {
          return 42;
        }
      }
    }
  }
  return 0;
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

  test("compiles and runs retained string aliases", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let a: string = "hello";
  let b: string = a;
  if b == "hello" {
    return 42;
  }
  return 0;
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

  test("compiles and runs retained aggregate string fields", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct User {
  name: string;
}

fn make() -> User {
  let s: string = "hi" + "!";
  let u: User = User { name: s };
  return u;
}

fn main() -> i32 {
  let u: User = make();
  if u.name == "hi!" {
    return 42;
  }
  return 0;
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

  test("compiles and runs CoW array alias mutation", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let a: i32[] = [1, 2];
  let b: i32[] = a;
  a[0] = 9;
  return b[0] * 10 + a[0];
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
          assert.equal(result.status, 19);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs CoW string array element mutation", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let xs: string[] = ["a", "b"];
  let ys: string[] = xs;
  xs[0] = "c";
  if ys[0] == "a" {
    if xs[0] == "c" {
      return 42;
    }
  }
  return 0;
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
