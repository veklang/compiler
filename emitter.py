import utils
from typing import Literal


class Emitter:
    def __init__(self, bits: Literal[32, 64] = 64) -> None:
        """Assembly emitter"""
        self.bits = bits
        self._bss: list[str] = []
        self._data: list[str] = []
        self._text: list[str] = ["global _start"]
        self._start: list[str] = []

    def r(self, name: str) -> str:
        """Returns a register based on `self.bits`"""
        return ("r" if self.bits == 64 else "e") + name

    def syscall_exit(self, return_code: int) -> None:
        """Adds an exit syscall"""
        self._start.append(f"mov {self.r('ax')}, 60")
        self._start.append(f"mov {self.r('di')}, {return_code}")
        self._start.append("syscall")

    def syscall_write(self, fd: int, buf: bytes) -> None:
        """Adds a write syscall and data entry"""
        id = utils.rand_id()
        self._data.append(f"{id} db " + ",".join([str(byte) for byte in buf]))
        self._start.append(f"mov {self.r('ax')}, 1")
        self._start.append(f"mov {self.r('di')}, {fd}")
        self._start.append(f"mov {self.r('si')}, {id}")
        self._start.append(f"mov {self.r('dx')}, {len(buf)}")
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
