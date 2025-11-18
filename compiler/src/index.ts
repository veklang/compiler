import { inspect } from "node:util";
import { Lexer } from "@/lang/lexer";
import { Parser } from "@/lang/parser";

const source = "6.9 + 420";
const tokens = new Lexer(source).lex();
const ast = new Parser(tokens).parse();

console.log(
  inspect(tokens, {
    depth: 50,
    colors: true,
  }),
);

console.log(
  inspect(ast, {
    depth: 50,
    colors: true,
  }),
);
