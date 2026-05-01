import type {
  ArrayLiteralExpression,
  AssignableExpression,
  AssociatedTypeDeclaration,
  AssociatedTypeDefinition,
  BindingPattern,
  BlockStatement,
  BuiltinDeclaration,
  BuiltinMember,
  BuiltinSatisfiesBlock,
  ContinueStatement,
  EnumDeclaration,
  EnumMember,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  FunctionType,
  FunctionTypeParameter,
  Identifier,
  IdentifierExpression,
  IfExpression,
  IfStatement,
  ImportDeclaration,
  LiteralExpression,
  MatchExpression,
  MatchExpressionArm,
  MatchStatement,
  MatchStatementArm,
  MethodDeclaration,
  NamedType,
  Node,
  Parameter,
  Pattern,
  Program,
  ReturnStatement,
  Statement,
  StringLiteralExpression,
  StructDeclaration,
  StructLiteralExpression,
  StructLiteralField,
  StructMember,
  TraitDeclaration,
  TraitMember,
  TraitMethodSignature,
  TraitSatisfiesDeclaration,
  TypeAliasDeclaration,
  TypeNode,
  TypeParameter,
  UnsafeBlockExpression,
  VariableDeclaration,
  WhereConstraint,
  WhileStatement,
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
  private diagnostics: Diagnostic[] = [];
  private current = 0;
  private structLiteralEnabled = true;

  constructor(private tokens: Token[]) {}

  public parseProgram(): ParseResult {
    const body: Statement[] = [];

    while (!this.isAtEnd()) {
      const before = this.current;
      const statement = this.parseStatement();
      if (statement) body.push(statement);
      if (this.current === before) {
        this.report("Parser made no progress.", this.currentSpan(), "E1099");
        this.advance();
      }
    }

    return {
      program: {
        kind: "Program",
        span: this.spanFromNodes(body) ?? this.emptySpan(),
        body,
      },
      diagnostics: this.diagnostics,
    };
  }

  private parseStatement(): Statement | null {
    if (this.checkKeyword("import")) return this.parseImport();
    if (this.checkKeyword("builtin")) return this.parseBuiltinDeclaration();

    let isPublic = false;
    if (this.matchKeyword("pub")) isPublic = true;

    const declaration =
      this.parseFunctionDeclaration(isPublic) ??
      this.parseVariableDeclaration(isPublic) ??
      this.parseTypeAlias(isPublic) ??
      this.parseStructDeclaration(isPublic) ??
      this.parseTraitDeclaration(isPublic) ??
      this.parseEnumDeclaration(isPublic);

    if (declaration) return declaration;

    return this.parseNonDeclarationStatement();
  }

  private parseBuiltinDeclaration(): BuiltinDeclaration {
    const start = this.expectKeyword("builtin");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const members: BuiltinMember[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      if (this.checkKeyword("satisfies")) {
        members.push(this.parseBuiltinSatisfiesBlock());
      } else if (this.checkKeyword("fn")) {
        members.push(this.parseTraitMethodSignature());
      } else {
        this.report(
          "Expected 'fn' or 'satisfies' inside builtin declaration.",
          this.currentSpan(),
          "E1041",
        );
        this.advance();
      }
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "BuiltinDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams: typeParams ?? undefined,
      members,
    };
  }

  private parseBuiltinSatisfiesBlock(): BuiltinSatisfiesBlock {
    const start = this.expectKeyword("satisfies");
    const trait =
      this.parseNamedType() ?? this.placeholderNamedType(start?.span);
    const whereClause = this.parseWhereClause();
    this.expectPunctuator("{");

    const methods: TraitMethodSignature[] = [];
    const associatedTypes: AssociatedTypeDefinition[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      if (this.checkKeyword("fn")) {
        methods.push(this.parseTraitMethodSignature());
      } else if (this.checkKeyword("type")) {
        associatedTypes.push(this.parseAssociatedTypeDefinition());
      } else {
        this.report(
          "Expected 'fn' or 'type' inside builtin satisfies block.",
          this.currentSpan(),
          "E1042",
        );
        this.advance();
      }
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "BuiltinSatisfiesBlock",
      span: this.spanFrom(start?.span, end?.span ?? trait.span),
      trait,
      whereClause,
      associatedTypes,
      methods,
    };
  }

  private parseImport(): ImportDeclaration {
    const start = this.expectKeyword("import");

    if (this.checkKind("String")) {
      const source = this.stringLiteralFromToken(this.expectKind("String"));
      this.expectKeyword("as");
      const namespace =
        this.parseIdentifier() ?? this.placeholderIdentifier(source.span);
      this.expectSemicolon();
      return {
        kind: "ImportDeclaration",
        span: this.spanFrom(start?.span, namespace.span),
        source,
        namespace,
      };
    }

    const names: Identifier[] = [];
    const first =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    names.push(first);
    while (this.matchPunctuator(",")) {
      const name =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());
      names.push(name);
    }
    this.expectKeyword("from");
    const source = this.stringLiteralFromToken(this.expectKind("String"));
    this.expectSemicolon();

    return {
      kind: "ImportDeclaration",
      span: this.spanFrom(start?.span, source.span),
      source,
      namedImports: names,
    };
  }

  private parseFunctionDeclaration(
    isPublic: boolean,
  ): FunctionDeclaration | null {
    const before = this.current;
    const isInline = !!this.matchKeyword("inline");
    const isUnsafe = !!this.matchKeyword("unsafe");
    const isExtern = !!this.matchKeyword("extern");
    const externName =
      isExtern && this.checkKind("String")
        ? this.stringLiteralFromToken(this.expectKind("String"))
        : undefined;
    if (!this.checkKeyword("fn")) {
      this.current = before;
      return null;
    }

    const start = this.expectKeyword("fn");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    const params = this.parseParameterList();
    const returnType = this.matchOperator("->") ? this.parseType() : undefined;
    const whereClause = this.parseWhereClause();

    if (isExtern && this.checkPunctuator(";")) {
      const semi = this.expectPunctuator(";");
      return {
        kind: "FunctionDeclaration",
        span: this.spanFrom(start?.span, semi?.span),
        name,
        typeParams,
        params,
        returnType: returnType ?? undefined,
        whereClause,
        externName,
        isInline,
        isUnsafe,
        isExtern,
        isPublic,
      };
    }

    const body = this.parseBlockStatement();

    return {
      kind: "FunctionDeclaration",
      span: this.spanFrom(start?.span, body.span),
      name,
      typeParams,
      params,
      returnType: returnType ?? undefined,
      whereClause,
      body,
      externName,
      isInline,
      isUnsafe,
      isExtern,
      isPublic,
    };
  }

  private parseVariableDeclaration(
    isPublic: boolean,
  ): VariableDeclaration | null {
    if (!this.checkKeyword("let") && !this.checkKeyword("const")) return null;
    const start = this.advance();
    const declarationKind = start?.lexeme === "const" ? "const" : "let";
    const name = this.parseBindingPattern();
    const typeAnnotation = this.matchPunctuator(":")
      ? this.parseType()
      : undefined;
    const initializer = this.matchOperator("=")
      ? this.parseExpression()
      : undefined;

    if (declarationKind === "const" && !initializer)
      this.report(
        "Const declarations require an initializer.",
        name.span,
        "E1011",
      );

    this.expectSemicolon();

    return {
      kind: "VariableDeclaration",
      span: this.spanFrom(start?.span, initializer?.span ?? name.span),
      declarationKind,
      name,
      typeAnnotation: typeAnnotation ?? undefined,
      initializer: initializer ?? undefined,
      isPublic,
    };
  }

  private parseTypeAlias(isPublic: boolean): TypeAliasDeclaration | null {
    if (!this.checkKeyword("type")) return null;
    const start = this.expectKeyword("type");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    this.expectOperator("=");
    const type = this.parseType() ?? this.placeholderType(this.currentSpan());
    this.expectSemicolon();
    return {
      kind: "TypeAliasDeclaration",
      span: this.spanFrom(start?.span, type.span),
      name,
      type,
      isPublic,
    };
  }

  private parseStructDeclaration(isPublic: boolean): StructDeclaration | null {
    if (!this.checkKeyword("struct")) return null;
    const start = this.expectKeyword("struct");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const members: StructMember[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const member = this.parseStructMember();
      if (member) members.push(member);
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "StructDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams,
      members,
      isPublic,
    };
  }

  private parseStructMember(): StructMember | null {
    const method = this.parseMethodDeclaration();
    if (method) return method;

    const satisfies = this.parseTraitSatisfiesDeclaration();
    if (satisfies) return satisfies;

    const fieldName =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    this.expectPunctuator(":");
    const type = this.parseType() ?? this.placeholderType(this.currentSpan());
    this.expectSemicolonOrSync();
    return {
      kind: "StructField",
      span: this.spanFrom(fieldName.span, type.span),
      name: fieldName,
      type,
    };
  }

  private parseEnumDeclaration(isPublic: boolean): EnumDeclaration | null {
    if (!this.checkKeyword("enum")) return null;
    const start = this.expectKeyword("enum");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const members: EnumMember[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const member = this.parseEnumMember();
      if (member) members.push(member);
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "EnumDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams,
      members,
      isPublic,
    };
  }

  private parseEnumMember(): EnumMember | null {
    const method = this.parseMethodDeclaration();
    if (method) return method;

    const satisfies = this.parseTraitSatisfiesDeclaration();
    if (satisfies) return satisfies;

    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
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
    this.expectSemicolonOrSync();
    return {
      kind: "EnumVariant",
      span: this.spanFrom(
        name.span,
        payload?.[payload.length - 1]?.span ?? name.span,
      ),
      name,
      payload,
    };
  }

  private parseTraitDeclaration(isPublic: boolean): TraitDeclaration | null {
    if (!this.checkKeyword("trait")) return null;
    const start = this.expectKeyword("trait");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("{");

    const members: TraitMember[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      if (this.checkKeyword("fn")) {
        members.push(this.parseTraitMethodSignature());
      } else if (this.checkKeyword("type")) {
        members.push(this.parseAssociatedTypeDeclaration());
      } else {
        this.report(
          "Expected 'fn' or 'type' inside trait declaration.",
          this.currentSpan(),
          "E1041",
        );
        this.advance();
      }
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "TraitDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? name.span),
      name,
      typeParams,
      members,
      isPublic,
    };
  }

  private parseAssociatedTypeDeclaration(): AssociatedTypeDeclaration {
    const start = this.expectKeyword("type");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const bound = this.matchPunctuator(":")
      ? (this.parseNamedType() ?? this.placeholderNamedType(name.span))
      : undefined;
    const end = this.expectPunctuator(";");
    return {
      kind: "AssociatedTypeDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? bound?.span ?? name.span),
      name,
      bound,
    };
  }

  private parseAssociatedTypeDefinition(): AssociatedTypeDefinition {
    const start = this.expectKeyword("type");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    this.expectOperator("=");
    const type = this.parseType() ?? this.placeholderType(this.currentSpan());
    const end = this.expectPunctuator(";");
    return {
      kind: "AssociatedTypeDefinition",
      span: this.spanFrom(start?.span, end?.span ?? type.span),
      name,
      type,
    };
  }

  private parseTraitMethodSignature(): TraitMethodSignature {
    const start = this.expectKeyword("fn");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    const params = this.parseParameterList();
    const returnType = this.matchOperator("->") ? this.parseType() : undefined;
    const whereClause = this.parseWhereClause();
    this.expectSemicolon();
    return {
      kind: "TraitMethodSignature",
      span: this.spanFrom(start?.span, returnType?.span ?? name.span),
      name,
      typeParams,
      params,
      returnType: returnType ?? undefined,
      whereClause,
    };
  }

  private parseMethodDeclaration(): MethodDeclaration | null {
    const before = this.current;
    const isInline = !!this.matchKeyword("inline");
    const isUnsafe = !!this.matchKeyword("unsafe");
    if (!this.checkKeyword("fn")) {
      this.current = before;
      return null;
    }

    const start = this.expectKeyword("fn");
    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    const typeParams = this.parseTypeParams();
    const params = this.parseParameterList();
    const returnType = this.matchOperator("->") ? this.parseType() : undefined;
    const whereClause = this.parseWhereClause();
    const body = this.parseBlockStatement();

    return {
      kind: "MethodDeclaration",
      span: this.spanFrom(start?.span, body.span),
      name,
      typeParams,
      params,
      returnType: returnType ?? undefined,
      whereClause,
      body,
      isInline,
      isUnsafe,
    };
  }

  private parseTraitSatisfiesDeclaration(): TraitSatisfiesDeclaration | null {
    if (!this.checkKeyword("satisfies")) return null;
    const start = this.expectKeyword("satisfies");
    const trait =
      this.parseNamedType() ?? this.placeholderNamedType(start?.span);
    this.expectPunctuator("{");

    const methods: MethodDeclaration[] = [];
    const associatedTypes: AssociatedTypeDefinition[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      if (this.checkKeyword("type")) {
        associatedTypes.push(this.parseAssociatedTypeDefinition());
        continue;
      }
      const method = this.parseMethodDeclaration();
      if (method) methods.push(method);
      else {
        this.report(
          "Expected 'fn' or 'type' inside satisfies block.",
          this.currentSpan(),
          "E1041",
        );
        this.advance();
      }
    }

    const end = this.expectPunctuator("}");
    return {
      kind: "TraitSatisfiesDeclaration",
      span: this.spanFrom(start?.span, end?.span ?? trait.span),
      trait,
      associatedTypes,
      methods,
    };
  }

  private parseNonDeclarationStatement(): Statement | null {
    if (this.checkKeyword("return")) return this.parseReturnStatement();
    if (this.checkKeyword("if")) return this.parseIfStatement();
    if (this.checkKeyword("while")) return this.parseWhileStatement();
    if (this.checkKeyword("for")) return this.parseForStatement();
    if (this.checkKeyword("match")) return this.parseMatchStatement();
    if (this.checkKeyword("break")) return this.parseBreakStatement();
    if (this.checkKeyword("continue")) return this.parseContinueStatement();
    if (this.checkPunctuator("{")) return this.parseBlockStatement();

    const expression = this.parseExpression();
    if (!expression) return null;

    const assignmentOperator = this.matchAssignmentOperator();
    if (assignmentOperator) {
      const value =
        this.parseExpression() ??
        this.placeholderExpression(this.currentSpan());
      this.expectSemicolon();
      return {
        kind: "AssignmentStatement",
        span: this.spanFrom(expression.span, value.span),
        operator: assignmentOperator,
        target: expression as AssignableExpression,
        value,
      };
    }

    const semicolon = this.matchPunctuator(";");
    if (
      !semicolon &&
      !this.checkPunctuator("}") &&
      expression.kind !== "UnsafeBlockExpression"
    ) {
      this.expectSemicolon();
    }
    return {
      kind: "ExpressionStatement",
      span: expression.span,
      expression,
      hasSemicolon: !!semicolon,
    };
  }

  private parseReturnStatement(): ReturnStatement {
    const start = this.expectKeyword("return");
    const value = this.checkPunctuator(";")
      ? undefined
      : this.parseExpression();
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
    const iterator = this.parseBindingPattern();
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
    const arms: MatchStatementArm[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const pattern = this.parsePattern();
      this.expectOperator("=>");
      const body = this.parseBlockStatement();
      arms.push({
        kind: "MatchStatementArm",
        span: this.spanFrom(pattern.span, body.span),
        pattern,
        body,
      });
      this.matchPunctuator(",");
    }
    const end = this.expectPunctuator("}");
    return {
      kind: "MatchStatement",
      span: this.spanFrom(start?.span, end?.span ?? expression.span),
      expression,
      arms,
    };
  }

  private parseBreakStatement(): Statement {
    const start = this.expectKeyword("break");
    this.expectSemicolon();
    return { kind: "BreakStatement", span: start?.span ?? this.currentSpan() };
  }

  private parseContinueStatement(): ContinueStatement {
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
    }
    const end = this.expectPunctuator("}");
    return {
      kind: "BlockStatement",
      span: this.spanFrom(start?.span, end?.span ?? start?.span),
      body,
    };
  }

  private parseExpression(): Expression | null {
    return this.parseCast();
  }

  private parseCast(): Expression | null {
    let expression = this.parseLogicalOr();
    if (!expression) return null;
    while (this.matchKeyword("as")) {
      const type = this.parseType() ?? this.placeholderType(this.currentSpan());
      expression = {
        kind: "CastExpression",
        span: this.spanFrom(expression.span, type.span),
        expression,
        type,
      };
    }
    return expression;
  }

  private parseLogicalOr(): Expression | null {
    return this.parseLeftAssociative(() => this.parseLogicalAnd(), ["||"]);
  }

  private parseLogicalAnd(): Expression | null {
    return this.parseLeftAssociative(() => this.parseBitwiseOr(), ["&&"]);
  }

  private parseBitwiseOr(): Expression | null {
    return this.parseLeftAssociative(() => this.parseBitwiseXor(), ["|"]);
  }

  private parseBitwiseXor(): Expression | null {
    return this.parseLeftAssociative(() => this.parseBitwiseAnd(), ["^"]);
  }

  private parseBitwiseAnd(): Expression | null {
    return this.parseLeftAssociative(() => this.parseEquality(), ["&"]);
  }

  private parseEquality(): Expression | null {
    return this.parseLeftAssociative(
      () => this.parseComparison(),
      ["==", "!="],
    );
  }

  private parseComparison(): Expression | null {
    return this.parseLeftAssociative(
      () => this.parseShift(),
      ["<", "<=", ">", ">="],
    );
  }

  private parseShift(): Expression | null {
    return this.parseLeftAssociative(() => this.parseTerm(), ["<<", ">>"]);
  }

  private parseTerm(): Expression | null {
    return this.parseLeftAssociative(() => this.parseFactor(), ["+", "-"]);
  }

  private parseFactor(): Expression | null {
    return this.parseLeftAssociative(() => this.parseUnary(), ["*", "/", "%"]);
  }

  private parseLeftAssociative(
    parser: () => Expression | null,
    operators: Operator[],
  ): Expression | null {
    let expression = parser();
    if (!expression) return null;
    while (operators.some((operator) => this.checkOperator(operator))) {
      const operatorToken = this.advance();
      const right = parser() ?? this.placeholderExpression(this.currentSpan());
      expression = {
        kind: "BinaryExpression",
        span: this.spanFrom(expression.span, right.span),
        operator: (operatorToken?.operator ??
          operatorToken?.lexeme) as Operator,
        left: expression,
        right,
      };
    }
    return expression;
  }

  private parseUnary(): Expression | null {
    if (
      this.matchOperator("!") ||
      this.matchOperator("-") ||
      this.matchOperator("*")
    ) {
      const operatorToken = this.previous();
      const argument =
        this.parseUnary() ?? this.placeholderExpression(this.currentSpan());
      return {
        kind: "UnaryExpression",
        span: this.spanFrom(operatorToken?.span, argument.span),
        operator: (operatorToken?.operator ??
          operatorToken?.lexeme) as Operator,
        argument,
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression | null {
    let expression = this.parsePrimary();
    if (!expression) return null;

    while (true) {
      if (
        this.structLiteralEnabled &&
        expression.kind === "IdentifierExpression"
      ) {
        if (this.checkPunctuator("{")) {
          expression = this.parseStructLiteral(expression);
          continue;
        }
      }

      if (this.checkOperator("<") && this.looksLikeCallTypeArgs()) {
        const typeArgs = this.parseCallTypeArgs();
        this.expectPunctuator("(");
        const args = this.parseExpressionList(")");
        const end = this.expectPunctuator(")");
        expression = {
          kind: "CallExpression",
          span: this.spanFrom(expression.span, end?.span ?? expression.span),
          callee: expression,
          typeArgs,
          args,
        };
        continue;
      }

      if (this.matchPunctuator("(")) {
        const args = this.parseExpressionList(")");
        const end = this.expectPunctuator(")");
        expression = {
          kind: "CallExpression",
          span: this.spanFrom(expression.span, end?.span ?? expression.span),
          callee: expression,
          args,
        };
        continue;
      }

      if (this.matchPunctuator("[")) {
        const index =
          this.parseExpression() ??
          this.placeholderExpression(this.currentSpan());
        const end = this.expectPunctuator("]");
        expression = {
          kind: "IndexExpression",
          span: this.spanFrom(expression.span, end?.span ?? index.span),
          object: expression,
          index,
        };
        continue;
      }

      if (this.matchPunctuator(".")) {
        if (this.checkKind("Number")) {
          const token = this.advance();
          expression = {
            kind: "TupleMemberExpression",
            span: this.spanFrom(
              expression.span,
              token?.span ?? expression.span,
            ),
            object: expression,
            index: Number.parseInt(token?.lexeme ?? "0", 10),
          };
          continue;
        }
        const property =
          this.parseIdentifier() ??
          this.placeholderIdentifier(this.currentSpan());
        expression = {
          kind: "MemberExpression",
          span: this.spanFrom(expression.span, property.span),
          object: expression,
          property,
        };
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimary(): Expression | null {
    if (this.checkKeyword("if")) return this.parseIfExpression();
    if (this.checkKeyword("match")) return this.parseMatchExpression();
    if (this.checkKeyword("unsafe")) return this.parseUnsafeBlockExpression();
    if (this.checkKeyword("fn")) return this.parseFunctionExpression();
    if (this.checkPunctuator("(")) return this.parseGroupingOrTuple();
    if (this.matchPunctuator("[")) return this.parseArrayLiteral();

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
      ) {
        return this.literalFromToken(token);
      }
      if (token.lexeme === "Self") {
        return {
          kind: "IdentifierExpression",
          span: token.span,
          name: "Self",
        };
      }
      this.report(`Unexpected keyword '${token.lexeme}'.`, token.span, "E1040");
      return this.placeholderExpression(token.span);
    }

    if (token.kind === "Identifier") {
      return {
        kind: "IdentifierExpression",
        span: token.span,
        name: token.lexeme,
      };
    }

    this.report(`Unexpected token '${token.lexeme}'.`, token.span, "E1041");
    return this.placeholderExpression(token.span);
  }

  private parseMatchExpression(): MatchExpression {
    const start = this.expectKeyword("match");
    const expression =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    this.expectPunctuator("{");
    const arms: MatchExpressionArm[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator("}")) {
      const pattern = this.parsePattern();
      this.expectOperator("=>");
      const armExpression = this.checkPunctuator("{")
        ? this.parseBlockStatement()
        : (this.parseExpression() ??
          this.placeholderExpression(this.currentSpan()));
      arms.push({
        kind: "MatchExpressionArm",
        span: this.spanFrom(pattern.span, armExpression.span),
        pattern,
        expression: armExpression,
      });
      this.matchPunctuator(",");
    }
    const end = this.expectPunctuator("}");
    return {
      kind: "MatchExpression",
      span: this.spanFrom(start?.span, end?.span ?? expression.span),
      expression,
      arms,
    };
  }

  private parseIfExpression(): IfExpression {
    const start = this.expectKeyword("if");
    const condition =
      this.withStructLiteral(false, () => this.parseExpression()) ??
      this.placeholderExpression(this.currentSpan());
    const thenBranch = this.parseBlockStatement();

    this.expectKeyword("else");
    const elseBranch = this.checkKeyword("if")
      ? this.parseIfExpression()
      : this.parseBlockStatement();

    return {
      kind: "IfExpression",
      span: this.spanFrom(start?.span, elseBranch.span),
      condition,
      thenBranch,
      elseBranch,
    };
  }

  private parseFunctionExpression(): FunctionExpression {
    const start = this.expectKeyword("fn");
    const params = this.parseParameterList();
    const returnType = this.matchOperator("->") ? this.parseType() : undefined;
    const body = this.parseBlockStatement();
    return {
      kind: "FunctionExpression",
      span: this.spanFrom(start?.span, body.span),
      params,
      returnType: returnType ?? undefined,
      body,
    };
  }

  private parseUnsafeBlockExpression(): UnsafeBlockExpression {
    const start = this.expectKeyword("unsafe");
    const body = this.parseBlockStatement();
    return {
      kind: "UnsafeBlockExpression",
      span: this.spanFrom(start?.span, body.span),
      body,
    };
  }

  private parseGroupingOrTuple(): Expression {
    const start = this.expectPunctuator("(");
    const elements: Expression[] = [];
    let sawComma = false;

    if (!this.checkPunctuator(")")) {
      const first =
        this.withStructLiteral(true, () => this.parseExpression()) ??
        this.placeholderExpression(this.currentSpan());
      elements.push(first);
      while (this.matchPunctuator(",")) {
        sawComma = true;
        if (this.checkPunctuator(")")) break;
        const next =
          this.withStructLiteral(true, () => this.parseExpression()) ??
          this.placeholderExpression(this.currentSpan());
        elements.push(next);
      }
    }

    const end = this.expectPunctuator(")");

    if (elements.length === 0 || sawComma) {
      return {
        kind: "TupleLiteralExpression",
        span: this.spanFrom(start?.span, end?.span ?? start?.span),
        elements,
      };
    }

    return {
      kind: "GroupingExpression",
      span: this.spanFrom(start?.span, end?.span ?? elements[0].span),
      expression: elements[0],
    };
  }

  private parseArrayLiteral(): ArrayLiteralExpression {
    const start = this.previousSpan();
    const elements = this.parseExpressionList("]");
    const end = this.expectPunctuator("]");
    return {
      kind: "ArrayLiteralExpression",
      span: this.spanFrom(start, end?.span ?? start),
      elements,
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
      } while (this.matchPunctuator(",") && !this.checkPunctuator("}"));
    }
    const end = this.expectPunctuator("}");
    return {
      kind: "StructLiteralExpression",
      span: this.spanFrom(start, end?.span ?? start),
      name,
      fields,
    };
  }

  private parsePattern(): Pattern {
    if (this.matchPunctuator("(")) {
      const start = this.previousSpan();
      const elements: Pattern[] = [];
      elements.push(...this.parsePatternList(")"));
      const end = this.expectPatternListClose(")");
      return {
        kind: "TuplePattern",
        span: this.spanFrom(start, end?.span ?? this.currentSpan()),
        elements,
      };
    }

    const token = this.advance();
    if (!token) return this.placeholderPattern(this.currentSpan());

    if (token.kind === "Identifier") {
      if (token.lexeme === "_") {
        return {
          kind: "WildcardPattern",
          span: token.span,
        };
      }

      const name = this.identifierFromToken(token);
      if (this.matchPunctuator("(")) {
        const args: Pattern[] = [];
        args.push(...this.parsePatternList(")"));
        const end = this.expectPatternListClose(")");
        return {
          kind: "EnumPattern",
          span: this.spanFrom(name.span, end?.span ?? name.span),
          name,
          args,
        };
      }

      return {
        kind: "IdentifierPattern",
        span: token.span,
        name,
      };
    }

    if (token.kind === "Number" || token.kind === "String") {
      const literal = this.literalFromToken(token);
      return {
        kind: "LiteralPattern",
        span: literal.span,
        literal,
      };
    }

    if (
      token.kind === "Keyword" &&
      (token.lexeme === "true" ||
        token.lexeme === "false" ||
        token.lexeme === "null" ||
        token.lexeme === "NaN" ||
        token.lexeme === "Infinity")
    ) {
      const literal = this.literalFromToken(token);
      return {
        kind: "LiteralPattern",
        span: literal.span,
        literal,
      };
    }

    this.report("Invalid match pattern.", token.span, "E1030");
    return this.placeholderPattern(token.span);
  }

  private parseBindingPattern(): BindingPattern {
    if (this.matchPunctuator("(")) {
      const start = this.previousSpan();
      const elements: BindingPattern[] = [];
      while (!this.isAtEnd() && !this.checkPunctuator(")")) {
        if (this.checkPunctuator(",")) {
          this.report("Invalid binding pattern.", this.currentSpan(), "E1031");
          this.advance();
          continue;
        }

        elements.push(this.parseBindingPattern());
        if (!this.matchPunctuator(",")) break;
        if (this.checkPunctuator(")")) break;
      }
      const end = this.matchPunctuator(")");
      if (!end) this.report("Expected ')'.", this.currentSpan(), "E1005");
      return {
        kind: "TupleBindingPattern",
        span: this.spanFrom(start, end?.span ?? this.currentSpan()),
        elements,
      };
    }

    const token = this.advance();
    if (!token) return this.placeholderIdentifier(this.currentSpan());
    if (token.kind === "Identifier") {
      if (token.lexeme === "_") {
        return {
          kind: "WildcardBindingPattern",
          span: token.span,
        };
      }
      return this.identifierFromToken(token);
    }

    this.report("Expected binding pattern.", token.span, "E1031");
    return this.placeholderIdentifier(token.span);
  }

  private parsePatternList(close: string): Pattern[] {
    const patterns: Pattern[] = [];
    while (!this.isAtEnd() && !this.checkPunctuator(close)) {
      if (this.checkPunctuator(",")) {
        this.report("Invalid match pattern.", this.currentSpan(), "E1030");
        this.advance();
        continue;
      }

      patterns.push(this.parsePattern());
      if (!this.matchPunctuator(",")) break;
      if (this.checkPunctuator(close)) break;
    }
    return patterns;
  }

  private expectPatternListClose(close: string): Token | null {
    const closeToken = this.matchPunctuator(close);
    if (closeToken) return closeToken;

    this.report(`Expected '${close}'.`, this.currentSpan(), "E1005");
    while (
      !this.isAtEnd() &&
      !this.checkPunctuator(close) &&
      !this.checkPunctuator(",") &&
      !this.checkPunctuator("{") &&
      !this.checkPunctuator("}") &&
      !this.checkOperator("=>")
    ) {
      this.advance();
    }
    return this.matchPunctuator(close);
  }

  private parseParameterList(): Parameter[] {
    this.expectPunctuator("(");
    const params: Parameter[] = [];
    if (!this.checkPunctuator(")")) {
      do {
        const parameter = this.parseParameter();
        if (parameter) params.push(parameter);
      } while (this.matchPunctuator(","));
    }
    this.expectPunctuator(")");
    return params;
  }

  private parseParameter(): Parameter | null {
    const mutToken = this.matchKeyword("mut");
    const maybeSelf = this.peek();
    const afterSelf = this.peek(1);
    if (
      maybeSelf?.kind === "Identifier" &&
      maybeSelf.lexeme === "self" &&
      afterSelf?.kind === "Punctuator" &&
      (afterSelf.lexeme === "," || afterSelf.lexeme === ")")
    ) {
      const token = this.advance();
      return {
        kind: "SelfParameter",
        span: this.spanFrom(mutToken?.span, token?.span),
        isMutable: !!mutToken,
      };
    }

    const name =
      this.parseIdentifier() ?? this.placeholderIdentifier(this.currentSpan());
    this.expectPunctuator(":");
    const type = this.parseType() ?? this.placeholderType(this.currentSpan());
    return {
      kind: "NamedParameter",
      span: this.spanFrom(mutToken?.span ?? name.span, type.span),
      name,
      type,
      isMutable: !!mutToken,
    };
  }

  private parseTypeParams(): TypeParameter[] | undefined {
    if (!this.matchOperator("<")) return undefined;
    const params: TypeParameter[] = [];
    if (!this.checkAngleClose()) {
      do {
        const name =
          this.parseIdentifier() ??
          this.placeholderIdentifier(this.currentSpan());
        let bounds: NamedType[] | undefined;
        if (this.matchPunctuator(":")) {
          const bound = this.parseNamedType();
          bounds = bound ? [bound] : [];
        }
        params.push({
          kind: "TypeParameter",
          span: this.spanFrom(name.span, bounds?.[bounds.length - 1]?.span),
          name,
          bounds,
        });
      } while (this.matchPunctuator(","));
    }
    this.expectAngleClose();
    return params;
  }

  private parseWhereClause(): WhereConstraint[] | undefined {
    if (!this.matchKeyword("where")) return undefined;
    const clauses: WhereConstraint[] = [];
    do {
      const typeName =
        this.parseIdentifier() ??
        this.placeholderIdentifier(this.currentSpan());
      this.expectPunctuator(":");
      const trait =
        this.parseNamedType() ?? this.placeholderNamedType(typeName.span);
      clauses.push({
        kind: "WhereConstraint",
        span: this.spanFrom(typeName.span, trait.span),
        typeName,
        trait,
      });
    } while (this.matchPunctuator(","));
    return clauses;
  }

  private parseType(): TypeNode | null {
    const primary = this.parsePrimaryType();
    if (!primary) return null;
    return this.parseTypePostfix(primary);
  }

  private parseTypePostfix(type: TypeNode): TypeNode {
    let current = type;
    while (true) {
      if (this.matchPunctuator("[")) {
        const end = this.expectPunctuator("]");
        current = {
          kind: "ArrayType",
          span: this.spanFrom(current.span, end?.span ?? current.span),
          element: current,
        };
        continue;
      }
      if (this.matchPunctuator("?")) {
        current = {
          kind: "NullableType",
          span: this.spanFrom(current.span, this.previousSpan()),
          base: current,
        };
        continue;
      }
      break;
    }
    return current;
  }

  private parsePrimaryType(): TypeNode | null {
    if (this.checkKeyword("fn")) return this.parseFunctionType();

    if (this.matchPunctuator("(")) {
      const elements: TypeNode[] = [];
      let sawComma = false;
      if (!this.checkPunctuator(")")) {
        const first =
          this.parseType() ?? this.placeholderType(this.currentSpan());
        elements.push(first);
        while (this.matchPunctuator(",")) {
          sawComma = true;
          if (this.checkPunctuator(")")) break;
          const next =
            this.parseType() ?? this.placeholderType(this.currentSpan());
          elements.push(next);
        }
      }
      const end = this.expectPunctuator(")");
      if (elements.length === 0 || sawComma) {
        return {
          kind: "TupleType",
          span: this.spanFrom(
            this.previousSpan(),
            end?.span ?? this.currentSpan(),
          ),
          elements,
        };
      }
      return elements[0];
    }

    if (this.matchKeyword("Self")) {
      return {
        kind: "SelfType",
        span: this.previousSpan(),
      };
    }

    if (this.checkKeyword("mut")) {
      const token = this.advance();
      this.report(
        "Mutable parameter syntax is 'mut name: Type'. 'name: mut Type' is invalid.",
        token?.span ?? this.currentSpan(),
        "E1050",
      );
      return this.placeholderType(token?.span ?? this.currentSpan());
    }

    return this.parseNamedType();
  }

  private static readonly typeKeywords = new Set([
    "void",
    "null",
    "never",
    "Self",
  ]);

  private parseNamedType(): NamedType | null {
    const token = this.advance();
    if (!token) return null;
    if (token.kind === "Keyword" && !Parser.typeKeywords.has(token.lexeme)) {
      this.report(
        `'${token.lexeme}' is a keyword and cannot be used as a type name.`,
        token.span,
        "E1051",
      );
      return this.placeholderNamedType(token.span);
    }
    if (token.kind !== "Identifier" && token.kind !== "Keyword") {
      this.report("Expected type.", token.span, "E1050");
      return this.placeholderNamedType(token.span);
    }

    const name = this.identifierFromToken(token);
    let typeArgs: TypeNode[] | undefined;
    if (this.matchOperator("<")) {
      typeArgs = [];
      if (!this.checkAngleClose()) {
        do {
          const type = this.parseType();
          if (type) typeArgs.push(type);
        } while (this.matchPunctuator(","));
      }
      this.expectAngleClose();
    }
    return {
      kind: "NamedType",
      span: this.spanFrom(
        name.span,
        typeArgs?.[typeArgs.length - 1]?.span ?? name.span,
      ),
      name,
      typeArgs,
    };
  }

  private parseFunctionType(): FunctionType {
    const start = this.expectKeyword("fn");
    const typeParams = this.parseTypeParams();
    this.expectPunctuator("(");
    const params: FunctionTypeParameter[] = [];
    if (!this.checkPunctuator(")")) {
      do {
        const mutToken = this.matchKeyword("mut");
        const type =
          this.parseType() ?? this.placeholderType(this.currentSpan());
        params.push({
          kind: "FunctionTypeParameter",
          span: this.spanFrom(mutToken?.span ?? type.span, type.span),
          type,
          isMutable: !!mutToken,
        });
      } while (this.matchPunctuator(","));
    }
    this.expectPunctuator(")");
    this.expectOperator("->");
    const returnType =
      this.parseType() ?? this.placeholderType(this.currentSpan());
    const whereClause = this.parseWhereClause();
    return {
      kind: "FunctionType",
      span: this.spanFrom(start?.span, returnType.span),
      typeParams,
      params,
      returnType,
      whereClause,
    };
  }

  private parseExpressionList(terminator: ")" | "]"): Expression[] {
    const expressions: Expression[] = [];
    if (!this.checkPunctuator(terminator)) {
      do {
        const expression = this.parseExpression();
        if (expression) expressions.push(expression);
      } while (this.matchPunctuator(","));
    }
    return expressions;
  }

  private parseCallTypeArgs(): TypeNode[] {
    const typeArgs: TypeNode[] = [];
    this.expectOperator("<");
    if (!this.checkAngleClose()) {
      do {
        const type = this.parseType();
        if (type) typeArgs.push(type);
      } while (this.matchPunctuator(","));
    }
    this.expectAngleClose();
    return typeArgs;
  }

  private literalFromToken(
    token: Token,
    forcedType?: LiteralType,
  ): LiteralExpression {
    let literalType: LiteralType = forcedType ?? "Integer";
    let value =
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
      }
    }

    if (token.kind === "Keyword") {
      if (token.lexeme === "true" || token.lexeme === "false")
        literalType = "Boolean";
      if (token.lexeme === "null") literalType = "Null";
      if (token.lexeme === "NaN" || token.lexeme === "Infinity")
        literalType = "Float";
    }

    if (token.kind === "String") literalType = "String";
    if (token.kind === "Number") value = token.lexeme.replaceAll("_", "");

    return {
      kind: "LiteralExpression",
      span: token.span,
      literalType,
      value,
    };
  }

  private stringLiteralFromToken(token: Token): StringLiteralExpression {
    const literal = this.literalFromToken(token, "String");
    return {
      ...literal,
      literalType: "String",
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
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
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
        if (j < inner.length && hex.length > 0) {
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          i = j;
          continue;
        }
      } else {
        out += next;
      }
      i++;
    }
    return out;
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

  private expectSemicolon() {
    if (!this.matchPunctuator(";"))
      this.report("Expected ';'.", this.currentSpan(), "E1020");
  }

  private expectSemicolonOrSync() {
    if (this.matchPunctuator(";")) return;
    this.report("Expected ';'.", this.currentSpan(), "E1020");
    while (
      !this.isAtEnd() &&
      !this.checkPunctuator(";") &&
      !this.checkPunctuator("}")
    ) {
      this.advance();
    }
    this.matchPunctuator(";");
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

  private checkAngleClose(): boolean {
    const token = this.peek();
    return (
      token?.kind === "Operator" &&
      (token.operator === ">" || token.operator === ">>")
    );
  }

  private expectAngleClose(): Token | null {
    const token = this.peek();
    if (token?.kind === "Operator" && token.operator === ">>") {
      this.current++;
      // Split >> into two >: splice a synthetic second > back into the stream
      const second: Token = {
        kind: "Operator",
        operator: ">",
        lexeme: ">",
        span: {
          start: {
            index: token.span.start.index + 1,
            line: token.span.start.line,
            column: token.span.start.column + 1,
          },
          end: token.span.end,
        },
      };
      this.tokens.splice(this.current, 0, second);
      return token;
    }
    return this.expectOperator(">");
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

  private matchAssignmentOperator(): Operator | null {
    const token = this.peek();
    if (token?.kind !== "Operator") return null;
    if (
      [
        "=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "<<=",
        ">>=",
        "&=",
        "^=",
        "|=",
      ].includes(token.operator ?? "")
    ) {
      this.advance();
      return token.operator ?? "=";
    }
    return null;
  }

  private matchPunctuator(punctuator: string): Token | null {
    if (this.checkPunctuator(punctuator)) return this.advance();
    return null;
  }

  private checkKind(kind: Token["kind"]) {
    return this.peek()?.kind === kind;
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

  private isAtEnd() {
    return this.peek()?.kind === "EOF";
  }

  private report(message: string, span: Span, code?: string) {
    this.diagnostics.push({ severity: "error", message, span, code });
  }

  private spanFrom(start?: Span | null, end?: Span | null): Span {
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
    return {
      kind: "Identifier",
      span: safeSpan,
      name: "<error>",
    };
  }

  private placeholderType(span?: Span): TypeNode {
    return this.placeholderNamedType(span);
  }

  private placeholderNamedType(span?: Span): NamedType {
    const safeSpan = span ?? this.emptySpan();
    return {
      kind: "NamedType",
      span: safeSpan,
      name: this.placeholderIdentifier(safeSpan),
    };
  }

  private placeholderPattern(span?: Span): Pattern {
    return {
      kind: "WildcardPattern",
      span: span ?? this.emptySpan(),
    };
  }

  private placeholderToken(): Token {
    return {
      kind: "EOF",
      lexeme: "",
      span: this.emptySpan(),
    };
  }

  private looksLikeCallTypeArgs(): boolean {
    if (!this.checkOperator("<")) return false;
    let depth = 0;
    let index = this.current;
    while (index < this.tokens.length) {
      const token = this.tokens[index];
      if (token.kind === "Operator" && token.operator === "<") {
        depth++;
      } else if (token.kind === "Operator" && token.operator === ">") {
        depth--;
        if (depth === 0) {
          return (
            this.tokens[index + 1]?.kind === "Punctuator" &&
            this.tokens[index + 1]?.lexeme === "("
          );
        }
      } else if (token.kind === "EOF") {
        return false;
      }
      index++;
    }
    return false;
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
