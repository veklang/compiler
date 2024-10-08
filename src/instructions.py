from enum import Enum
from typing import Any
from utils import enum

__all__ = ("InstructionType", "Instruction")


class InstructionType(Enum):
    ADD = enum(reset=True)
    SUB = enum()
    EXIT = enum()


class Instruction:
    def __init__(self, type: InstructionType, args: list[Any]) -> None:
        self.type = type
        self.args = args
