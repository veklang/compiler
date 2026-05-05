import type { Diagnostic } from "@/types/diagnostic";
import type { Position, Span } from "@/types/position";
import type { Operator, Punctuator } from "@/types/shared";
import type { TemplatePart, Token } from "@/types/token";
import { keywords } from "@/types/token";

const operatorCandidates: Operator[] = [
  "<<=",
  ">>=",
  "=>",
  "->",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "^=",
  "|=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<<",
  ">>",
  "+",
  "-",
  "!",
  "*",
  "/",
  "%",
  "=",
  ">",
  "<",
  "&",
  "^",
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
  private tokens: Token[] = [];
  private diagnostics: Diagnostic[] = [];
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(private source: string) {}

  public lex(): LexResult {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === " " || ch === "\r" || ch === "\t" || ch === "\n") {
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
            { punctuator: ch as Punctuator },
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
        code: "E0001",
      });
    }

    const eofPos = this.position();
    this.tokens.push(this.makeToken("EOF", "", { start: eofPos, end: eofPos }));
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private scanNumber() {
    const start = this.position();

    if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      this.advance();
      this.advance();
      const digitsStart = this.position();
      while (this.isHexDigit(this.peek()) || this.peek() === "_") {
        this.advance();
      }
      const end = this.position();
      const lexeme = this.source.slice(start.index, end.index);
      if (digitsStart.index === end.index) {
        this.diagnostics.push({
          severity: "error",
          message: "Invalid hex literal.",
          span: { start, end },
          code: "E0010",
        });
      }
      this.tokens.push(this.makeToken("Number", lexeme, { start, end }));
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
          code: "E0011",
        });
      }
      this.tokens.push(this.makeToken("Number", lexeme, { start, end }));
      return;
    }

    while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();

    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      this.advance();
      while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();
    }

    if (this.peek() === "e" || this.peek() === "E") {
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") this.advance();
      const exponentStart = this.position();
      while (this.isDigit(this.peek()) || this.peek() === "_") this.advance();
      if (exponentStart.index === this.position().index) {
        this.diagnostics.push({
          severity: "error",
          message: "Invalid exponent in numeric literal.",
          span: { start, end: this.position() },
          code: "E0013",
        });
      }
    }

    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);
    this.tokens.push(this.makeToken("Number", lexeme, { start, end }));
  }

  private scanString() {
    const start = this.position();
    this.advance();

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === '"') {
        this.advance();
        const end = this.position();
        const lexeme = this.source.slice(start.index, end.index);
        this.tokens.push(this.makeToken("String", lexeme, { start, end }));
        return;
      }

      if (ch === "\\") {
        const escapeStart = this.position();
        this.advance();
        const next = this.peek();

        if (next === "u") {
          this.advance();
          if (this.peek() !== "{") {
            this.invalidEscape(escapeStart);
            continue;
          }
          this.advance();
          const digitsStart = this.position();
          let sawDigit = false;
          let invalidDigit = false;
          let hexDigits = "";
          while (!this.isAtEnd() && this.peek() !== "}") {
            const digit = this.peek();
            if (!this.isHexDigit(digit)) invalidDigit = true;
            sawDigit = true;
            hexDigits += digit;
            this.advance();
          }
          if (this.isAtEnd() || this.peek() !== "}") {
            this.invalidEscape(escapeStart);
            continue;
          }
          if (!sawDigit || invalidDigit) this.invalidEscape(digitsStart);
          if (sawDigit && !invalidDigit) {
            const codePoint = Number.parseInt(hexDigits, 16);
            if (
              Number.isNaN(codePoint) ||
              codePoint > 0x10ffff ||
              (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ) {
              this.invalidEscape(digitsStart);
            }
          }
          this.advance();
          continue;
        }

        if (
          next === "n" ||
          next === "r" ||
          next === "t" ||
          next === '"' ||
          next === "\\" ||
          next === "0"
        ) {
          this.advance();
          continue;
        }

        if (this.isAtEnd()) {
          this.diagnostics.push({
            severity: "error",
            message: "Unterminated string literal.",
            span: { start, end: this.position() },
            code: "E0002",
          });
          return;
        }

        this.invalidEscape(escapeStart);
        this.advance();
        continue;
      }

      this.advance();
    }

    this.diagnostics.push({
      severity: "error",
      message: "Unterminated string literal.",
      span: { start, end: this.position() },
      code: "E0002",
    });
  }

  private invalidEscape(start: Position) {
    this.diagnostics.push({
      severity: "error",
      message: "Invalid escape sequence in string literal.",
      span: { start, end: this.position() },
      code: "E0004",
    });
  }

  private scanIdentifier() {
    const start = this.position();
    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) this.advance();
    const end = this.position();
    const lexeme = this.source.slice(start.index, end.index);

    if (lexeme === "f" && !this.isAtEnd() && this.peek() === '"') {
      this.scanTemplateString(start);
      return;
    }

    if (keywords.includes(lexeme as never)) {
      this.tokens.push(
        this.makeToken(
          "Keyword",
          lexeme,
          { start, end },
          { keyword: lexeme as never },
        ),
      );
      return;
    }

    this.tokens.push(this.makeToken("Identifier", lexeme, { start, end }));
  }

  private scanTemplateString(start: import("@/types/position").Position) {
    this.advance(); // consume the opening `"`
    const parts: TemplatePart[] = [];
    let literal = "";
    let literalStart = this.position();

    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === '"') {
        // End of template string.
        if (literal.length > 0) {
          parts.push({
            kind: "literal",
            value: literal,
            span: { start: literalStart, end: this.position() },
          });
          literal = "";
        }
        this.advance();
        const end = this.position();
        const lexeme = this.source.slice(start.index, end.index);
        this.tokens.push(
          this.makeToken(
            "TemplateString",
            lexeme,
            { start, end },
            { templateParts: parts },
          ),
        );
        return;
      }

      if (ch === "{") {
        // Start of interpolation.
        const braceStart = this.position();
        this.advance(); // consume `{`

        if (this.isAtEnd() || this.peek() === "}") {
          // Empty interpolation `{}` — E0006.
          this.diagnostics.push({
            severity: "error",
            message: "Empty interpolation '{}' in template string.",
            span: { start: braceStart, end: this.position() },
            code: "E0006",
          });
          if (!this.isAtEnd()) this.advance(); // consume `}`
          continue;
        }

        // Flush accumulated literal.
        if (literal.length > 0) {
          parts.push({
            kind: "literal",
            value: literal,
            span: { start: literalStart, end: braceStart },
          });
          literal = "";
        }

        // Scan the interpolation expression source, tracking brace depth.
        const exprStart = this.position();
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          const ic = this.peek();
          if (ic === "{") {
            depth++;
            this.advance();
          } else if (ic === "}") {
            depth--;
            if (depth > 0) this.advance();
          } else if (ic === '"') {
            // Skip string literal inside interpolation.
            this.advance();
            while (!this.isAtEnd() && this.peek() !== '"') {
              if (this.peek() === "\\") this.advance(); // skip escape
              if (!this.isAtEnd()) this.advance();
            }
            if (!this.isAtEnd()) this.advance(); // closing `"`
          } else {
            this.advance();
          }
        }

        if (depth > 0) {
          // Unterminated interpolation — E0005.
          this.diagnostics.push({
            severity: "error",
            message: "Unterminated interpolation block in template string.",
            span: { start: braceStart, end: this.position() },
            code: "E0005",
          });
          // Advance past the closing `"` if present.
          if (!this.isAtEnd() && this.peek() === '"') this.advance();
          const end = this.position();
          const lexeme = this.source.slice(start.index, end.index);
          this.tokens.push(
            this.makeToken(
              "TemplateString",
              lexeme,
              { start, end },
              { templateParts: parts },
            ),
          );
          return;
        }

        const exprEnd = this.position();
        const exprSource = this.source.slice(exprStart.index, exprEnd.index);
        parts.push({
          kind: "interpolation",
          source: exprSource,
          span: { start: exprStart, end: exprEnd },
        });
        this.advance(); // consume the closing `}`
        literalStart = this.position();
        continue;
      }

      if (ch === "\\") {
        this.advance(); // consume `\`
        const esc = this.peek();
        literal += this.rawEscapePair(ch, esc);
        if (!this.isAtEnd()) this.advance(); // consume escape char
        continue;
      }

      literal += ch;
      this.advance();
    }

    // Reached end without closing `"` — unterminated.
    this.diagnostics.push({
      severity: "error",
      message: "Unterminated string literal.",
      span: { start, end: this.position() },
      code: "E0002",
    });
  }

  private rawEscapePair(backslash: string, next: string): string {
    switch (next) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "0":
        return "\0";
      default:
        return backslash + (next ?? "");
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
    this.diagnostics.push({
      severity: "error",
      message: "Unterminated block comment.",
      span: { start: pos, end: pos },
      code: "E0003",
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
    for (const candidate of operatorCandidates)
      if (this.source.startsWith(candidate, this.index)) return candidate;
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
