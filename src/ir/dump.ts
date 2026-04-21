import type {
  IrConst,
  IrEnumDeclaration,
  IrFunction,
  IrGlobal,
  IrInstruction,
  IrOperand,
  IrProgram,
  IrStructDeclaration,
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
    if (declaration.kind === "struct_decl") dumpStructDecl(declaration, lines);
    else if (declaration.kind === "enum_decl") dumpEnumDecl(declaration, lines);
    else if (declaration.kind === "global") dumpGlobal(declaration, lines);
    else if (declaration.kind === "function") dumpFunction(declaration, lines);
  }

  return lines.join("\n");
}

function dumpStructDecl(decl: IrStructDeclaration, lines: string[]) {
  const fields = decl.fields
    .map((f) => `${f.name}: ${dumpType(f.type)}`)
    .join(", ");
  lines.push(`struct ${decl.id} ${decl.linkName} { ${fields} }`);
}

function dumpGlobal(decl: IrGlobal, lines: string[]) {
  const mut = decl.mutable ? "let" : "const";
  const init = decl.initializer ? ` = ${dumpConst(decl.initializer)}` : "";
  lines.push(
    `global ${decl.id} ${mut} ${decl.linkName}: ${dumpType(decl.type)}${init}`,
  );
}

function dumpEnumDecl(decl: IrEnumDeclaration, lines: string[]) {
  const variants = decl.variants
    .map((v) => {
      const payload =
        v.payloadTypes.length > 0
          ? `(${v.payloadTypes.map(dumpType).join(", ")})`
          : "";
      return `${v.name}[${v.tag}]${payload}`;
    })
    .join(", ");
  lines.push(`enum ${decl.id} ${decl.linkName} { ${variants} }`);
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
  if (instruction.kind === "make_null") {
    return `${instruction.target}: ${dumpType(instruction.type)} = make_null`;
  }
  if (instruction.kind === "make_nullable") {
    return `${instruction.target}: ${dumpType(instruction.type)} = make_nullable ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "is_null") {
    return `${instruction.target}: ${dumpType(instruction.type)} = is_null ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "unwrap_nullable") {
    return `${instruction.target}: ${dumpType(instruction.type)} = unwrap_nullable ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "construct_tuple") {
    return `${instruction.target}: ${dumpType(instruction.type)} = construct_tuple (${instruction.elements.map(dumpOperand).join(", ")})`;
  }
  if (instruction.kind === "get_tuple_field") {
    return `${instruction.target}: ${dumpType(instruction.type)} = get_tuple_field ${dumpOperand(instruction.object)}.${instruction.index}`;
  }
  if (instruction.kind === "construct_enum") {
    const payload =
      instruction.payload.length > 0
        ? `(${instruction.payload.map(dumpOperand).join(", ")})`
        : "";
    return `${instruction.target}: ${dumpType(instruction.type)} = construct_enum ${instruction.declId}::${instruction.variant}[${instruction.tag}]${payload}`;
  }
  if (instruction.kind === "get_tag") {
    return `${instruction.target}: ${dumpType(instruction.type)} = get_tag ${dumpOperand(instruction.object)}`;
  }
  if (instruction.kind === "get_enum_payload") {
    return `${instruction.target}: ${dumpType(instruction.type)} = get_enum_payload ${dumpOperand(instruction.object)}::${instruction.variant}[${instruction.index}]`;
  }
  if (instruction.kind === "construct_struct") {
    const fields = instruction.fields
      .map((f) => `${f.name}: ${dumpOperand(f.value)}`)
      .join(", ");
    return `${instruction.target}: ${dumpType(instruction.type)} = construct_struct ${instruction.declId} { ${fields} }`;
  }
  if (instruction.kind === "get_field") {
    return `${instruction.target}: ${dumpType(instruction.type)} = get_field ${dumpOperand(instruction.object)}.${instruction.field}`;
  }
  if (instruction.kind === "set_field") {
    return `set_field ${instruction.target}.${instruction.field} = ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "array_new") {
    const elems = instruction.elements.map(dumpOperand).join(", ");
    return `${instruction.target}: ${dumpType(instruction.type)} = array_new<${dumpType(instruction.elementType)}>[${elems}]`;
  }
  if (instruction.kind === "array_len") {
    return `${instruction.target}: ${dumpType(instruction.type)} = array_len ${dumpOperand(instruction.array)}`;
  }
  if (instruction.kind === "array_get") {
    return `${instruction.target}: ${dumpType(instruction.type)} = array_get ${dumpOperand(instruction.array)}[${dumpOperand(instruction.index)}]`;
  }
  if (instruction.kind === "array_set") {
    return `array_set ${dumpOperand(instruction.array)}[${dumpOperand(instruction.index)}] = ${dumpOperand(instruction.value)}`;
  }
  if (instruction.kind === "string_len") {
    return `${instruction.target}: ${dumpType(instruction.type)} = string_len ${dumpOperand(instruction.string)}`;
  }
  if (instruction.kind === "string_concat") {
    return `${instruction.target}: ${dumpType(instruction.type)} = string_concat ${dumpOperand(instruction.left)} + ${dumpOperand(instruction.right)}`;
  }
  if (instruction.kind === "string_eq") {
    return `${instruction.target}: ${dumpType(instruction.type)} = string_eq ${dumpOperand(instruction.left)} == ${dumpOperand(instruction.right)}`;
  }
  if (instruction.kind === "ensure_global_initialized") {
    return `ensure_global_initialized ${instruction.globalId}`;
  }
  if (instruction.kind === "store_global") {
    return `store_global ${instruction.globalId} = ${dumpOperand(instruction.value)}`;
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
  if (operand.kind === "global") return operand.id;
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
