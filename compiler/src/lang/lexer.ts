import type { Diagnostic } from "@/types/diagnostic";
import type { Position, Span } from "@/types/position";
import type { Operator, Punctuator } from "@/types/shared";
import type { Token } from "@/types/token";
import { keywords } from "@/types/token";

const operatorCandidates: Operator[] = [
  "=>",
  "->",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "**",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  ">",
  "<",
  "|",
];

const punctuators: Punctuator[] = [
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ",",
  ".",
  ":",
  ";",
  "?",
];

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private diagnostics: Diagnostic[] = [];
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  public lex(): LexResult {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === " " || ch === "\r" || ch === "\t") {
        this.advance();
        continue;
      }

      if (ch === "\n") {
        this.advance();
        continue;
      }

      if (ch === "/" && this.peek(1) === "/") {
        this.advance();
        this.advance();
        while (!this.isAtEnd() && this.peek() !== "\n") this.advance();
        continue;
      }

      if (ch === "/" && this.peek(1) === "*") {
        this.advance();
        this.advance();
        this.scanBlockComment();
        continue;
      }

      if (this.isDigit(ch)) {
        this.scanNumber();
        continue;
      }

      if (this.isAlpha(ch)) {
        this.scanIdentifier();
        continue;
      }

      if (ch === '"') {
        this.scanString();
        continue;
      }

      const operator = this.matchOperator();
      if (operator) {
        const start = this.position();
        for (let i = 0; i < operator.length; i++) this.advance();
        const end = this.position();
        this.tokens.push(
          this.makeToken("Operator", operator, { start, end }, { operator }),
        );
        continue;
      }

      if (punctuators.includes(ch as Punctuator)) {
        const start = this.position();
        this.advance();
        const end = this.position();
        this.tokens.push(
          this.makeToken(
            "Punctuator",
            ch,
            { start, end },
            {
              punctuator: ch as Punctuator,
            },
          ),
        );
        continue;
      }

      const start = this.position();
      const bad = this.advance();
      const end = this.position();
      this.diagnostics.push({
        severity: "error",
        message: `Unexpected character '${bad}'.`,
        span: { start, end },
        code: "LEX001",
      });
    }

    const eofPos = this.position();
    this.tokens.push(this.makeToken("EOF", "", { start: eofPos, end: eofPos }));
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private scanNumber() {
    const start = this.position();
    let isFloat = false;

    if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      this.advance();
      this.advance();
      const digitsStart = this.position();
      while (this.isHexDigit(this.peek()) || this.peek() === "_")
        this.advance();
      const end = this.position();
      const lexeme = this.source.slice(start.index, end.index);
      if (digitsStart.index === end.index) {
        this.diagnostics.push({
          severity: "error",
          message: "Invalid hex literal.",
          span: { start, end },
          code: "LEX010",
        });
      }
      this.tokens.push(
        this.makeToken("Number", lexeme, { start, end }, { value: lexeme }),
      );
      return;
    }

    if (this.peek() === "0" && (this.peek(1) === "b" || this.peek(1) === "B")) {
      this.advance();
      this.advance();
      const digitsStart = this.position();
      while (
        this.peek() === "0" ||
        this.peek() === "1" ||
        this.peek() === "_"
      ) {
        this.advance();
      }
      const end = this.position();
      const lexeme = this.source.slice(start.index, end.index);
      if (digitsStart.index === end.index) {
        this.diagnostics.push({
          severity: "error",
          message: "Invalid binary literal.",
          span: { start, end },
          code: "LEX011",
        });
      }
      this.tokens.push(
        this.makeToken("Number", lexeme, { start, end }, { value: lexeme }),
      );
      return;
    }

    while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();

    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      isFloat = true;
      this.advance();
      while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();
    }

    if (this.peek() === "e" || this.peek() === "E") {
      isFloat = true;
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") this.advance();
      const exponentStart = this.position();
      while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();
      if (exponentStart.index === this.position().index) {
        const end = this.position();
        this.diagnostics.push({
          severity: "error",
          message: "Invalid exponent in numeric literal.",
          span: { start, end },
          code: "LEX013",
        });
      }
    }

    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);
    this.tokens.push(
      this.makeToken("Number", lexeme, { start, end }, { value: lexeme }),
    );

    if (!isFloat && lexeme.includes(".")) {
      this.diagnostics.push({
        severity: "error",
        message: "Invalid numeric literal.",
        span: { start, end },
        code: "LEX012",
      });
    }
  }

  private scanString() {
    const start = this.position();
    this.advance();
    let value = "";

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === '"') {
        this.advance();
        const end = this.position();
        const lexeme = this.source.slice(start.index, end.index);
        this.tokens.push(
          this.makeToken("String", lexeme, { start, end }, { value }),
        );
        return;
      }

      if (ch === "\\") {
        this.advance();
        const next = this.peek();
        if (next === "n") value += "\n";
        else if (next === "t") value += "\t";
        else if (next === "r") value += "\r";
        else if (next === '"') value += '"';
        else if (next === "\\") value += "\\";
        else value += next;
        this.advance();
        continue;
      }

      value += ch;
      this.advance();
    }

    const end = this.position();
    this.diagnostics.push({
      severity: "error",
      message: "Unterminated string literal.",
      span: { start, end },
      code: "LEX002",
    });
  }

  private scanIdentifier() {
    const start = this.position();
    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) this.advance();
    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);

    if (lexeme === "is") {
      this.tokens.push(
        this.makeToken("Operator", lexeme, { start, end }, { operator: "is" }),
      );
      return;
    }

    if (keywords.includes(lexeme as never)) {
      this.tokens.push(
        this.makeToken(
          "Keyword",
          lexeme,
          { start, end },
          {
            keyword: lexeme as never,
          },
        ),
      );
      return;
    }

    this.tokens.push(this.makeToken("Identifier", lexeme, { start, end }));
  }

  private scanBlockComment() {
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peek(1) === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }

    const pos = this.position();
    this.diagnostics.push({
      severity: "error",
      message: "Unterminated block comment.",
      span: { start: pos, end: pos },
      code: "LEX003",
    });
  }

  private makeToken(
    kind: Token["kind"],
    lexeme: string,
    span: Span,
    extras?: Partial<Token>,
  ): Token {
    return { kind, lexeme, span, ...extras };
  }

  private matchOperator(): Operator | null {
    for (const candidate of operatorCandidates) {
      if (this.source.startsWith(candidate, this.index)) return candidate;
    }
    return null;
  }

  private advance() {
    if (this.isAtEnd()) return "\0";
    const ch = this.source[this.index];
    this.index++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private peek(offset = 0) {
    return this.index + offset >= this.source.length
      ? "\0"
      : this.source[this.index + offset];
  }

  private position(): Position {
    return { index: this.index, line: this.line, column: this.column };
  }

  private isAtEnd() {
    return this.index >= this.source.length;
  }

  private isDigit(ch: string) {
    return ch >= "0" && ch <= "9";
  }

  private isHexDigit(ch: string) {
    return (
      (ch >= "0" && ch <= "9") ||
      (ch >= "a" && ch <= "f") ||
      (ch >= "A" && ch <= "F")
    );
  }

  private isAlpha(ch: string) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string) {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
