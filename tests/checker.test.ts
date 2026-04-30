import {
  assert,
  check,
  expectDiagnostics,
  expectNoCheckDiagnostics,
  expectNoDiagnostics,
} from "./helpers";
import { describe, test } from "./tester";

const checkOk = (source: string) => {
  const result = check(source);
  expectNoDiagnostics(result.lexDiagnostics, result.parseDiagnostics);
  expectNoCheckDiagnostics(result.checkDiagnostics);
  return result;
};

describe("checker", () => {
  test("nullable narrowing works for explicit checks", () => {
    checkOk(`
fn main() -> void {
  let maybe_num: i32? = 1;
  if maybe_num != null {
    let _n: i32 = maybe_num;
  } else {
    let _z: null = maybe_num;
  }
}
`);
  });

  test("nullable aliases narrow like their underlying types", () => {
    checkOk(`
type MaybeI32 = i32?;

fn main() -> void {
  const maybe_num: MaybeI32 = 1;
  if maybe_num != null {
    let _n: i32 = maybe_num;
  } else {
    let _z: null = maybe_num;
  }
}
`);
  });

  test("array and string indexing", () => {
    checkOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let _first: i32 = xs[0];
  let s: string = "cat";
  let _c: string = s[0];
}
`);
  });

  test("usize is used for built-in lengths and indexes", () => {
    checkOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let i: usize = 0;
  let _first: i32 = xs[i];
  let _len: usize = xs.len;
  let s: string = "cat";
  let _c: string = s[i];
  let _s_len: usize = s.len;
}
`);
  });

  test("E2101: built-in array and string indexes require usize", () => {
    const result = check(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let i: i32 = 0;
  let _first: i32 = xs[i];
  let s: string = "cat";
  let _c: string = s[i];
}
`);

    expectDiagnostics(result.checkDiagnostics, ["E2101", "E2101"]);
  });

  test("isize is a valid signed pointer-width integer type", () => {
    checkOk(`
fn main() -> void {
  let _a: isize = 0;
  let _b: isize = -1;
  let _c: isize = 9223372036854775807;
}
`);
  });

  test("isize rejects out-of-range literals", () => {
    const result = check(`
fn main() -> void {
  let _x: isize = 9223372036854775808;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2401"]);
  });

  test("integer literals in expressions use the expected integer type", () => {
    checkOk(`
fn main() -> void {
  let _x: i8 = -128;
  let _y: i8 = 1 + 2;
}
`);
  });

  test("match expression with heterogeneous arms passes when each satisfies expected type", () => {
    checkOk(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);

  let _n: i32? = match value {
    Ok(v) => v,
    _ => null,
  };
}
`);
  });

  test("nullable enum matches accept enum and null patterns", () => {
    checkOk(`
fn main() -> void {
  let value: Result<i32, string>? = Ok(1);

  match value {
    Ok(v) => {
      let _x: i32 = v;
    },
    Err(e) => {
      let _y: string = e;
    },
    null => {
      return;
    },
  }
}
`);
  });

  test("function return types are inferred by default", () => {
    checkOk(`
fn add(x: i32, y: i32) {
  return x + y;
}

fn main() -> void {
  let _value: i32 = add(1, 2);
}
`);
  });

  test("trailing expressions infer and satisfy function return types", () => {
    checkOk(`
fn add(x: i32, y: i32) {
  x + y
}

fn explicit() -> i32 {
  add(20, 22)
}

fn main() -> void {
  let _value: i32 = explicit();
}
`);
  });

  test("trailing if and match statements can produce function values", () => {
    checkOk(`
enum Choice {
  A;
  B;
}

fn pick(flag: bool) -> i32 {
  if flag {
    1
  } else {
    2
  }
}

fn label(choice: Choice) -> string {
  match choice {
    A => { "a" },
    _ => { "b" },
  }
}

fn main() -> void {
  let _picked: i32 = pick(true);
  let _label: string = label(A);
}
`);
  });

  test("terminating match expression arms satisfy the other arm type", () => {
    checkOk(`
enum MaybeI32 {
  Some(i32);
  None;
}

fn unwrap(value: MaybeI32) -> i32 {
  return match value {
    Some(inner) => inner,
    _ => { panic("none"); },
  };
}
`);
  });

  test("main may infer i32 return type", () => {
    checkOk(`
fn main() {
  return 1;
}
`);
  });

  test("E2302: main must return void or i32 after inference", () => {
    const result = check(`
fn main() {
  return "bad";
}
`);

    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
  });

  test("E2207: main must take no parameters", () => {
    const result = check(`
fn main(code: i32) -> i32 {
  return code;
}
`);

    expectDiagnostics(result.checkDiagnostics, ["E2207"]);
  });

  test("generic function inference works", () => {
    checkOk(`
fn id<T>(value: T) -> T {
  return value;
}

fn main() -> void {
  let _x: i32 = id(1);
}
`);
  });

  test("generic function explicit type arguments work", () => {
    checkOk(`
fn id<T>(value: T) -> T {
  return value;
}

fn main() -> void {
  let _x: i32 = id<i32>(1);
}
`);
  });

  test("anonymous function return type is inferred without annotation", () => {
    checkOk(`
fn main() -> void {
  let add = fn(x: i32, y: i32) {
    return x + y;
  };
  let _result: i32 = add(1, 2);
}
`);
  });

  test("anonymous function inferred return type is used at call sites", () => {
    checkOk(`
fn apply(f: fn(i32) -> i32, x: i32) -> i32 {
  return f(x);
}

fn main() -> void {
  let double = fn(x: i32) {
    return x * 2;
  };
  let _result: i32 = apply(double, 3);
}
`);
  });

  test("anonymous function with no return infers void", () => {
    checkOk(`
fn main() -> void {
  let noop = fn(x: i32) {
    let _ = x;
    return;
  };
  noop(1);
}
`);
  });

  test("anonymous function with explicit return annotation still uses annotation", () => {
    checkOk(`
fn main() -> void {
  let _f: fn(i32) -> i32 = fn(x: i32) -> i32 {
    return x + 1;
  };
}
`);
  });

  test("traits and satisfies blocks work", () => {
    checkOk(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  satisfies Printable {
    fn print(self) -> void {
      let _x: i32 = self.show();
      return;
    }
  }
}

fn main() -> void {
  let user = User { id: 1 };
  user.print();
}
`);
  });

  test("custom Equal<T> satisfactions drive ==", () => {
    checkOk(`
struct UserId {
  value: i32;

  fn new(value: i32) -> Self {
    return Self { value };
  }

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

fn main() -> void {
  let a = UserId.new(1);
  let b = UserId.new(1);
  let _ok: bool = same(a, b);
}
`);
  });

  test("type-parameter methods resolve through trait bounds", () => {
    checkOk(`
trait Named {
  fn name(self) -> string;
}

struct User {
  name_value: string;

  satisfies Named {
    fn name(self) -> string {
      return self.name_value;
    }
  }
}

fn render<T>(value: T) -> string
where T: Named
{
  return value.name();
}

fn main() -> void {
  let user = User { name_value: "ducc" };
  let _label: string = render(user);
}
`);
  });

  test("enum methods may use Self and enum payloads", () => {
    checkOk(`
enum State {
  Idle;
  Busy(i32);

  fn busy(value: i32) -> Self {
    return Busy(value);
  }

  fn value(self) -> i32? {
    return match self {
      Busy(value) => value,
      _ => null,
    };
  }
}

fn main() -> void {
  let state = State.busy(1);
  let _value: i32? = state.value();
}
`);
  });

  test("generic owner methods use concrete type arguments", () => {
    checkOk(`
trait Measure<T> {
  fn compare(self, other: T) -> Ordering;
}

struct UserId {
  value: i32;

  fn new(value: i32) -> Self {
    return Self { value };
  }

  satisfies Equal<UserId> {
    fn equals(self, other: UserId) -> bool {
      return self.value == other.value;
    }
  }

  satisfies Measure<UserId> {
    fn compare(self, other: UserId) -> Ordering {
      if self.value < other.value {
        return Less;
      }

      if self.value > other.value {
        return Greater;
      }

      return Equal;
    }
  }
}

enum Packet<T> {
  Empty;
  Data(T);

  fn take(self) -> T? {
    return match self {
      Data(value) => value,
      _ => null,
    };
  }
}

fn main() -> void {
  let packet: Packet<UserId> = Data(UserId.new(1));
  let taken = packet.take();

  if taken != null {
    let same = taken.equals(UserId.new(1));
    let ordering = taken.compare(UserId.new(2));
    if same {
      let _label = match ordering {
        Less => "less",
        Equal => "equal",
        _ => "greater",
      };
    }
  }
}
`);
  });

  test("type-qualified method references work", () => {
    checkOk(`
struct User {
  id: i32;

  fn show(self) -> i32 {
    return self.id;
  }

  fn new(id: i32) -> Self {
    return Self { id };
  }
}

fn main() -> void {
  let f: fn(User) -> i32 = User.show;
  let g: fn(i32) -> User = User.new;
  let user = g(1);
  let _x: i32 = f(user);
}
`);
  });

  test("for loops use array iteration item types", () => {
    checkOk(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  for item in xs {
    let _x: i32 = item;
  }
}
`);
  });

  test("for loops use custom Iterable<T> item types", () => {
    checkOk(`
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

fn main() -> void {
  let counter = Counter.new(3);
  for item in counter {
    let _x: i32 = item;
  }
}
`);
  });

  test("numeric casts are accepted", () => {
    checkOk(`
fn main() -> void {
  let _a: i64 = 1 as i64;
  let _b: f32 = 1 as f32;
  let _c: i32 = 9 as i32;
  let _d: u8 = 255 as u8;
}
`);
  });

  test("compound assignments are type checked", () => {
    checkOk(`
fn main() -> void {
  let x: i32 = 4;
  x += 2;
  x -= 1;
  x *= 3;
  x /= 2;
  x %= 5;
  x <<= 1;
  x >>= 1;
  x &= 7;
  x ^= 3;
  x |= 8;

  let s: string = "ve";
  s += "k";
}
`);
  });

  test("generic enum variants and methods are type checked", () => {
    checkOk(`
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

fn main() -> void {
  let a: Option<i32> = Some(41);
  let b: Option<i32> = None;
  let user: User = User { id: 1 };
  let maybe_user: Option<User> = Some(user);
  let _x: i32 = a.value_or(0);
  let _y: i32 = b.value_or(2);
  let _u: User = maybe_user.value_or(User { id: 0 });
  let _pair: (Option<i32>, bool) = a.pair(true);
}
`);
  });

  test("generic function value assigned to matching bounded type is accepted", () => {
    checkOk(`
fn same<T: Equal<T>>(a: T, b: T) -> bool {
  return a.equals(b);
}

fn main() -> void {
  let _f: fn<T: Equal<T>>(T, T) -> bool = same;
}
`);
  });

  test("where clause on function type annotation is resolved by checker", () => {
    checkOk(`
fn eq_ints(a: i32, b: i32) -> bool {
  return a.equals(b);
}

fn apply_eq<T>(a: T, b: T) -> bool where T: Equal<T> {
  return a.equals(b);
}

fn main() -> void {
  let _r: bool = apply_eq(1, 2);
}
`);
  });

  test("unsafe extern fn is callable from unsafe blocks and return type is checked", () => {
    checkOk(`
unsafe extern fn add(a: i32, b: i32) -> i32;
unsafe extern "abs" fn c_abs(value: i32) -> i32;

fn main() -> void {
  let _x: i32 = unsafe { add(1, 2) };
  let _y: i32 = unsafe { c_abs(-1) };
}
`);
  });

  test("E2901/E2902: imported extern functions are unsafe", () => {
    const missingUnsafe = check(`
extern fn add(a: i32, b: i32) -> i32;
`);
    expectDiagnostics(missingUnsafe.checkDiagnostics, ["E2902"]);

    const unsafeCall = check(`
unsafe extern fn add(a: i32, b: i32) -> i32;

fn main() -> i32 {
  return add(1, 2);
}
`);
    expectDiagnostics(unsafeCall.checkDiagnostics, ["E2901"]);
  });

  test("E2910: extern symbol names must be C identifiers", () => {
    const result = check(`
unsafe extern "bad-name" fn bad(value: i32) -> i32;
`);

    expectDiagnostics(result.checkDiagnostics, ["E2910"]);
  });

  test("E2910: duplicate extern C symbol names are rejected", () => {
    const result = check(`
unsafe extern fn abs(value: i32) -> i32;
unsafe extern "abs" fn c_abs(value: i32) -> i32;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2910"]);
  });

  test("E2904: generic extern fn is rejected", () => {
    const result = check(`
unsafe extern fn identity<T>(value: T) -> T;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2904", "E2903"]);
  });

  test("E2903: non-ABI-safe type in extern fn signature is rejected", () => {
    const result = check(`
unsafe extern fn bad(message: string) -> i32;
`);
    expectDiagnostics(result.checkDiagnostics, ["E2903"]);
  });

  test("E2903: interior NUL byte in cstr literal is rejected", () => {
    const result = check(`
unsafe extern fn puts(s: cstr) -> i32;

fn main() -> void {
  let _ = unsafe { puts("he\0llo") };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2903"]);
  });

  test("E2901: dereferencing a pointer outside unsafe context is rejected", () => {
    const result = check(`
unsafe extern fn get_ptr() -> const_ptr<i32>;

fn main() -> i32 {
  let p = unsafe { get_ptr() };
  return *p;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2901"]);
  });

  test("E2901: pointer.offset() outside unsafe context is rejected", () => {
    const result = check(`
unsafe extern fn get_ptr() -> const_ptr<i32>;

fn test() -> void {
  let p: const_ptr<i32> = unsafe { get_ptr() };
  let _: const_ptr<i32> = p.offset(1);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2901", "E2901"]);
  });

  test("E2901: pointer index outside unsafe context is rejected", () => {
    const result = check(`
unsafe extern fn get_ptr() -> const_ptr<i32>;

fn test() -> void {
  let p: const_ptr<i32> = unsafe { get_ptr() };
  let _: i32 = p[0];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2901"]);
  });

  test("E2901: cast to raw pointer outside unsafe context is rejected", () => {
    const result = check(`
fn get() -> ptr<i32> {
  return 0x1000 as ptr<i32>;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2901"]);
  });

  test("E2907: dereferencing a non-pointer is rejected", () => {
    const result = check(`
fn main() -> i32 {
  let x: i32 = 42;
  return unsafe { *x };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2907"]);
  });

  test("E2908: writing through const_ptr is rejected", () => {
    const result = check(`
unsafe extern fn get_ptr() -> const_ptr<i32>;

fn main() -> void {
  let p = unsafe { get_ptr() };
  unsafe { *p = 1; }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2908"]);
  });

  test("E2909: dereferencing ptr<void> is rejected", () => {
    const result = check(`
unsafe extern fn malloc(size: usize) -> ptr<void>?;

fn main() -> void {
  let p = unsafe { malloc(8) };
  if p != null {
    let _ = unsafe { *p };
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2909"]);
  });

  test("ptr<T> and const_ptr<T> read/write operations are accepted in unsafe context", () => {
    checkOk(`
unsafe extern fn get_mutable() -> ptr<i32>;
unsafe extern fn get_readonly() -> const_ptr<i32>;

fn main() -> i32 {
  let mp: ptr<i32> = unsafe { get_mutable() };
  unsafe { *mp = 99; }
  let cp: const_ptr<i32> = unsafe { get_readonly() };
  let a: i32 = unsafe { *mp };
  let b: i32 = unsafe { *cp };
  let c: i32 = unsafe { mp[0] };
  let _d: ptr<i32> = unsafe { mp.offset(1) };
  let _e: const_ptr<i32> = unsafe { cp.offset(2) };
  return a + b + c;
}
`);
  });

  test("pointer offset and index require isize, not i32", () => {
    const result = check(`
unsafe extern fn get_ptr() -> ptr<i32>;

fn test() -> void {
  let p: ptr<i32> = unsafe { get_ptr() };
  let n: i32 = 1;
  let _a: ptr<i32> = unsafe { p.offset(n) };
  let _b: i32 = unsafe { p[n] };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2207", "E2101"]);
  });

  test("pointer offset and index accept isize", () => {
    checkOk(`
unsafe extern fn get_ptr() -> ptr<i32>;

fn test() -> void {
  let p: ptr<i32> = unsafe { get_ptr() };
  let n: isize = -1;
  let _a: ptr<i32> = unsafe { p.offset(n) };
  let _b: i32 = unsafe { p[n] };
}
`);
  });

  test("string.to_cstr() returns cstr and is accepted as a cstr argument", () => {
    checkOk(`
unsafe extern fn puts(s: cstr) -> i32;

fn main() -> void {
  let message: string = "hello";
  let c: cstr = message.to_cstr();
  let _a = unsafe { puts(c) };
  let _b = unsafe { puts(message.to_cstr()) };
}
`);
  });

  test("cstr parameter and string literal coercion are accepted", () => {
    checkOk(`
unsafe extern fn puts(s: cstr) -> i32;
unsafe extern fn strlen(s: cstr) -> usize;

fn main() -> void {
  let _ = unsafe { puts("hello from C") };
  let _n: usize = unsafe { strlen("hi") };
}
`);
  });

  test("isize is accepted in C ABI extern fn signatures", () => {
    checkOk(`
unsafe extern fn ptrdiff_example(a: isize, b: isize) -> isize;

fn main() -> void {
  let _: isize = unsafe { ptrdiff_example(1, -2) };
}
`);
  });

  test("unsafe fn is safe to define but unsafe to call", () => {
    const result = check(`
unsafe fn danger() -> i32 {
  return 0;
}

fn main() -> i32 {
  return danger();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2901"]);

    checkOk(`
unsafe fn danger() -> i32 {
  return 0;
}

fn main() -> i32 {
  return unsafe { danger() };
}
`);
  });

  test("inline function emits non-guarantee warning", () => {
    const result = check(`
inline fn add(a: i32, b: i32) -> i32 {
  return a + b;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["W2903"]);
    assert.match(
      result.checkDiagnostics[0]?.message ?? "",
      /not required to inline/i,
    );
  });

  test("inline extern function warns that inline has no effect", () => {
    const result = check(`
inline unsafe extern fn add(a: i32, b: i32) -> i32;
`);
    expectDiagnostics(result.checkDiagnostics, ["W2904"]);
    assert.match(
      result.checkDiagnostics[0]?.message ?? "",
      /do not emit a local function body/i,
    );
  });

  test("inline method emits non-guarantee warning", () => {
    const result = check(`
struct Counter {
  value: i32;

  inline fn get(self) -> i32 {
    return self.value;
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["W2903"]);
    assert.match(
      result.checkDiagnostics[0]?.message ?? "",
      /not required to inline/i,
    );
  });

  test("primitives satisfy Hashable, Ordered, Cloneable, Defaultable", () => {
    checkOk(`
fn needs_hashable<T: Hashable>(_x: T) -> void { return; }
fn needs_ordered<T: Ordered<T>>(_a: T, _b: T) -> void { return; }
fn needs_cloneable<T: Cloneable>(_x: T) -> void { return; }
fn needs_defaultable<T: Defaultable>(_x: T) -> void { return; }

fn main() -> void {
  needs_hashable(42);
  needs_ordered(1, 2);
  needs_cloneable(3);
  needs_defaultable(4);
}
`);
  });

  test("string satisfies Hashable, Ordered, Cloneable, Defaultable, Formattable", () => {
    checkOk(`
fn needs_hashable<T: Hashable>(_x: T) -> void { return; }
fn needs_ordered<T: Ordered<T>>(_a: T, _b: T) -> void { return; }
fn needs_cloneable<T: Cloneable>(_x: T) -> void { return; }
fn needs_formattable<T: Formattable>(x: T) -> string { return x.format(); }

fn main() -> void {
  let s: string = "hello";
  needs_hashable(s);
  needs_ordered(s, s);
  needs_cloneable(s);
  needs_formattable(s);
}
`);
  });

  test("tuple satisfies Equal, Formattable, Hashable, Cloneable", () => {
    checkOk(`
fn needs_eq<T: Equal<T>>(a: T, b: T) -> bool { return a.equals(b); }
fn needs_fmt<T: Formattable>(x: T) -> string { return x.format(); }
fn needs_hashable<T: Hashable>(_x: T) -> void { return; }
fn needs_cloneable<T: Cloneable>(_x: T) -> void { return; }

fn main() -> void {
  let pair: (i32, string) = (1, "a");
  needs_eq(pair, pair);
  needs_fmt(pair);
  needs_hashable(pair);
  needs_cloneable(pair);
}
`);
  });

  test("nullable satisfies Equal and Formattable", () => {
    checkOk(`
fn eq<T: Equal<T>>(a: T, b: T) -> bool { return a.equals(b); }
fn fmt<T: Formattable>(x: T) -> string { return x.format(); }

fn main() -> void {
  let x: i32? = null;
  let _e = eq(x, x);
  let _f = fmt(x);
}
`);
  });

  test("nullable satisfies Unwrappable<T> and unwrap is callable", () => {
    checkOk(`
fn main() -> void {
  let x: i32? = 42;
  let _v: i32 = x.unwrap();
}
`);
  });

  test("Result satisfies Unwrappable<T> and unwrap is callable", () => {
    checkOk(`
fn main() -> void {
  let r: Result<i32, string> = Ok(1);
  let _v: i32 = r.unwrap();
}
`);
  });

  test("Array satisfies Formattable when element is Formattable", () => {
    checkOk(`
fn fmt<T: Formattable>(x: T) -> string { return x.format(); }

fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  let _f = fmt(xs);
}
`);
  });

  test("Ordering satisfies Formattable", () => {
    checkOk(`
fn fmt<T: Formattable>(x: T) -> string { return x.format(); }

fn main() -> void {
  let _f = fmt(Less);
}
`);
  });

  test("enum unit variants are valid in expression position", () => {
    checkOk(`
enum Color {
  Red;
  Green;
  Blue;
}

fn pick(flag: bool) -> Color {
  if flag {
    return Red;
  }
  return Blue;
}

fn main() -> void {
  let _c: Ordering = Less;
  let _d: Color = pick(true);
}
`);
  });

  test("Ordering satisfies Equal<Ordering>", () => {
    checkOk(`
fn eq<T: Equal<T>>(a: T, b: T) -> bool { return a.equals(b); }

fn main() -> void {
  let _r = eq(Less, Greater);
}
`);
  });

  test("Ordering satisfies Hashable", () => {
    checkOk(`
fn needs_hashable<T: Hashable>(_x: T) -> void { return; }

fn main() -> void {
  needs_hashable(Equal);
}
`);
  });

  test("Array satisfies Cloneable when element is Cloneable", () => {
    checkOk(`
fn needs_clone<T: Cloneable>(_x: T) -> void { return; }

fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  needs_clone(xs);
}
`);
  });

  test("Array satisfies Defaultable", () => {
    checkOk(`
fn needs_default<T: Defaultable>(_x: T) -> void { return; }

fn main() -> void {
  let xs: i32[] = [];
  needs_default(xs);
}
`);
  });

  test("Array satisfies Iterable<T> when element types match", () => {
    checkOk(`
fn consume<T: Iterable<i32>>(_t: T) -> void { return; }

fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  consume(xs);
}
`);
  });

  test("used local suppresses W2901", () => {
    const result = check(`
fn double(x: i32) -> i32 {
  let y: i32 = x + x;
  return y;
}
`);
    assert.ok(
      !result.checkDiagnostics.some((d) => d.code === "W2901"),
      "unexpected W2901 for used local",
    );
  });

  test("underscore-prefixed locals suppress unused warnings", () => {
    const result = check(`
fn work(_unused: string) -> void {
  let _result: i32 = 1;
  return;
}
`);
    assert.ok(
      !result.checkDiagnostics.some(
        (d) => d.code === "W2901" || d.code === "W2902",
      ),
      "unexpected unused warning for _-prefixed names",
    );
  });
});

describe("checker diagnostics", () => {
  test("E2001: unknown identifier", () => {
    const result = check(`
fn main() -> void {
  let _x = y;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2001"]);
  });

  test("E2101: bool conditions are required", () => {
    const result = check(`
fn main() -> void {
  if 1 {
    return;
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2501: const assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  const x: i32 = 1;
  x = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("E2501: const nested mutation is rejected", () => {
    const result = check(`
struct User {
  id: i32;
}

fn main() -> void {
  const user = User { id: 1 };
  user.id = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("E2501: const array element assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  const xs: i32[] = [1, 2, 3];
  xs[0] = 9;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("E2503: readonly parameter assignment is rejected", () => {
    const result = check(`
fn bump(x: i32) -> void {
  x = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("E2503: readonly parameter nested mutation is rejected", () => {
    const result = check(`
struct User {
  id: i32;
}

fn bump(user: User) -> void {
  user.id = 2;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("E2501: mutating methods may not be called through const receivers", () => {
    const result = check(`
struct Counter {
  value: i32;

  fn bump(mut self) -> void {
    self.value = self.value + 1;
  }
}

fn main() -> void {
  const counter = Counter { value: 1 };
  counter.bump();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2501"]);
  });

  test("E2503: mutating methods may not be called through readonly parameters", () => {
    const result = check(`
struct Counter {
  value: i32;

  fn bump(mut self) -> void {
    self.value = self.value + 1;
  }
}

fn tick(counter: Counter) -> void {
  counter.bump();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2503"]);
  });

  test("E2101: bitwise operators require integers", () => {
    const result = check(`
fn main() -> void {
  let _x = 1.0 & 2.0;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2403: compile-time invalid shifts are rejected", () => {
    const result = check(`
fn main() -> void {
  let _x: i8 = 1 << 8;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2403"]);
  });

  test("E2402: compile-time integer overflow is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x: i8 = 127 + 1;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2402"]);
  });

  test("E2404: compile-time division by zero is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x: i32 = 1 / 0;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2404"]);
  });

  test("E2404: compile-time modulo by zero is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x: i32 = 1 % 0;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2404"]);
  });

  test("E2402: signed min divided by minus one is rejected at compile time", () => {
    const result = check(`
fn main() -> void {
  let _x: i8 = -128 / -1;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2402"]);
  });

  test("E2104: invalid index target is rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  let _y = x[0];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("E2104: member access on invalid receivers is rejected", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  let _y = x.name;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("E2504: tuple element assignment is rejected", () => {
    const result = check(`
fn main() -> void {
  let pair: (i32, i32) = (1, 2);
  pair.0 = 3;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2504"]);
  });

  test("E2102: empty arrays require contextual element types", () => {
    const result = check(`
fn main() -> void {
  let _xs = [];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2102"]);
  });

  test("E2207/E2101: bad arguments are still checked when the callee is not callable", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
  x(1 + true);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2207", "E2101"]);
  });

  test("E2104/E2101: bad arithmetic in imported-call arguments is still diagnosed", () => {
    const result = check(`
import "std:io" as io;

fn main() -> void {
  io.print(1 + true);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104", "E2101"]);
  });

  test("E2002: struct literals require complete known fields", () => {
    const result = check(`
struct User {
  id: i32;
  name: string;
}

let user = User { id: 1, name: "a", id: 2 };
`);
    expectDiagnostics(result.checkDiagnostics, ["E2002"]);
  });

  test("W2602: match expression warns on shadowed arms", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  let label = match value {
    Ok(v) => v.format(),
    _ => "other",
    Ok(_) => "shadowed",
  };
}
`);
    assert.equal(
      result.checkDiagnostics.some((d) => d.code === "W2602"),
      true,
    );
  });

  test("E2101: match expression with expected type checks each arm individually", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  let _label: string = match value {
    Ok(v) => v.format(),
    _ => 42,
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2101: non-terminating void match arms do not satisfy value arms", () => {
    const result = check(`
fn main() -> void {
  let value = true;
  let _number: i32 = match value {
    true => 1,
    _ => { let _x = 0; },
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2606: match expression requires wildcard arm", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  let _label = match value {
    Ok(v) => v.format(),
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2606"]);
  });

  test("W2601: statement match warns on missing enum variants", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  match value {
    Ok(v) => {
      let x = v;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("W2601: statement match warns on missing bool literals", () => {
    const result = check(`
fn main() -> void {
  let value: bool = true;
  match value {
    true => {
      return;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("W2601: statement match warns on missing null arm for nullable values", () => {
    const result = check(`
fn main() -> void {
  let value: i32? = 1;
  match value {
    1 => {
      return;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("W2601: statement match warns on unbounded domains without wildcard", () => {
    const result = check(`
fn main() -> void {
  let value: i32 = 1;
  match value {
    1 => {
      return;
    },
  }
}
`);
    assert.equal(
      result.checkDiagnostics.some((diagnostic) => diagnostic.code === "W2601"),
      true,
    );
  });

  test("E2302: inferred return types reject inconsistent branches", () => {
    const result = check(`
fn pick(flag: bool) {
  if flag {
    return 1;
  }
  return "bad";
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
  });

  test("E2820: generic function inference failure is diagnosed", () => {
    const result = check(`
fn keep<T>() -> i32 {
  return 1;
}

fn main() -> void {
  let _x = keep();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2820"]);
  });

  test("E2302: anonymous function inferred return type rejects inconsistent branches", () => {
    const result = check(`
fn main() -> void {
  let _pick = fn(flag: bool) {
    if flag {
      return 1;
    }
    return "bad";
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2302"]);
  });

  test("E2813: anonymous function may not capture outer locals", () => {
    const result = check(`
fn main() -> void {
  let offset: i32 = 2;
  let _add = fn(x: i32) -> i32 {
    return x + offset;
  };
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2813"]);
  });

  test("E2818/E2104: trait names are rejected as parameter types", () => {
    const result = check(`
trait Named {
  fn name(self) -> string;
}

fn render(value: Named) -> string {
  return value.name();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2818", "E2104"]);
  });

  test("E2819: ambiguous type-parameter methods are diagnosed", () => {
    const result = check(`
trait LeftName {
  fn name(self) -> string;
}

trait RightName {
  fn name(self) -> string;
}

fn render<T>(value: T) -> string
where T: LeftName, T: RightName
{
  return value.name();
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2819"]);
  });

  test("E2101: structs without Equal<T> cannot use ==", () => {
    const result = check(`
struct UserId {
  value: i32;
}

fn main() -> void {
  let left = UserId { value: 1 };
  let right = UserId { value: 1 };
  let _same = left == right;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2815: trait method mismatch is diagnosed", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  id: i32;

  satisfies Printable {
    fn print(self) -> i32 {
      return self.id;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2815"]);
  });

  test("E2817: duplicate satisfies blocks for the same trait are rejected", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

struct User {
  name: string;

  satisfies Printable {
    fn print(self) -> void {
      return;
    }
  }

  satisfies Printable {
    fn print(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
  });

  test("E2817: trait methods may not conflict with inherent methods", () => {
    const result = check(`
trait Printable {
  fn show(self) -> void;
}

struct User {
  name: string;

  fn show(self) -> void {
    return;
  }

  satisfies Printable {
    fn show(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
  });

  test("E2817: multiple satisfied traits may not expose the same method name", () => {
    const result = check(`
trait Left {
  fn show(self) -> void;
}

trait Right {
  fn show(self) -> void;
}

struct User {
  name: string;

  satisfies Left {
    fn show(self) -> void {
      return;
    }
  }

  satisfies Right {
    fn show(self) -> void {
      return;
    }
  }
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2817"]);
  });

  test("E2105: bool cast to integer is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x = true as i32;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("E2105: integer cast to bool is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x = 1 as bool;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("E2105: null cast is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x = null as i32;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2105"]);
  });

  test("E2101: generic function value assigned to differently bounded type is rejected", () => {
    const result = check(`
trait Printable {
  fn print(self) -> void;
}

trait Loggable {
  fn log(self) -> void;
}

fn show<T: Printable>(a: T) -> void {
  a.print();
}

fn main() -> void {
  let _f: fn<T: Loggable>(T) -> void = show;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2101: enum unit variant used as wrong type is rejected", () => {
    const result = check(`
fn main() -> void {
  let _x: i32 = Less;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("E2816: bool does not satisfy Ordered<bool>", () => {
    const result = check(`
fn needs_ordered<T: Ordered<T>>(_a: T, _b: T) -> void { return; }

fn main() -> void {
  needs_ordered(true, false);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: struct without Equal satisfaction fails Equal bound", () => {
    const result = check(`
struct Point {
  x: i32;
  y: i32;
}

fn needs_eq<T: Equal<T>>(_a: T, _b: T) -> void { return; }

fn main() -> void {
  let p = Point { x: 1, y: 2 };
  needs_eq(p, p);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Array of non-Equal element fails Equal bound", () => {
    const result = check(`
struct Item {
  value: i32;
}

fn needs_eq<T: Equal<T>>(_a: T, _b: T) -> void { return; }

fn main() -> void {
  let xs: Item[] = [];
  needs_eq(xs, xs);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Array of non-Cloneable element fails Cloneable bound", () => {
    const result = check(`
struct Widget {
  id: i32;
}

fn needs_clone<T: Cloneable>(_x: T) -> void { return; }

fn main() -> void {
  let xs: Widget[] = [];
  needs_clone(xs);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Array fails Iterable bound when element type mismatches", () => {
    const result = check(`
fn consume<T: Iterable<i32>>(_t: T) -> void { return; }

fn main() -> void {
  let xs: string[] = [];
  consume(xs);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Tuple fails Equal bound when an element has no Equal", () => {
    const result = check(`
struct Item {
  value: i32;
}

fn needs_eq<T: Equal<T>>(_a: T, _b: T) -> void { return; }

fn main() -> void {
  let pair: (i32, Item) = (1, Item { value: 2 });
  needs_eq(pair, pair);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Tuple fails Hashable when an element is not Hashable", () => {
    const result = check(`
struct Item {
  value: i32;
}

fn needs_hash<T: Hashable>(_x: T) -> void { return; }

fn main() -> void {
  let pair: (i32, Item) = (1, Item { value: 2 });
  needs_hash(pair);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("E2816: Nullable fails Equal when base type has no Equal", () => {
    const result = check(`
struct Item {
  value: i32;
}

fn needs_eq<T: Equal<T>>(_a: T, _b: T) -> void { return; }

fn main() -> void {
  let x: Item? = null;
  needs_eq(x, x);
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2816"]);
  });

  test("W2901: unused local variable gets W2901 warning", () => {
    const result = check(`
fn main() -> void {
  let x: i32 = 1;
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "W2901"),
      "expected W2901 for unused local",
    );
  });

  test("W2902: unused parameter gets W2902 warning", () => {
    const result = check(`
fn greet(name: string) -> void {
  return;
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "W2902"),
      "expected W2902 for unused parameter",
    );
  });

  test("W2901: for-loop iterator is tracked as a local", () => {
    const result = check(`
fn main() -> void {
  let xs: i32[] = [1, 2, 3];
  for item in xs {
    return;
  }
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "W2901"),
      "expected W2901 for unused for-loop iterator",
    );
  });

  test("W2901: match arm binding is tracked as a local", () => {
    const result = check(`
fn main() -> void {
  let value: Result<i32, string> = Ok(1);
  match value {
    Ok(v) => { return; },
    _ => { return; },
  }
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "W2901"),
      "expected W2901 for unused match binding",
    );
  });

  test("E2204: mut parameter requires a mutable identifier", () => {
    const result = check(`
fn takes_mut(mut _x: i32) -> void { return; }

fn main() -> void {
  takes_mut(42);
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "E2204"),
      "expected E2204 for literal passed to mut parameter",
    );
  });

  test("E2812: unknown trait in satisfies block", () => {
    const result = check(`
struct Foo {
  x: i32;

  satisfies Nonexistent {
    fn method(self) -> void { return; }
  }
}

fn main() -> void {
  let _f = Foo { x: 1 };
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "E2812"),
      "expected E2812 for unknown trait in satisfies",
    );
  });

  test("E2812: unknown type parameter in where clause", () => {
    const result = check(`
fn foo<T>(_x: T) -> void where U: Equal<U> { return; }

fn main() -> void {
  foo(1);
}
`);
    assert.ok(
      result.checkDiagnostics.some((d) => d.code === "E2812"),
      "expected E2812 for unknown where-clause type param",
    );
  });

  test("-> never functions satisfy any branch type", () => {
    checkOk(`
fn fail(message: string) -> never {
  panic(message);
}

fn unwrap_or_fail(value: i32?, message: string) -> i32 {
  if value != null {
    value
  } else {
    fail(message)
  }
}

fn label(flag: bool) -> string {
  return match flag {
    true => "yes",
    _ => { fail("impossible"); },
  };
}

fn main() -> void {
  let _x: i32 = unwrap_or_fail(42, "bad");
}
`);
  });

  test("-> never wraps panic and propagates divergence through callers", () => {
    checkOk(`
fn die(message: string) -> never {
  panic(message);
}

fn check_positive(n: i32) -> i32 {
  if n > 0 {
    n
  } else {
    die("not positive")
  }
}

fn main() -> void {
  let _x: i32 = check_positive(5);
}
`);
  });

  test("E2303: -> never function with reachable normal exit is an error", () => {
    const result = check(`
fn bad() -> never {
  let _x = 1;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2303"]);
  });

  test("E2303: -> never function ending in a value expression is an error", () => {
    const result = check(`
fn bad() -> never {
  42
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2302", "E2303"]);
  });

  test("E2106: const without initializer (checker)", () => {
    const result = check(`
const x: i32;
`);
    assert.ok(
      result.parseDiagnostics.some((d) => d.code === "E1011") ||
        result.checkDiagnostics.some((d) => d.code === "E2106"),
      "expected E1011 or E2106 for top-level const without initializer",
    );
  });
});

describe("arithmetic operator traits", () => {
  test("struct satisfying Add<T, T> allows + on that type", () => {
    checkOk(`
struct Vec2 {
  x: i32;
  y: i32;

  satisfies Add<Vec2, Vec2> {
    fn add(self, rhs: Vec2) -> Vec2 {
      return Vec2 { x: self.x + rhs.x, y: self.y + rhs.y };
    }
  }
}

fn main() -> void {
  let a = Vec2 { x: 1, y: 2 };
  let b = Vec2 { x: 3, y: 4 };
  let _c: Vec2 = a + b;
}
`);
  });

  test("struct satisfying Add with heterogeneous Output type is accepted", () => {
    checkOk(`
struct Meters {
  val: i32;
  satisfies Add<Meters, Meters> {
    fn add(self, rhs: Meters) -> Meters {
      return Meters { val: self.val + rhs.val };
    }
  }
}

fn needs_meters(_m: Meters) -> void { return; }

fn main() -> void {
  let a = Meters { val: 10 };
  let b = Meters { val: 5 };
  needs_meters(a + b);
}
`);
  });

  test("+ on named type without Add satisfaction is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void {
  let a = Nope { x: 1 };
  let b = Nope { x: 2 };
  let _c = a + b;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("struct satisfying Sub, Mul, Div, Rem allows those operators", () => {
    checkOk(`
struct N {
  v: i32;
  satisfies Add<N, N> { fn add(self, rhs: N) -> N { return N { v: self.v + rhs.v }; } }
  satisfies Sub<N, N> { fn sub(self, rhs: N) -> N { return N { v: self.v - rhs.v }; } }
  satisfies Mul<N, N> { fn mul(self, rhs: N) -> N { return N { v: self.v * rhs.v }; } }
  satisfies Div<N, N> { fn div(self, rhs: N) -> N { return N { v: self.v / rhs.v }; } }
  satisfies Rem<N, N> { fn rem(self, rhs: N) -> N { return N { v: self.v % rhs.v }; } }
}
fn main() -> void {
  let a = N { v: 10 };
  let b = N { v: 3 };
  let _add: N = a + b;
  let _sub: N = a - b;
  let _mul: N = a * b;
  let _div: N = a / b;
  let _rem: N = a % b;
}
`);
  });

  test("struct satisfying Neg allows unary -", () => {
    checkOk(`
struct Vec2 {
  x: i32;
  y: i32;
  satisfies Neg<Vec2> {
    fn neg(self) -> Vec2 { return Vec2 { x: -self.x, y: -self.y }; }
  }
}
fn main() -> void {
  let a = Vec2 { x: 1, y: 2 };
  let _b: Vec2 = -a;
}
`);
  });

  test("struct satisfying Not allows unary !", () => {
    checkOk(`
struct Flags {
  bits: i32;
  satisfies Not<Flags> {
    fn not(self) -> Flags { return Flags { bits: self.bits }; }
  }
}
fn main() -> void {
  let f = Flags { bits: 0 };
  let _g: Flags = !f;
}
`);
  });

  test("unary - on named type without Neg is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void { let _a = -Nope { x: 1 }; }
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("unary ! on named type without Not is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void { let _a = !Nope { x: 1 }; }
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("struct satisfying BitAnd, BitOr, BitXor, ShiftLeft, ShiftRight allows those operators", () => {
    checkOk(`
struct Bits {
  v: i32;
  satisfies BitAnd<Bits, Bits> { fn bit_and(self, rhs: Bits) -> Bits { return Bits { v: self.v & rhs.v }; } }
  satisfies BitOr<Bits, Bits>  { fn bit_or(self, rhs: Bits)  -> Bits { return Bits { v: self.v | rhs.v }; } }
  satisfies BitXor<Bits, Bits> { fn bit_xor(self, rhs: Bits) -> Bits { return Bits { v: self.v ^ rhs.v }; } }
  satisfies ShiftLeft<Bits, Bits>  { fn shift_left(self, rhs: Bits) -> Bits { return Bits { v: self.v << rhs.v }; } }
  satisfies ShiftRight<Bits, Bits> { fn shift_right(self, rhs: Bits) -> Bits { return Bits { v: self.v >> rhs.v }; } }
}
fn main() -> void {
  let a = Bits { v: 12 };
  let b = Bits { v: 2 };
  let _and: Bits = a & b;
  let _or:  Bits = a | b;
  let _xor: Bits = a ^ b;
  let _shl: Bits = a << b;
  let _shr: Bits = a >> b;
}
`);
  });

  test("struct satisfying Ordered<T> allows comparison operators", () => {
    checkOk(`
struct Score {
  v: i32;
  satisfies Ordered<Score> {
    fn compare(self, rhs: Score) -> Ordering {
      if self.v < rhs.v { return Less; }
      if self.v > rhs.v { return Greater; }
      return Equal;
    }
  }
}
fn main() -> void {
  let a = Score { v: 1 };
  let b = Score { v: 2 };
  let _lt: bool = a < b;
  let _le: bool = a <= b;
  let _gt: bool = a > b;
  let _ge: bool = a >= b;
}
`);
  });

  test("generic Ordered<T> bounds allow comparison operators", () => {
    checkOk(`
fn less<T: Ordered<T>>(a: T, b: T) -> bool {
  return a < b;
}

struct Score {
  v: i32;
  satisfies Ordered<Score> {
    fn compare(self, rhs: Score) -> Ordering {
      if self.v < rhs.v { return Less; }
      if self.v > rhs.v { return Greater; }
      return Equal;
    }
  }
}
fn main() -> void {
  let _x = less<Score>(Score { v: 1 }, Score { v: 2 });
}
`);
  });

  test("< on named type without Ordered satisfaction is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void {
  let a = Nope { x: 1 };
  let b = Nope { x: 2 };
  let _c = a < b;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("& on named type without BitAnd is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void {
  let a = Nope { x: 1 };
  let _b = a & a;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2101"]);
  });

  test("primitives implicitly satisfy Add<T, T>", () => {
    checkOk(`
fn needs_add<T: Add<T, T>>(a: T, b: T) -> T { return a + b; }

fn main() -> void {
  let _x: i32 = needs_add(1, 2);
  let a: f64 = 1.0;
  let b: f64 = 2.0;
  let _y: f64 = needs_add(a, b);
}
`);
  });

  test("struct satisfying IndexGet allows [] read", () => {
    checkOk(`
struct SlotMap {
  k: i32;
  v: i32;
  satisfies IndexGet<i32, i32> {
    fn index_get(self, index: i32) -> i32 { return self.v + index; }
  }
}
fn main() -> void {
  let m = SlotMap { k: 1, v: 42 };
  let _x: i32 = m[1];
}
`);
  });

  test("struct satisfying IndexSet allows [] write", () => {
    checkOk(`
struct SlotMap {
  k: i32;
  v: i32;
  satisfies IndexGet<i32, i32> {
    fn index_get(self, index: i32) -> i32 { return self.v + index; }
  }
  satisfies IndexSet<i32, i32> {
    fn index_set(mut self, index: i32, value: i32) -> void { self.v = value + index; }
  }
}
fn main() -> void {
  let m = SlotMap { k: 1, v: 0 };
  m[1] = 42;
}
`);
  });

  test("generic IndexGet bound allows [] read", () => {
    checkOk(`
struct SlotMap {
  v: i32;
  satisfies IndexGet<i32, i32> {
    fn index_get(self, index: i32) -> i32 { return self.v + index; }
  }
}

fn lookup<T: IndexGet<i32, i32>>(value: T) -> i32 {
  return value[0];
}

fn main() -> void {
  let m = SlotMap { v: 42 };
  let _x: i32 = lookup(m);
}
`);
  });

  test("generic IndexSet bound allows [] write through mut parameter", () => {
    checkOk(`
struct SlotMap {
  v: i32;
  satisfies IndexSet<i32, i32> {
    fn index_set(mut self, index: i32, value: i32) -> void { self.v = value + index; }
  }
}

fn store<T: IndexSet<i32, i32>>(mut value: T) -> void {
  value[0] = 42;
}

fn main() -> void {
  let m = SlotMap { v: 0 };
  store(m);
}
`);
  });

  test("built-in arrays and strings satisfy IndexGet traits", () => {
    checkOk(`
fn array_first<T: IndexGet<usize, i32>>(value: T) -> i32 {
  let index: usize = 0;
  return value[index];
}

fn string_first<T: IndexGet<usize, string>>(value: T) -> string {
  let index: usize = 0;
  return value[index];
}

fn main() -> void {
  let xs: i32[] = [1, 2];
  let _x: i32 = array_first(xs);
  let _s: string = string_first("hi");
}
`);
  });

  test("built-in arrays satisfy IndexSet traits", () => {
    checkOk(`
fn store<T: IndexSet<usize, i32>>(mut value: T) -> void {
  let index: usize = 0;
  value[index] = 42;
}

fn main() -> void {
  let xs: i32[] = [1, 2];
  store(xs);
}
`);
  });

  test("[] on named type without IndexGet is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void {
  let n = Nope { x: 1 };
  let _v = n[0];
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });

  test("[] assignment on named type without IndexSet is rejected", () => {
    const result = check(`
struct Nope { x: i32; }
fn main() -> void {
  let n = Nope { x: 1 };
  n[0] = 5;
}
`);
    expectDiagnostics(result.checkDiagnostics, ["E2104"]);
  });
});
