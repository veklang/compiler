class Asm:
    def __init__(self) -> None:
        """Simple assembly code manager"""
        self.section_bss: list[str] = []
        self.section_data: list[str] = []
        self.section_text: list[str] = ["global _start"]
        self.label_start: list[str] = []

    @property
    def raw(self) -> str:
        final = "section .bss"
        final += "".join([f"\n {instruction}" for instruction in self.section_bss])
        final += "\nsection .data"
        final += "".join([f"\n {instruction}" for instruction in self.section_data])
        final += "\nsection .text"
        final += "".join([f"\n {instruction}" for instruction in self.section_text])
        final += "\n_start:"
        final += "".join([f"\n {instruction}" for instruction in self.label_start])
        return final
