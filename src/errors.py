__all__ = ("CompilationError",)


class CompilationError(Exception):
    def __init__(self, *args: object) -> None:
        super().__init__(*args)
