import { keywords, type Token, type TokenType } from "@/types/token";

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

    this.addToken("Special:EOF", "\0");
    return this.tokens;
  }

  private scanToken() {
    const c = this.nextChar();

    switch (c) {
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
      case ":":
        this.addToken("Punctuation:Colon", ":");
        break;
      case ";":
        this.addToken("Punctuation:Semicolon", ";");
        break;
      case "-":
        if (this.match("-")) this.addToken("Operator:MinusMinus", "--");
        else if (this.match("=")) this.addToken("Operator:MinusEqual", "-=");
        else this.addToken("Operator:Minus", "-");
        break;
      case "+":
        if (this.match("+")) this.addToken("Operator:PlusPlus", "++");
        else if (this.match("=")) this.addToken("Operator:PlusEqual", "+=");
        else this.addToken("Operator:Plus", "+");
        break;
      case "/":
        if (this.match("/"))
          while (!this.isAtEnd() && this.peekChar() !== "\n") this.nextChar();
        else if (this.match("*")) {
          while (
            !this.isAtEnd() &&
            !(this.peekChar() === "*" && this.peekChar(1) === "/")
          )
            this.nextChar();
          if (!this.isAtEnd()) {
            this.nextChar();
            this.nextChar();
          } else
            throw new SyntaxError(
              `Unterminated multi-line comment at line ${this.line} column ${this.column}`,
            );
        } else if (this.match("=")) this.addToken("Operator:SlashEqual", "/=");
        else this.addToken("Operator:Slash", "/");
        break;
      case "%":
        if (this.match("=")) this.addToken("Operator:ModuloEqual", "%=");
        else this.addToken("Operator:Modulo", "%");
        break;
      case "*":
        if (this.match("*")) this.addToken("Operator:Exponentiation", "**");
        else if (this.match("=")) this.addToken("Operator:AsteriskEqual", "*=");
        else this.addToken("Operator:Asterisk", "*");
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
        if (this.match("<"))
          if (this.match("=")) this.addToken("Operator:LeftShiftEqual", "<<=");
          else this.addToken("Operator:LeftShift", "<<");
        else if (this.match("=")) this.addToken("Operator:LessEqual", "<=");
        else this.addToken("Operator:Less", "<");
        break;
      case ">":
        if (this.match(">"))
          if (this.match("=")) this.addToken("Operator:RightShiftEqual", ">>=");
          else this.addToken("Operator:RightShift", ">>");
        else if (this.match("=")) this.addToken("Operator:GreaterEqual", ">=");
        else this.addToken("Operator:Greater", ">");
        break;
      case '"':
        this.scanString();
        break;
      case "&":
        if (this.match("&")) this.addToken("Operator:AndAnd", "&&");
        else if (this.match("=")) this.addToken("Operator:AndEqual", "&=");
        else this.addToken("Operator:And", "&");
        break;
      case "|":
        if (this.match("|")) this.addToken("Operator:OrOr", "||");
        else if (this.match("=")) this.addToken("Operator:OrEqual", "|=");
        else this.addToken("Operator:Or", "|");
        break;
      case "^":
        if (this.match("=")) this.addToken("Operator:XorEqual", "^=");
        else this.addToken("Operator:Xor", "^");
        break;
      default:
        if (this.isDigit(c)) this.scanNumber();
        else if (this.isAlpha(c)) this.scanIdentifier();
        else
          throw new SyntaxError(
            `Unexpected character '${c}' at line ${this.line} column ${this.column}`,
          );
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
        this.addToken("Special:EOL", "\n");
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

    if (this.isAtEnd()) {
      throw new SyntaxError(
        `Unterminated string at line ${this.line} column ${this.column}`,
      );
    }

    this.nextChar();
    this.addToken(
      "Literal:String",
      this.source.substring(this.start + 1, this.current - 1),
    );
  }

  private scanIdentifier() {
    while (this.isAlphaNumeric(this.peekChar())) this.nextChar();
    const text = this.source.substring(this.start, this.current);
    if (keywords.includes(text)) this.addToken("Keyword", text);
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
}
