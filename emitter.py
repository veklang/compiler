import utils
from typing import Literal


class Emitter:
    def __init__(self) -> None:
        """Assembly emitter"""
        self._bss: list[str] = []
        self._data: list[str] = []
        self._text: list[str] = ["global _start"]
        self._start: list[str] = []

    def syscall_exit(self, return_code: int) -> None:
        """Adds an exit syscall"""
        self._start.append("mov rax, 60")
        self._start.append(f"mov rdi, {return_code}")
        self._start.append("syscall")

    def syscall_write(self, fd: int, buf: bytes) -> None:
        """Adds a write syscall and data entry"""
        id = utils.rand_id()
        self._data.append(f"{id} db " + ",".join([str(byte) for byte in buf]))
        self._start.append("mov rax, 1")
        self._start.append(f"mov rdi, {fd}")
        self._start.append(f"mov rsi, {id}")
        self._start.append(f"mov rdx, {len(buf)}")
        self._start.append("syscall")

    @property
    def asm(self) -> str:
        final = "section .bss"
        final += "".join([f"\n {instruction}" for instruction in self._bss])
        final += "\nsection .data"
        final += "".join([f"\n {instruction}" for instruction in self._data])
        final += "\nsection .text"
        final += "".join([f"\n {instruction}" for instruction in self._text])
        final += "\n_start:"
        final += "".join([f"\n {instruction}" for instruction in self._start])
        return final
