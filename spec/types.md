# Types

## Basics

```
// you can find the primitives in the keywords

let arr = [1, 2, 3] // my_arr: Array<int>
let tup = (6, 9) // tup: Tuple<int, int>
let a_map = { "hi": "mom" } // my_map: Map<string, string>

struct Stuff {
  num: int,
  str: string,
}

let stuff = Stuff { num: 69, str: "lol" }

enum State {
  OPEN,
  CLOSED,
}

let state = State.OPEN
alias IntOrString = int | string
```

## Typecasting

```
let num = 42
let num_f = num as float

// this also works on pointers
let* num_p = &num
let* num_f = num_p as *float
```

## OOP

```
// basic
class Stuff {
  pub fn constructor() {}
  pub static fn add(x: int, y: int): int {
    return x + y
  }
}

// extensions
class MoreStuff extends Stuff {
  pub static fn sub(x: int, y: int): int {
    return x - y
  }
}

// getter/setter
class GettersAndSetters {
  thing1: int
  thing2: int

  pub fn constructor() {
    this.thing1 = 69
    this.thing2 = 420
  }

  pub getter fn thingy() {
    return this.thing1
  }

  pub setter fn thingy(new: int) {
    this.thing1 = new
  }
}

// abstract implementations
abstract class Thing {
  private_thing: string
  pub public_thing: string

  fn private_func(x: int)
  pub fn public_func()
}

class ThingImpl implements Thing {
  pub fn constructor() {}

  fn private_func(x: int) {}
  pub fn public_func() {}
}

// there is also a destructor function
```
