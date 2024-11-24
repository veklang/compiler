from asm import Asm
from errors import CompilationError
from instructions import InstructionType as Type, Instruction

__all__ = ("emit",)


def emit(instructions: list[Instruction]) -> Asm:
    asm = Asm()
    exit_satisfied = False

    for i, ins in enumerate(instructions):
        match ins.type:
            case Type.ADD | Type.SUB:
                ins_name = "ADD" if ins.type == Type.ADD else "SUB"

                if len(ins.args) != 2:
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Expected 2 arguments, got {len(ins.args)}"
                    )

                if not (isinstance(ins.args[0], int) and isinstance(ins.args[1], int)):
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Unknown argument types: {type(ins.args[0])}, {type(ins.args[1])}"
                    )

                asm.label_start.append(f"mov rax, {ins.args[0]}")
                asm.label_start.append(f"mov rbx, {ins.args[1]}")
                asm.label_start.append(
                    "add rax, rbx" if ins.type == Type.ADD else "sub rbx, rax"
                )

            case Type.EXIT:
                exit_satisfied = True
                asm.label_start.append("mov rax, 60")
                asm.label_start.append(
                    f"mov rdi, {ins.args[0]}" if ins.args[0] != 0 else "xor rdi, rdi"
                )
                asm.label_start.append("syscall")

    if not exit_satisfied:
        asm.label_start.append("mov rax, 60")
        asm.label_start.append("xor rdi, rdi")
        asm.label_start.append("syscall")

    return asm
