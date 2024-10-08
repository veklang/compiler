__all__ = ("Asm",)


class Asm:
    def __init__(self) -> None:
        """Simple assembly code manager"""
        self.segment_bss: list[str] = []
        self.segment_data: list[str] = []
        self.segment_text: list[str] = ["global _start"]
        self.label_start: list[str] = []

    @property
    def raw(self) -> str:
        final = "segment .bss"
        final += "".join([f"\n {instruction}" for instruction in self.segment_bss])
        final += "\nsegment .data"
        final += "".join([f"\n {instruction}" for instruction in self.segment_data])
        final += "\nsegment .text"
        final += "".join([f"\n {instruction}" for instruction in self.segment_text])
        final += "\n_start:"
        final += "".join([f"\n {instruction}" for instruction in self.label_start])
        return final
