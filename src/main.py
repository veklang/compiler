from instructions import InstructionType as Type, Instruction
from emitter import emit
from builder import assemble

asm = emit(
    [
        Instruction(Type.ADD, [9, 4]),
        Instruction(Type.SUB, [9, 4]),
        Instruction(Type.EXIT, [0]),
        Instruction(Type.SUB, [9, 4]),
    ],
)

print(asm.raw)
assemble(asm.raw, strip=True, output_path="a.out")
