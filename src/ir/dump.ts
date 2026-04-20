import type {
  IrConst,
  IrFunction,
  IrInstruction,
  IrOperand,
  IrProgram,
  IrTerminator,
  IrType,
} from "@/ir/types";

export function dumpIr(program: IrProgram): string {
  const lines: string[] = [];
  lines.push(`ir v${program.version}`);
  if (program.entry) lines.push(`entry ${program.entry}`);
  lines.push(
    `runtime panic=${program.runtime.panic ? "yes" : "no"} strings=${
      program.runtime.strings ? "yes" : "no"
    } arrays=${program.runtime.arrays.length}`,
  );

  for (const declaration of program.declarations) {
    if (declaration.kind === "function") dumpFunction(declaration, lines);
  }

  return lines.join("\n");
}

function dumpFunction(fn: IrFunction, lines: string[]) {
  const params = fn.params
    .map(
      (param) => `${param.sourceName ?? param.local}: ${dumpType(param.type)}`,
    )
    .join(", ");
  lines.push(
    `fn ${fn.id} ${fn.linkName}(${params}) -> ${dumpType(
      fn.signature.returnType,
    )}`,
  );
  if (fn.body === "extern") {
    lines.push("  extern");
    return;
  }

  for (const local of fn.locals) {
    const mutability = local.mutable ? "mut" : "const";
    lines.push(
      `  local ${local.id} ${mutability} ${
        local.sourceName ?? "_"
      }: ${dumpType(local.type)}`,
    );
  }

  for (const block of fn.blocks) {
    lines.push(`${block.id}:`);
    for (const instruction of block.instructions) {
      lines.push(`  ${dumpInstruction(instruction)}`);
    }
    if (block.terminator) lines.push(`  ${dumpTerminator(block.terminator)}`);
  }
}

function dumpInstruction(instruction: IrInstruction): string {
  if (instruction.kind === "assign") {
    return `${instruction.target} = ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "binary") {
    return `${instruction.target}: ${dumpType(instruction.type)} = ${dumpOperand(
      instruction.left,
    )} ${instruction.operator} ${dumpOperand(instruction.right)}`;
  }
  if (instruction.kind === "unary") {
    return `${instruction.target}: ${dumpType(instruction.type)} = ${
      instruction.operator
    }${dumpOperand(instruction.argument)}`;
  }
  if (instruction.kind === "call") {
    const target = instruction.target
      ? `${instruction.target}: ${dumpType(instruction.type)} = `
      : "";
    return `${target}call ${dumpOperand(instruction.callee)}(${instruction.args
      .map(dumpOperand)
      .join(", ")})`;
  }
  return `${instruction.target}: ${dumpType(instruction.type)} = cast ${dumpOperand(
    instruction.value,
  )}`;
}

function dumpTerminator(terminator: IrTerminator): string {
  if (terminator.kind === "unreachable") return "unreachable";
  if (terminator.kind === "branch") return `branch ${terminator.target}`;
  if (terminator.kind === "cond_branch") {
    return `cond_branch ${dumpOperand(terminator.condition)}, ${terminator.thenTarget}, ${terminator.elseTarget}`;
  }
  if (terminator.kind === "switch") {
    const cases = terminator.cases
      .map((c) => `${dumpConst(c.value)} -> ${c.target}`)
      .join(", ");
    return `switch ${dumpOperand(terminator.value)}, [${cases}], default -> ${terminator.defaultTarget}`;
  }
  return terminator.value
    ? `return ${dumpOperand(terminator.value)}`
    : "return";
}

function dumpOperand(operand: IrOperand): string {
  if (operand.kind === "const") return dumpConst(operand.value);
  if (operand.kind === "local") return operand.id;
  if (operand.kind === "temp") return operand.id;
  return `@${operand.name}`;
}

function dumpConst(value: IrConst): string {
  if (value.kind === "string") return JSON.stringify(value.value);
  if (value.kind === "bool") return value.value ? "true" : "false";
  if (value.kind === "null") return "null";
  if (value.kind === "void") return "void";
  return value.value;
}

export function dumpType(type: IrType): string {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "named") {
    return type.args.length
      ? `${type.name}<${type.args.map(dumpType).join(", ")}>`
      : type.name;
  }
  if (type.kind === "nullable") return `${dumpType(type.base)}?`;
  if (type.kind === "tuple") {
    if (type.elements.length === 1) return `(${dumpType(type.elements[0])},)`;
    return `(${type.elements.map(dumpType).join(", ")})`;
  }
  if (type.kind === "function") {
    const params = type.params
      .map((param) => `${param.mutable ? "mut " : ""}${dumpType(param.type)}`)
      .join(", ");
    return `fn(${params}) -> ${dumpType(type.returnType)}`;
  }
  return type.kind;
}
