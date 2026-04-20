import type {
  IrBlock,
  IrFunction,
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
  const structIds = new Set<IrTypeDeclId>();

  for (const declaration of program.declarations) {
    if (declaration.kind === "struct_decl") {
      if (structIds.has(declaration.id)) {
        diagnostics.push({
          message: `Duplicate struct id '${declaration.id}'.`,
        });
      }
      structIds.add(declaration.id);
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
    validateFunction(declaration, structIds, diagnostics);
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
    validateBlock(fn, block, blockIds, locals, temps, structIds, diagnostics);
}

function validateBlock(
  fn: IrFunction,
  block: IrBlock,
  blockIds: Set<string>,
  locals: Set<string>,
  temps: Set<string>,
  structIds: Set<IrTypeDeclId>,
  diagnostics: IrValidationDiagnostic[],
) {
  for (const instruction of block.instructions) {
    validateInstruction(fn, instruction, locals, temps, structIds, diagnostics);
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
    diagnostics,
  );
}

function validateInstruction(
  fn: IrFunction,
  instruction: IrInstruction,
  locals: Set<string>,
  temps: Set<string>,
  structIds: Set<IrTypeDeclId>,
  diagnostics: IrValidationDiagnostic[],
) {
  if (instruction.kind === "assign") {
    if (!locals.has(instruction.target)) {
      diagnostics.push({
        message: `Assignment in '${fn.id}' targets unknown local '${instruction.target}'.`,
      });
    }
    validateOperand(fn, instruction.value, locals, temps, diagnostics);
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

  if (instruction.kind === "binary") {
    validateOperand(fn, instruction.left, locals, temps, diagnostics);
    validateOperand(fn, instruction.right, locals, temps, diagnostics);
    return;
  }

  if (instruction.kind === "unary") {
    validateOperand(fn, instruction.argument, locals, temps, diagnostics);
    return;
  }

  if (instruction.kind === "call") {
    validateOperand(fn, instruction.callee, locals, temps, diagnostics);
    for (const arg of instruction.args)
      validateOperand(fn, arg, locals, temps, diagnostics);
    return;
  }

  if (instruction.kind === "construct_struct") {
    if (!structIds.has(instruction.declId)) {
      diagnostics.push({
        message: `construct_struct in '${fn.id}' references unknown struct '${instruction.declId}'.`,
      });
    }
    for (const f of instruction.fields)
      validateOperand(fn, f.value, locals, temps, diagnostics);
    return;
  }

  if (instruction.kind === "get_field") {
    validateOperand(fn, instruction.object, locals, temps, diagnostics);
    return;
  }

  if (instruction.kind === "set_field") {
    if (!locals.has(instruction.target)) {
      diagnostics.push({
        message: `set_field in '${fn.id}' targets unknown local '${instruction.target}'.`,
      });
    }
    validateOperand(fn, instruction.value, locals, temps, diagnostics);
    return;
  }

  validateOperand(fn, instruction.value, locals, temps, diagnostics);
}

function validateTerminator(
  fn: IrFunction,
  terminator: IrTerminator,
  blockIds: Set<string>,
  locals: Set<string>,
  temps: Set<string>,
  diagnostics: IrValidationDiagnostic[],
) {
  if (terminator.kind === "return") {
    if (terminator.value)
      validateOperand(fn, terminator.value, locals, temps, diagnostics);
    return;
  }

  if (terminator.kind === "branch") {
    requireBlockTarget(fn, terminator.target, blockIds, diagnostics);
    return;
  }

  if (terminator.kind === "cond_branch") {
    validateOperand(fn, terminator.condition, locals, temps, diagnostics);
    requireBlockTarget(fn, terminator.thenTarget, blockIds, diagnostics);
    requireBlockTarget(fn, terminator.elseTarget, blockIds, diagnostics);
    return;
  }

  if (terminator.kind === "switch") {
    validateOperand(fn, terminator.value, locals, temps, diagnostics);
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
}
