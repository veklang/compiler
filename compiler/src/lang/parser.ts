import type {
  AssignmentExpression,
  Expression,
  ExpressionStatement,
  GroupingExpression,
  IdentifierExpression,
  LiteralExpression,
  Program,
  Statement,
} from "@/types/ast";
import { type Diagnostic, errorDiagnostic } from "@/types/diagnostic";
import type { Span } from "@/types/position";
import type { Operator } from "@/types/shared";
import type { Token } from "@/types/token";

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

const precedence: Record<Operator, number> = {
  "=": 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "<<": 6,
  ">>": 6,
  "+": 7,
  "-": 7,
  "*": 8,
  "/": 8,
  "%": 8,
  "**": 9,
  "&": 10,
  "|": 10,
  "^": 10,
  "++": 11,
  "--": 11,
  "+=": 1,
  "-=": 1,
  "*=": 1,
  "/=": 1,
  "%=": 1,
  "&=": 1,
  "|=": 1,
  "^=": 1,
  "<<=": 1,
  ">>=": 1,
  "!": 12,
};

const rightAssociative = new Set<Operator>([
  "=",
  "**",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
]);

const assignmentOperators = new Set<Operator>([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
]);

const unaryOperators = new Set<Operator>(["!", "+", "-", "++", "--"]);

export class Parser {
  private tokens: Token[];
  private diagnostics: Diagnostic[] = [];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parseProgram(): ParseResult {
    const body: Statement[] = [];

    while (!this.isAtEnd()) {
      this.consumeTrivia();
      if (this.isAtEnd()) break;
      const statement = this.parseStatement();
      if (statement) body.push(statement);
      this.consumeStatementTerminator();
    }

    const program: Program = {
      type: "Program",
      span: this.spanFromTo(
        body[0]?.span ?? this.peek()?.span,
        body[body.length - 1]?.span ?? this.peek()?.span,
      ),
      body,
    };

    return { program, diagnostics: this.diagnostics };
  }

  private parseStatement(): Statement | null {
    const expression = this.parseExpression();
    if (!expression) return null;
    const statement: ExpressionStatement = {
      type: "ExpressionStatement",
      span: expression.span,
      expression,
    };
    return statement;
  }

  private parseExpression(minPrecedence = 0): Expression | null {
    let left = this.parsePrefix();
    if (!left) return null;

    while (true) {
      this.consumeTrivia();
      const operatorToken = this.peek();
      if (!operatorToken || operatorToken.kind !== "Operator") break;
      const operator = operatorToken.operator;
      if (!operator) break;
      const opPrecedence = precedence[operator] ?? 0;
      if (opPrecedence < minPrecedence) break;

      this.advance();
      const nextMin = rightAssociative.has(operator)
        ? opPrecedence
        : opPrecedence + 1;
      const right = this.parseExpression(nextMin);
      if (!right) {
        this.report(
          "Expected expression after operator.",
          operatorToken.span,
          "PAR002",
        );
        break;
      }

      if (assignmentOperators.has(operator)) {
        if (left.type !== "IdentifierExpression") {
          this.report("Invalid assignment target.", left.span, "PAR003");
          left = right;
          continue;
        }
        const assignment: AssignmentExpression = {
          type: "AssignmentExpression",
          operator,
          left,
          right,
          span: this.spanFromTo(left.span, right.span),
        };
        left = assignment;
        continue;
      }

      left = {
        type: "BinaryExpression",
        operator,
        left,
        right,
        span: this.spanFromTo(left.span, right.span),
      };
    }

    return left;
  }

  private parsePrefix(): Expression | null {
    this.consumeTrivia();
    const token = this.peek();
    if (!token) return null;

    if (
      token.kind === "Operator" &&
      token.operator &&
      unaryOperators.has(token.operator)
    ) {
      this.advance();
      const argument = this.parsePrefix();
      if (!argument) {
        this.report(
          "Expected expression after unary operator.",
          token.span,
          "PAR004",
        );
        return null;
      }

      return {
        type: "UnaryExpression",
        operator: token.operator,
        argument,
        span: this.spanFromTo(token.span, argument.span),
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expression | null {
    this.consumeTrivia();
    const token = this.advance();
    if (!token) return null;

    switch (token.kind) {
      case "Number":
        return this.literalFromToken(
          token,
          "Number",
          token.value ?? Number(token.lexeme),
        );
      case "String":
        return this.literalFromToken(
          token,
          "String",
          token.value ?? token.lexeme,
        );
      case "Identifier":
        return {
          type: "IdentifierExpression",
          name: token.lexeme,
          span: token.span,
        } as IdentifierExpression;
      case "Keyword":
        if (token.lexeme === "true" || token.lexeme === "false") {
          return this.literalFromToken(
            token,
            "Boolean",
            token.lexeme === "true",
          );
        }
        if (token.lexeme === "null") {
          return this.literalFromToken(token, "Null", null);
        }
        this.report(
          `Unexpected keyword '${token.lexeme}'.`,
          token.span,
          "PAR005",
        );
        return null;
      case "Punctuator":
        if (token.punctuator === "(") {
          const expression = this.parseExpression();
          this.consumeTrivia();
          const closing = this.peek();
          if (
            !closing ||
            closing.kind !== "Punctuator" ||
            closing.punctuator !== ")"
          ) {
            this.report("Expected ')'.", token.span, "PAR006");
            return expression;
          }
          this.advance();
          const grouping: GroupingExpression = {
            type: "GroupingExpression",
            expression:
              expression ?? this.literalFromToken(token, "Null", null),
            span: this.spanFromTo(token.span, closing.span),
          };
          return grouping;
        }
        this.report(
          `Unexpected punctuator '${token.lexeme}'.`,
          token.span,
          "PAR007",
        );
        return null;
      case "EOF":
        return null;
      default:
        this.report(
          `Unexpected token '${token.lexeme}'.`,
          token.span,
          "PAR008",
        );
        return null;
    }
  }

  private literalFromToken(
    token: Token,
    type: LiteralExpression["literalType"],
    value: LiteralExpression["value"],
  ) {
    const literal: LiteralExpression = {
      type: "LiteralExpression",
      literalType: type,
      value,
      span: token.span,
    };
    return literal;
  }

  private consumeTrivia() {
    while (this.peek()?.kind === "EOL") this.advance();
  }

  private consumeStatementTerminator() {
    if (this.peek()?.kind === "Punctuator" && this.peek()?.punctuator === ";")
      this.advance();
    this.consumeTrivia();
  }

  private report(message: string, span: Span, code?: string) {
    this.diagnostics.push(errorDiagnostic(message, span, code));
  }

  private advance() {
    if (this.current < this.tokens.length) {
      const token = this.tokens[this.current];
      this.current++;
      return token;
    }
    return null;
  }

  private peek(offset = 0) {
    return this.current + offset < this.tokens.length
      ? this.tokens[this.current + offset]
      : null;
  }

  private isAtEnd() {
    return this.peek()?.kind === "EOF";
  }

  private spanFromTo(start?: Span, end?: Span): Span {
    if (!start && !end) {
      const pos = this.peek()?.span;
      if (pos) return pos;
      return {
        start: { index: 0, line: 1, column: 1 },
        end: { index: 0, line: 1, column: 1 },
      };
    }
    if (start && end) return { start: start.start, end: end.end };
    if (start) return { start: start.start, end: start.end };
    return { start: end!.start, end: end!.end };
  }
}
