import type { Node, Operator as AstOperator, LiteralType } from "@/types/ast";
import type { Token, Operator as TokenOperator, Literal } from "@/types/token";

export class Parser {
  private tokens: Token[] = [];
  private nodes: Node[] = [];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse() {
    while (!this.isAtEnd()) {
      const token = this.consume();
      if (!token || token.type === "Special:EOF") break;

      switch (token.type) {
        case "Literal:Integer":
        case "Literal:Float": {
          const operator = this.consume();
          if (
            !operator ||
            ![
              "Operator:Minus",
              "Operator:Plus",
              "Operator:Slash",
              "Operator:Asterisk",
              "Operator:Modulo",
              "Operator:Exponentiation",
              "Operator:BangEqual",
              "Operator:EqualEqual",
              "Operator:Greater",
              "Operator:GreaterEqual",
              "Operator:Less",
              "Operator:LessEqual",
              "Operator:AndAnd",
              "Operator:OrOr",
            ].includes(operator.type as TokenOperator)
          )
            throw new SyntaxError(
              `Expected binary operator, got ${operator?.type || "Special:EOF"} at line ${operator?.line || token.line} col ${operator?.column || token.column}`,
            );

          const rightOperand = this.consume();
          if (
            !rightOperand ||
            !["Literal:Integer", "Literal:Float"].includes(
              rightOperand.type as Literal,
            )
          )
            throw new SyntaxError(
              `Expected Literal:Integer or Literal:Float, got ${rightOperand?.type || "Special:EOF"} at line ${rightOperand?.line || token.line} col ${rightOperand?.column || token.column}`,
            );

          this.nodes.push({
            type: "Expression",
            expressionType: "Binary",
            operator: operator.type.replace("Operator:", "") as AstOperator,
            operands: [
              {
                type: "Literal",
                literalType: token.type.replace("Literal:", "") as LiteralType,
                value: Number(token.lexeme),
                tokens: [token],
              },
              {
                type: "Literal",
                literalType: rightOperand.type.replace(
                  "Literal:",
                  "",
                ) as LiteralType,
                value: Number(rightOperand.lexeme),
                tokens: [rightOperand],
              },
            ],
            tokens: [token, operator, rightOperand],
          });
        }
      }
    }

    return this.nodes;
  }

  private consume() {
    const token = this.peek();
    if (token) this.current++;
    return token;
  }

  private peek(offset = 0) {
    return this.current + offset < this.tokens.length
      ? this.tokens[this.current + offset]
      : null;
  }

  private isAtEnd() {
    return (
      this.current >= this.tokens.length || this.peek()?.type === "Special:EOF"
    );
  }
}
