from instructions import InstructionType, Instruction
from asm_generator import generate_asm
from builder import build

asm = generate_asm(
    [
        Instruction(InstructionType.ADD, [9, 4]),
        Instruction(InstructionType.SUB, [9, 4]),
        Instruction(InstructionType.EXIT, [0]),
        Instruction(InstructionType.ADD, [6, 9]),
    ]
)

print(asm.raw)
build(asm.raw, strip=True, output_path="a.out")
