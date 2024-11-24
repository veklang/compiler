__all__ = ("CompilationError", "AssemblerError", "LinkerError", "StripError")


class AssemblerError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


class LinkerError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


class StripError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)


class CompilationError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)
