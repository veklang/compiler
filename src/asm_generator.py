from asm import Asm
from instructions import InstructionType, Instruction


def generate_asm(instructions: list[Instruction]) -> Asm:
    asm = Asm()

    for i in instructions:
        match i.type:
            case InstructionType.ADD | InstructionType.SUB:
                asm.label_start.append(f"mov rax, {i.args[0]}")
                asm.label_start.append(f"mov rbx, {i.args[1]}")

                if i.type == InstructionType.ADD:
                    asm.label_start.append("add rax, rbx")
                else:
                    asm.label_start.append("sub rax, rbx")

            case InstructionType.EXIT:
                asm.label_start.append("mov rax, 60")
                asm.label_start.append(
                    f"mov rdi, {i.args[0]}" if i.args[0] != 0 else "xor rdi, rdi"
                )
                asm.label_start.append("syscall")
                break

    return asm
