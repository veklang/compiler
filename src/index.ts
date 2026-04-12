import { inspect } from "node:util";
import { Checker } from "@/core/checker";
import { Lexer } from "@/core/lexer";
import { Parser } from "@/core/parser";

const source = `
type MaybeI32 = i32?;

trait Measure<T> {
  fn compare(self, other: T) -> Ordering;
}

struct Counter {
  current: i32;
  end: i32;

  fn new(end: i32) -> Self {
    return Self { current: 0, end };
  }

  fn done(self) -> bool {
    return self.current == self.end;
  }

  satisfies Iterable<i32> {
    fn next(mut self) -> i32? {
      if self.done() {
        return null;
      }

      let value = self.current;
      self.current = self.current + 1;
      return value;
    }
  }
}

struct UserId {
  value: i32;

  fn new(value: i32) -> Self {
    return Self { value };
  }

  satisfies Equal<UserId> {
    fn equals(self, other: UserId) -> bool {
      return self.value == other.value;
    }
  }

  satisfies Measure<UserId> {
    fn compare(self, other: UserId) -> Ordering {
      if self.value < other.value {
        return Less;
      }

      if self.value > other.value {
        return Greater;
      }

      return Equal;
    }
  }
}

enum Packet<T> {
  Empty;
  Data(T);

  fn take(self) -> T? {
    return match self {
      Data(value) => value,
      _ => null,
    };
  }
}

fn id<T>(value: T) -> T {
  return value;
}

fn render(flag: bool, value: i32) -> string {
  return match flag {
    true => value.format(),
    _ => "disabled",
  };
}

fn main() -> void {
  const maybe_num: MaybeI32 = 3;
  let values: i32[] = [1, 2, 3];
  let unit: () = ();
  let single: (i32,) = (values[0],);
  let first: i32 = single.0;
  let packet: Packet<UserId> = Data(UserId.new(first));
  let counter = Counter.new(3);

  if maybe_num != null {
    let exact: i32 = maybe_num;
    let shown = render(true, exact as i32);
    panic(shown);
  }

  for item in counter {
    values[0] = id<i32>(item);
  }

  let taken = packet.take();
  if taken != null {
    let same = taken.equals(UserId.new(values[0]));
    let ordering = taken.compare(UserId.new(9));
    let summary = match ordering {
      Less => "less",
      Equal => "equal",
      _ => "greater",
    };
    if same {
      panic(summary);
    }
  }

  let _sink = unit;
}
`;
const { tokens, diagnostics: lexDiagnostics } = new Lexer(source).lex();
const { program, diagnostics: parseDiagnostics } = new Parser(
  tokens,
).parseProgram();
const { diagnostics: checkDiagnostics } = new Checker(program).checkProgram();

if (
  lexDiagnostics.length ||
  parseDiagnostics.length ||
  checkDiagnostics.length
) {
  console.log(
    inspect(
      { lexDiagnostics, parseDiagnostics, checkDiagnostics },
      { depth: 50, colors: true },
    ),
  );
} else {
  console.log(
    inspect(tokens, {
      depth: 50,
      colors: true,
    }),
  );

  console.log(
    inspect(program, {
      depth: 50,
      colors: true,
    }),
  );
}
