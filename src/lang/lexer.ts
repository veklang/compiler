import type { Token, TokenType } from "@/types/token";

export type LexerErrorType = "SyntaxError";

export class LexerError extends Error {
  type: LexerErrorType;

  public constructor(type: LexerErrorType, message: string) {
    super(`${type}: ${message}`);
    this.type = type;
  }
}

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private start = 0;
  private current = 0;
  private column = 0;
  private line = 1;

  constructor(source: string) {
    this.source = source;
  }

  public lex() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }

    return this.tokens;
  }

  private scanToken() {
    const ch = this.nextChar();

    switch (ch) {
      case " ":
      case "\r":
      case "\t":
      case "\n":
        break;
      case "(":
        this.addToken("Punctuation:LeftParen", "(");
        break;
      case ")":
        this.addToken("Punctuation:RightParen", ")");
        break;
      case "{":
        this.addToken("Punctuation:LeftBrace", "{");
        break;
      case "}":
        this.addToken("Punctuation:RightBrace", "}");
        break;
      case ",":
        this.addToken("Punctuation:Comma", ",");
        break;
      case ".":
        this.addToken("Punctuation:Dot", ".");
        break;
      case ";":
        this.addToken("Punctuation:Semicolon", ";");
        break;
      case "-":
        this.addToken("Operator:Minus", "-");
        break;
      case "+":
        this.addToken("Operator:Plus", "+");
        break;
      case "/":
        if (this.match("/"))
          while (!this.isAtEnd() && this.peekChar() !== "\n") this.nextChar();
        else if (this.match("*"))
          while (
            !this.isAtEnd() &&
            this.peekChar() !== "*" &&
            this.peekChar(1) !== "/"
          )
            this.nextChar();
        else this.addToken("Operator:Slash", "/");
        break;
      case "*":
        this.addToken("Operator:Asterisk", "*");
        break;
      case "!":
        if (this.match("=")) this.addToken("Operator:BangEqual", "!=");
        else this.addToken("Operator:Bang", "!");
        break;
      case "=":
        if (this.match("=")) this.addToken("Operator:EqualEqual", "==");
        else this.addToken("Operator:Equal", "=");
        break;
      case "<":
        if (this.match("=")) this.addToken("Operator:LessEqual", "<=");
        else this.addToken("Operator:Less", "<");
        break;
      case ">":
        if (this.match("=")) this.addToken("Operator:GreaterEqual", ">=");
        else this.addToken("Operator:Greater", ">");
        break;
    }
  }

  private addToken(type: TokenType, lexeme: string) {
    this.tokens.push({ type, lexeme, line: this.line, column: this.column });
  }

  private isAtEnd() {
    return this.current >= this.source.length;
  }

  private nextChar(extra = 0) {
    if (this.current + extra >= this.source.length) {
      this.current = this.source.length;
      return "\0";
    }

    const inner = () => {
      const ch = this.source[this.current++];

      if (ch === "\n") {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }

      return ch;
    };

    if (extra > 0) {
      let ch = "";
      for (let i = 0; i < extra; i++) ch = inner();
      return ch;
    }

    return inner();
  }

  private match(expected: string) {
    if (this.isAtEnd()) return false;
    if (this.peekChar() !== expected) return false;
    this.nextChar();
    return true;
  }

  private peekChar(extra = 0) {
    if (this.current + extra >= this.source.length) return "\0";
    return this.source[this.current + extra];
  }

  private nextString() {
    while (!this.isAtEnd() && this.peekChar() !== '"') {
      this.nextChar();
    }

    if (this.isAtEnd()) {
      throw new LexerError(
        "SyntaxError",
        `Unterminated string at line ${this.line} column ${this.column}`,
      );
    }

    this.nextChar();
    this.addToken(
      "Literal:String",
      this.source.substring(this.start + 1, this.current - 1),
    );
  }
}
