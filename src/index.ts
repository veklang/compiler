import { Lexer } from "@/lang/lexer";
import { Parser } from "./lang/parser";

console.log(
  new Lexer(`fn add(x: int, y: int) {
  return x + y
}

add(69, 420)
exit(0)`).lex(),
);

console.log(new Parser(new Lexer("6.9 + 420").lex()).parse()[0]);
