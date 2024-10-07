from emitter import Emitter
from builder import build

emitter = Emitter()
emitter.syscall_write(1, "hi mom\n".encode("ascii"))
emitter.syscall_exit(0)

build(emitter.asm, strip=True, output_path="himom")
