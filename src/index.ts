import { Lexer } from "@/lang/lexer";

console.log(
  new Lexer(`fn add(x: int, y: int) {
  return x + y
}

add(69, 420)
exit(0)`).lex(),
);
