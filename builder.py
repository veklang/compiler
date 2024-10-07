import utils
import subprocess
import os
import sys
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
        id = utils.rand_id(16)

        with open(f"/tmp/{id}.s", "w") as f:
            f.write(source)

        nasm_output = subprocess.run(
            ["nasm", f"-felf{bits}", f"/tmp/{id}.s", "-o", f"/tmp/{id}.o"],
            stderr=sys.stderr,
        )

        if nasm_output.returncode != 0:
            raise AssemblerError()

        ld_args = ["ld", f"/tmp/{id}.o", "-o", output_path]
        if bits == 32:
            ld_args.append("-m")
            ld_args.append("elf_i386")

        ld_output = subprocess.run(ld_args, stderr=sys.stderr)

        if ld_output.returncode != 0:
            raise LinkerError()

        if strip:
            strip_output = subprocess.run(
                ["strip", output_path],
                stderr=sys.stderr,
            )

            if strip_output.returncode != 0:
                raise StripError()
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
