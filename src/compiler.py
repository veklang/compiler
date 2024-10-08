from asm import Asm
from errors import CompilationError
from instructions import InstructionType, Instruction

__all__ = ("compile",)


def compile(instructions: list[Instruction]) -> Asm:
    asm = Asm()

    for i, ins in enumerate(instructions):
        match ins.type:
            case InstructionType.ADD | InstructionType.SUB:
                ins_name = "ADD" if ins.type == InstructionType.ADD else "SUB"

                if len(ins.args) != 2:
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Expected 2 arguments, got {len(ins.args)}"
                    )

                if not (isinstance(ins.args[0], int) and isinstance(ins.args[1], int)):
                    raise CompilationError(
                        f"Instruction {ins_name} ({i}): Unknown argument types: {type(ins.args[0])}, {type(ins.args[1])}"
                    )

                asm.label_start.append(
                    f"mov rax, {(ins.args[0] + ins.args[1]) if ins.type == InstructionType.ADD else (ins.args[0] - ins.args[1])}"
                )

            case InstructionType.EXIT:
                asm.label_start.append("mov rax, 60")
                asm.label_start.append(
                    f"mov rdi, {ins.args[0]}" if ins.args[0] != 0 else "xor rdi, rdi"
                )
                asm.label_start.append("syscall")
                break

    return asm
