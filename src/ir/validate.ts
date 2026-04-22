import type {
  IrBlock,
  IrFunction,
  IrGlobalId,
  IrInstruction,
  IrOperand,
  IrProgram,
  IrTerminator,
  IrTypeDeclId,
} from "@/ir/types";

export interface IrValidationDiagnostic {
  message: string;
}

export interface IrValidationResult {
  diagnostics: IrValidationDiagnostic[];
}

export function validateIr(program: IrProgram): IrValidationResult {
  const diagnostics: IrValidationDiagnostic[] = [];
  const functionIds = new Set<string>();
  const functionNames = new Set<string>();
  const structIds = new Set<IrTypeDeclId>();
  const globalIds = new Set<IrGlobalId>();
  const functionIdsSeenForGlobals = new Set<string>();

  for (const declaration of program.declarations) {
    if (declaration.kind === "struct_decl") {
      if (structIds.has(declaration.id)) {
        diagnostics.push({
          message: `Duplicate struct id '${declaration.id}'.`,
        });
      }
      structIds.add(declaration.id);
    } else if (declaration.kind === "enum_decl") {
      if (structIds.has(declaration.id)) {
        diagnostics.push({
          message: `Duplicate type decl id '${declaration.id}'.`,
        });
      }
      structIds.add(declaration.id);
    } else if (declaration.kind === "global") {
      if (globalIds.has(declaration.id)) {
        diagnostics.push({
          message: `Duplicate global id '${declaration.id}'.`,
        });
      }
      globalIds.add(declaration.id);
      if (declaration.initializerFunction) {
        functionIdsSeenForGlobals.add(declaration.initializerFunction);
      }
    } else if (declaration.kind === "function") {
      functionNames.add(declaration.linkName);
    }
  }

  for (const declaration of program.declarations) {
    if (declaration.kind !== "function") continue;
    if (functionIds.has(declaration.id)) {
      diagnostics.push({
        message: `Duplicate function id '${declaration.id}'.`,
      });
    }
    functionIds.add(declaration.id);
    validateFunction(
      declaration,
      structIds,
      globalIds,
      functionNames,
      diagnostics,
    );
  }

  for (const initializerFunction of functionIdsSeenForGlobals) {
    if (!functionIds.has(initializerFunction)) {
      diagnostics.push({
        message: `Global initializer function '${initializerFunction}' does not exist.`,
      });
    }
  }

  if (program.entry && !functionIds.has(program.entry)) {
    diagnostics.push({
      message: `Entry function '${program.entry}' does not exist.`,
    });
  }

  return { diagnostics };
}

function validateFunction(
  fn: IrFunction,
  structIds: Set<IrTypeDeclId>,
  globalIds: Set<IrGlobalId>,
  functionNames: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  const locals = new Set<string>();
  const temps = new Set<string>();

  for (const local of fn.locals) {
    if (locals.has(local.id)) {
      diagnostics.push({
        message: `Duplicate local id '${local.id}' in '${fn.id}'.`,
      });
    }
    locals.add(local.id);
  }

  if (fn.body === "extern") {
    if (fn.blocks.length !== 0) {
      diagnostics.push({ message: `Extern function '${fn.id}' has blocks.` });
    }
    return;
  }

  if (fn.blocks.length === 0) {
    diagnostics.push({ message: `Defined function '${fn.id}' has no blocks.` });
    return;
  }

  const blockIds = new Set(fn.blocks.map((b) => b.id));

  for (const block of fn.blocks)
    validateBlock(
      fn,
      block,
      blockIds,
      locals,
      temps,
      structIds,
      globalIds,
      functionNames,
      diagnostics,
    );
}

function validateBlock(
  fn: IrFunction,
  block: IrBlock,
  blockIds: Set<string>,
  locals: Set<string>,
  temps: Set<string>,
  structIds: Set<IrTypeDeclId>,
  globalIds: Set<IrGlobalId>,
  functionNames: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  for (const instruction of block.instructions) {
    validateInstruction(
      fn,
      instruction,
      locals,
      temps,
      structIds,
      globalIds,
      functionNames,
      diagnostics,
    );
  }

  if (!block.terminator) {
    diagnostics.push({
      message: `Block '${block.id}' in '${fn.id}' has no terminator.`,
    });
    return;
  }

  validateTerminator(
    fn,
    block.terminator,
    blockIds,
    locals,
    temps,
    globalIds,
    functionNames,
    diagnostics,
  );
}

function validateInstruction(
  fn: IrFunction,
  instruction: IrInstruction,
  locals: Set<string>,
  temps: Set<string>,
  structIds: Set<IrTypeDeclId>,
  globalIds: Set<IrGlobalId>,
  functionNames: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  const validate = (operand: IrOperand) =>
    validateOperand(
      fn,
      operand,
      locals,
      temps,
      globalIds,
      functionNames,
      diagnostics,
    );

  if (instruction.kind === "assign") {
    if (!locals.has(instruction.target)) {
      diagnostics.push({
        message: `Assignment in '${fn.id}' targets unknown local '${instruction.target}'.`,
      });
    }
    validate(instruction.value);
    return;
  }

  if (instruction.kind === "retain" || instruction.kind === "release") {
    validate(instruction.value);
    return;
  }

  if (instruction.kind === "store_global") {
    if (!globalIds.has(instruction.globalId)) {
      diagnostics.push({
        message: `store_global in '${fn.id}' targets unknown global '${instruction.globalId}'.`,
      });
    }
    validate(instruction.value);
    return;
  }

  if (instruction.kind === "ensure_global_initialized") {
    if (!globalIds.has(instruction.globalId)) {
      diagnostics.push({
        message: `ensure_global_initialized in '${fn.id}' references unknown global '${instruction.globalId}'.`,
      });
    }
    return;
  }

  if (instruction.kind === "string_len") {
    validate(instruction.string);
    temps.add(instruction.target);
    return;
  }

  if (instruction.kind === "string_at") {
    validate(instruction.string);
    validate(instruction.index);
    temps.add(instruction.target);
    return;
  }

  if (instruction.kind === "string_concat") {
    validate(instruction.left);
    validate(instruction.right);
    temps.add(instruction.target);
    return;
  }

  if (instruction.kind === "string_eq") {
    validate(instruction.left);
    validate(instruction.right);
    temps.add(instruction.target);
    return;
  }

  if (instruction.kind === "set_field") {
    if (!locals.has(instruction.target)) {
      diagnostics.push({
        message: `set_field in '${fn.id}' targets unknown local '${instruction.target}'.`,
      });
    }
    validate(instruction.value);
    return;
  }

  if ("target" in instruction && instruction.target) {
    if (temps.has(instruction.target)) {
      diagnostics.push({
        message: `Duplicate temp id '${instruction.target}' in '${fn.id}'.`,
      });
    }
    temps.add(instruction.target);
  }

  if (instruction.kind === "detach") {
    validate(instruction.value);
    return;
  }

  if (instruction.kind === "binary") {
    validate(instruction.left);
    validate(instruction.right);
    return;
  }

  if (instruction.kind === "unary") {
    validate(instruction.argument);
    return;
  }

  if (instruction.kind === "call") {
    validate(instruction.callee);
    for (const arg of instruction.args) validate(arg);
    return;
  }

  if (instruction.kind === "make_null") {
    return;
  }

  if (instruction.kind === "make_nullable") {
    validate(instruction.value);
    return;
  }

  if (
    instruction.kind === "is_null" ||
    instruction.kind === "unwrap_nullable"
  ) {
    validate(instruction.value);
    return;
  }

  if (instruction.kind === "construct_tuple") {
    for (const element of instruction.elements) {
      validate(element);
    }
    return;
  }

  if (instruction.kind === "get_tuple_field") {
    validate(instruction.object);
    return;
  }

  if (instruction.kind === "construct_enum") {
    if (!structIds.has(instruction.declId)) {
      diagnostics.push({
        message: `construct_enum in '${fn.id}' references unknown enum '${instruction.declId}'.`,
      });
    }
    for (const p of instruction.payload) validate(p);
    return;
  }

  if (instruction.kind === "get_tag") {
    validate(instruction.object);
    return;
  }

  if (instruction.kind === "get_enum_payload") {
    validate(instruction.object);
    return;
  }

  if (instruction.kind === "construct_struct") {
    if (!structIds.has(instruction.declId)) {
      diagnostics.push({
        message: `construct_struct in '${fn.id}' references unknown struct '${instruction.declId}'.`,
      });
    }
    for (const f of instruction.fields) validate(f.value);
    return;
  }

  if (instruction.kind === "get_field") {
    validate(instruction.object);
    return;
  }

  if (instruction.kind === "array_new") {
    for (const el of instruction.elements) validate(el);
    return;
  }

  if (instruction.kind === "array_len") {
    validate(instruction.array);
    return;
  }

  if (instruction.kind === "array_get") {
    validate(instruction.array);
    validate(instruction.index);
    return;
  }

  if (instruction.kind === "array_set") {
    validate(instruction.array);
    validate(instruction.index);
    validate(instruction.value);
    return;
  }

  validate(instruction.value);
}

function validateTerminator(
  fn: IrFunction,
  terminator: IrTerminator,
  blockIds: Set<string>,
  locals: Set<string>,
  temps: Set<string>,
  globalIds: Set<IrGlobalId>,
  functionNames: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  const validate = (operand: IrOperand) =>
    validateOperand(
      fn,
      operand,
      locals,
      temps,
      globalIds,
      functionNames,
      diagnostics,
    );

  if (terminator.kind === "return") {
    if (terminator.value) validate(terminator.value);
    return;
  }

  if (terminator.kind === "branch") {
    requireBlockTarget(fn, terminator.target, blockIds, diagnostics);
    return;
  }

  if (terminator.kind === "cond_branch") {
    validate(terminator.condition);
    requireBlockTarget(fn, terminator.thenTarget, blockIds, diagnostics);
    requireBlockTarget(fn, terminator.elseTarget, blockIds, diagnostics);
    return;
  }

  if (terminator.kind === "switch") {
    validate(terminator.value);
    for (const c of terminator.cases)
      requireBlockTarget(fn, c.target, blockIds, diagnostics);
    requireBlockTarget(fn, terminator.defaultTarget, blockIds, diagnostics);
    return;
  }

  // unreachable — no targets to validate
}

function requireBlockTarget(
  fn: IrFunction,
  target: string,
  blockIds: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  if (!blockIds.has(target)) {
    diagnostics.push({
      message: `Terminator in '${fn.id}' references unknown block '${target}'.`,
    });
  }
}

function validateOperand(
  fn: IrFunction,
  operand: IrOperand,
  locals: Set<string>,
  temps: Set<string>,
  globalIds: Set<IrGlobalId>,
  functionNames: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  if (operand.kind === "local" && !locals.has(operand.id)) {
    diagnostics.push({
      message: `Operand in '${fn.id}' references unknown local '${operand.id}'.`,
    });
  }

  if (operand.kind === "temp" && !temps.has(operand.id)) {
    diagnostics.push({
      message: `Operand in '${fn.id}' references undefined temp '${operand.id}'.`,
    });
  }

  if (operand.kind === "global" && !globalIds.has(operand.id)) {
    diagnostics.push({
      message: `Operand in '${fn.id}' references unknown global '${operand.id}'.`,
    });
  }

  if (
    operand.kind === "function" &&
    operand.name !== "panic" &&
    !functionNames.has(operand.name)
  ) {
    diagnostics.push({
      message: `Operand in '${fn.id}' references unknown function '${operand.name}'.`,
    });
  }
}
