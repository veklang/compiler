from asm import Asm
from errors import CompilationError
from instructions import InstructionType as Type, Instruction

__all__ = ("compile",)


def compile(
    instructions: list[Instruction],
    *,
    opt_constant_folding: bool = False,
    opt_useless_expressions: bool = False,
    opt_dead_code: bool = False,
) -> Asm:
    asm = Asm()

    for i, ins in enumerate(instructions):
        match ins.type:
            case Type.ADD | Type.SUB:
                if opt_useless_expressions:
                    continue

                ins_name = "ADD" if ins.type == Type.ADD else "SUB"

                if len(ins.args) != 2:
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Expected 2 arguments, got {len(ins.args)}"
                    )

                if not (isinstance(ins.args[0], int) and isinstance(ins.args[1], int)):
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Unknown argument types: {type(ins.args[0])}, {type(ins.args[1])}"
                    )

                if opt_constant_folding:
                    asm.label_start.append(
                        f"mov rax, {(ins.args[0] + ins.args[1]) if ins.type == Type.ADD else (ins.args[0] - ins.args[1])}"
                    )
                    continue

                asm.label_start.append(f"mov rax, {ins.args[0]}")
                asm.label_start.append(f"mov rbx, {ins.args[1]}")
                asm.label_start.append(
                    "add rax, rbx" if ins.type == Type.ADD else "sub rbx, rax"
                )

            case Type.EXIT:
                asm.label_start.append("mov rax, 60")
                asm.label_start.append(
                    f"mov rdi, {ins.args[0]}" if ins.args[0] != 0 else "xor rdi, rdi"
                )
                asm.label_start.append("syscall")

                if opt_dead_code:
                    break

    return asm
