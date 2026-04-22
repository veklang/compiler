import type {
  IrBlock,
  IrBlockId,
  IrConst,
  IrDeclaration,
  IrEnumDeclaration,
  IrEnumVariant,
  IrFunction,
  IrGlobal,
  IrGlobalId,
  IrLocal,
  IrLocalId,
  IrOperand,
  IrPrimitiveType,
  IrProgram,
  IrRuntimeRequirements,
  IrStructDeclaration,
  IrStructField,
  IrTempId,
  IrType,
  IrTypeDeclId,
} from "@/ir/types";
import { irPrimitive } from "@/ir/types";
import { mangleName } from "@/passes/mono";
import type {
  ArrayLiteralExpression,
  AssignmentStatement,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  CastExpression,
  ContinueStatement,
  EnumDeclaration,
  EnumVariant,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  GroupingExpression,
  IdentifierExpression,
  IfStatement,
  IndexExpression,
  LiteralExpression,
  MatchExpression,
  MatchExpressionArm,
  MatchStatement,
  MatchStatementArm,
  MemberExpression,
  MethodDeclaration,
  NamedParameter,
  Node,
  Parameter,
  Pattern,
  Program,
  ReturnStatement,
  Statement,
  StructDeclaration,
  StructField,
  StructLiteralExpression,
  TupleLiteralExpression,
  TupleMemberExpression,
  TypeNode,
  TypeParameter,
  UnaryExpression,
  VariableDeclaration,
  WhileStatement,
} from "@/types/ast";
import type { Operator } from "@/types/shared";

interface LowerOptions {
  sourcePath?: string;
}

interface IrTypeSource {
  types: WeakMap<Node, unknown>;
  instantiations?: GenericInstantiationInfo[];
  callInstantiations?: WeakMap<CallExpression, GenericInstantiationInfo>;
}

interface GenericInstantiationInfo {
  kind: "Function" | "Method" | "Struct" | "Enum";
  name: string;
  ownerName?: string;
  ownerTypeArgs?: string[];
  typeArgs: string[];
}

interface VariantInfo {
  enumName: string;
  declId: IrTypeDeclId;
  variantName: string;
  tag: number;
  payloadTypes: IrType[];
}

interface MethodDeclarationInfo {
  node: MethodDeclaration;
  ownerName: string;
  ownerDecl: "struct" | "enum";
}

interface LowerContext {
  checkResult: IrTypeSource;
  runtime: IrRuntimeRequirements;
  locals: Map<string, IrLocalId>;
  localTypes: Map<IrLocalId, IrType>;
  localDecls: IrLocal[];
  ownedLocals: Set<IrLocalId>;
  ownedTemps: Set<IrTempId>;
  blocks: IrBlock[];
  currentBlock: IrBlock;
  nextLocal: number;
  nextTemp: number;
  loopExit?: IrBlockId;
  loopContinue?: IrBlockId;
  loopCleanup?: LocalSnapshot;
  cleanupBlocks: Map<string, IrBlock>;
  returnValueLocalId?: IrLocalId;
  structFields: Map<string, IrStructField[]>;
  variantInfos: Map<string, VariantInfo>;
  enumNames: Set<string>;
  methodLinks: Map<string, string>;
  globals: Map<string, IrGlobalId>;
  globalTypes: Map<IrGlobalId, IrType>;
  lazyGlobals: Set<IrGlobalId>;
  returnType: IrType;
  typeSubstitutions?: Map<string, IrType>;
  selfTypeName?: string;
  session: LowerSession;
}

interface LowerSession {
  generatedFunctions: IrFunction[];
  nextAnonymousFunction: number;
}

interface LocalSnapshot {
  locals: Map<string, IrLocalId>;
  ownedLocals: Set<IrLocalId>;
}

type AssignablePlace =
  | {
      kind: "local";
      target: IrLocalId;
      type: IrType;
      span?: IrLocal["span"];
    }
  | {
      kind: "global";
      target: IrGlobalId;
      type: IrType;
      span?: IrLocal["span"];
    }
  | {
      kind: "field";
      target: IrLocalId;
      object: IrOperand;
      field: string;
      type: IrType;
      span?: IrLocal["span"];
    }
  | {
      kind: "index";
      array: IrOperand;
      index: IrOperand;
      type: IrType;
      span?: IrLocal["span"];
    };

export function lowerProgramToIr(
  program: Program,
  checkResult: IrTypeSource,
  options: LowerOptions = {},
): IrProgram {
  const runtime = emptyRuntimeRequirements();
  const declarations: IrDeclaration[] = [];
  const structFields = new Map<string, IrStructField[]>();
  const variantInfos = new Map<string, VariantInfo>();
  const methodLinks = new Map<string, string>();
  const session: LowerSession = {
    generatedFunctions: [],
    nextAnonymousFunction: 0,
  };
  const functionsByName = new Map<string, FunctionDeclaration>();
  const structsByName = new Map<string, StructDeclaration>();
  const enumsByName = new Map<string, EnumDeclaration>();
  const genericStructSpecializations: Array<{
    declaration: StructDeclaration;
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  }> = [];
  const genericEnumSpecializations: Array<{
    declaration: EnumDeclaration;
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  }> = [];
  const methodsByKey = new Map<string, MethodDeclarationInfo>();
  const enumNames = new Set(
    program.body
      .filter(
        (statement): statement is EnumDeclaration =>
          statement.kind === "EnumDeclaration",
      )
      .map((statement) => statement.name.name),
  );
  let entry: string | undefined;

  for (const statement of program.body) {
    if (statement.kind === "StructDeclaration") {
      structsByName.set(statement.name.name, statement);
      if ((statement.typeParams?.length ?? 0) > 0) continue;
      declarations.push(
        lowerStructDeclaration(statement, structFields, methodLinks, enumNames),
      );
    } else if (statement.kind === "EnumDeclaration") {
      enumsByName.set(statement.name.name, statement);
      if ((statement.typeParams?.length ?? 0) > 0) {
        recordEnumDeclarationInfo(
          statement,
          variantInfos,
          methodLinks,
          enumNames,
        );
        continue;
      }
      declarations.push(
        lowerEnumDeclaration(statement, variantInfos, methodLinks, enumNames),
      );
    }
  }

  const loweredSpecializations = new Set<string>();
  for (const instantiation of checkResult.instantiations ?? []) {
    if (instantiation.kind !== "Struct") continue;
    const declaration = structsByName.get(instantiation.name);
    if (!declaration || (declaration.typeParams?.length ?? 0) === 0) continue;
    const linkName = mangleName(instantiation.name, instantiation.typeArgs);
    if (loweredSpecializations.has(linkName)) continue;
    loweredSpecializations.add(linkName);
    const typeSubstitutions = typeSubstitutionsFromParams(
      declaration.typeParams,
      instantiation.typeArgs,
      enumNames,
    );
    genericStructSpecializations.push({
      declaration,
      linkName,
      typeSubstitutions,
    });
    declarations.push(
      lowerStructDeclaration(
        declaration,
        structFields,
        methodLinks,
        enumNames,
        {
          linkName,
          typeSubstitutions,
        },
      ),
    );
  }

  for (const instantiation of checkResult.instantiations ?? []) {
    if (instantiation.kind !== "Enum") continue;
    const declaration = enumsByName.get(instantiation.name);
    if (!declaration || (declaration.typeParams?.length ?? 0) === 0) continue;
    const linkName = mangleName(instantiation.name, instantiation.typeArgs);
    if (loweredSpecializations.has(linkName)) continue;
    loweredSpecializations.add(linkName);
    const typeSubstitutions = typeSubstitutionsFromParams(
      declaration.typeParams,
      instantiation.typeArgs,
      enumNames,
    );
    genericEnumSpecializations.push({
      declaration,
      linkName,
      typeSubstitutions,
    });
    declarations.push(
      lowerEnumDeclaration(declaration, variantInfos, methodLinks, enumNames, {
        linkName,
        typeSubstitutions,
      }),
    );
  }

  const globals = new Map<string, IrGlobalId>();
  const globalTypes = new Map<IrGlobalId, IrType>();
  const lazyGlobals = new Set<IrGlobalId>();
  const globalStatements: VariableDeclaration[] = [];
  for (const statement of program.body) {
    if (statement.kind === "VariableDeclaration") {
      const global = lowerGlobalDeclaration(
        statement,
        checkResult,
        runtime,
        enumNames,
      );
      declarations.push(global);
      globals.set(statement.name.name, global.id);
      globalTypes.set(global.id, global.type);
      if (global.initializerFunction) lazyGlobals.add(global.id);
      globalStatements.push(statement);
    }
  }

  for (const statement of program.body) {
    if (
      statement.kind !== "StructDeclaration" &&
      statement.kind !== "EnumDeclaration"
    )
      continue;
    for (const member of methodDeclarationsFromMembers(statement.members)) {
      methodsByKey.set(methodKey(statement.name.name, member.name.name), {
        node: member,
        ownerName: statement.name.name,
        ownerDecl: statement.kind === "EnumDeclaration" ? "enum" : "struct",
      });
      if (
        (statement.kind === "StructDeclaration" ||
          statement.kind === "EnumDeclaration") &&
        (statement.typeParams?.length ?? 0) > 0
      )
        continue;
      if ((member.typeParams?.length ?? 0) > 0) continue;
      declarations.push(
        lowerMethod(
          member,
          statement.name.name,
          statement.kind === "EnumDeclaration" ? "enum" : "struct",
          checkResult,
          runtime,
          structFields,
          variantInfos,
          methodLinks,
          globals,
          globalTypes,
          lazyGlobals,
          session,
        ),
      );
    }
  }

  for (const specialization of genericStructSpecializations) {
    for (const member of methodDeclarationsFromMembers(
      specialization.declaration.members,
    )) {
      if ((member.typeParams?.length ?? 0) > 0) continue;
      declarations.push(
        lowerMethod(
          member,
          specialization.linkName,
          "struct",
          checkResult,
          runtime,
          structFields,
          variantInfos,
          methodLinks,
          globals,
          globalTypes,
          lazyGlobals,
          session,
          {
            linkName: methodLinkName(specialization.linkName, member.name.name),
            typeSubstitutions: specialization.typeSubstitutions,
          },
        ),
      );
    }
  }

  for (const specialization of genericEnumSpecializations) {
    for (const member of methodDeclarationsFromMembers(
      specialization.declaration.members,
    )) {
      if ((member.typeParams?.length ?? 0) > 0) continue;
      declarations.push(
        lowerMethod(
          member,
          specialization.linkName,
          "enum",
          checkResult,
          runtime,
          structFields,
          variantInfos,
          methodLinks,
          globals,
          globalTypes,
          lazyGlobals,
          session,
          {
            linkName: methodLinkName(specialization.linkName, member.name.name),
            typeSubstitutions: specialization.typeSubstitutions,
          },
        ),
      );
    }
  }

  for (const statement of globalStatements) {
    if (
      !statement.initializer ||
      statement.initializer.kind === "LiteralExpression"
    )
      continue;
    declarations.push(
      lowerGlobalInitializerFunction(
        statement,
        checkResult,
        runtime,
        structFields,
        variantInfos,
        methodLinks,
        globals,
        globalTypes,
        lazyGlobals,
        session,
      ),
    );
  }

  for (const statement of program.body) {
    if (statement.kind !== "FunctionDeclaration") continue;
    functionsByName.set(statement.name.name, statement);
    if ((statement.typeParams?.length ?? 0) > 0) continue;
    const lowered = lowerFunction(
      statement,
      checkResult,
      runtime,
      structFields,
      variantInfos,
      methodLinks,
      globals,
      globalTypes,
      lazyGlobals,
      session,
    );
    declarations.push(lowered);
    if (statement.name.name === "main") entry = lowered.id;
  }

  for (const instantiation of checkResult.instantiations ?? []) {
    if (instantiation.kind !== "Function") continue;
    const declaration = functionsByName.get(instantiation.name);
    if (!declaration || (declaration.typeParams?.length ?? 0) === 0) continue;
    const linkName = mangleName(instantiation.name, instantiation.typeArgs);
    if (loweredSpecializations.has(linkName)) continue;
    loweredSpecializations.add(linkName);
    declarations.push(
      lowerFunction(
        declaration,
        checkResult,
        runtime,
        structFields,
        variantInfos,
        methodLinks,
        globals,
        globalTypes,
        lazyGlobals,
        session,
        {
          linkName,
          typeSubstitutions: typeSubstitutionsFromParams(
            declaration.typeParams,
            instantiation.typeArgs,
            new Set([...variantInfos.values()].map((v) => v.enumName)),
          ),
        },
      ),
    );
  }

  for (const instantiation of checkResult.instantiations ?? []) {
    if (instantiation.kind !== "Method" || !instantiation.ownerName) continue;
    const methodInfo = methodsByKey.get(
      methodKey(instantiation.ownerName, instantiation.name),
    );
    if (!methodInfo || (methodInfo.node.typeParams?.length ?? 0) === 0)
      continue;
    const ownerLinkName = instantiation.ownerTypeArgs?.length
      ? mangleName(instantiation.ownerName, instantiation.ownerTypeArgs)
      : methodInfo.ownerName;
    const linkName = methodInstantiationLinkName(instantiation);
    if (loweredSpecializations.has(linkName)) continue;
    loweredSpecializations.add(linkName);
    const ownerTypeSubstitutions = instantiation.ownerTypeArgs?.length
      ? ownerTypeSubstitutionsForMethod(
          methodInfo.ownerDecl === "struct"
            ? structsByName.get(instantiation.ownerName)
            : enumsByName.get(instantiation.ownerName),
          instantiation.ownerTypeArgs,
          enumNames,
        )
      : new Map<string, IrType>();
    const methodTypeSubstitutions = typeSubstitutionsFromParams(
      methodInfo.node.typeParams,
      instantiation.typeArgs,
      enumNames,
    );
    declarations.push(
      lowerMethod(
        methodInfo.node,
        ownerLinkName,
        methodInfo.ownerDecl,
        checkResult,
        runtime,
        structFields,
        variantInfos,
        methodLinks,
        globals,
        globalTypes,
        lazyGlobals,
        session,
        {
          linkName,
          typeSubstitutions: mergeTypeSubstitutions(
            ownerTypeSubstitutions,
            methodTypeSubstitutions,
          ),
        },
      ),
    );
  }

  declarations.push(...session.generatedFunctions);

  return {
    version: 1,
    sourceFiles: [{ id: "source.0", path: options.sourcePath }],
    declarations,
    entry,
    runtime,
  };
}

function lowerStructDeclaration(
  node: StructDeclaration,
  structFields: Map<string, IrStructField[]>,
  methodLinks: Map<string, string>,
  enumNames: Set<string>,
  specialization?: {
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  },
): IrStructDeclaration {
  const fields: IrStructField[] = node.members
    .filter((m): m is StructField => m.kind === "StructField")
    .map((field, index) => ({
      name: field.name.name,
      type: typeFromTypeNodeWithSubstitutions(
        field.type,
        enumNames,
        specialization?.typeSubstitutions,
      ),
      index,
    }));
  const linkName = specialization?.linkName ?? node.name.name;
  const id: IrTypeDeclId = `struct.${linkName}`;
  structFields.set(linkName, fields);
  recordMethodLinks(linkName, node.members, methodLinks);
  return {
    kind: "struct_decl",
    id,
    sourceName: node.name.name,
    linkName,
    fields,
    span: node.span,
  };
}

function lowerEnumDeclaration(
  node: EnumDeclaration,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  enumNames?: Set<string>,
  specialization?: {
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  },
): IrEnumDeclaration {
  const linkName = specialization?.linkName ?? node.name.name;
  const id: IrTypeDeclId = `enum.${linkName}`;
  const declId = id;
  recordMethodLinks(linkName, node.members, methodLinks);
  const variants: IrEnumVariant[] = node.members
    .filter((m): m is EnumVariant => m.kind === "EnumVariant")
    .map((variant, tag) => {
      const payloadTypes = (variant.payload ?? []).map((n) =>
        typeFromTypeNodeWithSubstitutions(
          n,
          enumNames,
          specialization?.typeSubstitutions,
        ),
      );
      const info: VariantInfo = {
        enumName: linkName,
        declId,
        variantName: variant.name.name,
        tag,
        payloadTypes,
      };
      variantInfos.set(variantInfoKey(linkName, variant.name.name), info);
      if (!specialization) variantInfos.set(variant.name.name, info);
      return { name: variant.name.name, tag, payloadTypes };
    });
  return {
    kind: "enum_decl",
    id,
    sourceName: node.name.name,
    linkName,
    variants,
    span: node.span,
  };
}

function recordEnumDeclarationInfo(
  node: EnumDeclaration,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  enumNames?: Set<string>,
) {
  recordMethodLinks(node.name.name, node.members, methodLinks);
  for (const [tag, variant] of node.members
    .filter((m): m is EnumVariant => m.kind === "EnumVariant")
    .entries()) {
    const payloadTypes = (variant.payload ?? []).map((n) =>
      typeFromTypeNode(n, enumNames),
    );
    const info: VariantInfo = {
      enumName: node.name.name,
      declId: `enum.${node.name.name}`,
      variantName: variant.name.name,
      tag,
      payloadTypes,
    };
    variantInfos.set(variantInfoKey(node.name.name, variant.name.name), info);
    variantInfos.set(variant.name.name, info);
  }
}

function recordMethodLinks(
  ownerName: string,
  members: Array<
    StructDeclaration["members"][number] | EnumDeclaration["members"][number]
  >,
  methodLinks: Map<string, string>,
) {
  for (const member of methodDeclarationsFromMembers(members)) {
    methodLinks.set(
      methodKey(ownerName, member.name.name),
      methodLinkName(ownerName, member.name.name),
    );
  }
}

function methodDeclarationsFromMembers(
  members: Array<
    StructDeclaration["members"][number] | EnumDeclaration["members"][number]
  >,
): MethodDeclaration[] {
  const methods: MethodDeclaration[] = [];
  for (const member of members) {
    if (member.kind === "MethodDeclaration") {
      methods.push(member);
    } else if (member.kind === "TraitSatisfiesDeclaration") {
      methods.push(...member.methods);
    }
  }
  return methods;
}

function lowerGlobalDeclaration(
  node: VariableDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  enumNames: Set<string>,
): IrGlobal {
  const type = node.typeAnnotation
    ? typeFromTypeNode(node.typeAnnotation, enumNames)
    : normalizeSpecializedNamedTypes(
        typeFromNode(checkResult, node.initializer),
      );
  const initializer =
    node.initializer?.kind === "LiteralExpression"
      ? constFromLiteral(node.initializer)
      : undefined;
  if (initializer?.kind === "string") runtime.strings = true;
  const id: IrGlobalId = `global.${node.name.name}`;
  const initializerFunction =
    node.initializer && !initializer
      ? `fn.__vek_init_global_${node.name.name}`
      : undefined;
  return {
    kind: "global",
    id,
    sourceName: node.name.name,
    linkName: node.name.name,
    type,
    mutable: node.declarationKind === "let",
    initializer,
    initializerFunction,
    span: node.span,
  };
}

function lowerGlobalInitializerFunction(
  node: VariableDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
): IrFunction {
  if (!node.initializer) {
    throw new Error("IR lowering: missing global initializer.");
  }

  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const globalId: IrGlobalId = `global.${node.name.name}`;
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    ownedLocals: new Set(),
    ownedTemps: new Set(),
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    enumNames: new Set([...variantInfos.values()].map((v) => v.enumName)),
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType: irPrimitive("void"),
    cleanupBlocks: new Map(),
    session,
  };

  const value = coerceOperand(
    lowerExpression(node.initializer, context),
    globalTypes.get(globalId) ??
      normalizeSpecializedNamedTypes(
        typeFromNode(checkResult, node.initializer),
      ),
    context,
    node.span,
  );
  retainIfBorrowedHeap(value, context, node.span);
  context.currentBlock.instructions.push({
    kind: "store_global",
    globalId,
    value,
    span: node.span,
  });
  if (value.kind === "temp") context.ownedTemps.delete(value.id);
  releaseOwnedLocals(context, node.span);
  context.currentBlock.terminator = {
    kind: "return",
    value: voidOperand(),
    span: node.span,
  };

  return {
    kind: "function",
    id: `fn.__vek_init_global_${node.name.name}`,
    sourceName: `__vek_init_global_${node.name.name}`,
    linkName: `__vek_init_global_${node.name.name}`,
    signature: { params: [], returnType: irPrimitive("void") },
    params: [],
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: node.span,
  };
}

function lowerMethod(
  node: MethodDeclaration,
  ownerName: string,
  ownerDecl: "struct" | "enum",
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
  specialization?: {
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  },
): IrFunction {
  const enumNames = new Set([...variantInfos.values()].map((v) => v.enumName));
  const ownerType: IrType = {
    kind: "named",
    name: ownerName,
    args: [],
    ...(ownerDecl === "enum" ? { decl: "enum" as const } : {}),
  };
  const returnType = node.returnType
    ? typeFromTypeNodeWithSelfAndSubstitutions(
        node.returnType,
        ownerName,
        enumNames,
        specialization?.typeSubstitutions,
      )
    : substituteTypeParams(
        checkedFunctionReturnType(checkResult, node),
        specialization?.typeSubstitutions,
      );
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    ownedLocals: new Set(),
    ownedTemps: new Set(),
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    enumNames,
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType,
    selfTypeName: ownerName,
    typeSubstitutions: specialization?.typeSubstitutions,
    cleanupBlocks: new Map(),
    session,
  };

  const params = node.params.map((param) =>
    lowerMethodParameter(param, ownerType, ownerName, context),
  );

  lowerBlock(node.body, context);
  if (!isTerminated(context)) {
    releaseOwnedLocals(context, node.body.span);
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: node.body.span,
    };
  }

  const linkName =
    specialization?.linkName ?? methodLinkName(ownerName, node.name.name);
  return {
    kind: "function",
    id: `fn.${linkName}`,
    sourceName: `${ownerName}.${node.name.name}`,
    linkName,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType,
    },
    params,
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: node.span,
  };
}

function lowerMethodParameter(
  param: Parameter,
  ownerType: IrType,
  ownerName: string,
  context: LowerContext,
) {
  if (param.kind === "SelfParameter") {
    const local = declareLocal(
      context,
      "self",
      ownerType,
      param.isMutable,
      param.span,
    );
    return {
      local: local.id,
      sourceName: "self",
      type: local.type,
      mutable: param.isMutable,
      span: param.span,
    };
  }

  const local = declareLocal(
    context,
    param.name.name,
    typeFromTypeNodeWithSelfAndSubstitutions(
      param.type,
      ownerName,
      context.enumNames,
      context.typeSubstitutions,
    ),
    param.isMutable,
    param.span,
  );
  return {
    local: local.id,
    sourceName: param.name.name,
    type: local.type,
    mutable: param.isMutable,
    span: param.span,
  };
}

function lowerFunction(
  node: FunctionDeclaration,
  checkResult: IrTypeSource,
  runtime: IrRuntimeRequirements,
  structFields: Map<string, IrStructField[]>,
  variantInfos: Map<string, VariantInfo>,
  methodLinks: Map<string, string>,
  globals: Map<string, IrGlobalId>,
  globalTypes: Map<IrGlobalId, IrType>,
  lazyGlobals: Set<IrGlobalId>,
  session: LowerSession,
  specialization?: {
    linkName: string;
    typeSubstitutions: Map<string, IrType>;
  },
): IrFunction {
  const enumNames = new Set([...variantInfos.values()].map((v) => v.enumName));
  const returnType = node.returnType
    ? typeFromTypeNodeWithSubstitutions(
        node.returnType,
        enumNames,
        specialization?.typeSubstitutions,
      )
    : substituteTypeParams(
        checkedFunctionReturnType(checkResult, node),
        specialization?.typeSubstitutions,
      );
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult,
    runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    ownedLocals: new Set(),
    ownedTemps: new Set(),
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields,
    variantInfos,
    enumNames,
    methodLinks,
    globals,
    globalTypes,
    lazyGlobals,
    returnType,
    typeSubstitutions: specialization?.typeSubstitutions,
    cleanupBlocks: new Map(),
    session,
  };

  const params = node.params
    .filter((param): param is NamedParameter => param.kind === "NamedParameter")
    .map((param) => {
      const local = declareLocal(
        context,
        param.name.name,
        typeFromTypeNodeInContext(param.type, context),
        param.isMutable,
        param.span,
      );
      return {
        local: local.id,
        sourceName: param.name.name,
        type: local.type,
        mutable: param.isMutable,
        span: param.span,
      };
    });

  if (node.body) lowerBlock(node.body, context);
  if (!isTerminated(context)) {
    releaseOwnedLocals(context, node.body?.span);
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: node.body?.span,
    };
  }

  return {
    kind: "function",
    id: `fn.${specialization?.linkName ?? node.name.name}`,
    sourceName: node.name.name,
    linkName: specialization?.linkName ?? node.name.name,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType,
    },
    params,
    locals: context.localDecls,
    blocks: node.isExtern ? [] : context.blocks,
    body: node.isExtern ? "extern" : "defined",
    span: node.span,
  };
}

function lowerBlock(block: BlockStatement, context: LowerContext) {
  for (const statement of block.body) {
    if (isTerminated(context)) return;
    lowerStatement(statement, context);
  }
}

function lowerStatement(statement: Statement, context: LowerContext) {
  switch (statement.kind) {
    case "VariableDeclaration":
      lowerVariableDeclaration(statement, context);
      return;
    case "ReturnStatement":
      lowerReturn(statement, context);
      return;
    case "ExpressionStatement":
      releaseIfOwnedTemp(
        lowerExpression(statement.expression, context),
        context,
      );
      return;
    case "AssignmentStatement":
      lowerAssignment(statement, context);
      return;
    case "BlockStatement":
      lowerBlock(statement, context);
      return;
    case "IfStatement":
      lowerIfStatement(statement, context);
      return;
    case "WhileStatement":
      lowerWhileStatement(statement, context);
      return;
    case "BreakStatement":
      lowerBreak(statement, context);
      return;
    case "ContinueStatement":
      lowerContinue(statement, context);
      return;
    case "ForStatement":
      lowerForStatement(statement, context);
      return;
    case "MatchStatement":
      lowerMatchStatement(statement, context);
      return;
    default:
      throw new Error(`IR lowering does not support ${statement.kind} yet.`);
  }
}

function lowerVariableDeclaration(
  statement: VariableDeclaration,
  context: LowerContext,
) {
  const type = statement.typeAnnotation
    ? typeFromTypeNodeInContext(statement.typeAnnotation, context)
    : typeFromNodeInContext(context, statement.initializer);
  const local = declareLocal(
    context,
    statement.name.name,
    type,
    statement.declarationKind === "let",
    statement.span,
  );

  if (statement.initializer) {
    const value = coerceOperand(
      lowerExpression(statement.initializer, context),
      local.type,
      context,
      statement.span,
    );
    retainIfBorrowedHeap(value, context, statement.span);
    context.currentBlock.instructions.push({
      kind: "assign",
      target: local.id,
      value,
      span: statement.span,
    });
    markLocalOwns(local.id, value, context);
  }
}

function lowerReturn(statement: ReturnStatement, context: LowerContext) {
  const value = statement.value
    ? coerceOperand(
        lowerExpression(statement.value, context),
        context.returnType,
        context,
        statement.span,
      )
    : voidOperand();
  retainIfBorrowedHeap(value, context, statement.span);

  if (context.ownedLocals.size === 0) {
    if (value.kind === "temp") context.ownedTemps.delete(value.id);
    context.currentBlock.terminator = {
      kind: "return",
      value,
      span: statement.span,
    };
    return;
  }

  if (statement.value) {
    if (!context.returnValueLocalId) {
      const local = declareLocal(
        context,
        "__return",
        context.returnType,
        true,
        statement.span,
      );
      context.returnValueLocalId = local.id;
    }
    if (value.kind === "temp") context.ownedTemps.delete(value.id);
    context.currentBlock.instructions.push({
      kind: "assign",
      target: context.returnValueLocalId,
      value,
      span: statement.span,
    });
  }

  const cleanupBlock = getOrCreateCleanupBlock(
    context,
    context.ownedLocals,
    statement.span,
  );
  context.ownedLocals.clear();
  context.currentBlock.terminator = {
    kind: "branch",
    target: cleanupBlock.id,
    span: statement.span,
  };
}

function lowerAssignment(
  statement: AssignmentStatement,
  context: LowerContext,
) {
  const place = resolveAssignablePlace(statement.target, context);

  if (statement.operator !== "=") {
    lowerCompoundAssignment(statement, place, context);
    return;
  }

  const value = coerceOperand(
    lowerExpression(statement.value, context),
    place.type,
    context,
    statement.span,
  );
  writeAssignablePlace(place, value, context, statement.span);
}

function lowerCompoundAssignment(
  statement: AssignmentStatement,
  place: AssignablePlace,
  context: LowerContext,
) {
  const operator = compoundAssignmentOperator(statement.operator);
  if (!operator) throw new Error("IR lowering: invalid compound assignment.");
  const oldValue = readAssignablePlace(place, context, true);
  const value = lowerCompoundOperation(
    operator,
    oldValue,
    lowerExpression(statement.value, context),
    place.type,
    context,
    statement.span,
  );
  writeAssignablePlace(place, value, context, statement.span, {
    releaseOld: place.kind !== "field",
  });
}

function resolveAssignablePlace(
  target: Expression,
  context: LowerContext,
): AssignablePlace {
  if (target.kind === "IdentifierExpression") {
    const localId = context.locals.get(target.name);
    if (localId) {
      return {
        kind: "local",
        target: localId,
        type:
          context.localTypes.get(localId) ??
          typeFromNodeInContext(context, target),
        span: target.span,
      };
    }

    const globalId = context.globals.get(target.name);
    if (globalId) {
      return {
        kind: "global",
        target: globalId,
        type:
          context.globalTypes.get(globalId) ??
          typeFromNodeInContext(context, target),
        span: target.span,
      };
    }

    throw new Error(`Unknown local '${target.name}' during IR lowering.`);
  }

  if (target.kind === "MemberExpression") {
    const localId = resolveLocalFromMember(target, context);
    const objectType = context.localTypes.get(localId) ?? { kind: "unknown" };
    const checkedType = typeFromNodeInContext(context, target);
    const fieldType =
      checkedType.kind !== "unknown"
        ? checkedType
        : objectType.kind === "named"
          ? (context.structFields
              .get(objectType.name)
              ?.find((field) => field.name === target.property.name)?.type ??
            checkedType)
          : checkedType;
    return {
      kind: "field",
      target: localId,
      object: { kind: "local", id: localId, type: objectType },
      field: target.property.name,
      type: fieldType,
      span: target.span,
    };
  }

  if (target.kind === "IndexExpression") {
    const array = detachArrayForIndexedMutation(
      target.object,
      context,
      target.span,
    );
    const checkedType = typeFromNodeInContext(context, target);
    const elementType =
      checkedType.kind !== "unknown"
        ? checkedType
        : array.type.kind === "named" &&
            array.type.name === "Array" &&
            array.type.args.length > 0
          ? array.type.args[0]
          : checkedType;
    return {
      kind: "index",
      array,
      index: lowerExpression(target.index, context),
      type: elementType,
      span: target.span,
    };
  }

  throw new Error("IR lowering only supports assignable targets.");
}

function readAssignablePlace(
  place: AssignablePlace,
  context: LowerContext,
  releaseBorrowedFieldOnUse = false,
): IrOperand {
  if (place.kind === "local") {
    return { kind: "local", id: place.target, type: place.type };
  }

  if (place.kind === "global") {
    if (context.lazyGlobals.has(place.target)) {
      context.currentBlock.instructions.push({
        kind: "ensure_global_initialized",
        globalId: place.target,
        span: place.span,
      });
    }
    return { kind: "global", id: place.target, type: place.type };
  }

  const target = nextTemp(context);
  if (place.kind === "field") {
    context.currentBlock.instructions.push({
      kind: "get_field",
      target,
      object: place.object,
      field: place.field,
      type: place.type,
      span: place.span,
    });
    if (releaseBorrowedFieldOnUse) markOwnedTemp(target, place.type, context);
    return { kind: "temp", id: target, type: place.type };
  }

  context.currentBlock.instructions.push({
    kind: "array_get",
    target,
    array: place.array,
    index: place.index,
    elementType: place.type,
    type: place.type,
    span: place.span,
  });
  const value = { kind: "temp" as const, id: target, type: place.type };
  retainIfBorrowedHeap(value, context, place.span);
  markOwnedTemp(target, place.type, context);
  return value;
}

function writeAssignablePlace(
  place: AssignablePlace,
  value: IrOperand,
  context: LowerContext,
  span?: IrLocal["span"],
  options: { releaseOld?: boolean } = {},
) {
  const releaseOld = options.releaseOld ?? true;

  if (place.kind === "local") {
    if (!(value.kind === "local" && value.id === place.target)) {
      releaseLocalIfOwned(place.target, context, span);
      retainIfBorrowedHeap(value, context, span);
    }
    context.currentBlock.instructions.push({
      kind: "assign",
      target: place.target,
      value,
      span,
    });
    markLocalOwns(place.target, value, context);
    return;
  }

  if (place.kind === "global") {
    if (!(value.kind === "global" && value.id === place.target)) {
      releaseGlobalIfHeap(place.target, context, span);
      retainIfBorrowedHeap(value, context, span);
    }
    context.currentBlock.instructions.push({
      kind: "store_global",
      globalId: place.target,
      value,
      span,
    });
    if (value.kind === "temp") context.ownedTemps.delete(value.id);
    return;
  }

  if (place.kind === "field") {
    retainIfBorrowedHeap(value, context, span);
    if (releaseOld) releaseFieldIfHeap(place, context, span);
    context.currentBlock.instructions.push({
      kind: "set_field",
      target: place.target,
      field: place.field,
      value,
      span,
    });
    if (value.kind === "temp") context.ownedTemps.delete(value.id);
    return;
  }

  context.currentBlock.instructions.push({
    kind: "array_set",
    array: place.array,
    index: place.index,
    value,
    elementType: place.type,
    span,
  });
  releaseIfOwnedTemp(place.array, context);
  releaseIfOwnedTemp(value, context);
}

function releaseFieldIfHeap(
  place: Extract<AssignablePlace, { kind: "field" }>,
  context: LowerContext,
  span?: IrLocal["span"],
) {
  if (!hasOwnedStorage(place.type, context)) return;
  const oldTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "get_field",
    target: oldTarget,
    object: place.object,
    field: place.field,
    type: place.type,
    span,
  });
  context.currentBlock.instructions.push({
    kind: "release",
    value: { kind: "temp", id: oldTarget, type: place.type },
    span,
  });
  context.runtime.refCounting = true;
}

function lowerCompoundOperation(
  operator: Operator,
  left: IrOperand,
  right: IrOperand,
  type: IrType,
  context: LowerContext,
  span: IrLocal["span"],
): IrOperand {
  if (type.kind === "primitive" && type.name === "string" && operator === "+") {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "string_concat",
      target,
      left,
      right,
      type,
      span,
    });
    releaseIfOwnedTemp(left, context);
    releaseIfOwnedTemp(right, context);
    markOwnedTemp(target, type, context);
    context.runtime.strings = true;
    return { kind: "temp", id: target, type };
  }

  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target,
    operator,
    left,
    right,
    type,
    span,
  });
  releaseIfOwnedTemp(left, context);
  releaseIfOwnedTemp(right, context);
  return { kind: "temp", id: target, type };
}

function resolveLocalFromMember(
  expr: MemberExpression,
  context: LowerContext,
): IrLocalId {
  if (expr.object.kind !== "IdentifierExpression") {
    throw new Error(
      "IR lowering only supports single-level field assignment so far.",
    );
  }
  const localId = context.locals.get(expr.object.name);
  if (!localId) {
    throw new Error(`Unknown local '${expr.object.name}' during IR lowering.`);
  }
  return localId;
}

function lowerIfStatement(statement: IfStatement, context: LowerContext) {
  const condition = lowerExpression(statement.condition, context);

  const thenBlock = newBlock(context);
  const elseBlock = statement.elseBranch ? newBlock(context) : undefined;
  const joinBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition,
    thenTarget: thenBlock.id,
    elseTarget: elseBlock ? elseBlock.id : joinBlock.id,
    span: statement.span,
  };

  const savedLocals = saveLocals(context);

  switchBlock(context, thenBlock);
  lowerBlock(statement.thenBranch, context);
  restoreLocals(context, savedLocals);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = { kind: "branch", target: joinBlock.id };
  }

  if (statement.elseBranch && elseBlock) {
    switchBlock(context, elseBlock);
    const savedLocals2 = saveLocals(context);
    if (statement.elseBranch.kind === "BlockStatement") {
      lowerBlock(statement.elseBranch, context);
    } else {
      lowerIfStatement(statement.elseBranch, context);
    }
    restoreLocals(context, savedLocals2);
    if (!isTerminated(context)) {
      context.currentBlock.terminator = {
        kind: "branch",
        target: joinBlock.id,
      };
    }
  }

  switchBlock(context, joinBlock);
}

function lowerWhileStatement(statement: WhileStatement, context: LowerContext) {
  const condBlock = newBlock(context);
  const bodyBlock = newBlock(context);
  const exitBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
    span: statement.span,
  };

  switchBlock(context, condBlock);
  const condition = lowerExpression(statement.condition, context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition,
    thenTarget: bodyBlock.id,
    elseTarget: exitBlock.id,
    span: statement.span,
  };

  switchBlock(context, bodyBlock);
  const savedExit = context.loopExit;
  const savedContinue = context.loopContinue;
  const savedLoopCleanup = context.loopCleanup;
  context.loopExit = exitBlock.id;
  context.loopContinue = condBlock.id;
  const savedLocals = saveLocals(context);
  context.loopCleanup = savedLocals;
  lowerBlock(statement.body, context);
  restoreLocals(context, savedLocals);
  context.loopExit = savedExit;
  context.loopContinue = savedContinue;
  context.loopCleanup = savedLoopCleanup;
  if (!isTerminated(context)) {
    context.currentBlock.terminator = { kind: "branch", target: condBlock.id };
  }

  switchBlock(context, exitBlock);
}

function lowerBreak(statement: BreakStatement, context: LowerContext) {
  if (!context.loopExit) {
    throw new Error("IR lowering: break outside of loop.");
  }
  releaseLoopLocals(context, statement.span);
  context.currentBlock.terminator = {
    kind: "branch",
    target: context.loopExit,
    span: statement.span,
  };
}

function lowerContinue(statement: ContinueStatement, context: LowerContext) {
  if (!context.loopContinue) {
    throw new Error("IR lowering: continue outside of loop.");
  }
  releaseLoopLocals(context, statement.span);
  context.currentBlock.terminator = {
    kind: "branch",
    target: context.loopContinue,
    span: statement.span,
  };
}

function lowerForStatement(statement: ForStatement, context: LowerContext) {
  const arrayOperand = lowerExpression(statement.iterable, context);
  const arrayType = arrayOperand.type;
  if (!(arrayType.kind === "named" && arrayType.name === "Array")) {
    lowerCustomIterableForStatement(statement, arrayOperand, context);
    return;
  }

  const elementType: IrType =
    arrayType.kind === "named" && arrayType.args.length > 0
      ? arrayType.args[0]
      : { kind: "unknown" };

  const lenTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "array_len",
    target: lenTarget,
    array: arrayOperand,
    type: irPrimitive("i32"),
    span: statement.span,
  });

  const idxLocal = declareLocal(
    context,
    "__vek_for_idx",
    irPrimitive("i32"),
    true,
    statement.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: idxLocal.id,
    value: {
      kind: "const",
      value: { kind: "int", value: "0" },
      type: irPrimitive("i32"),
    },
    span: statement.span,
  });

  const condBlock = newBlock(context);
  const bodyBlock = newBlock(context);
  const incBlock = newBlock(context);
  const exitBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
    span: statement.span,
  };

  switchBlock(context, condBlock);
  const condTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target: condTarget,
    operator: "<",
    left: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    right: { kind: "temp", id: lenTarget, type: irPrimitive("i32") },
    type: irPrimitive("bool"),
    span: statement.span,
  });
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: { kind: "temp", id: condTarget, type: irPrimitive("bool") },
    thenTarget: bodyBlock.id,
    elseTarget: exitBlock.id,
    span: statement.span,
  };

  switchBlock(context, bodyBlock);
  const elemTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "array_get",
    target: elemTarget,
    array: arrayOperand,
    index: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    elementType,
    type: elementType,
    span: statement.span,
  });
  const elemValue: IrOperand = {
    kind: "temp",
    id: elemTarget,
    type: elementType,
  };
  retainIfBorrowedHeap(elemValue, context, statement.span);
  const iterLocal = declareLocal(
    context,
    statement.iterator.name,
    elementType,
    false,
    statement.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: iterLocal.id,
    value: elemValue,
    span: statement.span,
  });
  markLocalOwns(iterLocal.id, elemValue, context);

  const savedExit = context.loopExit;
  const savedContinue = context.loopContinue;
  const savedLoopCleanup = context.loopCleanup;
  context.loopExit = exitBlock.id;
  context.loopContinue = incBlock.id;

  const savedLocals = saveLocals(context);
  context.loopCleanup = savedLocals;
  lowerBlock(statement.body, context);
  restoreLocals(context, savedLocals);

  context.loopExit = savedExit;
  context.loopContinue = savedContinue;
  context.loopCleanup = savedLoopCleanup;

  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "branch",
      target: incBlock.id,
    };
  }

  switchBlock(context, incBlock);
  const incTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target: incTarget,
    operator: "+",
    left: { kind: "local", id: idxLocal.id, type: irPrimitive("i32") },
    right: {
      kind: "const",
      value: { kind: "int", value: "1" },
      type: irPrimitive("i32"),
    },
    type: irPrimitive("i32"),
    span: statement.span,
  });
  context.currentBlock.instructions.push({
    kind: "assign",
    target: idxLocal.id,
    value: { kind: "temp", id: incTarget, type: irPrimitive("i32") },
    span: statement.span,
  });
  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
  };

  switchBlock(context, exitBlock);
}

function lowerCustomIterableForStatement(
  statement: ForStatement,
  iterableOperand: IrOperand,
  context: LowerContext,
) {
  const iteratorType = iterableOperand.type;
  if (iteratorType.kind !== "named") {
    throw new Error("IR lowering: custom for loop requires named iterable.");
  }

  const nextLinkName = context.methodLinks.get(
    methodKey(iteratorType.name, "next"),
  );
  if (!nextLinkName) {
    throw new Error(
      `IR lowering: iterable type '${displayIrType(iteratorType)}' has no emitted next method.`,
    );
  }

  const itemType = typeFromCheckedNode(context, statement.iterator);
  const nextType: IrType = { kind: "nullable", base: itemType };
  const iteratorLocal = declareLocal(
    context,
    `__vek_iter_${context.nextLocal}`,
    iteratorType,
    true,
    statement.span,
  );
  retainIfBorrowedHeap(iterableOperand, context, statement.span);
  context.currentBlock.instructions.push({
    kind: "assign",
    target: iteratorLocal.id,
    value: iterableOperand,
    span: statement.span,
  });
  markLocalOwns(iteratorLocal.id, iterableOperand, context);

  const condBlock = newBlock(context);
  const bodyBlock = newBlock(context);
  const exitBlock = newBlock(context);

  context.currentBlock.terminator = {
    kind: "branch",
    target: condBlock.id,
    span: statement.span,
  };

  switchBlock(context, condBlock);
  const nextTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "call",
    target: nextTarget,
    callee: {
      kind: "function",
      name: nextLinkName,
      type: {
        kind: "function",
        params: [{ type: iteratorType, mutable: true }],
        returnType: nextType,
      },
    },
    args: [{ kind: "local", id: iteratorLocal.id, type: iteratorType }],
    type: nextType,
    span: statement.span,
  });
  markOwnedTemp(nextTarget, nextType, context);
  const nextValue: IrOperand = { kind: "temp", id: nextTarget, type: nextType };
  const isNullTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "is_null",
    target: isNullTarget,
    value: nextValue,
    type: irPrimitive("bool"),
    span: statement.span,
  });
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: { kind: "temp", id: isNullTarget, type: irPrimitive("bool") },
    thenTarget: exitBlock.id,
    elseTarget: bodyBlock.id,
    span: statement.span,
  };

  switchBlock(context, bodyBlock);
  const itemValue = unwrapNullableOperand(nextValue, context, statement.span);
  retainIfBorrowedHeap(itemValue, context, statement.span);
  const itemLocal = declareLocal(
    context,
    statement.iterator.name,
    itemType,
    false,
    statement.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: itemLocal.id,
    value: itemValue,
    span: statement.span,
  });
  markLocalOwns(itemLocal.id, itemValue, context);
  releaseIfOwnedTemp(nextValue, context);

  const savedExit = context.loopExit;
  const savedContinue = context.loopContinue;
  const savedLoopCleanup = context.loopCleanup;
  context.loopExit = exitBlock.id;
  context.loopContinue = condBlock.id;

  const savedLocals = saveLocals(context);
  context.loopCleanup = savedLocals;
  lowerBlock(statement.body, context);
  restoreLocals(context, savedLocals);

  context.loopExit = savedExit;
  context.loopContinue = savedContinue;
  context.loopCleanup = savedLoopCleanup;

  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "branch",
      target: condBlock.id,
    };
  }

  switchBlock(context, exitBlock);
}

function lowerMatchStatement(statement: MatchStatement, context: LowerContext) {
  const matchOperand = lowerExpression(statement.expression, context);
  const joinBlock = newBlock(context);

  const armBlocks = statement.arms.map(() => newBlock(context));
  const defaultBlock = newBlock(context);
  const failureBlocks = statement.arms
    .slice(0, -1)
    .map(() => newBlock(context));

  for (let i = 0; i < statement.arms.length; i++) {
    if (i > 0) switchBlock(context, failureBlocks[i - 1]);
    const failureTarget =
      i + 1 < statement.arms.length ? failureBlocks[i].id : defaultBlock.id;
    lowerPatternBranch(
      statement.arms[i].pattern,
      matchOperand,
      armBlocks[i].id,
      failureTarget,
      context,
    );
  }

  let branchesToJoin = false;
  for (let i = 0; i < statement.arms.length; i++) {
    const arm = statement.arms[i];
    const armBlock = armBlocks[i];
    switchBlock(context, armBlock);
    lowerMatchArmBindings(arm, matchOperand, context);
    const savedLocals = saveLocals(context);
    lowerBlock(arm.body, context);
    restoreLocals(context, savedLocals);
    if (!isTerminated(context)) {
      context.currentBlock.terminator = {
        kind: "branch",
        target: joinBlock.id,
      };
      branchesToJoin = true;
    }
  }

  switchBlock(context, defaultBlock);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = branchesToJoin
      ? {
          kind: "branch",
          target: joinBlock.id,
        }
      : {
          kind: "unreachable",
          span: statement.span,
        };
  }

  if (!branchesToJoin) {
    joinBlock.terminator = { kind: "unreachable", span: statement.span };
  }
  switchBlock(context, joinBlock);
}

function lowerMatchExpression(
  expression: MatchExpression,
  context: LowerContext,
): IrOperand {
  const matchOperand = lowerExpression(expression.expression, context);
  const resultType = typeFromNodeInContext(context, expression);
  const resultLocalName = `__match_result_${context.nextLocal}`;
  const resultLocal = declareLocal(
    context,
    resultLocalName,
    resultType,
    true,
    expression.span,
  );
  const resultOperand: IrOperand = {
    kind: "local",
    id: resultLocal.id,
    type: resultType,
  };

  const joinBlock = newBlock(context);
  const armBlocks = expression.arms.map(() => newBlock(context));
  const defaultBlock = newBlock(context);

  const failureBlocks = expression.arms
    .slice(0, -1)
    .map(() => newBlock(context));
  for (let i = 0; i < expression.arms.length; i++) {
    if (i > 0) switchBlock(context, failureBlocks[i - 1]);
    const failureTarget =
      i + 1 < expression.arms.length ? failureBlocks[i].id : defaultBlock.id;
    lowerPatternBranch(
      expression.arms[i].pattern,
      matchOperand,
      armBlocks[i].id,
      failureTarget,
      context,
    );
  }

  for (let i = 0; i < expression.arms.length; i++) {
    const arm = expression.arms[i];
    const armBlock = armBlocks[i];
    switchBlock(context, armBlock);
    lowerMatchExpressionArmBindings(arm, matchOperand, context);
    const armValue = lowerExpression(arm.expression, context);
    context.currentBlock.instructions.push({
      kind: "assign",
      target: resultLocal.id,
      value: armValue,
      span: arm.span,
    });
    context.currentBlock.terminator = {
      kind: "branch",
      target: joinBlock.id,
    };
  }

  switchBlock(context, defaultBlock);
  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "unreachable",
      span: expression.span,
    };
  }

  switchBlock(context, joinBlock);
  return resultOperand;
}

function lowerMatchExpressionArmBindings(
  arm: MatchExpressionArm,
  matchOperand: IrOperand,
  context: LowerContext,
) {
  lowerPatternBindings(arm.pattern, matchOperand, context);
}

function lowerMatchArmBindings(
  arm: MatchStatementArm,
  matchOperand: IrOperand,
  context: LowerContext,
) {
  lowerPatternBindings(arm.pattern, matchOperand, context);
}

function lowerPatternBranch(
  pattern: Pattern,
  matchOperand: IrOperand,
  successTarget: IrBlockId,
  failureTarget: IrBlockId,
  context: LowerContext,
) {
  switch (pattern.kind) {
    case "WildcardPattern":
      context.currentBlock.terminator = {
        kind: "branch",
        target: successTarget,
      };
      return;
    case "IdentifierPattern": {
      if (
        findUnitVariantInfo(
          context.variantInfos,
          pattern.name.name,
          matchedEnumNameForOperand(matchOperand),
        )
      ) {
        lowerEnumPatternBranch(
          pattern.name.name,
          [],
          matchOperand,
          successTarget,
          failureTarget,
          context,
          pattern.span,
        );
        return;
      }
      context.currentBlock.terminator = {
        kind: "branch",
        target: successTarget,
      };
      return;
    }
    case "LiteralPattern":
      lowerLiteralPatternBranch(
        pattern.literal,
        matchOperand,
        successTarget,
        failureTarget,
        context,
      );
      return;
    case "TuplePattern":
      lowerTuplePatternBranch(
        pattern.elements,
        matchOperand,
        successTarget,
        failureTarget,
        context,
      );
      return;
    case "EnumPattern":
      lowerEnumPatternBranch(
        pattern.name.name,
        pattern.args,
        matchOperand,
        successTarget,
        failureTarget,
        context,
        pattern.span,
      );
      return;
  }
}

function lowerLiteralPatternBranch(
  literal: LiteralExpression,
  matchOperand: IrOperand,
  successTarget: IrBlockId,
  failureTarget: IrBlockId,
  context: LowerContext,
) {
  if (literal.literalType === "Null") {
    if (matchOperand.type.kind === "nullable") {
      const isNullTarget = nextTemp(context);
      context.currentBlock.instructions.push({
        kind: "is_null",
        target: isNullTarget,
        value: matchOperand,
        type: irPrimitive("bool"),
        span: literal.span,
      });
      context.currentBlock.terminator = {
        kind: "cond_branch",
        condition: {
          kind: "temp",
          id: isNullTarget,
          type: irPrimitive("bool"),
        },
        thenTarget: successTarget,
        elseTarget: failureTarget,
        span: literal.span,
      };
      return;
    }
  }

  const comparedOperand =
    matchOperand.type.kind === "nullable" && literal.literalType !== "Null"
      ? unwrapNullableOperand(matchOperand, context, literal.span)
      : matchOperand;

  if (literal.literalType === "String" || isStringType(comparedOperand.type)) {
    const eqTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "string_eq",
      target: eqTarget,
      left: comparedOperand,
      right: lowerLiteral(literal),
      type: irPrimitive("bool"),
      span: literal.span,
    });
    context.currentBlock.terminator = {
      kind: "cond_branch",
      condition: {
        kind: "temp",
        id: eqTarget,
        type: irPrimitive("bool"),
      },
      thenTarget: successTarget,
      elseTarget: failureTarget,
      span: literal.span,
    };
    context.runtime.strings = true;
    return;
  }

  const cmpTarget = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target: cmpTarget,
    operator: "==",
    left: comparedOperand,
    right: lowerLiteral(literal),
    type: irPrimitive("bool"),
    span: literal.span,
  });
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: {
      kind: "temp",
      id: cmpTarget,
      type: irPrimitive("bool"),
    },
    thenTarget: successTarget,
    elseTarget: failureTarget,
    span: literal.span,
  };
}

function lowerTuplePatternBranch(
  elements: Pattern[],
  matchOperand: IrOperand,
  successTarget: IrBlockId,
  failureTarget: IrBlockId,
  context: LowerContext,
) {
  if (matchOperand.type.kind !== "tuple") {
    context.currentBlock.terminator = {
      kind: "branch",
      target: failureTarget,
    };
    return;
  }

  const tupleType = matchOperand.type;
  const fieldOperands = elements.map((element, index) =>
    extractTupleFieldOperand(
      matchOperand,
      index,
      tupleType.elements[index] ?? { kind: "unknown" },
      element.span,
      context,
    ),
  );

  lowerPatternSequence(
    elements,
    fieldOperands,
    successTarget,
    failureTarget,
    context,
  );
}

function lowerEnumPatternBranch(
  variantName: string,
  args: Pattern[],
  matchOperand: IrOperand,
  successTarget: IrBlockId,
  failureTarget: IrBlockId,
  context: LowerContext,
  span: Node["span"],
) {
  const emit = (enumOperand: IrOperand) => {
    const matchedEnumName = matchedEnumNameForOperand(enumOperand);
    const variantInfo = findVariantInfo(
      context.variantInfos,
      variantName,
      matchedEnumName,
    );
    if (!variantInfo) {
      context.currentBlock.terminator = {
        kind: "branch",
        target: failureTarget,
      };
      return;
    }

    const tagTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "get_tag",
      target: tagTarget,
      object: enumOperand,
      type: irPrimitive("i32"),
    });
    const cmpTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "binary",
      target: cmpTarget,
      operator: "==",
      left: {
        kind: "temp",
        id: tagTarget,
        type: irPrimitive("i32"),
      },
      right: {
        kind: "const",
        value: { kind: "int", value: String(variantInfo.tag) },
        type: irPrimitive("i32"),
      },
      type: irPrimitive("bool"),
      span,
    });

    const payloadBlock = args.length > 0 ? newBlock(context) : null;
    context.currentBlock.terminator = {
      kind: "cond_branch",
      condition: { kind: "temp", id: cmpTarget, type: irPrimitive("bool") },
      thenTarget: payloadBlock?.id ?? successTarget,
      elseTarget: failureTarget,
      span,
    };

    if (!payloadBlock) return;

    switchBlock(context, payloadBlock);
    const payloadOperands = args.map((arg, index) =>
      extractEnumPayloadOperand(
        enumOperand,
        variantInfo,
        index,
        arg.span,
        context,
      ),
    );
    lowerPatternSequence(
      args,
      payloadOperands,
      successTarget,
      failureTarget,
      context,
    );
  };

  if (matchOperand.type.kind === "nullable") {
    const nonNullBlock = newBlock(context);
    const isNullTarget = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "is_null",
      target: isNullTarget,
      value: matchOperand,
      type: irPrimitive("bool"),
      span,
    });
    context.currentBlock.terminator = {
      kind: "cond_branch",
      condition: {
        kind: "temp",
        id: isNullTarget,
        type: irPrimitive("bool"),
      },
      thenTarget: failureTarget,
      elseTarget: nonNullBlock.id,
      span,
    };
    switchBlock(context, nonNullBlock);
    emit(unwrapNullableOperand(matchOperand, context, span));
    return;
  }

  emit(matchOperand);
}

function lowerPatternSequence(
  patterns: Pattern[],
  values: IrOperand[],
  successTarget: IrBlockId,
  failureTarget: IrBlockId,
  context: LowerContext,
) {
  if (patterns.length === 0) {
    context.currentBlock.terminator = {
      kind: "branch",
      target: successTarget,
    };
    return;
  }

  if (patterns.length === 1) {
    lowerPatternBranch(
      patterns[0],
      values[0] ?? {
        kind: "const",
        value: { kind: "void" },
        type: irPrimitive("void"),
      },
      successTarget,
      failureTarget,
      context,
    );
    return;
  }

  const nextBlock = newBlock(context);
  lowerPatternBranch(
    patterns[0],
    values[0] ?? {
      kind: "const",
      value: { kind: "void" },
      type: irPrimitive("void"),
    },
    nextBlock.id,
    failureTarget,
    context,
  );
  switchBlock(context, nextBlock);
  lowerPatternSequence(
    patterns.slice(1),
    values.slice(1),
    successTarget,
    failureTarget,
    context,
  );
}

function lowerPatternBindings(
  pattern: Pattern,
  matchOperand: IrOperand,
  context: LowerContext,
) {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "LiteralPattern":
      return;
    case "IdentifierPattern": {
      const variantInfo = findUnitVariantInfo(
        context.variantInfos,
        pattern.name.name,
        matchedEnumNameForOperand(matchOperand),
      );
      if (variantInfo) return;
      const local = declareLocal(
        context,
        pattern.name.name,
        matchOperand.type,
        true,
        pattern.span,
      );
      retainIfBorrowedHeap(matchOperand, context, pattern.span);
      context.currentBlock.instructions.push({
        kind: "assign",
        target: local.id,
        value: matchOperand,
        span: pattern.span,
      });
      markLocalOwns(local.id, matchOperand, context);
      return;
    }
    case "TuplePattern":
      if (matchOperand.type.kind !== "tuple") return;
      {
        const tupleType = matchOperand.type;
        for (let i = 0; i < pattern.elements.length; i++) {
          lowerPatternBindings(
            pattern.elements[i],
            extractTupleFieldOperand(
              matchOperand,
              i,
              tupleType.elements[i] ?? { kind: "unknown" },
              pattern.elements[i].span,
              context,
            ),
            context,
          );
        }
      }
      return;
    case "EnumPattern": {
      const enumOperand =
        matchOperand.type.kind === "nullable"
          ? unwrapNullableOperand(matchOperand, context, pattern.span)
          : matchOperand;
      const variantInfo = findVariantInfo(
        context.variantInfos,
        pattern.name.name,
        matchedEnumNameForOperand(enumOperand),
      );
      if (!variantInfo) return;
      for (let i = 0; i < pattern.args.length; i++) {
        lowerPatternBindings(
          pattern.args[i],
          extractEnumPayloadOperand(
            enumOperand,
            variantInfo,
            i,
            pattern.args[i].span,
            context,
          ),
          context,
        );
      }
      return;
    }
  }
}

function unwrapNullableOperand(
  operand: IrOperand,
  context: LowerContext,
  span: Node["span"],
): IrOperand {
  if (operand.type.kind !== "nullable") return operand;
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "unwrap_nullable",
    target,
    value: operand,
    type: operand.type.base,
    span,
  });
  return { kind: "temp", id: target, type: operand.type.base };
}

function extractTupleFieldOperand(
  operand: IrOperand,
  index: number,
  fieldType: IrType,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "get_tuple_field",
    target,
    object: operand,
    index,
    type: fieldType,
    span,
  });
  return { kind: "temp", id: target, type: fieldType };
}

function extractEnumPayloadOperand(
  operand: IrOperand,
  variantInfo: VariantInfo,
  index: number,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const payloadType = variantInfo.payloadTypes[index] ?? { kind: "unknown" };
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "get_enum_payload",
    target,
    object: operand,
    variant: variantInfo.variantName,
    index,
    type: payloadType,
    span,
  });
  return { kind: "temp", id: target, type: payloadType };
}

function matchedEnumNameForOperand(operand: IrOperand): string | undefined {
  const type =
    operand.type.kind === "nullable" ? operand.type.base : operand.type;
  return type.kind === "named" && type.decl === "enum" ? type.name : undefined;
}

function isStringType(type: IrType): boolean {
  return type.kind === "primitive" && type.name === "string";
}

function findUnitVariantInfo(
  variantInfos: Map<string, VariantInfo>,
  variantName: string,
  enumName?: string,
): VariantInfo | undefined {
  const variantInfo = findVariantInfo(variantInfos, variantName, enumName);
  if (!variantInfo || variantInfo.payloadTypes.length > 0) return undefined;
  return variantInfo;
}

function lowerExpression(
  expression: Expression,
  context: LowerContext,
): IrOperand {
  switch (expression.kind) {
    case "LiteralExpression":
      if (expression.literalType === "String") context.runtime.strings = true;
      return lowerLiteral(expression);
    case "IdentifierExpression":
      return lowerIdentifier(expression, context);
    case "GroupingExpression":
      return lowerGrouping(expression, context);
    case "BinaryExpression":
      return lowerBinary(expression, context);
    case "UnaryExpression":
      return lowerUnary(expression, context);
    case "CallExpression":
      return lowerCall(expression, context);
    case "CastExpression":
      return lowerCast(expression, context);
    case "StructLiteralExpression":
      return lowerStructLiteral(expression, context);
    case "MemberExpression":
      return lowerMemberExpression(expression, context);
    case "TupleLiteralExpression":
      return lowerTupleLiteral(expression, context);
    case "TupleMemberExpression":
      return lowerTupleMemberExpression(expression, context);
    case "FunctionExpression":
      return lowerFunctionExpression(expression, context);
    case "ArrayLiteralExpression":
      return lowerArrayLiteral(expression, context);
    case "IndexExpression":
      return lowerIndexExpression(expression, context);
    case "MatchExpression":
      return lowerMatchExpression(expression, context);
    default:
      throw new Error(
        `IR lowering does not support ${(expression as { kind: string }).kind} yet.`,
      );
  }
}

function lowerFunctionExpression(
  expression: FunctionExpression,
  outerContext: LowerContext,
): IrOperand {
  const functionType = typeFromNodeInContext(outerContext, expression);
  if (functionType.kind !== "function") {
    throw new Error(
      "IR lowering: function expression did not have function type.",
    );
  }

  const index = outerContext.session.nextAnonymousFunction++;
  const sourceName = `__vek_anon_${index}`;
  const entryBlock: IrBlock = { id: "bb.0", instructions: [] };
  const context: LowerContext = {
    checkResult: outerContext.checkResult,
    runtime: outerContext.runtime,
    locals: new Map(),
    localTypes: new Map(),
    localDecls: [],
    ownedLocals: new Set(),
    ownedTemps: new Set(),
    blocks: [entryBlock],
    currentBlock: entryBlock,
    nextLocal: 0,
    nextTemp: 0,
    structFields: outerContext.structFields,
    variantInfos: outerContext.variantInfos,
    enumNames: outerContext.enumNames,
    methodLinks: outerContext.methodLinks,
    globals: outerContext.globals,
    globalTypes: outerContext.globalTypes,
    lazyGlobals: outerContext.lazyGlobals,
    returnType: functionType.returnType,
    cleanupBlocks: new Map(),
    session: outerContext.session,
  };

  const params = expression.params
    .filter((param): param is NamedParameter => param.kind === "NamedParameter")
    .map((param, paramIndex) => {
      const paramType = functionType.params[paramIndex]?.type ?? {
        kind: "unknown" as const,
      };
      const local = declareLocal(
        context,
        param.name.name,
        paramType,
        param.isMutable,
        param.span,
      );
      return {
        local: local.id,
        sourceName: param.name.name,
        type: local.type,
        mutable: param.isMutable,
        span: param.span,
      };
    });

  lowerBlock(expression.body, context);
  if (!isTerminated(context)) {
    releaseOwnedLocals(context, expression.body.span);
    context.currentBlock.terminator = {
      kind: "return",
      value: voidOperand(),
      span: expression.body.span,
    };
  }

  outerContext.session.generatedFunctions.push({
    kind: "function",
    id: `fn.${sourceName}`,
    sourceName,
    linkName: sourceName,
    signature: {
      params: params.map((param) => ({
        type: param.type,
        mutable: param.mutable,
      })),
      returnType: functionType.returnType,
    },
    params,
    locals: context.localDecls,
    blocks: context.blocks,
    body: "defined",
    span: expression.span,
  });

  return { kind: "function", name: sourceName, type: functionType };
}

function lowerLiteral(expression: LiteralExpression): IrOperand {
  const value = constFromLiteral(expression);
  return { kind: "const", value, type: typeFromConst(value) };
}

function lowerIdentifier(
  expression: IdentifierExpression,
  context: LowerContext,
): IrOperand {
  const local = context.locals.get(expression.name);
  if (local) {
    return maybeUnwrapNullable(
      {
        kind: "local",
        id: local,
        type:
          context.localTypes.get(local) ??
          typeFromNodeInContext(context, expression),
      },
      typeFromNodeInContext(context, expression),
      context,
      expression.span,
    );
  }
  const globalId = context.globals.get(expression.name);
  if (globalId) {
    if (context.lazyGlobals.has(globalId)) {
      context.currentBlock.instructions.push({
        kind: "ensure_global_initialized",
        globalId,
        span: expression.span,
      });
    }
    return maybeUnwrapNullable(
      {
        kind: "global",
        id: globalId,
        type:
          context.globalTypes.get(globalId) ??
          typeFromNodeInContext(context, expression),
      },
      typeFromNodeInContext(context, expression),
      context,
      expression.span,
    );
  }
  const checkedType = typeFromNodeInContext(context, expression);
  const checkedEnumName =
    checkedType.kind === "named" && checkedType.decl === "enum"
      ? checkedType.name
      : undefined;
  const variant = findVariantInfo(
    context.variantInfos,
    expression.name,
    checkedEnumName,
  );
  if (variant && variant.payloadTypes.length === 0) {
    const target = nextTemp(context);
    const type: IrType =
      checkedType.kind === "named" && checkedType.decl === "enum"
        ? checkedType
        : {
            kind: "named",
            name: variant.enumName,
            args: [],
            decl: "enum",
          };
    context.currentBlock.instructions.push({
      kind: "construct_enum",
      target,
      declId: variant.declId,
      variant: variant.variantName,
      tag: variant.tag,
      payload: [],
      type,
      span: expression.span,
    });
    markOwnedTemp(target, type, context);
    return { kind: "temp", id: target, type };
  }
  return {
    kind: "function",
    name: expression.name,
    type: typeFromNodeInContext(context, expression),
  };
}

function lowerGrouping(
  expression: GroupingExpression,
  context: LowerContext,
): IrOperand {
  return lowerExpression(expression.expression, context);
}

function lowerBinary(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand {
  if (expression.operator === "&&" || expression.operator === "||") {
    return lowerShortCircuitBinary(expression, context);
  }

  if (expression.operator === "==" || expression.operator === "!=") {
    return lowerEquality(expression, context);
  }

  const leftType = typeFromNodeInContext(context, expression.left);
  const isString = leftType.kind === "primitive" && leftType.name === "string";

  if (isString && expression.operator === "+") {
    const target = nextTemp(context);
    const left = lowerExpression(expression.left, context);
    const right = lowerExpression(expression.right, context);
    context.currentBlock.instructions.push({
      kind: "string_concat",
      target,
      left,
      right,
      type: irPrimitive("string"),
      span: expression.span,
    });
    releaseIfOwnedTemp(left, context);
    releaseIfOwnedTemp(right, context);
    markOwnedTemp(target, irPrimitive("string"), context);
    context.runtime.strings = true;
    return { kind: "temp", id: target, type: irPrimitive("string") };
  }

  const target = nextTemp(context);
  const type = typeFromNodeInContext(context, expression);
  const left = lowerExpression(expression.left, context);
  const right = lowerExpression(expression.right, context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target,
    operator: expression.operator,
    left,
    right,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerShortCircuitBinary(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand {
  const resultType = irPrimitive("bool");
  const resultLocal = declareLocal(
    context,
    `__vek_sc_${context.nextLocal}`,
    resultType,
    true,
    expression.span,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: resultLocal.id,
    value: {
      kind: "const",
      value: {
        kind: "bool",
        value: expression.operator === "||",
      },
      type: resultType,
    },
    span: expression.span,
  });

  const left = lowerExpression(expression.left, context);
  const rhsBlock = newBlock(context);
  const joinBlock = newBlock(context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: left,
    thenTarget: expression.operator === "&&" ? rhsBlock.id : joinBlock.id,
    elseTarget: expression.operator === "&&" ? joinBlock.id : rhsBlock.id,
    span: expression.span,
  };

  switchBlock(context, rhsBlock);
  const right = lowerExpression(expression.right, context);
  context.currentBlock.instructions.push({
    kind: "assign",
    target: resultLocal.id,
    value: right,
    span: expression.span,
  });
  if (!isTerminated(context)) {
    context.currentBlock.terminator = {
      kind: "branch",
      target: joinBlock.id,
      span: expression.span,
    };
  }

  switchBlock(context, joinBlock);
  return { kind: "local", id: resultLocal.id, type: resultType };
}

function lowerEquality(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand {
  const leftIsNull = isNullLiteral(expression.left);
  const rightIsNull = isNullLiteral(expression.right);
  const equal =
    leftIsNull || rightIsNull
      ? lowerNullEquality(expression, context)
      : lowerOperandEquality(
          lowerExpression(expression.left, context),
          lowerExpression(expression.right, context),
          expression.span,
          context,
        );

  if (expression.operator === "==") return equal;

  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "unary",
    target,
    operator: "!",
    argument: equal,
    type: irPrimitive("bool"),
    span: expression.span,
  });
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function lowerNullEquality(
  expression: BinaryExpression,
  context: LowerContext,
): IrOperand {
  const leftIsNull = isNullLiteral(expression.left);
  const nullable = lowerExpression(
    leftIsNull ? expression.right : expression.left,
    context,
  );
  if (nullable.type.kind !== "nullable") {
    throw new Error("IR lowering: null equality requires nullable operand.");
  }

  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "is_null",
    target,
    value: nullable,
    type: irPrimitive("bool"),
    span: expression.span,
  });
  releaseIfOwnedTemp(nullable, context);
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function lowerOperandEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const result = lowerOperandEqualityNoCleanup(left, right, span, context);
  releaseIfOwnedTemp(left, context);
  releaseIfOwnedTemp(right, context);
  return result;
}

function lowerOperandEqualityNoCleanup(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  if (isStringType(left.type) && isStringType(right.type)) {
    return lowerStringEquality(left, right, span, context);
  }

  if (left.type.kind === "nullable" && right.type.kind === "nullable") {
    return lowerNullableEquality(left, right, span, context);
  }

  if (left.type.kind === "tuple" && right.type.kind === "tuple") {
    return lowerTupleEquality(left, right, span, context);
  }

  if (left.type.kind === "named" && right.type.kind === "named") {
    const equals = context.methodLinks.get(methodKey(left.type.name, "equals"));
    if (equals) return lowerCustomEquality(equals, left, right, span, context);
    if (left.type.decl === "enum" && right.type.decl === "enum") {
      return lowerEnumEquality(left, right, span, context);
    }
  }

  if (canUsePrimitiveEquality(left.type, right.type)) {
    return lowerBinaryEquality(left, right, span, context);
  }

  throw new Error(
    `IR lowering: unsupported equality for '${displayIrType(left.type)}'.`,
  );
}

function lowerBinaryEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "binary",
    target,
    operator: "==",
    left,
    right,
    type: irPrimitive("bool"),
    span,
  });
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function lowerStringEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "string_eq",
    target,
    left,
    right,
    type: irPrimitive("bool"),
    span,
  });
  context.runtime.strings = true;
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function lowerCustomEquality(
  linkName: string,
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const calleeType: IrType = {
    kind: "function",
    params: [
      { type: left.type, mutable: false },
      { type: right.type, mutable: false },
    ],
    returnType: irPrimitive("bool"),
  };
  context.currentBlock.instructions.push({
    kind: "call",
    target,
    callee: { kind: "function", name: linkName, type: calleeType },
    args: [left, right],
    type: irPrimitive("bool"),
    span,
  });
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function lowerNullableEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  if (left.type.kind !== "nullable" || right.type.kind !== "nullable") {
    throw new Error(
      "IR lowering: nullable equality requires nullable operands.",
    );
  }

  const result = declareEqualityResultLocal(context, span);
  const joinBlock = newBlock(context);
  const leftNullBlock = newBlock(context);
  const leftValueBlock = newBlock(context);

  const leftNull = lowerIsNull(left, span, context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: leftNull,
    thenTarget: leftNullBlock.id,
    elseTarget: leftValueBlock.id,
    span,
  };

  switchBlock(context, leftNullBlock);
  const bothNullBlock = newBlock(context);
  const rightNotNullFromLeftNullBlock = newBlock(context);
  const rightNullWhenLeftNull = lowerIsNull(right, span, context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: rightNullWhenLeftNull,
    thenTarget: bothNullBlock.id,
    elseTarget: rightNotNullFromLeftNullBlock.id,
    span,
  };

  switchBlock(context, bothNullBlock);
  assignBoolResult(result.id, true, span, context);
  context.currentBlock.terminator = {
    kind: "branch",
    target: joinBlock.id,
    span,
  };

  switchBlock(context, rightNotNullFromLeftNullBlock);
  context.currentBlock.terminator = {
    kind: "branch",
    target: joinBlock.id,
    span,
  };

  switchBlock(context, leftValueBlock);
  const bothValueBlock = newBlock(context);
  const rightNullWhenLeftValue = lowerIsNull(right, span, context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: rightNullWhenLeftValue,
    thenTarget: joinBlock.id,
    elseTarget: bothValueBlock.id,
    span,
  };

  switchBlock(context, bothValueBlock);
  const leftValue = unwrapNullableOperand(left, context, span);
  const rightValue = unwrapNullableOperand(right, context, span);
  const valueEqual = lowerOperandEqualityNoCleanup(
    leftValue,
    rightValue,
    span,
    context,
  );
  context.currentBlock.instructions.push({
    kind: "assign",
    target: result.id,
    value: valueEqual,
    span,
  });
  context.currentBlock.terminator = {
    kind: "branch",
    target: joinBlock.id,
    span,
  };

  switchBlock(context, joinBlock);
  return { kind: "local", id: result.id, type: irPrimitive("bool") };
}

function lowerTupleEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  if (left.type.kind !== "tuple" || right.type.kind !== "tuple") {
    throw new Error("IR lowering: tuple equality requires tuple operands.");
  }
  if (left.type.elements.length !== right.type.elements.length) {
    throw new Error("IR lowering: tuple equality arity mismatch.");
  }
  const leftType = left.type;
  const rightType = right.type;

  return lowerSequentialEquality(leftType.elements.length, span, context, (i) =>
    lowerOperandEqualityNoCleanup(
      extractTupleFieldOperand(left, i, leftType.elements[i], span, context),
      extractTupleFieldOperand(right, i, rightType.elements[i], span, context),
      span,
      context,
    ),
  );
}

function lowerEnumEquality(
  left: IrOperand,
  right: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const variants = enumVariantsForType(left.type, context);
  if (variants.length === 0) {
    throw new Error(`IR lowering: unknown enum '${displayIrType(left.type)}'.`);
  }

  const leftTag = getEnumTagOperand(left, span, context);
  const rightTag = getEnumTagOperand(right, span, context);
  const tagsEqual = lowerBinaryEquality(leftTag, rightTag, span, context);
  if (variants.every((variant) => variant.payloadTypes.length === 0)) {
    return tagsEqual;
  }

  const result = declareEqualityResultLocal(context, span);
  const joinBlock = newBlock(context);
  const sameTagBlock = newBlock(context);
  context.currentBlock.terminator = {
    kind: "cond_branch",
    condition: tagsEqual,
    thenTarget: sameTagBlock.id,
    elseTarget: joinBlock.id,
    span,
  };

  switchBlock(context, sameTagBlock);
  for (const variant of variants) {
    const matchedBlock = newBlock(context);
    const nextVariantBlock = newBlock(context);
    const tagMatches = lowerBinaryEquality(
      leftTag,
      {
        kind: "const",
        value: { kind: "int", value: String(variant.tag) },
        type: irPrimitive("i32"),
      },
      span,
      context,
    );
    context.currentBlock.terminator = {
      kind: "cond_branch",
      condition: tagMatches,
      thenTarget: matchedBlock.id,
      elseTarget: nextVariantBlock.id,
      span,
    };

    switchBlock(context, matchedBlock);
    if (variant.payloadTypes.length === 0) {
      assignBoolResult(result.id, true, span, context);
    } else {
      const payloadEqual = lowerSequentialEquality(
        variant.payloadTypes.length,
        span,
        context,
        (i) =>
          lowerOperandEqualityNoCleanup(
            extractEnumPayloadOperand(left, variant, i, span, context),
            extractEnumPayloadOperand(right, variant, i, span, context),
            span,
            context,
          ),
      );
      context.currentBlock.instructions.push({
        kind: "assign",
        target: result.id,
        value: payloadEqual,
        span,
      });
    }
    context.currentBlock.terminator = {
      kind: "branch",
      target: joinBlock.id,
      span,
    };

    switchBlock(context, nextVariantBlock);
  }
  context.currentBlock.terminator = {
    kind: "branch",
    target: joinBlock.id,
    span,
  };

  switchBlock(context, joinBlock);
  return { kind: "local", id: result.id, type: irPrimitive("bool") };
}

function lowerSequentialEquality(
  count: number,
  span: Node["span"],
  context: LowerContext,
  lowerAt: (index: number) => IrOperand,
): IrOperand {
  const result = declareEqualityResultLocal(context, span);
  const joinBlock = newBlock(context);

  if (count === 0) {
    assignBoolResult(result.id, true, span, context);
    context.currentBlock.terminator = {
      kind: "branch",
      target: joinBlock.id,
      span,
    };
    switchBlock(context, joinBlock);
    return { kind: "local", id: result.id, type: irPrimitive("bool") };
  }

  for (let i = 0; i < count; i++) {
    const equal = lowerAt(i);
    if (i === count - 1) {
      context.currentBlock.instructions.push({
        kind: "assign",
        target: result.id,
        value: equal,
        span,
      });
      context.currentBlock.terminator = {
        kind: "branch",
        target: joinBlock.id,
        span,
      };
    } else {
      const nextBlock = newBlock(context);
      context.currentBlock.terminator = {
        kind: "cond_branch",
        condition: equal,
        thenTarget: nextBlock.id,
        elseTarget: joinBlock.id,
        span,
      };
      switchBlock(context, nextBlock);
    }
  }

  switchBlock(context, joinBlock);
  return { kind: "local", id: result.id, type: irPrimitive("bool") };
}

function declareEqualityResultLocal(
  context: LowerContext,
  span: Node["span"],
): IrLocal {
  const local = declareLocal(
    context,
    `__vek_eq_${context.nextLocal}`,
    irPrimitive("bool"),
    true,
    span,
  );
  assignBoolResult(local.id, false, span, context);
  return local;
}

function assignBoolResult(
  target: IrLocalId,
  value: boolean,
  span: Node["span"],
  context: LowerContext,
) {
  context.currentBlock.instructions.push({
    kind: "assign",
    target,
    value: boolOperand(value),
    span,
  });
}

function lowerIsNull(
  value: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "is_null",
    target,
    value,
    type: irPrimitive("bool"),
    span,
  });
  return { kind: "temp", id: target, type: irPrimitive("bool") };
}

function getEnumTagOperand(
  value: IrOperand,
  span: Node["span"],
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  context.currentBlock.instructions.push({
    kind: "get_tag",
    target,
    object: value,
    type: irPrimitive("i32"),
    span,
  });
  return { kind: "temp", id: target, type: irPrimitive("i32") };
}

function enumVariantsForType(
  type: IrType,
  context: LowerContext,
): VariantInfo[] {
  if (type.kind !== "named" || type.decl !== "enum") return [];
  const variants = [...context.variantInfos.values()].filter(
    (variant) => variant.enumName === type.name,
  );
  return [
    ...new Map(variants.map((variant) => [variant.tag, variant])).values(),
  ].sort((left, right) => left.tag - right.tag);
}

function boolOperand(value: boolean): IrOperand {
  return {
    kind: "const",
    value: { kind: "bool", value },
    type: irPrimitive("bool"),
  };
}

function canUsePrimitiveEquality(left: IrType, right: IrType): boolean {
  if (!irTypeEquals(left, right)) return false;
  return (
    left.kind === "primitive" &&
    left.name !== "string" &&
    left.name !== "void" &&
    left.name !== "null"
  );
}

function lowerUnary(
  expression: UnaryExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNodeInContext(context, expression);
  const argument = lowerExpression(expression.argument, context);
  context.currentBlock.instructions.push({
    kind: "unary",
    target,
    operator: expression.operator,
    argument,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerCall(
  expression: CallExpression,
  context: LowerContext,
): IrOperand {
  const methodCall = lowerInstanceMethodCall(expression, context);
  if (methodCall) return methodCall;

  const target = nextTemp(context);
  const type = typeFromNodeInContext(context, expression);
  let callee = lowerExpression(expression.callee, context);
  const instantiation = context.checkResult.callInstantiations?.get(expression);
  if (callee.kind === "function" && instantiation?.kind === "Function") {
    callee = {
      ...callee,
      name: mangleName(instantiation.name, instantiation.typeArgs),
    };
  }
  const returnsVoid = type.kind === "primitive" && type.name === "void";

  if (callee.kind === "function") {
    const enumName =
      type.kind === "named" && type.decl === "enum" ? type.name : undefined;
    const variant = findVariantInfo(
      context.variantInfos,
      callee.name,
      enumName,
    );
    if (variant && variant.payloadTypes.length > 0) {
      const target = nextTemp(context);
      const enumType: IrType =
        type.kind === "named" && type.decl === "enum"
          ? type
          : {
              kind: "named",
              name: variant.enumName,
              args: [],
              decl: "enum",
            };
      const payload = expression.args.map((arg) =>
        lowerExpression(arg, context),
      );
      for (const value of payload) retainIfBorrowedHeap(value, context);
      context.currentBlock.instructions.push({
        kind: "construct_enum",
        target,
        declId: variant.declId,
        variant: variant.variantName,
        tag: variant.tag,
        payload,
        type: enumType,
        span: expression.span,
      });
      for (const value of payload)
        if (value.kind === "temp") context.ownedTemps.delete(value.id);
      markOwnedTemp(target, enumType, context);
      return { kind: "temp", id: target, type: enumType };
    }
  }

  if (callee.kind === "function" && callee.name === "panic") {
    context.runtime.panic = true;
    const args = expression.args.map((arg) => lowerExpression(arg, context));
    context.currentBlock.instructions.push({
      kind: "call",
      target: undefined,
      callee,
      args,
      type,
      span: expression.span,
    });
    context.currentBlock.terminator = {
      kind: "unreachable",
      span: expression.span,
    };
    const afterBlock = newBlock(context);
    switchBlock(context, afterBlock);
    return voidOperand();
  }

  const args = expression.args.map((arg) => lowerExpression(arg, context));
  context.currentBlock.instructions.push({
    kind: "call",
    target: returnsVoid ? undefined : target,
    callee,
    args,
    type,
    span: expression.span,
  });
  for (const arg of args) releaseIfOwnedTemp(arg, context);

  if (returnsVoid) return voidOperand();
  markOwnedTemp(target, type, context);
  return { kind: "temp", id: target, type };
}

function lowerInstanceMethodCall(
  expression: CallExpression,
  context: LowerContext,
): IrOperand | undefined {
  if (expression.callee.kind !== "MemberExpression") return undefined;
  if (
    expression.callee.object.kind === "IdentifierExpression" &&
    context.methodLinks.has(
      methodKey(expression.callee.object.name, expression.callee.property.name),
    )
  ) {
    return undefined;
  }

  const calleeType = typeFromNodeInContext(context, expression.callee);
  if (calleeType.kind !== "function") return undefined;

  const objectType = typeFromNodeInContext(context, expression.callee.object);
  if (objectType.kind !== "named") return undefined;

  const linkName = context.methodLinks.get(
    methodKey(objectType.name, expression.callee.property.name),
  );
  if (!linkName) return undefined;
  const instantiation = context.checkResult.callInstantiations?.get(expression);
  const calleeName =
    instantiation?.kind === "Method" && instantiation.ownerName
      ? methodInstantiationLinkName(instantiation)
      : linkName;

  const type = typeFromNodeInContext(context, expression);
  const returnsVoid = type.kind === "primitive" && type.name === "void";
  const target = nextTemp(context);
  const args = [
    lowerExpression(expression.callee.object, context),
    ...expression.args.map((arg) => lowerExpression(arg, context)),
  ];
  const concreteCalleeType: IrType = {
    kind: "function",
    params: args.map((arg) => ({ type: arg.type, mutable: false })),
    returnType: type,
  };
  context.currentBlock.instructions.push({
    kind: "call",
    target: returnsVoid ? undefined : target,
    callee: { kind: "function", name: calleeName, type: concreteCalleeType },
    args,
    type,
    span: expression.span,
  });
  for (const arg of args) releaseIfOwnedTemp(arg, context);

  if (returnsVoid) return voidOperand();
  markOwnedTemp(target, type, context);
  return { kind: "temp", id: target, type };
}

function lowerCast(
  expression: CastExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromTypeNode(expression.type);
  context.currentBlock.instructions.push({
    kind: "cast",
    target,
    value: lowerExpression(expression.expression, context),
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function maybeUnwrapNullable(
  operand: IrOperand,
  expressionType: IrType,
  context: LowerContext,
  span: IrLocal["span"],
): IrOperand {
  if (
    operand.type.kind === "nullable" &&
    irTypeEquals(operand.type.base, expressionType)
  ) {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "unwrap_nullable",
      target,
      value: operand,
      type: expressionType,
      span,
    });
    return { kind: "temp", id: target, type: expressionType };
  }
  return {
    ...operand,
    type: expressionType.kind === "unknown" ? operand.type : expressionType,
  };
}

function coerceOperand(
  operand: IrOperand,
  targetType: IrType,
  context: LowerContext,
  span: IrLocal["span"],
): IrOperand {
  if (targetType.kind !== "nullable") return operand;
  if (operand.type.kind === "primitive" && operand.type.name === "null") {
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "make_null",
      target,
      type: targetType,
      span,
    });
    return { kind: "temp", id: target, type: targetType };
  }
  if (irTypeEquals(operand.type, targetType.base)) {
    const target = nextTemp(context);
    retainIfBorrowedHeap(operand, context, span);
    context.currentBlock.instructions.push({
      kind: "make_nullable",
      target,
      value: operand,
      type: targetType,
      span,
    });
    if (operand.kind === "temp") context.ownedTemps.delete(operand.id);
    markOwnedTemp(target, targetType, context);
    return { kind: "temp", id: target, type: targetType };
  }
  return operand;
}

function isNullLiteral(expression: Expression): boolean {
  return (
    expression.kind === "LiteralExpression" && expression.literalType === "Null"
  );
}

function lowerArrayLiteral(
  expression: ArrayLiteralExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNodeInContext(context, expression);
  const elementType: IrType =
    type.kind === "named" && type.args.length > 0
      ? type.args[0]
      : { kind: "unknown" };
  const target = nextTemp(context);
  const elements = expression.elements.map((el) =>
    lowerExpression(el, context),
  );
  context.currentBlock.instructions.push({
    kind: "array_new",
    target,
    elementType,
    elements,
    type,
    span: expression.span,
  });
  for (const element of elements) releaseIfOwnedTemp(element, context);
  if (!context.runtime.arrays.some((t) => irTypeEquals(t, elementType))) {
    context.runtime.arrays.push(elementType);
  }
  markOwnedTemp(target, type, context);
  return { kind: "temp", id: target, type };
}

function lowerIndexExpression(
  expression: IndexExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNodeInContext(context, expression);
  const target = nextTemp(context);
  const object = lowerExpression(expression.object, context);
  const index = lowerExpression(expression.index, context);
  if (object.type.kind === "primitive" && object.type.name === "string") {
    context.currentBlock.instructions.push({
      kind: "string_at",
      target,
      string: object,
      index,
      type,
      span: expression.span,
    });
    releaseIfOwnedTemp(object, context);
    markOwnedTemp(target, type, context);
    context.runtime.strings = true;
    return { kind: "temp", id: target, type };
  }
  context.currentBlock.instructions.push({
    kind: "array_get",
    target,
    array: object,
    index,
    elementType: type,
    type,
    span: expression.span,
  });
  releaseIfOwnedTemp(object, context);
  const result = { kind: "temp" as const, id: target, type };
  retainIfBorrowedHeap(result, context, expression.span);
  markOwnedTemp(target, type, context);
  return { kind: "temp", id: target, type };
}

function lowerTupleLiteral(
  expression: TupleLiteralExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNodeInContext(context, expression);
  if (type.kind !== "tuple") {
    throw new Error("IR lowering: tuple literal did not have tuple type.");
  }
  const target = nextTemp(context);
  const elements = expression.elements.map((element) =>
    lowerExpression(element, context),
  );
  for (const element of elements) retainIfBorrowedHeap(element, context);
  context.currentBlock.instructions.push({
    kind: "construct_tuple",
    target,
    elements,
    type,
    span: expression.span,
  });
  for (const element of elements)
    if (element.kind === "temp") context.ownedTemps.delete(element.id);
  markOwnedTemp(target, type, context);
  return { kind: "temp", id: target, type };
}

function lowerTupleMemberExpression(
  expression: TupleMemberExpression,
  context: LowerContext,
): IrOperand {
  const target = nextTemp(context);
  const type = typeFromNodeInContext(context, expression);
  context.currentBlock.instructions.push({
    kind: "get_tuple_field",
    target,
    object: lowerExpression(expression.object, context),
    index: expression.index,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function lowerStructLiteral(
  expression: StructLiteralExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNodeInContext(context, expression);
  const structType: IrType =
    type.kind === "named"
      ? type
      : {
          kind: "named",
          name:
            expression.name.name === "Self" && context.selfTypeName
              ? context.selfTypeName
              : expression.name.name,
          args: [],
        };
  const structName = structType.kind === "named" ? structType.name : "";
  const declId: IrTypeDeclId = `struct.${structName}`;
  const target = nextTemp(context);
  const fields = expression.fields.map((f) => ({
    name: f.name.name,
    value: lowerExpression(f.value, context),
  }));
  for (const field of fields) retainIfBorrowedHeap(field.value, context);
  context.currentBlock.instructions.push({
    kind: "construct_struct",
    target,
    declId,
    fields,
    type: structType,
    span: expression.span,
  });
  for (const field of fields)
    if (field.value.kind === "temp") context.ownedTemps.delete(field.value.id);
  markOwnedTemp(target, structType, context);
  return { kind: "temp", id: target, type: structType };
}

function lowerMemberExpression(
  expression: MemberExpression,
  context: LowerContext,
): IrOperand {
  const type = typeFromNodeInContext(context, expression);
  if (
    expression.object.kind === "IdentifierExpression" &&
    type.kind === "function"
  ) {
    const linkName = context.methodLinks.get(
      methodKey(expression.object.name, expression.property.name),
    );
    if (linkName) return { kind: "function", name: linkName, type };
  }

  const target = nextTemp(context);
  const object = lowerExpression(expression.object, context);

  if (expression.property.name === "len") {
    if (object.type.kind === "named" && object.type.name === "Array") {
      context.currentBlock.instructions.push({
        kind: "array_len",
        target,
        array: object,
        type: irPrimitive("i32"),
        span: expression.span,
      });
      releaseIfOwnedTemp(object, context);
      return { kind: "temp", id: target, type: irPrimitive("i32") };
    }
    if (object.type.kind === "primitive" && object.type.name === "string") {
      context.currentBlock.instructions.push({
        kind: "string_len",
        target,
        string: object,
        type: irPrimitive("i32"),
        span: expression.span,
      });
      releaseIfOwnedTemp(object, context);
      context.runtime.strings = true;
      return { kind: "temp", id: target, type: irPrimitive("i32") };
    }
  }

  context.currentBlock.instructions.push({
    kind: "get_field",
    target,
    object,
    field: expression.property.name,
    type,
    span: expression.span,
  });
  return { kind: "temp", id: target, type };
}

function newBlock(context: LowerContext): IrBlock {
  const block: IrBlock = {
    id: `bb.${context.blocks.length}`,
    instructions: [],
  };
  context.blocks.push(block);
  return block;
}

function switchBlock(context: LowerContext, block: IrBlock): void {
  context.currentBlock = block;
}

function isTerminated(context: LowerContext): boolean {
  return context.currentBlock.terminator !== undefined;
}

function saveLocals(context: LowerContext): LocalSnapshot {
  return {
    locals: new Map(context.locals),
    ownedLocals: new Set(context.ownedLocals),
  };
}

function restoreLocals(context: LowerContext, saved: LocalSnapshot): void {
  if (!isTerminated(context)) {
    for (const local of context.ownedLocals) {
      if (!saved.ownedLocals.has(local)) releaseLocal(local, context);
    }
  }
  context.locals = saved.locals;
  context.ownedLocals = new Set(saved.ownedLocals);
}

function releaseLoopLocals(
  context: LowerContext,
  span?: IrLocal["span"],
): void {
  const saved = context.loopCleanup;
  if (!saved) return;
  for (const local of Array.from(context.ownedLocals)) {
    if (saved.ownedLocals.has(local)) continue;
    releaseLocal(local, context, span);
    context.ownedLocals.delete(local);
  }
}

function declareLocal(
  context: LowerContext,
  sourceName: string,
  type: IrType,
  mutable: boolean,
  span: IrLocal["span"],
): IrLocal {
  const local: IrLocal = {
    id: `local.${context.nextLocal++}`,
    sourceName,
    type,
    mutable,
    span,
  };
  context.locals.set(sourceName, local.id);
  context.localTypes.set(local.id, type);
  context.localDecls.push(local);
  return local;
}

function isDirectHeapType(type: IrType): boolean {
  return (
    (type.kind === "primitive" && type.name === "string") ||
    (type.kind === "named" && type.name === "Array")
  );
}

function hasOwnedStorage(
  type: IrType,
  context: LowerContext,
  seen = new Set<string>(),
): boolean {
  if (isDirectHeapType(type)) return true;
  if (type.kind === "nullable") {
    return hasOwnedStorage(type.base, context, seen);
  }
  if (type.kind === "tuple") {
    return type.elements.some((element) =>
      hasOwnedStorage(element, context, seen),
    );
  }
  if (type.kind !== "named") return false;
  if (type.name === "Array") return true;
  const key = `${type.decl ?? "named"}:${type.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (type.decl === "enum") {
    for (const variant of context.variantInfos.values()) {
      if (variant.enumName !== type.name) continue;
      if (
        variant.payloadTypes.some((payloadType) =>
          hasOwnedStorage(payloadType, context, seen),
        )
      )
        return true;
    }
    return false;
  }
  const fields = context.structFields.get(type.name);
  if (!fields) return false;
  return fields.some((field) => hasOwnedStorage(field.type, context, seen));
}

function isArrayType(type: IrType): boolean {
  return type.kind === "named" && type.name === "Array";
}

function detachArrayForIndexedMutation(
  object: Expression,
  context: LowerContext,
  span?: IrLocal["span"],
): IrOperand {
  if (object.kind !== "IdentifierExpression") {
    return lowerExpression(object, context);
  }

  const localId = context.locals.get(object.name);
  if (localId) {
    const type = context.localTypes.get(localId);
    if (!type || !isArrayType(type)) return lowerExpression(object, context);

    const localOperand: IrOperand = { kind: "local", id: localId, type };
    if (!context.ownedLocals.has(localId)) {
      context.currentBlock.instructions.push({
        kind: "retain",
        value: localOperand,
        span,
      });
      context.runtime.refCounting = true;
    }

    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "detach",
      target,
      value: localOperand,
      type,
      span,
    });
    context.currentBlock.instructions.push({
      kind: "assign",
      target: localId,
      value: { kind: "temp", id: target, type },
      span,
    });
    markLocalOwns(localId, { kind: "temp", id: target, type }, context);
    context.runtime.copyOnWrite = true;
    return localOperand;
  }

  const globalId = context.globals.get(object.name);
  if (globalId) {
    const type = context.globalTypes.get(globalId);
    if (!type || !isArrayType(type)) return lowerExpression(object, context);
    if (context.lazyGlobals.has(globalId)) {
      context.currentBlock.instructions.push({
        kind: "ensure_global_initialized",
        globalId,
        span,
      });
    }
    const globalOperand: IrOperand = { kind: "global", id: globalId, type };
    const target = nextTemp(context);
    context.currentBlock.instructions.push({
      kind: "detach",
      target,
      value: globalOperand,
      type,
      span,
    });
    context.currentBlock.instructions.push({
      kind: "store_global",
      globalId,
      value: { kind: "temp", id: target, type },
      span,
    });
    context.runtime.copyOnWrite = true;
    return globalOperand;
  }

  return lowerExpression(object, context);
}

function retainIfBorrowedHeap(
  operand: IrOperand,
  context: LowerContext,
  span?: IrLocal["span"],
) {
  if (!hasOwnedStorage(operand.type, context)) return;
  if (operand.kind === "temp" && context.ownedTemps.has(operand.id)) return;
  context.currentBlock.instructions.push({
    kind: "retain",
    value: operand,
    span,
  });
  context.runtime.refCounting = true;
}

function markLocalOwns(
  local: IrLocalId,
  value: IrOperand,
  context: LowerContext,
) {
  if (!hasOwnedStorage(value.type, context)) return;
  context.ownedLocals.add(local);
  if (value.kind === "temp") context.ownedTemps.delete(value.id);
}

function releaseLocalIfOwned(
  local: IrLocalId,
  context: LowerContext,
  span?: IrLocal["span"],
) {
  if (!context.ownedLocals.has(local)) return;
  releaseLocal(local, context, span);
  context.ownedLocals.delete(local);
}

function releaseLocal(
  local: IrLocalId,
  context: LowerContext,
  span?: IrLocal["span"],
) {
  const type = context.localTypes.get(local);
  if (!type || !hasOwnedStorage(type, context)) return;
  context.currentBlock.instructions.push({
    kind: "release",
    value: { kind: "local", id: local, type },
    span,
  });
  context.runtime.refCounting = true;
}

function releaseGlobalIfHeap(
  globalId: IrGlobalId,
  context: LowerContext,
  span?: IrLocal["span"],
) {
  const type = context.globalTypes.get(globalId);
  if (!type || !hasOwnedStorage(type, context)) return;
  if (context.lazyGlobals.has(globalId)) {
    context.currentBlock.instructions.push({
      kind: "ensure_global_initialized",
      globalId,
      span,
    });
  }
  context.currentBlock.instructions.push({
    kind: "release",
    value: { kind: "global", id: globalId, type },
    span,
  });
  context.runtime.refCounting = true;
}

function getOrCreateCleanupBlock(
  context: LowerContext,
  ownedLocals: Set<IrLocalId>,
  span?: IrLocal["span"],
): IrBlock {
  const sortedLocals = Array.from(ownedLocals).sort();
  const key = sortedLocals.join(",");
  const existing = context.cleanupBlocks.get(key);
  if (existing) return existing;

  const cleanupBlock = newBlock(context);
  const savedBlock = context.currentBlock;
  switchBlock(context, cleanupBlock);

  for (const local of sortedLocals) {
    releaseLocal(local, context, span);
  }

  const isVoid =
    context.returnType.kind === "primitive" &&
    context.returnType.name === "void";
  if (isVoid || !context.returnValueLocalId) {
    cleanupBlock.terminator = { kind: "return", span };
  } else {
    const retLocalId = context.returnValueLocalId;
    const retLocalType = context.localTypes.get(retLocalId)!;
    cleanupBlock.terminator = {
      kind: "return",
      value: { kind: "local", id: retLocalId, type: retLocalType },
      span,
    };
  }

  switchBlock(context, savedBlock);
  context.cleanupBlocks.set(key, cleanupBlock);
  return cleanupBlock;
}

function releaseOwnedLocals(context: LowerContext, span?: IrLocal["span"]) {
  for (const local of Array.from(context.ownedLocals)) {
    releaseLocal(local, context, span);
  }
  context.ownedLocals.clear();
}

function releaseIfOwnedTemp(operand: IrOperand, context: LowerContext) {
  if (operand.kind !== "temp" || !context.ownedTemps.has(operand.id)) return;
  context.currentBlock.instructions.push({
    kind: "release",
    value: operand,
  });
  context.ownedTemps.delete(operand.id);
  context.runtime.refCounting = true;
}

function markOwnedTemp(target: IrTempId, type: IrType, context: LowerContext) {
  if (!hasOwnedStorage(type, context)) return;
  context.ownedTemps.add(target);
}

function irTypeEquals(left: IrType, right: IrType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "primitive" && right.kind === "primitive")
    return left.name === right.name;
  if (left.kind === "nullable" && right.kind === "nullable")
    return irTypeEquals(left.base, right.base);
  if (left.kind === "tuple" && right.kind === "tuple") {
    return (
      left.elements.length === right.elements.length &&
      left.elements.every((element, index) =>
        irTypeEquals(element, right.elements[index]),
      )
    );
  }
  if (left.kind === "named" && right.kind === "named") {
    return (
      left.name === right.name &&
      left.args.length === right.args.length &&
      left.args.every((arg, index) => irTypeEquals(arg, right.args[index]))
    );
  }
  if (left.kind === "function" && right.kind === "function") {
    return (
      left.params.length === right.params.length &&
      left.params.every(
        (param, index) =>
          param.mutable === right.params[index].mutable &&
          irTypeEquals(param.type, right.params[index].type),
      ) &&
      irTypeEquals(left.returnType, right.returnType)
    );
  }
  return left.kind === right.kind;
}

function nextTemp(context: LowerContext): IrTempId {
  return `tmp.${context.nextTemp++}`;
}

function emptyRuntimeRequirements(): IrRuntimeRequirements {
  return {
    panic: false,
    strings: false,
    arrays: [],
    refCounting: false,
    copyOnWrite: false,
  };
}

function constFromLiteral(expression: LiteralExpression): IrConst {
  if (expression.literalType === "Integer") {
    return { kind: "int", value: expression.value };
  }
  if (expression.literalType === "Float") {
    return { kind: "float", value: expression.value };
  }
  if (expression.literalType === "String") {
    return { kind: "string", value: expression.value };
  }
  if (expression.literalType === "Boolean") {
    return { kind: "bool", value: expression.value === "true" };
  }
  return { kind: "null" };
}

function typeFromConst(value: IrConst): IrType {
  if (value.kind === "int") return irPrimitive("i32");
  if (value.kind === "float") return irPrimitive("f32");
  if (value.kind === "string") return irPrimitive("string");
  if (value.kind === "bool") return irPrimitive("bool");
  if (value.kind === "null") return irPrimitive("null");
  return irPrimitive("void");
}

function voidOperand(): IrOperand {
  return {
    kind: "const",
    value: { kind: "void" },
    type: irPrimitive("void"),
  };
}

function typeFromNode(
  checkResult: IrTypeSource,
  node: Expression | VariableDeclaration["initializer"] | undefined,
): IrType {
  if (!node) return irPrimitive("void");
  return typeFromCheckerType(checkResult.types.get(node) as unknown);
}

function checkedFunctionReturnType(
  checkResult: IrTypeSource,
  node: FunctionDeclaration | MethodDeclaration,
): IrType {
  const type = typeFromCheckerType(checkResult.types.get(node) as unknown);
  return type.kind === "function" ? type.returnType : irPrimitive("void");
}

function typeSubstitutionsFromParams(
  params: TypeParameter[] | undefined,
  typeArgs: string[],
  enumNames: Set<string>,
): Map<string, IrType> {
  const substitutions = new Map<string, IrType>();
  for (let i = 0; i < Math.min(params?.length ?? 0, typeArgs.length); i++) {
    substitutions.set(
      params![i].name.name,
      typeFromDisplay(typeArgs[i], enumNames),
    );
  }
  return substitutions;
}

function ownerTypeSubstitutionsForMethod(
  owner: StructDeclaration | EnumDeclaration | undefined,
  typeArgs: string[],
  enumNames: Set<string>,
): Map<string, IrType> {
  return typeSubstitutionsFromParams(owner?.typeParams, typeArgs, enumNames);
}

function mergeTypeSubstitutions(
  left: Map<string, IrType>,
  right: Map<string, IrType>,
): Map<string, IrType> {
  return new Map([...left, ...right]);
}

function typeFromDisplay(source: string, enumNames: Set<string>): IrType {
  const parser = new DisplayTypeParser(source, enumNames);
  return normalizeSpecializedNamedTypes(parser.parse());
}

function typeFromTypeNode(node: TypeNode, enumNames?: Set<string>): IrType {
  return normalizeSpecializedNamedTypes(rawTypeFromTypeNode(node, enumNames));
}

function rawTypeFromTypeNode(node: TypeNode, enumNames?: Set<string>): IrType {
  if (node.kind === "NamedType") {
    const name = node.name.name;
    if (isPrimitiveName(name)) return irPrimitive(name);
    return {
      kind: "named",
      name,
      args: (node.typeArgs ?? []).map((n) => rawTypeFromTypeNode(n, enumNames)),
      ...(enumNames?.has(name) ? { decl: "enum" as const } : {}),
    };
  }
  if (node.kind === "ArrayType") {
    return {
      kind: "named",
      name: "Array",
      args: [rawTypeFromTypeNode(node.element, enumNames)],
    };
  }
  if (node.kind === "NullableType") {
    return {
      kind: "nullable",
      base: rawTypeFromTypeNode(node.base, enumNames),
    };
  }
  if (node.kind === "TupleType") {
    return {
      kind: "tuple",
      elements: node.elements.map((e) => rawTypeFromTypeNode(e, enumNames)),
    };
  }
  if (node.kind === "FunctionType") {
    return {
      kind: "function",
      params: node.params.map((param) => ({
        type: rawTypeFromTypeNode(param.type, enumNames),
        mutable: param.isMutable,
      })),
      returnType: rawTypeFromTypeNode(node.returnType, enumNames),
    };
  }
  return { kind: "named", name: "Self", args: [] };
}

function typeFromTypeNodeInContext(
  node: TypeNode,
  context: LowerContext,
): IrType {
  return typeFromTypeNodeWithSubstitutions(
    node,
    context.enumNames,
    context.typeSubstitutions,
  );
}

function typeFromTypeNodeWithSubstitutions(
  node: TypeNode,
  enumNames?: Set<string>,
  substitutions?: Map<string, IrType>,
): IrType {
  return normalizeSpecializedNamedTypes(
    substituteTypeParams(rawTypeFromTypeNode(node, enumNames), substitutions),
  );
}

function typeFromNodeInContext(
  context: LowerContext,
  node: Node | undefined,
): IrType {
  return normalizeSpecializedNamedTypes(
    substituteTypeParams(
      typeFromNode(context.checkResult, node as Expression | undefined),
      context.typeSubstitutions,
    ),
  );
}

function typeFromCheckedNode(context: LowerContext, node: Node): IrType {
  return normalizeSpecializedNamedTypes(
    substituteTypeParams(
      typeFromCheckerType(context.checkResult.types.get(node) as unknown),
      context.typeSubstitutions,
    ),
  );
}

function substituteTypeParams(
  type: IrType,
  substitutions?: Map<string, IrType>,
): IrType {
  if (!substitutions || substitutions.size === 0) return type;
  if (type.kind === "named" && type.args.length === 0) {
    return substitutions.get(type.name) ?? type;
  }
  if (type.kind === "nullable") {
    return { ...type, base: substituteTypeParams(type.base, substitutions) };
  }
  if (type.kind === "tuple") {
    return {
      ...type,
      elements: type.elements.map((element) =>
        substituteTypeParams(element, substitutions),
      ),
    };
  }
  if (type.kind === "function") {
    return {
      ...type,
      params: type.params.map((param) => ({
        ...param,
        type: substituteTypeParams(param.type, substitutions),
      })),
      returnType: substituteTypeParams(type.returnType, substitutions),
    };
  }
  if (type.kind === "named" && type.args.length > 0) {
    return {
      ...type,
      args: type.args.map((arg) => substituteTypeParams(arg, substitutions)),
    };
  }
  return type;
}

function typeFromTypeNodeWithSelf(
  node: TypeNode,
  selfTypeName: string,
  enumNames?: Set<string>,
): IrType {
  const type = rawTypeFromTypeNode(node, enumNames);
  return replaceSelfType(type, selfTypeName);
}

function typeFromTypeNodeWithSelfAndSubstitutions(
  node: TypeNode,
  selfTypeName: string,
  enumNames?: Set<string>,
  substitutions?: Map<string, IrType>,
): IrType {
  return normalizeSpecializedNamedTypes(
    substituteTypeParams(
      typeFromTypeNodeWithSelf(node, selfTypeName, enumNames),
      substitutions,
    ),
  );
}

function replaceSelfType(type: IrType, selfTypeName: string): IrType {
  if (type.kind === "named" && type.name === "Self") {
    return { ...type, name: selfTypeName };
  }
  if (type.kind === "nullable") {
    return { ...type, base: replaceSelfType(type.base, selfTypeName) };
  }
  if (type.kind === "tuple") {
    return {
      ...type,
      elements: type.elements.map((element) =>
        replaceSelfType(element, selfTypeName),
      ),
    };
  }
  if (type.kind === "function") {
    return {
      ...type,
      params: type.params.map((param) => ({
        ...param,
        type: replaceSelfType(param.type, selfTypeName),
      })),
      returnType: replaceSelfType(type.returnType, selfTypeName),
    };
  }
  if (type.kind === "named" && type.args.length > 0) {
    return {
      ...type,
      args: type.args.map((arg) => replaceSelfType(arg, selfTypeName)),
    };
  }
  return type;
}

function typeFromCheckerType(type: unknown): IrType {
  if (!isRecord(type) || typeof type.kind !== "string")
    return { kind: "unknown" };

  if (type.kind === "Primitive" && typeof type.name === "string") {
    return isPrimitiveName(type.name)
      ? irPrimitive(type.name)
      : { kind: "unknown" };
  }

  if (type.kind === "Named" && typeof type.name === "string") {
    const isEnum =
      isRecord(type.symbol) &&
      "enumDecl" in type.symbol &&
      !!type.symbol.enumDecl;
    return {
      kind: "named",
      name: type.name,
      args: Array.isArray(type.typeArgs)
        ? type.typeArgs.map(typeFromCheckerType)
        : [],
      ...(isEnum ? { decl: "enum" as const } : {}),
    };
  }

  if (type.kind === "Nullable") {
    return { kind: "nullable", base: typeFromCheckerType(type.base) };
  }

  if (type.kind === "Tuple" && Array.isArray(type.elements)) {
    return { kind: "tuple", elements: type.elements.map(typeFromCheckerType) };
  }

  if (type.kind === "Function" && Array.isArray(type.params)) {
    return {
      kind: "function",
      params: type.params.map((param) => ({
        type: typeFromCheckerType(isRecord(param) ? param.type : undefined),
        mutable: isRecord(param) && param.isMutable === true,
      })),
      returnType: typeFromCheckerType(type.returnType),
    };
  }

  if (type.kind === "TypeParam" && typeof type.name === "string") {
    return { kind: "named", name: type.name, args: [] };
  }

  if (type.kind === "Error") return { kind: "error" };
  return { kind: "unknown" };
}

function normalizeSpecializedNamedTypes(type: IrType): IrType {
  if (type.kind === "nullable") {
    return { ...type, base: normalizeSpecializedNamedTypes(type.base) };
  }
  if (type.kind === "tuple") {
    return {
      ...type,
      elements: type.elements.map(normalizeSpecializedNamedTypes),
    };
  }
  if (type.kind === "function") {
    return {
      ...type,
      params: type.params.map((param) => ({
        ...param,
        type: normalizeSpecializedNamedTypes(param.type),
      })),
      returnType: normalizeSpecializedNamedTypes(type.returnType),
    };
  }
  if (type.kind !== "named") return type;

  const args = type.args.map(normalizeSpecializedNamedTypes);
  if (type.name === "Array") return { ...type, args };
  if (args.length === 0) return { ...type, args };

  return {
    ...type,
    name: mangleName(type.name, args.map(typeMangleDisplay)),
    args: [],
  };
}

function typeMangleDisplay(type: IrType): string {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "named") {
    return type.args.length > 0
      ? `${type.name}<${type.args.map(typeMangleDisplay).join(", ")}>`
      : type.name;
  }
  if (type.kind === "nullable") return `${typeMangleDisplay(type.base)}?`;
  if (type.kind === "tuple") {
    return `(${type.elements.map(typeMangleDisplay).join(", ")})`;
  }
  if (type.kind === "function") return "fn";
  return type.kind;
}

function displayIrType(type: IrType): string {
  return typeMangleDisplay(type);
}

class DisplayTypeParser {
  private index = 0;

  constructor(
    private source: string,
    private enumNames: Set<string>,
  ) {}

  parse(): IrType {
    const type = this.parseType();
    this.skipWhitespace();
    return type;
  }

  private parseType(): IrType {
    this.skipWhitespace();
    const type = this.check("(") ? this.parseTuple() : this.parseNamed();
    this.skipWhitespace();
    if (this.consume("?")) return { kind: "nullable", base: type };
    return type;
  }

  private parseTuple(): IrType {
    this.expect("(");
    const elements: IrType[] = [];
    this.skipWhitespace();
    if (!this.check(")")) {
      do {
        elements.push(this.parseType());
        this.skipWhitespace();
      } while (this.consume(",") && !this.check(")"));
    }
    this.expect(")");
    return { kind: "tuple", elements };
  }

  private parseNamed(): IrType {
    const name = this.parseIdentifier();
    if (isPrimitiveName(name)) return irPrimitive(name);
    const args: IrType[] = [];
    this.skipWhitespace();
    if (this.consume("<")) {
      do {
        args.push(this.parseType());
        this.skipWhitespace();
      } while (this.consume(","));
      this.expect(">");
    }
    if (name === "Array" && args.length === 1) {
      return { kind: "named", name: "Array", args };
    }
    return {
      kind: "named",
      name,
      args,
      ...(this.enumNames.has(name) ? { decl: "enum" as const } : {}),
    };
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    const start = this.index;
    while (
      this.index < this.source.length &&
      /[A-Za-z0-9_]/.test(this.source[this.index])
    ) {
      this.index++;
    }
    return this.source.slice(start, this.index);
  }

  private consume(value: string): boolean {
    this.skipWhitespace();
    if (!this.check(value)) return false;
    this.index += value.length;
    return true;
  }

  private expect(value: string) {
    this.skipWhitespace();
    if (this.check(value)) this.index += value.length;
  }

  private check(value: string): boolean {
    return this.source.startsWith(value, this.index);
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.index] ?? "")) this.index++;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrimitiveName(name: string): name is IrPrimitiveType["name"] {
  return [
    "i8",
    "i16",
    "i32",
    "i64",
    "u8",
    "u16",
    "u32",
    "u64",
    "f16",
    "f32",
    "f64",
    "bool",
    "string",
    "void",
    "null",
  ].includes(name);
}

function methodKey(ownerName: string, methodName: string): string {
  return `${ownerName}.${methodName}`;
}

function variantInfoKey(enumName: string, variantName: string): string {
  return `${enumName}.${variantName}`;
}

function findVariantInfo(
  variantInfos: Map<string, VariantInfo>,
  variantName: string,
  enumName?: string,
): VariantInfo | undefined {
  if (enumName) return variantInfos.get(variantInfoKey(enumName, variantName));
  return variantInfos.get(variantName);
}

function methodLinkName(ownerName: string, methodName: string): string {
  return `${ownerName}_${methodName}`;
}

function methodInstantiationLinkName(
  instantiation: GenericInstantiationInfo,
): string {
  if (!instantiation.ownerName)
    return mangleName(instantiation.name, instantiation.typeArgs);
  const ownerName = instantiation.ownerTypeArgs?.length
    ? mangleName(instantiation.ownerName, instantiation.ownerTypeArgs)
    : instantiation.ownerName;
  const base = instantiation.ownerTypeArgs?.length
    ? methodLinkName(ownerName, instantiation.name)
    : `${ownerName}__${instantiation.name}`;
  return mangleName(base, instantiation.typeArgs);
}

function compoundAssignmentOperator(operator: Operator): Operator | null {
  if (operator === "+=") return "+";
  if (operator === "-=") return "-";
  if (operator === "*=") return "*";
  if (operator === "/=") return "/";
  if (operator === "%=") return "%";
  if (operator === "<<=") return "<<";
  if (operator === ">>=") return ">>";
  if (operator === "&=") return "&";
  if (operator === "^=") return "^";
  if (operator === "|=") return "|";
  return null;
}
