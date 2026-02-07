import type {
  Argument,
  ArrayLiteralExpression,
  AssignmentExpression,
  BinaryExpression,
  BindingPattern,
  BlockStatement,
  CallExpression,
  CastExpression,
  EnumDeclaration,
  EnumPattern,
  EnumVariant,
  ExportDefaultDeclaration,
  Expression,
  ExpressionStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  FunctionType,
  Identifier,
  IdentifierExpression,
  IdentifierPattern,
  IfStatement,
  ImportDeclaration,
  KwSpreadArgument,
  KwVariadicParameter,
  LiteralExpression,
  LiteralPattern,
  MapEntry,
  MapLiteralExpression,
  MatchArm,
  MatchStatement,
  MemberExpression,
  NamedArgument,
  NamedType,
  Node,
  Parameter,
  ParameterNode,
  ParameterSeparator,
  Pattern,
  PositionalArgument,
  Program,
  ReturnStatement,
  SpreadArgument,
  Statement,
  StringLiteralExpression,
  StructDeclaration,
  StructField,
  StructLiteralExpression,
  StructLiteralField,
  TupleBinding,
  TupleLiteralExpression,
  TupleType,
  TypeAliasDeclaration,
  TypeNode,
  TypeParameter,
  UnaryExpression,
  UnionType,
  VariableDeclaration,
  VariadicParameter,
  WhileStatement,
  WildcardPattern,
} from "@/types/ast";
import type { Diagnostic } from "@/types/diagnostic";
import type { Span } from "@/types/position";
import type { LiteralType, Operator } from "@/types/shared";
import type { Token } from "@/types/token";

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

export class Parser {
  private tokens: Token[];
  private diagnostics: Diagnostic[] = [];
  private current = 0;
  private structLiteralEnabled = true;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parseProgram(): ParseResult {
    const body: Statement[] = [];

    while (!this.isAtEnd()) {
      const before = this.current;
      const statement = this.parseStatement();
      if (statement) body.push(statement);
      else this.advance();
      if (this.current === before) {
        this.report("Parser made no progress.", this.currentSpan(), "E1099");
        this.advance();
      }
    }

    const program: Program = {
      kind: "Program",
      span: this.spanFromNodes(body) ?? this.emptySpan(),
      body,
    };

    return { program, diagnostics: this.diagnostics };
  }

  private parseStatement(): Statement | null {
    if (this.matchKeyword("pub")) {
      if (this.matchKeyword("default")) return this.parseExportDefault();
      return this.parseDeclaration(true);
    }

    if (this.checkKeyword("import")) return this.parseImport();

    return (
      this.parseDeclaration(false) ??
      this.parseControlStatement() ??
      this.parseExpressionStatement()
    );
  }

  private parseDeclaration(isPublic: boolean): Statement | null {
    if (this.matchKeyword("inline"))
      return this.parseFunctionDeclaration(isPublic, true);
    if (this.checkKeyword("fn"))
      return this.parseFunctionDeclaration(isPublic, false);
    if (this.checkKeyword("let") || this.checkKeyword("const"))
      return this.parseVariableDeclaration(isPublic);
    if (this.checkKeyword("type")) return this.parseTypeAlias(isPublic);
    if (this.checkKeyword("struct"))
      return this.parseStructDeclaration(isPublic);
    if (this.checkKeyword("enum")) return this.parseEnumDeclaration(isPublic);
    return null;
  }

  private parseControlStatement(): Statement | null {
    if (this.checkKeyword("return")) return this.parseReturnStatement();
    if (this.checkKeyword("if")) return this.parseIfStatement();
    if (this.checkKeyword("while")) return this.parseWhileStatement();
    if (this.checkKeyword("for")) return this.parseForStatement();
    if (this.checkKeyword("match")) return this.parseMatchStatement();
    if (this.checkKeyword("break")) return this.parseBreakStatement();
    if (this.checkKeyword("continue")) return this.parseContinueStatement();
    if (this.checkPunctuator("{")) return this.parseBlockStatement();
    return null;
  }

  private parseImport(): ImportDeclaration {
    const start = this.expectKeyword("import");

    let defaultImport: Identifier | undefined;
    let namedImports: Identifier[] | undefined;

    if (this.matchPunctuator("{")) {
      namedImports = [];
      while (!this.isAtEnd() && !this.checkPunctuator("}")) {
        const name = this.parseIdentifier();
        if (name) namedImports.push(name);
        if (!this.matchPunctuator(",")) break;
      }
      this.expectPunctuator("}");
    } else
      defaultImport =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());

    this.expectKeyword("from");
    const sourceToken = this.expectKind("String");
    const source = this.stringLiteralFromToken(sourceToken);

    this.expectSemicolon();

    return {
      kind: "ImportDeclaration",
      span: this.spanFrom(start?.span, source.span),
      defaultImport,
      namedImports,
      source,
    };
  }

  private parseExportDefault(): ExportDefaultDeclaration {
    const start = this.previousSpan() ?? this.currentSpan();
    if (this.matchOperator("*")) {
      this.expectSemicolon();
      return {
        kind: "ExportDefaultDeclaration",
        span: this.spanFrom(start, this.previousSpan()),
        exportAll: true,
      };
    }

    if (this.peek()?.kind === "Identifier") {
      const startIndex = this.current;
      const symbols: Identifier[] = [];
      const first = this.parseIdentifier();
      if (first) symbols.push(first);
      let sawComma = false;
      while (this.matchPunctuator(",")) {
        sawComma = true;
        if (!this.checkIdentifierStart()) {
          this.report(
            "Default export list must contain only identifiers.",
            this.currentSpan(),
            "E1070",
          );
          break;
        }
        const symbol = this.parseIdentifier();
        if (symbol) symbols.push(symbol);
      }
      if (sawComma) {
        this.expectSemicolon();
        return {
          kind: "ExportDefaultDeclaration",
          span: this.spanFrom(
            start,
            symbols[symbols.length - 1]?.span ?? start,
          ),
          symbols,
        };
      }
      this.current = startIndex;
    }

    const expression = this.parseExpression();
    this.expectSemicolon();

    return {
      kind: "ExportDefaultDeclaration",
      span: this.spanFrom(start, expression?.span ?? start),
      expression: expression ?? this.placeholderExpression(start),
    };
  }

  private parseFunctionDeclaration(
    isPublic: boolean,
    isInline: boolean,
  ): FunctionDeclaration {
    const start = this.expectKeyword("fn");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(start?.span);
    const typeParams = this.parseTypeParams();
    const params = this.parseParameterList();
    const returnType = this.matchPunctuator(":") ? this.parseType() : undefined;
    const body = this.parseBlockStatement();

    return {
      kind: "FunctionDeclaration",
      span: this.spanFrom(start?.span, body.span),
      name,
      typeParams,
      params,
      returnType: returnType ?? undefined,
      body,
      isInline,
      isPublic,
    };
  }

  private parseVariableDeclaration(isPublic: boolean): VariableDeclaration {
    const keywordToken = this.advance();
    const declarationKind = keywordToken?.lexeme === "const" ? "const" : "let";
    const name =
      this.parseBindingPattern() ??
      this.placeholderIdentifier(keywordToken?.span);
    let typeAnnotation: TypeNode | undefined;
    let initializer: Expression | undefined;

    if (this.matchPunctuator(":"))
      typeAnnotation = this.parseType() ?? undefined;
    if (this.matchOperator("="))
      initializer = this.parseExpression() ?? undefined;

    if (declarationKind === "const" && !initializer)
      this.report(
        "Const declarations require an initializer.",
        name.span,
        "E1011",
      );

    this.expectSemicolon();

    return {
      kind: "VariableDeclaration",
      span: this.spanFrom(keywordToken?.span, initializer?.span ?? name.span),
      declarationKind,
      name,
      typeAnnotation,
      initializer,
      isPublic,
    };
  }

  private parseTypeAlias(isPublic: boolean): TypeAliasDeclaration {
    const start = this.expectKeyword("type");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(start?.span);
    this.expectOperator("=");
    const type = this.parseType() ?? this.placeholderType(start?.span);
    this.expectSemicolon();

    return {
      kind: "TypeAliasDeclaration",
      span: this.spanFrom(start?.span, type.span),
      name,
      type,
      isPublic,
    };
  }

  private parseStructDeclaration(isPublic: boolean): StructDeclaration {
    const start = this.expectKeyword("struct");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(start?.span);
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const fields: StructField[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const fieldName = this.parseIdentifier();
      this.expectPunctuator(":");
      const type = this.parseType() ?? this.placeholderType(this.currentSpan());
      fields.push({
        kind: "StructField",
        span: this.spanFrom(fieldName?.span, type.span),
        name: fieldName ?? this.placeholderIdentifier(this.currentSpan()),
        type,
      });
      if (!this.matchPunctuator(",")) break;
    }

    const end = this.expectPunctuator("}");

    return {
      kind: "StructDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams,
      fields,
      isPublic,
    };
  }

  private parseEnumDeclaration(isPublic: boolean): EnumDeclaration {
    const start = this.expectKeyword("enum");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(start?.span);
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const variants: EnumVariant[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const variantName = this.parseIdentifier();
      let payload: TypeNode[] | undefined;
      if (this.matchPunctuator("(")) {
        payload = [];
        if (!this.checkPunctuator(")")) {
          do {
            const type = this.parseType();
            if (type) payload.push(type);
          } while (this.matchPunctuator(","));
        }
        this.expectPunctuator(")");
      }
      const variant: EnumVariant = {
        kind: "EnumVariant",
        span: this.spanFrom(
          variantName?.span,
          payload?.[payload.length - 1]?.span ?? variantName?.span,
        ),
        name: variantName ?? this.placeholderIdentifier(this.currentSpan()),
        payload,
      };
      variants.push(variant);
      if (!this.matchPunctuator(",")) break;
    }

    const end = this.expectPunctuator("}");

    return {
      kind: "EnumDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams,
      variants,
      isPublic,
    };
  }

  private parseReturnStatement(): ReturnStatement {
    const start = this.expectKeyword("return");

    if (this.checkPunctuator(";")) {
      this.advance();
      return {
        kind: "ReturnStatement",
        span: this.spanFrom(start?.span, start?.span),
      };
    }

    let value = this.parseExpression();
    if (this.matchPunctuator(",")) {
      const elements: Expression[] = value ? [value] : [];
      do {
        const next = this.parseExpression();
        if (next) elements.push(next);
      } while (this.matchPunctuator(","));
      const tuple: TupleLiteralExpression = {
        kind: "TupleLiteralExpression",
        span: this.spanFrom(
          elements[0]?.span,
          elements[elements.length - 1]?.span,
        ),
        elements,
      };
      value = tuple;
    }

    this.expectSemicolon();

    return {
      kind: "ReturnStatement",
      span: this.spanFrom(start?.span, value?.span ?? start?.span),
      value: value ?? undefined,
    };
  }

  private parseIfStatement(): IfStatement {
    const start = this.expectKeyword("if");
    const condition =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    const thenBranch = this.parseBlockStatement();
    let elseBranch: BlockStatement | IfStatement | undefined;

    if (this.matchKeyword("else")) {
      if (this.checkKeyword("if")) elseBranch = this.parseIfStatement();
      else elseBranch = this.parseBlockStatement();
    }

    return {
      kind: "IfStatement",
      span: this.spanFrom(start?.span, (elseBranch ?? thenBranch).span),
      condition,
      thenBranch,
      elseBranch,
    };
  }

  private parseWhileStatement(): WhileStatement {
    const start = this.expectKeyword("while");
    const condition =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    const body = this.parseBlockStatement();

    return {
      kind: "WhileStatement",
      span: this.spanFrom(start?.span, body.span),
      condition,
      body,
    };
  }

  private parseForStatement(): ForStatement {
    const start = this.expectKeyword("for");
    const iterator =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    this.expectKeyword("in");
    const iterable =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    const body = this.parseBlockStatement();

    return {
      kind: "ForStatement",
      span: this.spanFrom(start?.span, body.span),
      iterator,
      iterable,
      body,
    };
  }

  private parseMatchStatement(): MatchStatement {
    const start = this.expectKeyword("match");
    const expression =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    this.expectPunctuator("{");

    const arms: MatchArm[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const pattern = this.parsePattern();
      this.expectOperator("=>");
      const body = this.checkPunctuator("{")
        ? this.parseBlockStatement()
        : (this.parseExpression() ??
          this.placeholderExpression(this.currentSpan()));
      arms.push({
        kind: "MatchArm",
        span: this.spanFrom(pattern.span, body.span),
        pattern,
        body,
      });
      if (!this.matchPunctuator(",")) break;
    }

    const end = this.expectPunctuator("}");

    return {
      kind: "MatchStatement",
      span: this.spanFrom(start?.span, end?.span ?? expression.span),
      expression,
      arms,
    };
  }

  private parsePattern(): Pattern {
    const token = this.advance();
    if (!token) return this.placeholderPattern(this.currentSpan());

    if (token.kind === "Identifier" && token.lexeme === "_") {
      return {
        kind: "WildcardPattern",
        span: token.span,
      } satisfies WildcardPattern;
    }

    if (token.kind === "Identifier") {
      const name = this.identifierFromToken(token);
      if (this.matchPunctuator("(")) {
        const bindings: Identifier[] = [];
        if (!this.checkPunctuator(")")) {
          do {
            const binding =
              this.parseIdentifier() ??
              this.placeholderIdentifier(this.currentSpan());
            bindings.push(binding);
          } while (this.matchPunctuator(","));
        }
        const end = this.expectPunctuator(")");
        return {
          kind: "EnumPattern",
          span: this.spanFrom(token.span, end?.span ?? token.span),
          name,
          bindings,
        } satisfies EnumPattern;
      }
      return {
        kind: "IdentifierPattern",
        span: token.span,
        name,
      } satisfies IdentifierPattern;
    }

    if (token.kind === "Number" || token.kind === "String") {
      const literal = this.literalFromToken(token);
      return {
        kind: "LiteralPattern",
        span: literal.span,
        literal,
      } satisfies LiteralPattern;
    }

    if (token.kind === "Operator" && token.lexeme === "=>") {
      this.report("Unexpected '=>' outside match arm.", token.span, "E1042");
      return this.placeholderPattern(token.span);
    }

    if (token.kind === "Keyword") {
      if (
        token.lexeme === "true" ||
        token.lexeme === "false" ||
        token.lexeme === "null"
      ) {
        const literal = this.literalFromToken(token);
        return {
          kind: "LiteralPattern",
          span: literal.span,
          literal,
        } satisfies LiteralPattern;
      }
      this.report(
        `Unexpected keyword '${token.lexeme}' in pattern.`,
        token.span,
        "E1030",
      );
      return this.placeholderPattern(token.span);
    }

    this.report("Invalid match pattern.", token.span, "E1030");
    return this.placeholderPattern(token.span);
  }

  private parseBreakStatement(): Statement {
    const start = this.expectKeyword("break");
    this.expectSemicolon();
    return { kind: "BreakStatement", span: start?.span ?? this.currentSpan() };
  }

  private parseContinueStatement(): Statement {
    const start = this.expectKeyword("continue");
    this.expectSemicolon();
    return {
      kind: "ContinueStatement",
      span: start?.span ?? this.currentSpan(),
    };
  }

  private parseBlockStatement(): BlockStatement {
    const start = this.expectPunctuator("{");
    const body: Statement[] = [];

    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const statement = this.parseStatement();
      if (statement) body.push(statement);
      else this.advance();
    }

    const end = this.expectPunctuator("}");

    return {
      kind: "BlockStatement",
      span: this.spanFrom(start?.span, end?.span ?? start?.span),
      body,
    };
  }

  private parseExpressionStatement(): ExpressionStatement | null {
    const expression = this.parseExpression();
    if (!expression) return null;
    this.expectSemicolon();
    return {
      kind: "ExpressionStatement",
      span: expression.span,
      expression,
    };
  }

  private parseExpression(): Expression | null {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression | null {
    const left = this.parseLogicalOr();
    if (!left) return null;

    if (this.matchOperator("=")) {
      const right =
        this.parseAssignment() ??
        this.placeholderExpression(this.currentSpan());
      const assignment: AssignmentExpression = {
        kind: "AssignmentExpression",
        span: this.spanFrom(left.span, right.span),
        left,
        right,
      };
      return assignment;
    }

    return left;
  }

  private parseLogicalOr(): Expression | null {
    let expression = this.parseLogicalAnd();
    if (!expression) return null;
    while (this.matchOperator("||")) {
      const operatorToken = this.previous();
      const right =
        this.parseLogicalAnd() ??
        this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseLogicalAnd(): Expression | null {
    let expression = this.parseEquality();
    if (!expression) return null;
    while (this.matchOperator("&&")) {
      const operatorToken = this.previous();
      const right =
        this.parseEquality() ?? this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseEquality(): Expression | null {
    let expression = this.parseComparison();
    if (!expression) return null;
    while (
      this.matchOperator("==") ||
      this.matchOperator("!=") ||
      this.matchOperator("is")
    ) {
      const operatorToken = this.previous();
      const right =
        this.parseComparison() ??
        this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseComparison(): Expression | null {
    let expression = this.parseTerm();
    if (!expression) return null;
    while (
      this.matchOperator("<") ||
      this.matchOperator("<=") ||
      this.matchOperator(">") ||
      this.matchOperator(">=")
    ) {
      const operatorToken = this.previous();
      const right =
        this.parseTerm() ?? this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseTerm(): Expression | null {
    let expression = this.parseFactor();
    if (!expression) return null;
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operatorToken = this.previous();
      const right =
        this.parseFactor() ?? this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseFactor(): Expression | null {
    let expression = this.parseUnary();
    if (!expression) return null;
    while (
      this.matchOperator("*") ||
      this.matchOperator("/") ||
      this.matchOperator("%")
    ) {
      const operatorToken = this.previous();
      const right =
        this.parseUnary() ?? this.placeholderExpression(this.currentSpan());
      expression = this.binaryFrom(operatorToken, expression, right);
    }
    return expression;
  }

  private parseUnary(): Expression | null {
    if (
      this.matchOperator("-") ||
      this.matchOperator("+") ||
      this.matchOperator("!")
    ) {
      const operatorToken = this.previous();
      const argument =
        this.parseUnary() ?? this.placeholderExpression(this.currentSpan());
      const expression: UnaryExpression = {
        kind: "UnaryExpression",
        span: this.spanFrom(operatorToken?.span, argument.span),
        operator: (operatorToken?.operator ??
          operatorToken?.lexeme) as Operator,
        argument,
      };
      return expression;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression | null {
    let expression = this.parsePrimary();
    if (!expression) return null;

    while (true) {
      if (this.matchPunctuator("(")) {
        const args = this.parseArgumentList();
        const end = this.expectPunctuator(")");
        expression = {
          kind: "CallExpression",
          span: this.spanFrom(expression.span, end?.span ?? expression.span),
          callee: expression,
          args,
        } satisfies CallExpression;
        continue;
      }

      if (this.matchPunctuator(".")) {
        const property =
          this.parseIdentifier() ??
          this.placeholderIdentifier(this.currentSpan());
        expression = {
          kind: "MemberExpression",
          span: this.spanFrom(expression.span, property.span),
          object: expression,
          property,
        } satisfies MemberExpression;
        continue;
      }

      if (
        this.structLiteralEnabled &&
        this.checkPunctuator("{") &&
        expression.kind === "IdentifierExpression"
      ) {
        expression = this.parseStructLiteral(
          expression as IdentifierExpression,
        );
        continue;
      }

      if (this.matchKeyword("as")) {
        const type =
          this.parseType() ?? this.placeholderType(this.currentSpan());
        expression = {
          kind: "CastExpression",
          span: this.spanFrom(expression.span, type.span),
          expression,
          type,
        } satisfies CastExpression;
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimary(): Expression | null {
    if (this.checkPunctuator("(")) return this.parseGroupingOrTuple();

    if (this.matchPunctuator("[")) return this.parseArrayLiteral();
    if (this.matchPunctuator("{")) return this.parseMapLiteral();

    if (this.matchKeyword("fn")) return this.parseFunctionExpression();

    const token = this.advance();
    if (!token) return null;

    if (token.kind === "Number") return this.literalFromToken(token);
    if (token.kind === "String") return this.literalFromToken(token, "String");

    if (token.kind === "Keyword") {
      if (
        token.lexeme === "true" ||
        token.lexeme === "false" ||
        token.lexeme === "null" ||
        token.lexeme === "NaN" ||
        token.lexeme === "Infinity"
      )
        return this.literalFromToken(token);
      this.report(`Unexpected keyword '${token.lexeme}'.`, token.span, "E1040");
      return this.placeholderExpression(token.span);
    }

    if (token.kind === "Identifier") {
      const identifier: IdentifierExpression = {
        kind: "IdentifierExpression",
        span: token.span,
        name: token.lexeme,
      };
      return identifier;
    }

    this.report(`Unexpected token '${token.lexeme}'.`, token.span, "E1041");
    return this.placeholderExpression(token.span);
  }

  private parseArrayLiteral(): ArrayLiteralExpression {
    const start = this.previousSpan();
    const elements: Expression[] = [];
    if (!this.checkPunctuator("]")) {
      do {
        const element = this.parseExpression();
        if (element) elements.push(element);
      } while (this.matchPunctuator(","));
    }
    const end = this.expectPunctuator("]");
    return {
      kind: "ArrayLiteralExpression",
      span: this.spanFrom(start, end?.span ?? start),
      elements,
    };
  }

  private parseMapLiteral(): MapLiteralExpression {
    const start = this.previousSpan();
    const entries: MapEntry[] = [];

    if (!this.checkPunctuator("}")) {
      do {
        if (
          this.checkIdentifierStart() &&
          (this.peek(1)?.lexeme === "," || this.peek(1)?.lexeme === "}")
        ) {
          const name =
            this.parseIdentifier() ??
            this.placeholderIdentifier(this.currentSpan());
          const key: LiteralExpression = {
            kind: "LiteralExpression",
            span: name.span,
            literalType: "String",
            value: name.name,
          };
          const value: IdentifierExpression = {
            kind: "IdentifierExpression",
            span: name.span,
            name: name.name,
          };
          entries.push({
            kind: "MapEntry",
            span: this.spanFrom(key.span, value.span),
            key,
            value,
          });
        } else {
          const key =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
          this.expectPunctuator(":");
          const value =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
          entries.push({
            kind: "MapEntry",
            span: this.spanFrom(key.span, value.span),
            key,
            value,
          });
        }
      } while (this.matchPunctuator(","));
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "MapLiteralExpression",
      span: this.spanFrom(start, end?.span ?? start),
      entries,
    };
  }

  private parseStructLiteral(
    name: IdentifierExpression,
  ): StructLiteralExpression {
    const start = name.span;
    this.expectPunctuator("{");
    const fields: StructLiteralField[] = [];

    if (!this.checkPunctuator("}")) {
      do {
        const fieldName =
          this.parseIdentifier() ??
          this.placeholderIdentifier(this.currentSpan());
        let value: Expression;
        if (this.matchPunctuator(":")) {
          value =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
        } else {
          value = {
            kind: "IdentifierExpression",
            span: fieldName.span,
            name: fieldName.name,
          };
        }
        fields.push({
          kind: "StructLiteralField",
          span: this.spanFrom(fieldName.span, value.span),
          name: fieldName,
          value,
        });
      } while (this.matchPunctuator(","));
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "StructLiteralExpression",
      span: this.spanFrom(start, end?.span ?? start),
      name,
      fields,
    };
  }

  private parseGroupingOrTuple(): Expression {
    const start = this.expectPunctuator("(");
    const elements: Expression[] = [];

    if (!this.checkPunctuator(")")) {
      do {
        const element = this.withStructLiteral(true, () =>
          this.parseExpression(),
        );
        if (element) elements.push(element);
      } while (this.matchPunctuator(","));
    }

    const end = this.expectPunctuator(")");

    if (elements.length === 1) {
      return {
        kind: "GroupingExpression",
        span: this.spanFrom(start?.span, end?.span ?? elements[0].span),
        expression: elements[0],
      };
    }

    return {
      kind: "TupleLiteralExpression",
      span: this.spanFrom(start?.span, end?.span ?? start?.span),
      elements,
    };
  }

  private parseFunctionExpression(): FunctionExpression {
    const start = this.previousSpan();
    const params = this.parseParameterList();
    const returnType = this.matchPunctuator(":") ? this.parseType() : undefined;
    const body = this.parseBlockStatement();
    return {
      kind: "FunctionExpression",
      span: this.spanFrom(start, body.span),
      params,
      returnType: returnType ?? undefined,
      body,
    };
  }

  private parseArgumentList(): Argument[] {
    const args: Argument[] = [];
    let seenNamed = false;
    let seenKwSpread = false;
    const seenNamedArgs = new Set<string>();
    if (!this.checkPunctuator(")")) {
      do {
        if (this.matchOperator("**")) {
          if (seenKwSpread)
            this.report(
              "Multiple '**kwargs' arguments are not allowed.",
              this.previousSpan(),
              "E1068",
            );
          const value =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
          const arg: KwSpreadArgument = {
            kind: "KwSpreadArgument",
            span: this.spanFrom(this.previousSpan(), value.span),
            value,
          };
          args.push(arg);
          seenNamed = true;
          seenKwSpread = true;
          continue;
        }

        if (this.matchOperator("*")) {
          const value =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
          const arg: SpreadArgument = {
            kind: "SpreadArgument",
            span: this.spanFrom(this.previousSpan(), value.span),
            value,
          };
          args.push(arg);
          continue;
        }

        if (this.checkArgumentNamed()) {
          const name =
            this.parseIdentifier() ??
            this.placeholderIdentifier(this.currentSpan());
          if (seenNamedArgs.has(name.name)) {
            this.report(
              `Duplicate keyword argument '${name.name}'.`,
              name.span,
              "E1069",
            );
          }
          seenNamedArgs.add(name.name);
          this.expectOperator("=");
          const value =
            this.parseExpression() ??
            this.placeholderExpression(this.currentSpan());
          const arg: NamedArgument = {
            kind: "NamedArgument",
            span: this.spanFrom(name.span, value.span),
            name,
            value,
          };
          args.push(arg);
          seenNamed = true;
          continue;
        }

        if (seenNamed)
          this.report(
            "Positional arguments cannot follow named arguments.",
            this.currentSpan(),
            "E1060",
          );

        const value = this.parseExpression();
        if (value) {
          const arg: PositionalArgument = {
            kind: "PositionalArgument",
            span: value.span,
            value,
          };
          args.push(arg);
        }
      } while (this.matchPunctuator(","));
    }
    return args;
  }

  private parseParameterList(): ParameterNode[] {
    this.expectPunctuator("(");
    const params = this.parseParameterListInner();
    this.expectPunctuator(")");
    return params;
  }

  private parseParameterListInner(): ParameterNode[] {
    const params: ParameterNode[] = [];
    let namedOnly = false;
    let seenDefault = false;
    let seenVariadic = false;
    let seenKwVariadic = false;
    let seenSeparator = false;
    if (!this.checkPunctuator(")")) {
      do {
        const parsed = this.parseParameter({
          namedOnly,
          seenDefault,
          seenVariadic,
          seenKwVariadic,
          seenSeparator,
        });
        if (parsed) {
          params.push(parsed.node);
          if (parsed.makesNamedOnly) namedOnly = true;
          if (parsed.hasDefault) seenDefault = true;
          if (parsed.seenVariadic) seenVariadic = true;
          if (parsed.seenKwVariadic) seenKwVariadic = true;
          if (parsed.seenSeparator) seenSeparator = true;
        }
      } while (this.matchPunctuator(","));
    }
    return params;
  }

  private parseParameter(context: {
    namedOnly: boolean;
    seenDefault: boolean;
    seenVariadic: boolean;
    seenKwVariadic: boolean;
    seenSeparator: boolean;
  }): {
    node: ParameterNode;
    makesNamedOnly: boolean;
    hasDefault: boolean;
    seenVariadic: boolean;
    seenKwVariadic: boolean;
    seenSeparator: boolean;
  } | null {
    if (this.matchOperator("*")) {
      if (this.checkPunctuator(",") || this.checkPunctuator(")")) {
        if (
          context.seenSeparator ||
          context.seenVariadic ||
          context.seenKwVariadic
        )
          this.report(
            "Multiple '*' separators or varargs are not allowed.",
            this.previousSpan(),
            "E1063",
          );
        const sep: ParameterSeparator = {
          kind: "ParameterSeparator",
          span: this.previousSpan(),
          separator: "*",
        };
        return {
          node: sep,
          makesNamedOnly: true,
          hasDefault: false,
          seenVariadic: false,
          seenKwVariadic: false,
          seenSeparator: true,
        };
      }

      if (context.seenVariadic)
        this.report(
          "Multiple '*args' parameters are not allowed.",
          this.previousSpan(),
          "E1064",
        );

      const name =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());
      this.expectPunctuator(":");
      const type = this.parseType() ?? this.placeholderType(name.span);
      const node: VariadicParameter = {
        kind: "VariadicParameter",
        span: this.spanFrom(name.span, type.span),
        name,
        type,
      };
      return {
        node,
        makesNamedOnly: true,
        hasDefault: false,
        seenVariadic: true,
        seenKwVariadic: false,
        seenSeparator: false,
      };
    }

    if (this.matchOperator("**")) {
      if (this.checkPunctuator(",") || this.checkPunctuator(")")) {
        if (
          context.seenSeparator ||
          context.seenVariadic ||
          context.seenKwVariadic
        )
          this.report(
            "Multiple '**' separators or kwargs are not allowed.",
            this.previousSpan(),
            "E1065",
          );
        const sep: ParameterSeparator = {
          kind: "ParameterSeparator",
          span: this.previousSpan(),
          separator: "**",
        };
        return {
          node: sep,
          makesNamedOnly: true,
          hasDefault: false,
          seenVariadic: false,
          seenKwVariadic: false,
          seenSeparator: true,
        };
      }

      if (context.seenKwVariadic)
        this.report(
          "Multiple '**kwargs' parameters are not allowed.",
          this.previousSpan(),
          "E1066",
        );

      const name =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());
      this.expectPunctuator(":");
      const type = this.parseType() ?? this.placeholderType(name.span);
      const node: KwVariadicParameter = {
        kind: "KwVariadicParameter",
        span: this.spanFrom(name.span, type.span),
        name,
        type,
      };
      return {
        node,
        makesNamedOnly: true,
        hasDefault: false,
        seenVariadic: false,
        seenKwVariadic: true,
        seenSeparator: false,
      };
    }

    let leadingMut = false;
    if (this.checkKeyword("mut")) {
      this.advance();
      leadingMut = true;
    }
    const name = this.parseIdentifier();
    if (!name) return null;

    if (context.seenKwVariadic)
      this.report(
        "No parameters allowed after '**kwargs'.",
        name.span,
        "E1067",
      );

    this.expectPunctuator(":");
    const trailingMut = this.matchKeyword("mut");
    if (leadingMut && trailingMut)
      this.report("Duplicate 'mut' on parameter.", name.span, "E1068");
    const isMutable = leadingMut || trailingMut;
    const type = this.parseType() ?? this.placeholderType(name.span);
    let defaultValue: Expression | undefined;
    let hasDefault = false;

    if (this.matchOperator("=")) {
      if (isMutable)
        this.report(
          "Default values are not allowed for mut parameters.",
          name.span,
          "E1061",
        );
      defaultValue =
        this.parseExpression() ??
        this.placeholderExpression(this.currentSpan());
      hasDefault = true;
    }

    if (!hasDefault && context.seenDefault)
      this.report(
        "Required parameters cannot follow default parameters.",
        name.span,
        "E1062",
      );

    const node: Parameter = {
      kind: "Parameter",
      span: this.spanFrom(name.span, defaultValue?.span ?? type.span),
      name,
      type,
      isMutable: !!isMutable,
      isNamedOnly: context.namedOnly,
      defaultValue,
    };
    return {
      node,
      makesNamedOnly: false,
      hasDefault,
      seenVariadic: false,
      seenKwVariadic: false,
      seenSeparator: false,
    };
  }

  private parseTypeParams(): TypeParameter[] | undefined {
    if (!this.matchOperator("<")) return undefined;
    const params: TypeParameter[] = [];

    if (!this.checkOperator(">")) {
      do {
        const name = this.parseIdentifier();
        if (name) {
          params.push({ kind: "TypeParameter", span: name.span, name });
        }
      } while (this.matchPunctuator(","));
    }

    this.expectOperator(">");
    return params;
  }

  private parseBindingPattern(): BindingPattern | null {
    if (this.matchPunctuator("(")) {
      const elements: Identifier[] = [];
      if (!this.checkPunctuator(")")) {
        do {
          const id = this.parseIdentifier();
          if (id) elements.push(id);
        } while (this.matchPunctuator(","));
      }
      const end = this.expectPunctuator(")");
      const span = this.spanFrom(
        elements[0]?.span,
        end?.span ?? this.currentSpan(),
      );
      const tuple: TupleBinding = { kind: "TupleBinding", span, elements };
      return tuple;
    }

    const first = this.parseIdentifier();
    if (!first) return null;
    if (!this.checkPunctuator(",")) return first;

    const elements: Identifier[] = [first];
    while (this.matchPunctuator(",")) {
      const id = this.parseIdentifier();
      if (id) elements.push(id);
      else break;
    }
    const span = this.spanFrom(
      elements[0]?.span,
      elements[elements.length - 1]?.span,
    );
    return { kind: "TupleBinding", span, elements };
  }

  private parseType(): TypeNode | null {
    return this.parseUnionType();
  }

  private parseUnionType(): TypeNode | null {
    const left = this.parsePrimaryType();
    if (!left) return null;
    const types: TypeNode[] = [left];

    while (this.matchOperator("|")) {
      const right = this.parsePrimaryType();
      if (right) types.push(right);
    }

    if (types.length === 1) return left;
    return {
      kind: "UnionType",
      span: this.spanFrom(types[0].span, types[types.length - 1].span),
      types,
    } satisfies UnionType;
  }

  private parsePrimaryType(): TypeNode | null {
    if (this.matchKeyword("fn")) return this.parseFunctionType();

    if (this.matchPunctuator("(")) {
      const elements: TypeNode[] = [];
      if (!this.checkPunctuator(")")) {
        do {
          const type = this.parseType();
          if (type) elements.push(type);
        } while (this.matchPunctuator(","));
      }
      const end = this.expectPunctuator(")");
      if (elements.length === 1) return elements[0];
      return {
        kind: "TupleType",
        span: this.spanFrom(elements[0]?.span, end?.span ?? elements[0]?.span),
        elements,
      } satisfies TupleType;
    }

    const token = this.advance();
    if (!token) return null;

    if (token.kind === "Identifier" || token.kind === "Keyword") {
      const name = this.identifierFromToken(token);
      let typeArgs: TypeNode[] | undefined;
      if (this.matchOperator("<")) {
        typeArgs = [];
        if (!this.checkOperator(">")) {
          do {
            const type = this.parseType();
            if (type) typeArgs.push(type);
          } while (this.matchPunctuator(","));
        }
        this.expectOperator(">");
      }
      return {
        kind: "NamedType",
        span: this.spanFrom(
          name.span,
          typeArgs?.[typeArgs.length - 1]?.span ?? name.span,
        ),
        name,
        typeArgs,
      } satisfies NamedType;
    }

    this.report("Expected type.", token.span, "E1050");
    return this.placeholderType(token.span);
  }

  private parseFunctionType(): TypeNode {
    this.expectPunctuator("(");
    const params: TypeNode[] = [];
    if (!this.checkPunctuator(")")) {
      do {
        const param = this.parseType();
        if (param) params.push(param);
      } while (this.matchPunctuator(","));
    }
    this.expectPunctuator(")");
    this.expectOperator("->");
    const returnType =
      this.parseType() ?? this.placeholderType(this.currentSpan());
    return {
      kind: "FunctionType",
      span: this.spanFrom(params[0]?.span ?? returnType.span, returnType.span),
      params,
      returnType,
    } satisfies FunctionType;
  }

  private parseIdentifier(): Identifier | null {
    const token = this.advance();
    if (!token) return null;
    if (token.kind === "Identifier") return this.identifierFromToken(token);
    this.report("Expected identifier.", token.span, "E1001");
    return this.placeholderIdentifier(token.span);
  }

  private identifierFromToken(token: Token): Identifier {
    return {
      kind: "Identifier",
      span: token.span,
      name: token.lexeme,
    };
  }

  private literalFromToken(
    token: Token,
    forcedType?: LiteralType,
  ): LiteralExpression {
    let literalType: LiteralType = forcedType ?? "Integer";
    let value: string =
      token.kind === "String"
        ? this.unescapeStringLiteral(token.lexeme)
        : token.lexeme;

    if (!forcedType && token.kind === "Number") {
      if (
        token.lexeme.includes(".") ||
        token.lexeme.includes("e") ||
        token.lexeme.includes("E")
      ) {
        literalType = "Float";
      } else literalType = "Integer";
    }

    if (token.kind === "Keyword") {
      if (token.lexeme === "true" || token.lexeme === "false")
        literalType = "Boolean";
      if (token.lexeme === "null") literalType = "Null";
      if (token.lexeme === "NaN") literalType = "Float";
      if (token.lexeme === "Infinity") literalType = "Float";
    }

    if (token.kind === "String") literalType = "String";
    if (token.kind === "Number") value = token.lexeme.replace(/_/g, "");

    return {
      kind: "LiteralExpression",
      span: token.span,
      literalType,
      value,
    };
  }

  private unescapeStringLiteral(lexeme: string): string {
    if (lexeme.length < 2) return lexeme;
    const inner = lexeme.slice(1, -1);
    let out = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const next = inner[i + 1] ?? "";
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === "0") out += "\0";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "u" && inner[i + 2] === "{") {
        let j = i + 3;
        let hex = "";
        while (j < inner.length && inner[j] !== "}") {
          hex += inner[j];
          j++;
        }
        if (j < inner.length && inner[j] === "}" && hex.length > 0) {
          const codePoint = Number.parseInt(hex, 16);
          if (
            !Number.isNaN(codePoint) &&
            codePoint <= 0x10ffff &&
            (codePoint < 0xd800 || codePoint > 0xdfff)
          ) {
            out += String.fromCodePoint(codePoint);
            i = j;
            continue;
          } else out += "u";
        } else out += "u";
      } else out += next;
      i++;
    }
    return out;
  }

  private stringLiteralFromToken(token: Token): StringLiteralExpression {
    const literal = this.literalFromToken(token, "String");
    return {
      ...literal,
      literalType: "String",
      value: literal.value,
    };
  }

  private binaryFrom(
    operatorToken: Token | null,
    left: Expression,
    right: Expression,
  ): BinaryExpression {
    return {
      kind: "BinaryExpression",
      span: this.spanFrom(left.span, right.span),
      operator: (operatorToken?.operator ?? operatorToken?.lexeme) as Operator,
      left,
      right,
    };
  }

  private expectSemicolon() {
    if (!this.matchPunctuator(";")) {
      this.report("Expected ';'.", this.currentSpan(), "E1020");
    }
  }

  private expectKind(kind: Token["kind"]): Token {
    const token = this.advance();
    if (!token || token.kind !== kind) {
      this.report(
        `Expected ${kind} token.`,
        token?.span ?? this.currentSpan(),
        "E1002",
      );
      return token ?? this.placeholderToken();
    }
    return token;
  }

  private expectKeyword(keyword: string): Token | null {
    const token = this.advance();
    if (!token || token.kind !== "Keyword" || token.lexeme !== keyword) {
      this.report(
        `Expected keyword '${keyword}'.`,
        token?.span ?? this.currentSpan(),
        "E1003",
      );
      return token ?? null;
    }
    return token;
  }

  private expectOperator(operator: Operator): Token | null {
    const token = this.advance();
    if (!token || token.kind !== "Operator" || token.operator !== operator) {
      this.report(
        `Expected operator '${operator}'.`,
        token?.span ?? this.currentSpan(),
        "E1004",
      );
      return token ?? null;
    }
    return token;
  }

  private expectPunctuator(punctuator: string): Token | null {
    const token = this.advance();
    if (!token || token.kind !== "Punctuator" || token.lexeme !== punctuator) {
      this.report(
        `Expected '${punctuator}'.`,
        token?.span ?? this.currentSpan(),
        "E1005",
      );
      return token ?? null;
    }
    return token;
  }

  private matchKeyword(keyword: string): Token | null {
    if (this.checkKeyword(keyword)) return this.advance();
    return null;
  }

  private matchOperator(operator: Operator): Token | null {
    if (this.checkOperator(operator)) return this.advance();
    return null;
  }

  private matchPunctuator(punctuator: string): Token | null {
    if (this.checkPunctuator(punctuator)) return this.advance();
    return null;
  }

  private checkKeyword(keyword: string) {
    const token = this.peek();
    return token?.kind === "Keyword" && token.lexeme === keyword;
  }

  private checkOperator(operator: Operator) {
    const token = this.peek();
    return token?.kind === "Operator" && token.operator === operator;
  }

  private checkPunctuator(punctuator: string) {
    const token = this.peek();
    return token?.kind === "Punctuator" && token.lexeme === punctuator;
  }

  private advance(): Token | null {
    if (this.current < this.tokens.length) {
      const token = this.tokens[this.current];
      this.current++;
      return token;
    }
    return null;
  }

  private peek(offset = 0): Token | null {
    return this.current + offset < this.tokens.length
      ? this.tokens[this.current + offset]
      : null;
  }

  private previous(): Token | null {
    return this.current > 0 ? this.tokens[this.current - 1] : null;
  }

  private previousSpan(): Span {
    return this.previous()?.span ?? this.emptySpan();
  }

  private currentSpan(): Span {
    return this.peek()?.span ?? this.previousSpan();
  }

  private isAtEnd(): boolean {
    return this.peek()?.kind === "EOF";
  }

  private report(message: string, span: Span, code?: string) {
    this.diagnostics.push({ severity: "error", message, span, code });
  }

  private spanFrom(start?: Span, end?: Span): Span {
    if (!start && !end) return this.emptySpan();
    if (start && end) return { start: start.start, end: end.end };
    if (start) return { start: start.start, end: start.end };
    return { start: end!.start, end: end!.end };
  }

  private spanFromNodes(nodes: Node[]): Span | null {
    if (nodes.length === 0) return null;
    return this.spanFrom(nodes[0].span, nodes[nodes.length - 1].span);
  }

  private emptySpan(): Span {
    return {
      start: { index: 0, line: 1, column: 1 },
      end: { index: 0, line: 1, column: 1 },
    };
  }

  private placeholderExpression(span: Span): Expression {
    return {
      kind: "IdentifierExpression",
      span,
      name: "<error>",
    };
  }

  private placeholderIdentifier(span?: Span): Identifier {
    const safeSpan = span ?? this.emptySpan();
    return { kind: "Identifier", span: safeSpan, name: "<error>" };
  }

  private placeholderType(span?: Span): TypeNode {
    const safeSpan = span ?? this.emptySpan();
    return {
      kind: "NamedType",
      span: safeSpan,
      name: { kind: "Identifier", span: safeSpan, name: "<error>" },
    } satisfies NamedType;
  }

  private placeholderPattern(span?: Span): Pattern {
    return { kind: "WildcardPattern", span: span ?? this.emptySpan() };
  }

  private placeholderToken(): Token {
    return {
      kind: "EOF",
      lexeme: "",
      span: this.emptySpan(),
    };
  }

  private checkArgumentNamed(): boolean {
    const current = this.peek();
    const next = this.peek(1);
    return (
      current?.kind === "Identifier" &&
      next?.kind === "Operator" &&
      next.operator === "="
    );
  }

  private checkIdentifierStart(): boolean {
    return this.peek()?.kind === "Identifier";
  }

  private withStructLiteral<T>(enabled: boolean, fn: () => T): T {
    const previous = this.structLiteralEnabled;
    this.structLiteralEnabled = enabled;
    try {
      return fn();
    } finally {
      this.structLiteralEnabled = previous;
    }
  }
}
