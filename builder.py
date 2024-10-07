import random
import string
import subprocess
import os
from typing import Literal


class AssemblerError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


class LinkerError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


class StripError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


def build(
    source: str,
    bits: Literal[32, 64] = 64,
    strip: bool = False,
    output_path: str = "a.out",
) -> None:
    """Assembles, links, and optionally strips a binary, from assembly source"""
    try:
        id = "".join(random.choices(string.ascii_letters, k=16))

        with open(f"/tmp/{id}.s", "w") as f:
            f.write(source)

        nasm_output = subprocess.run(
            ["nasm", f"-felf{bits}", f"/tmp/{id}.s", "-o", f"/tmp/{id}.o"]
        )

        if nasm_output.returncode != 0:
            raise AssemblerError(nasm_output.stderr.decode("utf-8", errors="ignore"))

        ld_args = ["ld", f"/tmp/{id}.o", "-o", output_path]
        if bits == 32:
            ld_args.append("-m")
            ld_args.append("elf_i386")

        ld_output = subprocess.run(ld_args)

        if ld_output.returncode != 0:
            raise LinkerError(ld_output.stderr.decode("utf-8", errors="ignore"))

        if strip:
            strip_output = subprocess.run(["strip", output_path])

            if strip_output.returncode != 0:
                raise StripError(strip_output.stderr.decode("utf-8", errors="ignore"))
    except Exception as e:
        try:
            os.remove(output_path)
        except:
            pass

        raise e
    finally:
        try:
            os.remove(f"/tmp/{id}.s")
        except:
            pass

        try:
            os.remove(f"/tmp/{id}.o")
        except:
            pass
