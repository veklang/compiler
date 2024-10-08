import random
import string

__all__ = ("rand_id", "enum")
enum_counter = 0


def rand_id(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_letters, k=length))


def enum(*, reset: bool = False) -> int:
    global enum_counter

    if reset:
        enum_counter = 0
        return 0

    enum_counter += 1
    return enum_counter - 1
