import random
import string


def rand_id(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_letters, k=length))
