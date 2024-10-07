from emitter import Emitter
from builder import build

emitter = Emitter()
emitter.syscall_exit(69)

build(emitter.asm, strip=True, output_path="exit69")
