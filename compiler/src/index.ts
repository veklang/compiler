import { inspect } from "node:util";
import { Checker } from "@/lang/checker";
import { Lexer } from "@/lang/lexer";
import { Parser } from "@/lang/parser";

const source = `
import io from "std:io";

type ID = i32 | string;

struct User {
  id: ID,
  name: string,
}

enum Result<T, E> {
  Ok(T),
  Err(E),
}

fn make_user(id: ID, name: string): User {
  return User { id: id, name: name };
}

fn lookup_user(id: ID): Result<User, string> {
  if id == 0 {
    return Err("invalid id");
  }
  return Ok(make_user(id, "alex"));
}

fn main() {
  let id = 1;
  let name = "sam";
  let user = User { id, name };
  let ids = [1, 2, 3];
  let count: i32 = 3;
  let count_f: f32 = count as f32;
  let role = "admin";
  let info = { role };
  let ok = Ok(user);

  if !"" { io.print("empty string is falsy\\n"); }
  if [] { io.print("empty array is falsy\\n"); }
  if {} { io.print("empty map is falsy\\n"); }
  if [1] { io.print("non-empty array is truthy\\n"); }
  if { "a": 1 } { io.print("non-empty map is truthy\\n"); }

  match lookup_user(user.id) {
    Ok(u) => io.print("user: " + u.name + "\\n"),
    Err(e) => io.eprint("error: " + e + "\\n"),
  }

  io.print("role: " + role + "\\n");
  io.print("count f32: " + (count_f as string) + "\\n");
}
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
