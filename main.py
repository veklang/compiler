from emitter import Emitter

emitter = Emitter()
emitter.syscall_exit(0)
print(emitter.asm)
