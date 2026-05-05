import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildToolchainCommand,
  compileFile,
  defaultToolchainCommand,
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

const hasCc = () =>
  spawnSync("command -v cc", {
    shell: true,
    encoding: "utf8",
    stdio: "pipe",
  }).status === 0;

describe("cli", () => {
  test("parses source path and optional backend flags", () => {
    withTempFile("", (filePath) => {
      const root = path.dirname(filePath);
      const cPath = path.join(root, "native.c");
      const oPath = path.join(root, "native.o");
      const aPath = path.join(root, "libnative.a");
      fs.writeFileSync(cPath, "", "utf8");
      fs.writeFileSync(oPath, "", "utf8");
      fs.writeFileSync(aPath, "", "utf8");

      const options = parseCliArgs([
        filePath,
        cPath,
        oPath,
        aPath,
        "--runtime-header",
        "../runtime/dist/vek_runtime.h",
        "--preserve-temp",
        "--static",
        "--strip",
        "--lto",
        "-Os",
      ]);

      assert.equal(options.sourcePath, filePath);
      assert.deepEqual(options.nativeInputs, [cPath, oPath, aPath]);
      assert.equal(
        options.runtimeHeaderPath,
        path.resolve("../runtime/dist/vek_runtime.h"),
      );
      assert.equal(options.preserveTemps, true);
      assert.equal(options.staticLink, true);
      assert.equal(options.stripSymbols, true);
      assert.equal(options.lto, true);
      assert.equal(options.optimizationLevel, "s");
      assert.equal(options.outputPath, path.join(root, "main"));
    });
  });

  test("uses the default portable-ish C toolchain command and O2", () => {
    withTempFile("", (filePath) => {
      const options = parseCliArgs([filePath]);

      assert.equal(defaultToolchainCommand, "cc -std=c99 -Wall -Wextra");
      assert.equal(options.optimizationLevel, "2");
      assert.equal(options.staticLink, false);
      assert.equal(options.stripSymbols, false);
      assert.equal(options.lto, false);
    });
  });

  test("builds toolchain command with native inputs and linker flags", () => {
    const command = buildToolchainCommand(
      {
        nativeInputs: ["/tmp/native file.c", "/tmp/native.o", "/tmp/libx.a"],
        optimizationLevel: "3",
        staticLink: true,
        stripSymbols: true,
        lto: true,
        libraryPaths: ["/tmp/lib dir"],
        libraries: ["m", "stdc++"],
        rawFlags: ["-pthread", "-Wl,--as-needed"],
        outputPath: "/tmp/a file",
      },
      "/tmp/a file.c",
    );

    assert.equal(
      command,
      "cc -std=c99 -Wall -Wextra -O3 -flto -static -s '/tmp/a file.c' '/tmp/native file.c' '/tmp/native.o' '/tmp/libx.a' -L '/tmp/lib dir' -l'm' -l'stdc++' '-pthread' '-Wl,--as-needed' -o '/tmp/a file'",
    );
  });

  test("parses library flags and validates their paths and names", () => {
    withTempFile("", (filePath) => {
      const root = path.dirname(filePath);
      const libDir = path.join(root, "lib dir");
      fs.mkdirSync(libDir);

      const options = parseCliArgs([
        filePath,
        "--library-path",
        libDir,
        "-L",
        libDir,
        `-L${libDir}`,
        "--library",
        "m",
        "-l",
        "stdc++",
        "-l:liblocal.a",
        "--raw-flags",
        "-pthread",
      ]);

      assert.deepEqual(options.libraryPaths, [libDir, libDir, libDir]);
      assert.deepEqual(options.libraries, ["m", "stdc++", ":liblocal.a"]);
      assert.deepEqual(options.rawFlags, ["-pthread"]);
    });
  });

  test("rejects invalid CLI inputs", () => {
    withTempFile("", (filePath) => {
      const root = path.dirname(filePath);
      const otherVek = path.join(root, "other.vek");
      const textFile = path.join(root, "notes.txt");
      fs.writeFileSync(otherVek, "", "utf8");
      fs.writeFileSync(textFile, "", "utf8");

      assert.throws(() => parseCliArgs([filePath, otherVek]), /Multiple Vek/);
      assert.throws(
        () => parseCliArgs([filePath, textFile]),
        /Unsupported input extension/,
      );
      assert.throws(
        () => parseCliArgs([filePath, "--optimization-level", "fast"]),
        /Invalid value/,
      );
      assert.throws(
        () => parseCliArgs([filePath, "--library", "bad name"]),
        /Invalid library name/,
      );
      assert.throws(
        () => parseCliArgs([filePath, "--library-path", textFile]),
        /not a directory/,
      );
      assert.throws(
        () => parseCliArgs([path.join(root, "missing.vek")]),
        /does not exist/,
      );
      assert.throws(
        () => parseCliArgs([filePath, "--toolchain-prefix", "cc"]),
        /Unknown flag/,
      );
    });
  });

  test("can preserve emitted C", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> void {
  return;
}
`,
      (filePath) => {
        const options = {
          ...parseCliArgs([filePath, "--preserve-temp"]),
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
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs with an extra native C input", () => {
    if (!hasCc()) return;

    withTempFile(
      `
unsafe extern "native_answer" fn native_answer() -> i32;

fn main() -> i32 {
  return unsafe { native_answer() };
}
`,
      (filePath) => {
        const cPath = path.join(path.dirname(filePath), "native.c");
        fs.writeFileSync(
          cPath,
          "#include <stdint.h>\nint32_t native_answer(void) { return 42; }\n",
          "utf8",
        );
        const options = parseCliArgs([filePath, cPath]);
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

  test("compiles and runs a void main with the default toolchain", () => {
    if (!hasCc()) return;

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

  test("compiles and runs implicit main return", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() {
  let base = 39;
  base + 3
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

  test("compiles and runs panic through the runtime", () => {
    if (!hasCc()) return;

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

  test("compiles and runs user-defined -> never wrapper", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn fail(message: string) -> never {
  panic(message);
}

fn pick(flag: bool) -> i32 {
  if flag {
    42
  } else {
    fail("not flag")
  }
}

fn main() -> i32 {
  pick(true)
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

  test("compiles and runs global reads and writes", () => {
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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

  test("compiles and runs tuple destructuring in bindings and for loops", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let (base, (extra, _)) = (10, (5, 99));
  let pairs: (i32, i32)[] = [(1, 2), (3, 4), (5, 6)];
  let total: i32 = base + extra;
  for (left, right) in pairs {
    total += left + right;
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
          assert.equal(result.status, 36);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs nullable narrowing", () => {
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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

  test("compiles and runs custom iterable for loop", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Counter {
  current: i32;
  end: i32;

  fn new(end: i32) -> Self {
    return Self { current: 0, end };
  }

  satisfies Iterator {
    type Item = i32;

    fn next(mut self) -> Item? {
      if self.current == self.end {
        return null;
      }

      let value = self.current;
      self.current = self.current + 1;
      return value;
    }
  }
}

fn main() -> i32 {
  let total: i32 = 0;
  for x in Counter.new(7) {
    if x == 2 {
      continue;
    }
    if x == 5 {
      break;
    }
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
          assert.equal(result.status, 8);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs short-circuit logical operators", () => {
    if (!hasCc()) return;

    withTempFile(
      `
let hits: i32 = 0;

fn rhs() -> bool {
  hits = hits + 1;
  return true;
}

fn main() -> i32 {
  let left: bool = false && rhs();
  let right: bool = true || rhs();
  if left {
    return 1;
  }
  if !right {
    return 2;
  }
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
          assert.equal(result.status, 0);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs direct instance method calls", () => {
    if (!hasCc()) return;

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

  test("compiles and runs an exported extern symbol alias", () => {
    if (!hasCc()) return;

    withTempFile(
      `
pub extern "vek_answer" fn answer() -> i32 {
  return 42;
}

fn main() -> i32 {
  return answer();
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

  test("compiles and runs compound assignments", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let x: i32 = 40;
  x += 2;
  x -= 2;
  x *= 2;
  x /= 2;
  x %= 50;
  x |= 2;
  x &= 63;
  x ^= 0;
  x <<= 1;
  x >>= 1;

  let s: string = "ve";
  s += "k";
  if s != "vek" {
    return 0;
  }
  return x;
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

  test("compiles and runs signed wrapping arithmetic", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let a: i8 = 127;
  let b: i8 = a + 1;
  let c: i8 = b - 1;
  let d: i8 = c * 2;
  let min: i8 = -128;
  let e: i8 = -min;
  let expected_b: i8 = -128;
  let expected_c: i8 = 127;
  let expected_d: i8 = -2;
  let expected_e: i8 = -128;
  if b != expected_b { return 1; }
  if c != expected_c { return 2; }
  if d != expected_d { return 3; }
  if e != expected_e { return 4; }
  return 42;
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

  test("compiles and runs isize wrapping arithmetic", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let a: isize = 9223372036854775807;
  let b: isize = a + 1;
  let c: isize = b - 1;
  let min: isize = -9223372036854775808;
  let d: isize = -min;
  let expected_b: isize = -9223372036854775808;
  let expected_c: isize = 9223372036854775807;
  let expected_d: isize = -9223372036854775808;
  if b != expected_b { return 1; }
  if c != expected_c { return 2; }
  if d != expected_d { return 3; }
  return 42;
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

  test("panics on invalid runtime integer shift", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> void {
  let count: i32 = 32;
  let _x: i32 = 1 << count;
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
            result.stderr.includes("panic: invalid integer shift"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("panics on runtime integer division by zero", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> void {
  let x: i32 = 1;
  let y: i32 = 0;
  let _z: i32 = x / y;
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
            result.stderr.includes("panic: integer division by zero"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs compound assignment places", () => {
    if (!hasCc()) return;

    withTempFile(
      `
let total: i32 = 1;

struct Acc {
  value: i32;
  name: string;
}

fn main() -> i32 {
  let acc: Acc = Acc { value: 40, name: "ve" };
  let xs: i32[] = [1, 2, 3];
  acc.value += 2;
  xs[1] += acc.value;
  total += xs[1];
  acc.name += "k";
  if acc.name != "vek" {
    return 0;
  }
  return total - 3;
}
`,
      (filePath) => {
        const options = parseCliArgs([filePath]);
        compileFile(options);
        try {
          const result = spawnSync(options.outputPath, [], {
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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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

  test("compiles and runs trait satisfaction methods on generic struct owners", () => {
    if (!hasCc()) return;

    withTempFile(
      `
trait Extract<T> {
  fn extract(self) -> T;
}

struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  satisfies Extract<T> {
    fn extract(self) -> T {
      return self.value;
    }
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let copied: User = box.extract();
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

  test("compiles and runs omitted trait default methods", () => {
    if (!hasCc()) return;

    withTempFile(
      `
trait Scored {
  fn score(self) -> i32 {
    return 42;
  }
}

struct User {
  satisfies Scored {
  }
}

fn main() -> i32 {
  let user: User = User {};
  return user.score();
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

  test("compiles and runs generic method specialization on generic struct owner", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct User {
  id: i32;
}

struct Box<T> {
  value: T;

  fn pair<U>(self, other: U) -> (T, U) {
    return (self.value, other);
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  let box: Box<User> = Box { value: user };
  let pair: (User, i32) = box.pair(7);
  return pair.0.id;
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

  test("compiles and runs generic enum specializations and methods", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct User {
  id: i32;
}

enum Option<T> {
  Some(T);
  None;

  fn value_or(self, fallback: T) -> T {
    match self {
      Some(value) => { return value; }
      None => { return fallback; }
    }
  }

  fn pair<U>(self, other: U) -> (Self, U) {
    return (self, other);
  }
}

fn main() -> i32 {
  let a: Option<i32> = Some(39);
  let b: Option<i32> = None;
  let user: User = User { id: 2 };
  let maybe_user: Option<User> = Some(user);
  let pair: (Option<i32>, bool) = a.pair(true);
  if pair.1 {
    let got: User = maybe_user.value_or(User { id: 0 });
    return a.value_or(0) + b.value_or(1) + got.id;
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

  test("compiles and runs string, nullable, and tuple match patterns", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let text: string = "hello";
  let pair: (i32, string) = (1, text);
  let maybe: i32? = null;

  match text {
    "hello" => {}
    _ => { return 1; }
  }

  match maybe {
    null => {}
    _ => { return 2; }
  }

  match pair {
    (1, value) => { return value.len as i32; }
    _ => { return 3; }
  }
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
          assert.equal(result.status, 5);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs core Result, Ordering, and nullable unwrap helpers", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn compare(a: i32, b: i32) -> Ordering {
  if a < b {
    return Less;
  }
  if a > b {
    return Greater;
  }
  return Equal;
}

fn main() -> i32 {
  let some: i32? = 9;
  let none: i32? = null;
  let ok: Result<i32, string> = Ok(30);
  let err: Result<i32, string> = Err("bad");

  if some == null { return 1; }
  if none != null { return 2; }

  let total = some.unwrap() + none.unwrap_or(2) + ok.unwrap() + err.unwrap_or(1);

  match compare(total, 42) {
    Less => { return 3; }
    Equal => { return 42; }
    Greater => { return 4; }
  }
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

  test("compiles and runs custom trait satisfaction through a generic bound", () => {
    if (!hasCc()) return;

    withTempFile(
      `
trait Doubles {
  fn doubled(self) -> i32;
}

struct Metric {
  value: i32;

  satisfies Doubles {
    fn doubled(self) -> i32 {
      return self.value * 2;
    }
  }
}

fn use_double<T: Doubles>(value: T) -> i32 {
  return value.doubled();
}

fn main() -> i32 {
  let metric: Metric = Metric { value: 21 };
  return use_double(metric);
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
    if (!hasCc()) return;

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

  test("compiles and runs aggregate and custom equality", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct UserId {
  value: i32;

  satisfies Equal<UserId> {
    fn equals(self, other: UserId) -> bool {
      return self.value == other.value;
    }
  }
}

fn same<T>(left: T, right: T) -> bool
where T: Equal<T>
{
  return left == right;
}

fn main() -> i32 {
  let one: i32? = 7;
  let two: i32? = 7;
  let none: i32? = null;
  if !(one == two) {
    return 1;
  }
  if one == none {
    return 2;
  }
  if !(none == null) {
    return 3;
  }

  let left: (i32, string) = (1, "x");
  let right: (i32, string) = (1, "x");
  let other: (i32, string) = (2, "x");
  if !(left == right) {
    return 4;
  }
  if left == other {
    return 5;
  }

  let user_a: UserId = UserId { value: 5 };
  let user_b: UserId = UserId { value: 5 };
  let user_c: UserId = UserId { value: 6 };
  if !same(user_a, user_b) {
    return 6;
  }
  if same(user_a, user_c) {
    return 7;
  }
  return 42;
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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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
    if (!hasCc()) return;

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

  test("compiles and runs CoW struct field array mutation", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Buf {
  data: i32[];
}

fn main() -> i32 {
  let a = Buf { data: [1, 2] };
  let b = a;
  a.data[0] = 9;
  return b.data[0] * 10 + a.data[0];
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

  test("compiles and runs mut self method calls by reference", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Counter {
  value: i32;

  fn increment(mut self) -> void {
    self.value = self.value + 1;
  }
}

fn main() -> i32 {
  let c = Counter { value: 41 };
  c.increment();
  return c.value;
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

  test("compiled array indexing panics out of bounds", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let xs: i32[] = [1, 2];
  return xs[2];
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
            result.stderr.includes("panic: array index out of bounds"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiled string indexing panics out of bounds", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let s: string = "hi";
  let _c: string = s[2];
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
          assert.equal(result.status, 1);
          assert.equal(
            result.stderr.includes("panic: string index out of bounds"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiled Result unwrap panics on Err", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let err: Result<i32, string> = Err("bad");
  return err.unwrap();
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
            result.stderr.includes("panic: called unwrap on an Err value"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiled nullable unwrap panics on null", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let value: i32? = null;
  return value.unwrap();
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
            result.stderr.includes("panic: called unwrap on a null value"),
            true,
          );
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs string.to_cstr() passed to an extern cstr fn", () => {
    if (!hasCc()) return;

    withTempFile(
      `
unsafe extern "strlen" fn c_strlen(s: cstr) -> usize;

fn count(s: string) -> usize {
  return unsafe { c_strlen(s.to_cstr()) };
}

fn main() -> i32 {
  return count("hello") as i32;
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
          assert.equal(result.status, 5);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs unsafe extern fn with cstr and pointer arithmetic", () => {
    if (!hasCc()) return;

    withTempFile(
      `
unsafe extern "strlen" fn c_strlen(s: cstr) -> usize;

fn main() -> i32 {
  let n: usize = unsafe { c_strlen("hello") };
  return n as i32;
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
          assert.equal(result.status, 5);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs unsafe fn wrapping pointer cast and offset", () => {
    if (!hasCc()) return;

    withTempFile(
      `
unsafe fn byte_stride(p: ptr<i32>) -> i64 {
  let q: ptr<i32> = p.offset(2);
  let pi: i64 = p as i64;
  let qi: i64 = q as i64;
  return qi - pi;
}

fn main() -> i32 {
  let base: ptr<i32> = unsafe { 0x1000 as ptr<i32> };
  let diff: i64 = unsafe { byte_stride(base) };
  return diff as i32;
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
          assert.equal(result.status, 8);
        } finally {
          fs.rmSync(options.outputPath, { force: true });
        }
      },
    );
  });

  test("compiles and runs custom Neg/Not/BitAnd/BitOr/BitXor/ShiftLeft/ShiftRight trait satisfactions", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Bits {
  v: i32;
  satisfies Neg<Bits>          { fn neg(self) -> Bits    { return Bits { v: -self.v }; } }
  satisfies Not<Bits>          { fn not(self) -> Bits    { return Bits { v: self.v ^ -1 }; } }
  satisfies BitAnd<Bits, Bits> { fn bit_and(self, rhs: Bits) -> Bits { return Bits { v: self.v & rhs.v }; } }
  satisfies BitOr<Bits, Bits>  { fn bit_or(self, rhs: Bits)  -> Bits { return Bits { v: self.v | rhs.v }; } }
  satisfies BitXor<Bits, Bits> { fn bit_xor(self, rhs: Bits) -> Bits { return Bits { v: self.v ^ rhs.v }; } }
  satisfies ShiftLeft<Bits, Bits>  { fn shift_left(self, rhs: Bits) -> Bits { return Bits { v: self.v << rhs.v }; } }
  satisfies ShiftRight<Bits, Bits> { fn shift_right(self, rhs: Bits) -> Bits { return Bits { v: self.v >> rhs.v }; } }
}

fn main() -> i32 {
  let a = Bits { v: 12 };
  let b = Bits { v: 2 };
  let neg_a = -a;
  let not_a = !a;
  let and_ab = a & b;
  let or_ab  = a | b;
  let xor_ab = a ^ b;
  let shl_ab = a << b;
  let shr_ab = a >> b;
  if neg_a.v != -12 { return 1; }
  if not_a.v != (12 ^ -1) { return 2; }
  if and_ab.v != (12 & 2) { return 3; }
  if or_ab.v  != (12 | 2) { return 4; }
  if xor_ab.v != (12 ^ 2) { return 5; }
  if shl_ab.v != (12 << 2) { return 6; }
  if shr_ab.v != (12 >> 2) { return 7; }
  return 42;
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

  test("compiles and runs custom Order trait comparisons", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Score {
  v: i32;
  satisfies Order<Score> {
    fn compare(self, rhs: Score) -> Ordering {
      if self.v < rhs.v { return Less; }
      if self.v > rhs.v { return Greater; }
      return Equal;
    }
  }
}

fn before<T: Order<T>>(a: T, b: T) -> bool {
  return a < b;
}

fn main() -> i32 {
  let one = Score { v: 1 };
  let two = Score { v: 2 };
  if !(one < two) { return 1; }
  if !(one <= two) { return 2; }
  if one > two { return 3; }
  if one >= two { return 4; }
  if !(two > one) { return 5; }
  if !(two >= one) { return 6; }
  if two < one { return 7; }
  if two <= one { return 8; }
  if !before<Score>(one, two) { return 9; }
  return 42;
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

  test("compiles and runs custom Add/Sub/Mul/Div/Rem trait satisfactions", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Vec2 {
  x: i32;
  y: i32;

  satisfies Add<Vec2, Vec2> {
    fn add(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x + rhs.x, y: self.y + rhs.y };
    }
  }

  satisfies Sub<Vec2, Vec2> {
    fn sub(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x - rhs.x, y: self.y - rhs.y };
    }
  }

  satisfies Mul<Vec2, Vec2> {
    fn mul(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x * rhs.x, y: self.y * rhs.y };
    }
  }

  satisfies Div<Vec2, Vec2> {
    fn div(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x / rhs.x, y: self.y / rhs.y };
    }
  }

  satisfies Rem<Vec2, Vec2> {
    fn rem(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x % rhs.x, y: self.y % rhs.y };
    }
  }
}

fn main() -> i32 {
  let a = Vec2 { x: 10, y: 20 };
  let b = Vec2 { x: 3, y: 4 };
  let added = a + b;
  let subbed = a - b;
  let mulled = a * b;
  let divved = a / b;
  let remmed = a % b;
  if added.x != 13 { return 1; }
  if added.y != 24 { return 2; }
  if subbed.x != 7 { return 3; }
  if subbed.y != 16 { return 4; }
  if mulled.x != 30 { return 5; }
  if mulled.y != 80 { return 6; }
  if divved.x != 3 { return 7; }
  if divved.y != 5 { return 8; }
  if remmed.x != 1 { return 9; }
  if remmed.y != 0 { return 10; }
  return 42;
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

  test("compiles and runs Callable satisfaction and implicit function-value Callable", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Adder {
  amount: i32;

  satisfies Callable<i32, i32> {
    fn call(self, x: i32) -> i32 {
      return x + self.amount;
    }
  }
}

struct Combiner {
  n: i32;

  satisfies Callable<(i32, i32), i32> {
    fn call(self, args: (i32, i32)) -> i32 {
      return args.0 + args.1 + self.n;
    }
  }
}

fn apply<F>(f: F, x: i32) -> i32
where F: Callable<i32, i32>
{
  return f(x);
}

fn double(n: i32) -> i32 { return n * 2; }

fn main() -> i32 {
  let add5 = Adder { amount: 5 };
  if add5(3) != 8 { return 1; }

  let c = Combiner { n: 0 };
  if c(10, 20) != 30 { return 2; }

  if apply(add5, 7) != 12 { return 3; }

  if apply(double, 6) != 12 { return 4; }

  return 42;
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

  test("compiles and runs template string interpolation", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let name = "world";
  let n: i32 = 42;
  let b = true;
  let s1 = f"hello {name}!";
  let s2 = f"n={n}";
  let s3 = f"flag={b}";
  let s4 = f"{n} and {n}";
  if s1 != "hello world!" { return 1; }
  if s2 != "n=42" { return 2; }
  if s3 != "flag=true" { return 3; }
  if s4 != "42 and 42" { return 4; }
  return 42;
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

  test("compiles and runs format interpolation for Ordering, nullable, tuple, and Result", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let o: Ordering = Less;
  if f"{o}" != "Less" { return 1; }

  let n: i32? = 42;
  if f"{n}" != "42" { return 2; }

  let null_n: i32? = null;
  if f"{null_n}" != "null" { return 3; }

  let t = (10, "hi");
  if f"{t}" != "(10, hi)" { return 4; }

  let ok: Result<i32, string> = Ok(7);
  if f"{ok}" != "Ok(7)" { return 5; }

  let err: Result<i32, string> = Err("oops");
  if f"{err}" != "Err(oops)" { return 6; }

  return 42;
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

  test("compiles and runs format interpolation for Array<T>", () => {
    if (!hasCc()) return;

    withTempFile(
      `
fn main() -> i32 {
  let empty: Array<i32> = [];
  if f"{empty}" != "[]" { return 1; }

  let nums: Array<i32> = [1, 2, 3];
  if f"{nums}" != "[1, 2, 3]" { return 2; }

  let single: Array<string> = ["hello"];
  if f"{single}" != "[hello]" { return 3; }

  return 42;
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

  test("compiles and runs custom Index and IndexMut trait satisfactions", () => {
    if (!hasCc()) return;

    withTempFile(
      `
struct Slots {
  v: i32;

  satisfies Index<i32, i32> {
    fn index_get(self, index: i32) -> i32 {
      return self.v + index;
    }
  }

  satisfies IndexMut<i32, i32> {
    fn index_set(mut self, index: i32, value: i32) -> void {
      self.v = value + index;
    }
  }
}

fn main() -> i32 {
  let slots = Slots { v: 1 };
  if slots[2] != 3 { return 1; }
  slots[1] = 41;
  if slots.v != 42 { return 2; }
  if slots[0] != 42 { return 3; }
  return 42;
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
