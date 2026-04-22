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

  test("emits inferred i32 main return type", () => {
    const c = emitOk(`
fn main() {
  let sum = 0;
  for i in [1, 2, 3] {
    sum = sum + i;
  }
  return sum;
}
`);

    assert.ok(c.includes("static int32_t __vek_fn_main(void);"));
    assert.ok(c.includes("static int32_t __vek_fn_main(void) {"));
    assert.ok(c.includes("  return __vek_fn_main();"));
  });

  test("emits generic function specialization for struct types", () => {
    const c = emitOk(`
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
`);

    assert.ok(
      c.includes(
        "static __vek_struct_User __vek_fn_id__User(__vek_struct_User v0);",
      ),
    );
    assert.ok(!c.includes("__vek_struct_T"));
    assert.ok(c.includes("__vek_fn_id__User(v0);"));
  });

  test("emits generic method specialization for struct types", () => {
    const c = emitOk(`
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
`);

    assert.ok(
      c.includes(
        "static __vek_struct_User __vek_fn_Container__map__User(__vek_struct_Container v0, __vek_struct_User v1);",
      ),
    );
    assert.ok(!c.includes("__vek_fn_Container_map"));
    assert.ok(!c.includes("__vek_struct_T"));
    assert.ok(c.includes("__vek_fn_Container__map__User(v0, v1);"));
  });

  test("emits generic struct specialization for aggregate fields", () => {
    const c = emitOk(`
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
`);

    assert.ok(c.includes("} __vek_struct_Box__User;"));
    assert.ok(c.includes("  __vek_struct_User value;"));
    assert.ok(
      c.includes(
        "static __vek_struct_User __vek_fn_Box__User_get(__vek_struct_Box__User v0);",
      ),
    );
    assert.ok(c.includes("__vek_fn_Box__User_get(v1);"));
    assert.ok(!c.includes("__vek_struct_T"));
    assert.ok(!c.includes("__vek_struct_Box;"));
    assert.ok(!c.includes("__vek_fn_Box_get"));
  });

  test("emits generic method specialization on generic struct owner", () => {
    const c = emitOk(`
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
`);

    assert.ok(c.includes("} __vek_struct_Box__User;"));
    assert.ok(
      c.includes(
        "static __vek_tuple_User__i32 __vek_fn_Box__User_pair__i32(__vek_struct_Box__User v0, int32_t v1);",
      ),
    );
    assert.ok(c.includes("__vek_fn_Box__User_pair__i32(v1, 7);"));
    assert.ok(!c.includes("__vek_struct_T"));
    assert.ok(!c.includes("__vek_fn_Box_pair"));
  });

  test("emits generic enum specialization and generic enum methods", () => {
    const c = emitOk(`
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
`);

    assert.ok(c.includes("} __vek_enum_Option__i32;"));
    assert.ok(c.includes("} __vek_enum_Option__User;"));
    assert.ok(!c.includes("__vek_enum_Option "));
    assert.ok(c.includes("__vek_fn_Option__i32_value_or"));
    assert.ok(c.includes("__vek_fn_Option__User_value_or"));
    assert.ok(c.includes("__vek_fn_Option__i32_pair__bool"));
    assert.ok(c.includes("__vek_fn_Option__i32_pair__bool(v0, true);"));
  });

  test("lowers panic to the runtime helper", () => {
    const c = emitOk(`
fn main() -> void {
  panic("boom");
}
`);

    assert.ok(c.includes("__vek_panic_cstr(") && c.includes("->data"));
  });

  test("emits top-level globals and global loads", () => {
    const c = emitOk(`
let counter: i32 = 41;
const label: string = "count";

fn get_counter() -> i32 {
  return counter;
}
`);

    assert.ok(c.includes("static int32_t __vek_global_counter = 41;"));
    assert.ok(c.includes("static const __vek_string * __vek_global_label ="));
    assert.ok(c.includes("&__vek_str_"));
    assert.ok(c.includes("return __vek_global_counter;"));
  });

  test("emits store_global for top-level let assignment", () => {
    const c = emitOk(`
let counter: i32 = 0;

fn inc() -> i32 {
  counter = counter + 1;
  return counter;
}
`);

    assert.ok(c.includes("__vek_global_counter ="));
    assert.ok(c.includes("return __vek_global_counter;"));
  });

  test("emits compound assignment as binary operation and assignment", () => {
    const c = emitOk(`
fn main() -> i32 {
  let x: i32 = 4;
  x += 2;
  x *= 5;
  return x;
}
`);

    assert.ok(c.includes("int32_t t0 = v0 + 2;"));
    assert.ok(c.includes("v0 = t0;"));
    assert.ok(c.includes("int32_t t1 = v0 * 5;"));
    assert.ok(c.includes("v0 = t1;"));
  });

  test("emits compound assignment through assignable places", () => {
    const c = emitOk(`
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
  return total;
}
`);

    assert.ok(c.includes(".value ="));
    assert.ok(c.includes("__vek_array_get("));
    assert.ok(c.includes("__vek_array_set("));
    assert.ok(c.includes("__vek_global_total ="));
    assert.ok(c.includes("__vek_string_concat("));
  });

  test("emits lazy global initializer guards", () => {
    const c = emitOk(`
fn make() -> i32 {
  return 41;
}

const answer: i32 = make();

fn main() -> i32 {
  return answer;
}
`);

    assert.ok(c.includes("static int32_t __vek_global_answer;"));
    assert.ok(c.includes("static int __vek_global_answer_state = 0;"));
    assert.ok(c.includes("static void __vek_ensure_global_answer(void) {"));
    assert.ok(c.includes("if (__vek_global_answer_state == 2) return;"));
    assert.ok(c.includes('__vek_panic_cstr("cyclic top-level initializer");'));
    assert.ok(c.includes("__vek_fn___vek_init_global_answer();"));
    assert.ok(c.includes("__vek_ensure_global_answer();"));
    assert.ok(c.includes("__vek_global_answer ="));
  });

  test("emits tuple typedefs, construction, and field access", () => {
    const c = emitOk(`
fn second() -> i32 {
  let pair: (bool, i32) = (true, 42);
  return pair.1;
}
`);

    assert.ok(c.includes("typedef struct {"));
    assert.ok(c.includes("  bool _0;"));
    assert.ok(c.includes("  int32_t _1;"));
    assert.ok(c.includes("} __vek_tuple_bool__i32;"));
    assert.ok(c.includes("._0 = true"));
    assert.ok(c.includes("._1 = 42"));
    assert.ok(c.includes("._1;"));
  });

  test("emits nullable typedefs, construction, checks, and unwraps", () => {
    const c = emitOk(`
fn main() -> i32 {
  let maybe_num: i32? = 42;
  if maybe_num != null {
    return maybe_num;
  }
  return 0;
}
`);

    assert.ok(c.includes("typedef struct {"));
    assert.ok(c.includes("  bool is_null;"));
    assert.ok(c.includes("  int32_t value;"));
    assert.ok(c.includes("} __vek_nullable_i32;"));
    assert.ok(c.includes(".is_null = false"));
    assert.ok(c.includes(".value = 42"));
    assert.ok(c.includes(".is_null;"));
    assert.ok(c.includes(".value;"));
  });

  test("emits if/else as labels and conditional goto", () => {
    const c = emitOk(`
fn max(a: i32, b: i32) -> i32 {
  if a > b {
    return a;
  } else {
    return b;
  }
}
`);

    assert.ok(c.includes("if ("));
    assert.ok(c.includes("goto bb_"));
    assert.ok(c.includes("bb_1:"));
    assert.ok(c.includes("bb_2:"));
  });

  test("emits while loop with condition and body labels", () => {
    const c = emitOk(`
fn count() -> void {
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
  }
  return;
}
`);

    assert.ok(c.includes("goto bb_"));
    assert.ok(c.includes("if ("));
    assert.ok(c.includes("bb_1:"));
    assert.ok(c.includes("bb_2:"));
    assert.ok(c.includes("bb_3:"));
  });

  test("emits unreachable after panic", () => {
    const c = emitOk(`
fn main() -> void {
  panic("boom");
}
`);

    assert.ok(c.includes("__builtin_unreachable();"));
  });

  test("emits struct typedef and compound literal", () => {
    const c = emitOk(`
struct Point {
  x: i32;
  y: i32;
}
fn make() -> Point {
  let p: Point = Point { x: 1, y: 2 };
  return p;
}
`);

    assert.ok(c.includes("typedef struct {"));
    assert.ok(c.includes("  int32_t x;"));
    assert.ok(c.includes("  int32_t y;"));
    assert.ok(c.includes("} __vek_struct_Point;"));
    assert.ok(c.includes("__vek_struct_Point"));
    assert.ok(c.includes(".x = 1"));
    assert.ok(c.includes(".y = 2"));
  });

  test("emits get_field as struct member access", () => {
    const c = emitOk(`
struct Point {
  x: i32;
  y: i32;
}
fn get_x(p: Point) -> i32 {
  return p.x;
}
`);

    assert.ok(c.includes(".x;"));
  });

  test("emits set_field as struct member assignment", () => {
    const c = emitOk(`
struct Point {
  x: i32;
  y: i32;
}
fn move_right(mut p: Point) -> void {
  p.x = p.x + 1;
  return;
}
`);

    assert.ok(c.includes(".x ="));
  });

  test("emits recursive retain and release for struct fields", () => {
    const c = emitOk(`
struct User {
  name: string;
}

fn main() -> i32 {
  let a: User = User { name: "hi" };
  let b: User = a;
  if b.name == "hi" {
    return 42;
  }
  return 0;
}
`);

    assert.ok(c.includes("__vek_string_retain((v0).name);"));
    assert.ok(c.includes("__vek_string_release((v0).name);"));
    assert.ok(c.includes("__vek_string_release((v1).name);"));
  });

  test("emits enum typedef with tag and union", () => {
    const c = emitOk(`
enum Shape {
  Circle(i32);
  Rect(i32, i32);
}
fn main() -> void { return; }
`);

    assert.ok(c.includes("typedef struct {"));
    assert.ok(c.includes("int32_t tag;"));
    assert.ok(c.includes("union {"));
    assert.ok(c.includes("struct { int32_t _0; } Circle;"));
    assert.ok(c.includes("struct { int32_t _0; int32_t _1; } Rect;"));
    assert.ok(c.includes("} __vek_enum_Shape;"));
  });

  test("emits unit variant construction", () => {
    const c = emitOk(`
enum Color {
  Red;
  Green;
  Blue;
}
fn make() -> Color {
  return Red;
}
`);

    assert.ok(c.includes("__vek_enum_Color"));
    assert.ok(c.includes(".tag = 0"));
  });

  test("emits payload variant construction", () => {
    const c = emitOk(`
enum Shape {
  Circle(i32);
}
fn make(r: i32) -> Shape {
  return Circle(r);
}
`);

    assert.ok(c.includes(".tag = 0"));
    assert.ok(c.includes(".data.Circle._0 ="));
  });

  test("emits match on enum as branch chain with get_tag", () => {
    const c = emitOk(`
enum Color {
  Red;
  Green;
  Blue;
}
fn describe(c: Color) -> void {
  match c {
    Red => { return; }
    Green => { return; }
    _ => { return; }
  }
}
`);

    assert.ok(c.includes(".tag;"));
    assert.ok(c.includes("if ("));
    assert.ok(!c.includes("switch ("));
  });

  test("emits payload binding via get_enum_payload", () => {
    const c = emitOk(`
enum Shape {
  Circle(i32);
}
fn area(s: Shape) -> i32 {
  match s {
    Circle(r) => { return r; }
    _ => { return 0; }
  }
}
`);

    assert.ok(c.includes(".data.Circle._0;"));
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

  test("emits function pointer declarations and indirect calls", () => {
    const c = emitOk(`
fn add_one(x: i32) -> i32 {
  return x + 1;
}

fn apply(f: fn(i32) -> i32, x: i32) -> i32 {
  return f(x);
}

fn main() -> i32 {
  let f: fn(i32) -> i32 = add_one;
  return apply(f, 41);
}
`);

    assert.ok(
      c.includes(
        "static int32_t __vek_fn_apply(int32_t (*v0)(int32_t), int32_t v1);",
      ),
    );
    assert.ok(c.includes("int32_t (*v0)(int32_t);"));
    assert.ok(c.includes("v0 = __vek_fn_add_one;"));
    assert.ok(c.includes("t0 = v0(v1);"));
  });

  test("emits non-capturing anonymous functions as generated functions", () => {
    const c = emitOk(`
fn main() -> i32 {
  let f: fn(i32) -> i32 = fn(x: i32) -> i32 {
    return x + 1;
  };
  return f(41);
}
`);

    assert.ok(c.includes("static int32_t __vek_fn___vek_anon_0(int32_t v0);"));
    assert.ok(c.includes("int32_t (*v0)(int32_t);"));
    assert.ok(c.includes("v0 = __vek_fn___vek_anon_0;"));
    assert.ok(c.includes("= v0(41);"));
  });

  test("emits type-qualified method references as function pointers", () => {
    const c = emitOk(`
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
`);

    assert.ok(
      c.includes("static int32_t __vek_fn_User_show(__vek_struct_User v0);"),
    );
    assert.ok(
      c.includes("static __vek_struct_User __vek_fn_User_new(int32_t v0);"),
    );
    assert.ok(c.includes("__vek_struct_User (*v0)(int32_t);"));
    assert.ok(c.includes("int32_t (*v1)(__vek_struct_User);"));
    assert.ok(c.includes("v0 = __vek_fn_User_new;"));
    assert.ok(c.includes("v1 = __vek_fn_User_show;"));
    assert.ok(c.includes("= v0(42);"));
    assert.ok(c.includes("= v1(v2);"));
  });

  test("emits direct instance method calls as static function calls", () => {
    const c = emitOk(`
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
`);

    assert.ok(
      c.includes("static int32_t __vek_fn_User_show(__vek_struct_User v0);"),
    );
    assert.ok(c.includes("__vek_fn_User_show(v0);"));
  });

  test("emits trait satisfaction methods as static functions", () => {
    const c = emitOk(`
trait Scored {
  fn score(self) -> i32;
}

struct User {
  id: i32;

  satisfies Scored {
    fn score(self) -> i32 {
      return self.id;
    }
  }
}

fn main() -> i32 {
  let user: User = User { id: 42 };
  return user.score();
}
`);

    assert.ok(
      c.includes("static int32_t __vek_fn_User_score(__vek_struct_User v0);"),
    );
    assert.ok(c.includes("__vek_fn_User_score(v0);"));
  });

  test("emits Array<T> parameter and local as __vek_array *", () => {
    const c = emitOk(`
fn len(xs: i32[]) -> i32 {
  return xs[0];
}
`);

    assert.ok(c.includes("__vek_array *"));
  });

  test("emits empty array literal as __vek_array_new with NULL data", () => {
    const c = emitOk(`
fn get() -> i32[] {
  let xs: i32[] = [];
  return xs;
}
`);

    assert.ok(
      c.includes("__vek_array_new(sizeof(int32_t), 0, NULL, NULL, NULL)"),
    );
  });

  test("emits array literal with elements as __vek_array_new with compound literal", () => {
    const c = emitOk(`
fn get() -> i32[] {
  return [10, 20, 30];
}
`);

    assert.ok(
      c.includes(
        "__vek_array_new(sizeof(int32_t), 3, (int32_t[]){10, 20, 30}, NULL, NULL)",
      ),
    );
  });

  test("emits array element ownership callbacks for string arrays", () => {
    const c = emitOk(`
fn get() -> string[] {
  return ["a", "b"];
}
`);

    assert.ok(c.includes("static void __vek_array_elem_retain_string"));
    assert.ok(c.includes("static void __vek_array_elem_release_string"));
    assert.ok(c.includes("__vek_string_retain(*(__vek_string * *)element);"));
    assert.ok(
      c.includes(
        "__vek_array_new(sizeof(__vek_string *), 2, (__vek_string *[]){",
      ),
    );
    assert.ok(
      c.includes(
        "__vek_array_elem_retain_string, __vek_array_elem_release_string",
      ),
    );
  });

  test("emits index expression as dereferenced __vek_array_get", () => {
    const c = emitOk(`
fn first(xs: i32[]) -> i32 {
  return xs[0];
}
`);

    assert.ok(c.includes("*(int32_t *)__vek_array_get("));
  });

  test("emits indexed assignment as __vek_array_set", () => {
    const c = emitOk(`
fn set_first(mut xs: i32[]) -> void {
  xs[0] = 42;
}
`);

    assert.ok(c.includes("__vek_array_detach("));
    assert.ok(c.includes("__vek_array_set("));
    assert.ok(c.includes("&(int32_t){"));
  });

  test("emits for loop over array using __vek_array_len and __vek_array_get", () => {
    const c = emitOk(`
fn sum(xs: i32[]) -> i32 {
  let total: i32 = 0;
  for x in xs {
    total = total + x;
  }
  return total;
}
`);

    assert.ok(c.includes("__vek_array_len("));
    assert.ok(c.includes("*(int32_t *)__vek_array_get("));
  });

  test("emits string literals as static __vek_string globals", () => {
    const c = emitOk(`
fn greet() -> string {
  return "hello";
}
`);

    assert.ok(c.includes("static __vek_string __vek_str_0 ="));
    assert.ok(c.includes(".ref_count = -1"));
    assert.ok(c.includes(".length = 5"));
    assert.ok(c.includes('"hello"'));
    assert.ok(c.includes("return &__vek_str_0;"));
  });

  test("emits string_len as __vek_string_len", () => {
    const c = emitOk(`
fn length(s: string) -> i32 {
  return s.len;
}
`);

    assert.ok(c.includes("__vek_string_len("));
  });

  test("emits string index expression as __vek_string_at", () => {
    const c = emitOk(`
fn first(s: string) -> string {
  return s[0];
}
`);

    assert.ok(c.includes("__vek_string_at("));
  });

  test("emits retain and release for heap aliases", () => {
    const c = emitOk(`
fn main() -> i32 {
  let a: string = "hi";
  let b: string = a;
  return b.len;
}
`);

    assert.ok(c.includes("__vek_string_retain(v0);"));
    assert.ok(c.includes("__vek_string_release(v0);"));
    assert.ok(c.includes("__vek_string_release(v1);"));
  });

  test("emits string + as __vek_string_concat", () => {
    const c = emitOk(`
fn join(a: string, b: string) -> string {
  return a + b;
}
`);

    assert.ok(c.includes("__vek_string_concat("));
  });

  test("emits string == as __vek_string_eq", () => {
    const c = emitOk(`
fn same(a: string, b: string) -> bool {
  return a == b;
}
`);

    assert.ok(c.includes("__vek_string_eq("));
  });

  test("emits string != as negated __vek_string_eq", () => {
    const c = emitOk(`
fn different(a: string, b: string) -> bool {
  return a != b;
}
`);

    assert.ok(c.includes("__vek_string_eq("));
    assert.ok(c.includes("!t"));
  });

  test("emits array .len as __vek_array_len", () => {
    const c = emitOk(`
fn length(xs: i32[]) -> i32 {
  return xs.len;
}
`);

    assert.ok(c.includes("__vek_array_len("));
  });
});
