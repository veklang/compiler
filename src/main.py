from instructions import InstructionType as Type, Instruction
from compiler import emit
from builder import assemble

asm = emit(
    [
        Instruction(Type.ADD, [9, 4]),
        Instruction(Type.SUB, [9, 4]),
        Instruction(Type.EXIT, [0]),
        Instruction(Type.SUB, [9, 4]),
    ],
    opt_constant_folding=True,
    opt_useless_expressions=True,
    opt_dead_code=True,
)

print(asm.raw)
assemble(asm.raw, strip=True, output_path="a.out")
