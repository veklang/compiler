from instructions import InstructionType, Instruction
from compiler import compile
from builder import build

asm = compile(
    [
        Instruction(InstructionType.ADD, [9, 4]),
        Instruction(InstructionType.SUB, [9, 4]),
        Instruction(InstructionType.EXIT, [0]),
    ]
)

print(asm.raw)
build(asm.raw, strip=True, output_path="a.out")
