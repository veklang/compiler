from asm import Asm
from builder import build

source = Asm()
source.section_data.append("msg db 'hi mom', 0x0A")
source.section_data.append("len equ $ - msg")
source.label_start.append("mov rax, 1")
source.label_start.append("mov rdi, 1")
source.label_start.append("mov rsi, msg")
source.label_start.append("mov rdx, len")
source.label_start.append("syscall")
source.label_start.append("mov rax, 60")
source.label_start.append("xor rdi, rdi")
source.label_start.append("syscall")

build(source.raw, strip=True, output_path="himom")
