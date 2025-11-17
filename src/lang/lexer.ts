import { keywords, type Token, type TokenType } from "@/types/token";

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private start = 0;
  private current = 0;
  private column = 0;
  private line = 1;

  constructor(source: string) {
    this.source = source.trim();
  }

  public lex() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }

    this.addToken("Special:EOF", "");
    return this.tokens;
  }

  private scanToken() {
    const c = this.nextChar();

    switch (c) {
      case " ":
      case "\r":
      case "\t":
      case "\n": {
        break;
      }

      case "(": {
        this.addToken("Punctuation:LeftParen", "(");
        break;
      }

      case ")": {
        this.addToken("Punctuation:RightParen", ")");
        break;
      }

      case "{": {
        this.addToken("Punctuation:LeftBrace", "{");
        break;
      }

      case "}": {
        this.addToken("Punctuation:RightBrace", "}");
        break;
      }
      case ",": {
        this.addToken("Punctuation:Comma", ",");
        break;
      }

      case ".": {
        this.addToken("Punctuation:Dot", ".");
        break;
      }

      case ":": {
        this.addToken("Punctuation:Colon", ":");
        break;
      }

      case ";": {
        this.addToken("Punctuation:Semicolon", ";");
        break;
      }

      case "-": {
        this.scanOperator("-", "Operator:Minus", [
          { match: "-", token: "Operator:MinusMinus" },
          { match: "=", token: "Operator:MinusEqual" },
        ]);
        break;
      }

      case "+": {
        this.scanOperator("+", "Operator:Plus", [
          { match: "+", token: "Operator:PlusPlus" },
          { match: "=", token: "Operator:PlusEqual" },
        ]);
        break;
      }

      case "/": {
        if (this.match("/")) {
          // Single-line comment
          while (!this.isAtEnd() && this.peekChar() !== "\n") this.nextChar();
        } else if (this.match("*")) {
          // Multi-line comment
          this.scanMultiLineComment();
        } else if (this.match("=")) {
          this.addToken("Operator:SlashEqual", "/=");
        } else {
          this.addToken("Operator:Slash", "/");
        }
        break;
      }

      case "%": {
        this.scanOperator("%", "Operator:Modulo", [
          { match: "=", token: "Operator:ModuloEqual" },
        ]);
        break;
      }

      case "*": {
        this.scanOperator("*", "Operator:Asterisk", [
          { match: "*", token: "Operator:Exponentiation" },
          { match: "=", token: "Operator:AsteriskEqual" },
        ]);
        break;
      }

      case "!": {
        this.scanOperator("!", "Operator:Bang", [
          { match: "=", token: "Operator:BangEqual" },
        ]);
        break;
      }

      case "=": {
        this.scanOperator("=", "Operator:Equal", [
          { match: "=", token: "Operator:EqualEqual" },
        ]);
        break;
      }

      case "<": {
        this.scanShiftOperator(
          "<",
          "Operator:Less",
          "Operator:LeftShift",
          "Operator:LessEqual",
          "Operator:LeftShiftEqual",
        );
        break;
      }

      case ">": {
        this.scanShiftOperator(
          ">",
          "Operator:Greater",
          "Operator:RightShift",
          "Operator:GreaterEqual",
          "Operator:RightShiftEqual",
        );
        break;
      }

      case '"': {
        this.scanString();
        break;
      }

      case "&": {
        this.scanOperator("&", "Operator:And", [
          { match: "&", token: "Operator:AndAnd" },
          { match: "=", token: "Operator:AndEqual" },
        ]);
        break;
      }

      case "|": {
        this.scanOperator("|", "Operator:Or", [
          { match: "|", token: "Operator:OrOr" },
          { match: "=", token: "Operator:OrEqual" },
        ]);
        break;
      }

      case "^": {
        this.scanOperator("^", "Operator:Xor", [
          { match: "=", token: "Operator:XorEqual" },
        ]);
        break;
      }

      default: {
        if (this.isDigit(c)) this.scanNumber();
        else if (this.isAlpha(c)) this.scanIdentifier();
        else
          throw new SyntaxError(
            `Unexpected character '${c}' at line ${this.line} column ${this.column}`,
          );
      }
    }
  }

  private addToken(type: TokenType, lexeme: string) {
    this.tokens.push({ type, lexeme, line: this.line, column: this.column });
  }

  private isAtEnd() {
    return this.current >= this.source.length;
  }

  private nextChar(offset = 0) {
    if (this.current + offset >= this.source.length) {
      this.current = this.source.length;
      return "\0";
    }

    const inner = () => {
      const ch = this.source[this.current++];

      if (ch === "\n") {
        this.line++;
        this.column = 0;
        this.addToken("Special:EOL", "\n");
      } else this.column++;

      return ch;
    };

    if (offset > 0) {
      let ch = "";
      for (let i = 0; i < offset; i++) ch = inner();
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

  private peekChar(offset = 0) {
    if (this.current + offset >= this.source.length) return "\0";
    return this.source[this.current + offset];
  }

  private scanNumber() {
    while (this.isDigit(this.peekChar())) this.nextChar();
    if (this.peekChar() === "." && this.isDigit(this.peekChar(1))) {
      this.nextChar();
      while (this.isDigit(this.peekChar())) this.nextChar();
    }

    const lexeme = this.source.substring(this.start, this.current);
    if (lexeme.includes(".")) this.addToken("Literal:Float", lexeme);
    else this.addToken("Literal:Integer", lexeme);
  }

  private scanString() {
    while (!this.isAtEnd() && this.peekChar() !== '"') this.nextChar();

    if (this.isAtEnd())
      throw new SyntaxError(
        `Unterminated string at line ${this.line} column ${this.column}`,
      );

    this.nextChar();
    this.addToken(
      "Literal:String",
      this.source.substring(this.start + 1, this.current - 1),
    );
  }

  private scanIdentifier() {
    while (this.isAlphaNumeric(this.peekChar())) this.nextChar();
    const text = this.source.substring(this.start, this.current);
    if (keywords.includes(text as never)) this.addToken("Keyword", text);
    else this.addToken("Identifier", text);
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isAlpha(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  }

  private isAlphaNumeric(c: string): boolean {
    return this.isAlpha(c) || this.isDigit(c);
  }

  /**
   * Scans an operator with optional single or double character variations.
   * @param char The primary character
   * @param singleToken Token type if only the single character is matched
   * @param patterns Array of { match, token } for multi-character operators
   */
  private scanOperator(
    char: string,
    singleToken: TokenType,
    patterns: { match: string; token: TokenType }[],
  ) {
    for (const pattern of patterns) {
      if (this.match(pattern.match)) {
        this.addToken(pattern.token, char + pattern.match);
        return;
      }
    }
    this.addToken(singleToken, char);
  }

  /**
   * Scans shift operators and comparison operators that use the same character twice.
   * @param char The operator character ('<' or '>')
   * @param singleToken Token for single character (e.g., '<')
   * @param doubleToken Token for double character (e.g., '<<')
   * @param equalToken Token for single + '=' (e.g., '<=')
   * @param doubleEqualToken Token for double + '=' (e.g., '<<=')
   */
  private scanShiftOperator(
    char: string,
    singleToken: TokenType,
    doubleToken: TokenType,
    equalToken: TokenType,
    doubleEqualToken: TokenType,
  ) {
    if (this.match(char)) {
      if (this.match("=")) {
        this.addToken(doubleEqualToken, char + char + "=");
      } else {
        this.addToken(doubleToken, char + char);
      }
    } else if (this.match("=")) {
      this.addToken(equalToken, char + "=");
    } else {
      this.addToken(singleToken, char);
    }
  }

  // Scans a multi-line comment /* ... */
  private scanMultiLineComment() {
    while (
      !this.isAtEnd() &&
      !(this.peekChar() === "*" && this.peekChar(1) === "/")
    ) {
      this.nextChar();
    }

    if (this.isAtEnd()) {
      throw new SyntaxError(
        `Unterminated multi-line comment at line ${this.line} column ${this.column}`,
      );
    }

    this.nextChar();
    this.nextChar();
  }
}
