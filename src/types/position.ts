export interface Position {
  index: number;
  line: number;
  column: number;
}

export interface Span {
  start: Position;
  end: Position;
}
