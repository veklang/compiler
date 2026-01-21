import { type Diagnostic, errorDiagnostic } from "@/types/diagnostic";
import type { Position, Span } from "@/types/position";
import type { Operator, Punctuator } from "@/types/shared";
import type { Token } from "@/types/token";
import { keywords } from "@/types/token";

const operatorCandidates: Operator[] = [
  "<<=",
  ">>=",
  "**",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<<",
  ">>",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "=",
  ">",
  "<",
  "&",
  "|",
  "^",
];

const punctuators: Punctuator[] = ["(", ")", "{", "}", ",", ".", ":", ";", "?"];

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
        const start = this.position();
        this.advance();
        const end = this.position();
        this.tokens.push(this.makeToken("EOL", "\n", { start, end }));
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

      if (ch === "/") {
        if (this.peek(1) === "/") {
          this.advance();
          this.advance();
          while (!this.isAtEnd() && this.peek() !== "\n") this.advance();
          continue;
        }

        if (this.peek(1) === "*") {
          this.advance();
          this.advance();
          this.scanBlockComment();
          continue;
        }
      }

      const operator = this.matchOperator();
      if (operator) {
        const start = this.position();
        for (let i = 0; i < operator.length; i++) this.advance();
        const end = this.position();
        this.tokens.push(
          this.makeToken(
            "Operator",
            operator,
            { start, end },
            {
              operator,
            },
          ),
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
      this.diagnostics.push(
        errorDiagnostic(
          `Unexpected character '${bad}'.`,
          { start, end },
          "LEX001",
        ),
      );
    }

    const eofPos = this.position();
    this.tokens.push(this.makeToken("EOF", "", { start: eofPos, end: eofPos }));
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private scanNumber() {
    const start = this.position();
    let hasDot = false;

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (this.isDigit(ch)) {
        this.advance();
        continue;
      }

      if (ch === "." && !hasDot && this.isDigit(this.peek(1))) {
        hasDot = true;
        this.advance();
        continue;
      }
      break;
    }

    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);
    this.tokens.push(
      this.makeToken(
        "Number",
        lexeme,
        { start, end },
        {
          value: Number(lexeme),
        },
      ),
    );
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

      if (ch === "\n") {
        const end = this.position();
        this.diagnostics.push(
          errorDiagnostic(
            "Unterminated string literal.",
            { start, end },
            "LEX002",
          ),
        );
        return;
      }

      if (ch === "\\") {
        this.advance();
        const next = this.peek();
        if (next === "n") value += "\n";
        else if (next === "t") value += "\t";
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
    this.diagnostics.push(
      errorDiagnostic("Unterminated string literal.", { start, end }, "LEX002"),
    );
  }

  private scanIdentifier() {
    const start = this.position();
    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) this.advance();
    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);

    if (keywords.includes(lexeme as never)) {
      this.tokens.push(this.makeToken("Keyword", lexeme, { start, end }));
    } else {
      this.tokens.push(this.makeToken("Identifier", lexeme, { start, end }));
    }
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
    this.diagnostics.push(
      errorDiagnostic(
        "Unterminated block comment.",
        { start: pos, end: pos },
        "LEX003",
      ),
    );
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

  private isAlpha(ch: string) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string) {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
