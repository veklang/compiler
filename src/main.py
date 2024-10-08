from instructions import InstructionType, Instruction
from asm_generator import generate_asm

asm = generate_asm(
    [
        Instruction(InstructionType.ADD, [9, 4]),
        Instruction(InstructionType.SUB, [9, 4]),
        Instruction(InstructionType.EXIT, [0]),
        Instruction(InstructionType.ADD, [6, 9]),
    ]
)

print(asm.raw)
