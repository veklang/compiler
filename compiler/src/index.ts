import { inspect } from "node:util";
import { Lexer } from "@/lang/lexer";
import { Parser } from "@/lang/parser";

const source = "6.9 + 420";
const { tokens, diagnostics: lexDiagnostics } = new Lexer(source).lex();
const { program, diagnostics: parseDiagnostics } = new Parser(
  tokens,
).parseProgram();

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

if (lexDiagnostics.length || parseDiagnostics.length) {
  console.log(
    inspect({ lexDiagnostics, parseDiagnostics }, { depth: 50, colors: true }),
  );
}
