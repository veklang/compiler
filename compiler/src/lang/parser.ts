import type {
  Argument,
  ArrayLiteralExpression,
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  CastExpression,
  ClassDeclaration,
  ClassField,
  ClassMember,
  ClassMethod,
  EnumDeclaration,
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
      const statement = this.parseStatement();
      if (statement) body.push(statement);
      else this.advance();
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
    if (this.checkKeyword("alias")) return this.parseTypeAlias(isPublic);
    if (this.checkKeyword("struct"))
      return this.parseStructDeclaration(isPublic);
    if (this.checkKeyword("enum")) return this.parseEnumDeclaration(isPublic);
    if (this.checkKeyword("abstract"))
      return this.parseClassDeclaration(isPublic, true);
    if (this.checkKeyword("class"))
      return this.parseClassDeclaration(isPublic, false);
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
    } else {
      defaultImport =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());
    }

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
      this.parseIdentifier() ?? this.placeholderIdentifier(keywordToken?.span);
    let typeAnnotation: TypeNode | undefined;
    let initializer: Expression | undefined;

    if (this.matchPunctuator(":"))
      typeAnnotation = this.parseType() ?? undefined;
    if (this.matchOperator("="))
      initializer = this.parseExpression() ?? undefined;

    if (declarationKind === "const" && !initializer) {
      this.report(
        "Const declarations require an initializer.",
        name.span,
        "PAR011",
      );
    }

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
    const start = this.expectKeyword("alias");
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
      const variant: EnumVariant = {
        kind: "EnumVariant",
        span: this.spanFrom(variantName?.span, variantName?.span),
        name: variantName ?? this.placeholderIdentifier(this.currentSpan()),
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

  private parseClassDeclaration(
    isPublic: boolean,
    isAbstract: boolean,
  ): ClassDeclaration {
    const startSpan = isAbstract
      ? this.expectKeyword("abstract")?.span
      : this.currentSpan();
    this.expectKeyword("class");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();

    let extendsType: TypeNode | undefined;
    let implementsTypes: TypeNode[] | undefined;

    if (this.matchKeyword("extends")) {
      extendsType = this.parseType() ?? undefined;
    }

    if (this.matchKeyword("implements")) {
      implementsTypes = [];
      do {
        const type = this.parseType();
        if (type) implementsTypes.push(type);
      } while (this.matchPunctuator(","));
    }

    this.expectPunctuator("{");
    const members: ClassMember[] = [];

    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const member = this.parseClassMember();
      if (member) members.push(member);
      else this.advance();
    }

    const end = this.expectPunctuator("}");

    return {
      kind: "ClassDeclaration",
      span: this.spanFrom(startSpan, end?.span ?? name.span),
      name,
      typeParams,
      isAbstract,
      isPublic,
      extendsType,
      implementsTypes,
      members,
    };
  }

  private parseClassMember(): ClassMember | null {
    const modifiers = this.parseClassMemberModifiers();

    if (this.checkKeyword("fn")) {
      const start = this.expectKeyword("fn");
      const nameToken = this.advance();
      let name: Identifier;
      if (
        nameToken &&
        (nameToken.kind === "Identifier" || nameToken.kind === "Keyword")
      ) {
        name = this.identifierFromToken(nameToken);
      } else {
        if (nameToken)
          this.report("Expected method name.", nameToken.span, "PAR016");
        name = this.placeholderIdentifier(nameToken?.span);
      }
      const params = this.parseParameterList();
      const returnType = this.matchPunctuator(":")
        ? this.parseType()
        : undefined;
      let body: BlockStatement | null = null;
      if (modifiers.isAbstract) {
        this.expectSemicolon();
      } else {
        body = this.parseBlockStatement();
      }

      return {
        kind: "ClassMethod",
        span: this.spanFrom(
          start?.span,
          body?.span ?? returnType?.span ?? name.span,
        ),
        name,
        params,
        returnType: returnType ?? undefined,
        body,
        isPublic: modifiers.isPublic,
        isStatic: modifiers.isStatic,
        isGetter: modifiers.isGetter,
        isSetter: modifiers.isSetter,
        isAbstract: modifiers.isAbstract,
      } satisfies ClassMethod;
    }

    const fieldName = this.parseIdentifier();
    if (!fieldName) return null;
    this.expectPunctuator(":");
    const type = this.parseType() ?? this.placeholderType(fieldName.span);
    this.expectSemicolon();

    return {
      kind: "ClassField",
      span: this.spanFrom(fieldName.span, type.span),
      name: fieldName,
      type,
      isPublic: modifiers.isPublic,
      isStatic: modifiers.isStatic,
    } satisfies ClassField;
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
      this.report("Unexpected '=>' outside match arm.", token.span, "PAR042");
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
        "PAR030",
      );
      return this.placeholderPattern(token.span);
    }

    this.report("Invalid match pattern.", token.span, "PAR030");
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
    if (this.matchOperator("-") || this.matchOperator("+")) {
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
    if (this.checkPunctuator("(")) {
      return this.parseGroupingOrTuple();
    }

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
        token.lexeme === "null"
      ) {
        return this.literalFromToken(token);
      }
      this.report(
        `Unexpected keyword '${token.lexeme}'.`,
        token.span,
        "PAR040",
      );
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

    this.report(`Unexpected token '${token.lexeme}'.`, token.span, "PAR041");
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
        this.expectPunctuator(":");
        const value =
          this.parseExpression() ??
          this.placeholderExpression(this.currentSpan());
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
    if (!this.checkPunctuator(")")) {
      do {
        if (this.matchOperator("**")) {
          if (seenKwSpread) {
            this.report(
              "Multiple '**kwargs' arguments are not allowed.",
              this.previousSpan(),
              "PAR068",
            );
          }
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

        if (seenNamed) {
          this.report(
            "Positional arguments cannot follow named arguments.",
            this.currentSpan(),
            "PAR060",
          );
        }

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
        ) {
          this.report(
            "Multiple '*' separators or varargs are not allowed.",
            this.previousSpan(),
            "PAR063",
          );
        }
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

      if (context.seenVariadic) {
        this.report(
          "Multiple '*args' parameters are not allowed.",
          this.previousSpan(),
          "PAR064",
        );
      }

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
        ) {
          this.report(
            "Multiple '**' separators or kwargs are not allowed.",
            this.previousSpan(),
            "PAR065",
          );
        }
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

      if (context.seenKwVariadic) {
        this.report(
          "Multiple '**kwargs' parameters are not allowed.",
          this.previousSpan(),
          "PAR066",
        );
      }

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

    const name = this.parseIdentifier();
    if (!name) return null;

    if (context.seenKwVariadic) {
      this.report(
        "No parameters allowed after '**kwargs'.",
        name.span,
        "PAR067",
      );
    }

    this.expectPunctuator(":");
    const isMutable = this.matchKeyword("mut");
    const type = this.parseType() ?? this.placeholderType(name.span);
    let defaultValue: Expression | undefined;
    let hasDefault = false;

    if (this.matchOperator("=")) {
      if (isMutable) {
        this.report(
          "Default values are not allowed for mut parameters.",
          name.span,
          "PAR061",
        );
      }
      defaultValue =
        this.parseExpression() ??
        this.placeholderExpression(this.currentSpan());
      hasDefault = true;
    }

    if (!hasDefault && context.seenDefault) {
      this.report(
        "Required parameters cannot follow default parameters.",
        name.span,
        "PAR062",
      );
    }

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

    this.report("Expected type.", token.span, "PAR050");
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
    this.report("Expected identifier.", token.span, "PAR001");
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
    let value: string | number | boolean | null = token.value ?? token.lexeme;

    if (!forcedType && token.kind === "Number") {
      if (
        token.lexeme.includes(".") ||
        token.lexeme.includes("e") ||
        token.lexeme.includes("E")
      ) {
        literalType = "Float";
      } else {
        literalType = "Integer";
      }
    }

    if (token.kind === "Keyword") {
      if (token.lexeme === "true" || token.lexeme === "false") {
        literalType = "Boolean";
        value = token.lexeme === "true";
      }
      if (token.lexeme === "null") {
        literalType = "Null";
        value = null;
      }
      if (token.lexeme === "NaN") {
        literalType = "Float";
        value = Number.NaN;
      }
      if (token.lexeme === "Infinity") {
        literalType = "Float";
        value = Number.POSITIVE_INFINITY;
      }
    }

    if (token.kind === "String") {
      literalType = "String";
      value = token.value ?? "";
    }

    return {
      kind: "LiteralExpression",
      span: token.span,
      literalType,
      raw: token.lexeme,
      value,
    };
  }

  private stringLiteralFromToken(token: Token): StringLiteralExpression {
    const literal = this.literalFromToken(token, "String");
    return {
      ...literal,
      literalType: "String",
      value: String(literal.value ?? ""),
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

  private parseClassMemberModifiers() {
    let isPublic = false;
    let isStatic = false;
    let isGetter = false;
    let isSetter = false;
    let isAbstract = false;

    let progressed = true;
    while (progressed) {
      progressed = false;
      if (this.matchKeyword("pub")) {
        isPublic = true;
        progressed = true;
      } else if (this.matchKeyword("static")) {
        isStatic = true;
        progressed = true;
      } else if (this.matchKeyword("getter")) {
        isGetter = true;
        progressed = true;
      } else if (this.matchKeyword("setter")) {
        isSetter = true;
        progressed = true;
      } else if (this.matchKeyword("abstract")) {
        isAbstract = true;
        progressed = true;
      }
    }

    return { isPublic, isStatic, isGetter, isSetter, isAbstract };
  }

  private expectSemicolon() {
    if (!this.matchPunctuator(";")) {
      this.report("Expected ';'.", this.currentSpan(), "PAR020");
    }
  }

  private expectKind(kind: Token["kind"]): Token {
    const token = this.advance();
    if (!token || token.kind !== kind) {
      this.report(
        `Expected ${kind} token.`,
        token?.span ?? this.currentSpan(),
        "PAR002",
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
        "PAR003",
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
        "PAR004",
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
        "PAR005",
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
    return this.previous()?.span ?? this.currentSpan();
  }

  private currentSpan(): Span {
    return this.peek()?.span ?? this.emptySpan();
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
