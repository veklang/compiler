from typing import Literal


class Emitter:
    def __init__(self, bits: Literal[32, 64] = 64) -> None:
        """Assembly emitter"""
        self.bits = bits
        self._start = ""

    def r(self, name: str) -> str:
        """Returns a register based on `self.bits`"""
        return ("r" if self.bits == 64 else "e") + name

    def syscall_exit(self, return_code: int) -> None:
        self._start += (
            f"mov {self.r('ax')}, 60\nmov {self.r('di')}, {return_code}\nsyscall"
        )

    @property
    def asm(self) -> str:
        return "global _start\n_start:\n " + "\n ".join(self._start.split("\n"))
