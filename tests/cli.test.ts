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

  test("compiles and runs implicit main return", () => {
    if (!hasMuslGcc()) return;

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

  test("compiles and runs user-defined -> never wrapper", () => {
    if (!hasMuslGcc()) return;

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

  test("compiles and runs custom iterable for loop", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
struct Counter {
  current: i32;
  end: i32;

  fn new(end: i32) -> Self {
    return Self { current: 0, end };
  }

  satisfies Iterable<i32> {
    fn next(mut self) -> i32? {
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
    if (!hasMuslGcc()) return;

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

  test("compiles and runs an exported extern symbol alias", () => {
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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

  test("panics on invalid runtime integer shift", () => {
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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

  test("compiles and runs trait satisfaction methods on generic struct owners", () => {
    if (!hasMuslGcc()) return;

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

  test("compiles and runs generic method specialization on generic struct owner", () => {
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    (1, value) => { return value.len; }
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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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

  test("compiles and runs aggregate and custom equality", () => {
    if (!hasMuslGcc()) return;

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

  test("compiled array indexing panics out of bounds", () => {
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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
    if (!hasMuslGcc()) return;

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

  test("compiles and runs unsafe extern fn with cstr and pointer arithmetic", () => {
    if (!hasMuslGcc()) return;

    withTempFile(
      `
unsafe extern "strlen" fn c_strlen(s: cstr) -> u64;

fn main() -> i32 {
  let n: u64 = unsafe { c_strlen("hello") };
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
    if (!hasMuslGcc()) return;

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
});
