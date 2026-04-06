import { inspect } from "node:util";
import { Checker } from "@/core/checker";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";

const source = `
// Vek feature stress-test program
/*
  This file is intentionally broad: it touches most surface syntax + semantics.
*/

import io from "std:io";
import { print } from "std:io";

pub const VERSION: i32 = 1;
pub let build_name: string = "spec-stress";

// Type aliases
pub type ID = i32 | string;
type MaybeI32 = i32 | null;
type BinOp = fn(i32, i32) -> i32;

// Structs
pub struct User {
  id: ID,
  name: string,
  score: f32,
}

struct Point {
  x: i32,
  y: i32,
}

struct Box<T: Printable> {
  value: T,
}

// Enums (payload + multi-payload variants)
pub enum Result<T, E> {
  Ok(T),
  Err(E),
  Pair(T, E),
}

enum State {
  Idle,
  Busy(i32),
}

// Traits + impls
pub trait Printable {
  fn print(self: User): void;
}

impl User {
  fn display(self: User): string {
    return "User(" + self.name + ")";
  }

  fn bump_score(mut self: User, by: f32): f32 {
    self.score = self.score + by;
    return self.score;
  }
}

impl Printable for User {
  fn print(self: User): void {
    io.print(self.display() + "\n");
  }
}

inline fn add(x: i32, y: i32): i32 {
  return x + y;
}

fn pair(): (i32, i32) {
  return 6, 9;
}

// Parameter forms: positional, defaults, named-only separator, variadic, kw-variadic
fn configure(
  path: string,
  retries: i32 = 3,
  *,
  stream: string = "stdout",
  *extras: Array<i32>,
  **meta: Map<string, string>
): i32 {
  let count = retries;
  for item in extras {
    let item_i32: i32 = item;
    count = count + item_i32;
  }
  if meta is meta {
    io.print("configured: " + path + " via " + stream + "\n");
  }
  return count;
}

fn takes_mut(mut x: i32): i32 {
  x = x + 1;
  return x;
}

fn apply(op: BinOp, a: i32, b: i32): i32 {
  return op(a, b);
}

fn literals_showcase(): void {
  // Integer literals
  let d: i32 = 123;
  let h: i32 = 0x7F;
  let b: i32 = 0b1010_1100;
  let u: u64 = 1_000_000;

  // Float literals
  let pi: f32 = 3.14;
  let exp: f32 = 2.0e5;
  let n: f32 = NaN;
  let inf: f32 = Infinity;

  // String escapes + multiline
  let s1 = "line1\\nline2\\t\\"quote\\"\\\\slash\\\\\\u{41}\\0";
  let s2 = "multi
line
string";

  io.print(s1 + "\n");
  io.print(s2 + "\n");

  // Unary/Binary operators + explicit casts
  let math: i32 = (d + h - 3) * 2 / 2 % 5;
  let cmp: bool = math == 0 || math != 1 && math < 10 && math <= 10 && math > -1 && math >= 0;
  let signed: i32 = -d;
  let truthy_not: bool = !"";
  let f: f32 = (signed as f32) + pi;
  let bits_or: i32 = 1 + 2;

  io.print((cmp as string) + " " + (truthy_not as string) + " " + (f as string) + " " + (bits_or as string) + "\n");
}

fn main(): void {
  literals_showcase();

  // Variable declarations + tuple destructuring
  let x: i32 = 1;
  const y: i32 = 2;
  let x2, y2 = pair();
  let (a, b) = pair();

  // Arrays, tuples, maps, struct literals (with shorthand)
  let arr = [1, 2, 3];
  let tup = (x2, y2);
  let role = "admin";
  let info = { "role": role, role };
  let p = Point { x: a, y: b };
  let name = "sam";
  let user = User { id: 69, name, score: 4.2 };

  let sum = add(x, y);
  let product = apply(add, 6, 7);
  let _next = takes_mut(x);

  // is identity operator on aliasable values
  let arr_alias = arr;
  let same_arr = arr is arr_alias;
  io.print("same_arr=" + (same_arr as string) + "\n");

  // if/else + truthy/falsy checks
  if "" {
    io.print("empty string branch\n");
  } else {
    io.print("else branch\n");
  }

  if [] {
    io.print("empty array\n");
  }

  if {} {
    io.print("empty map\n");
  }

  if [1] {
    io.print("non-empty array\n");
  }

  if { "k": 1 } {
    io.print("non-empty map\n");
  }

  // while + break/continue
  let i: i32 = 0;
  while i < 10 {
    i = i + 1;
    if i == 3 {
      continue;
    }
    if i == 7 {
      break;
    }
  }

  // for loop
  for v in arr {
    io.print("v=" + (v as string) + "\n");
  }

  // Named/default/spread/kwspread args
  let extras = [10, 20];
  let meta = { "owner": "ducc", "env": "dev" };
  let configured = configure("./tmp", stream="stderr", *extras, **meta);
  io.print("configured=" + (configured as string) + "\n", stream=io.stdout);

  // Result + match with payload extraction
  let r: Result<User, string> = Ok(user);
  match r {
    Ok(u) => io.print("ok user: " + u.name + "\n"),
    Err(e) => io.eprint("err: " + e + "\n"),
    Pair(u, e) => io.print(u.name + ":" + e + "\n"),
  }

  // Match tuple pattern
  match tup {
    (6, yy) => io.print("tuple second=" + (yy as string) + "\n"),
    _ => io.print("tuple other\n"),
  }

  // Match struct pattern
  match user {
    User { id, name: n, score } => io.print(n + ":" + (score as string) + "\n"),
  }

  // Enum without/with payload
  let st = Busy(sum + product);
  match st {
    Idle() => io.print("idle\n"),
    Busy(v) => io.print("busy=" + (v as string) + "\n"),
  }

  // Trait + impl usage
  user.print();
  let shown = user.display();
  io.print(shown + "\n");

  let wrapped: Box<User> = Box { value: user };
  io.print(wrapped.value.name + "\n");

  // Use imported named symbol too
  print("done\n", stream=io.stdout);

  // Consume variables to avoid unused noise in future tooling
  io.print((p.x as string) + "," + (p.y as string) + " | " + (x2 as string) + "," + (y2 as string) + "\n");
}

pub fn run_demo(): void {
  main();
}

pub default run_demo;

// Alternative default export forms (intentionally commented for parser/testing reference):
// pub default 123;
// pub default add, pair, configure;
// pub default *;
`;
const { tokens, diagnostics: lexDiagnostics } = new Lexer(source).lex();
const { program, diagnostics: parseDiagnostics } = new Parser(
  tokens,
).parseProgram();
const { diagnostics: checkDiagnostics } = new Checker(program).checkProgram();

console.log(
  inspect(tokens, {
    depth: 50,
    colors: true,
  }),
);

console.log(
  inspect(program, {
    depth: 50,
    colors: true,
  }),
);

if (
  lexDiagnostics.length ||
  parseDiagnostics.length ||
  checkDiagnostics.length
) {
  console.log(
    inspect(
      { lexDiagnostics, parseDiagnostics, checkDiagnostics },
      { depth: 50, colors: true },
    ),
  );
}
