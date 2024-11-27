# Variables

## Declarations/Assignments

```
let num: uint = 42 // typed
let hi = "mom" // type inference

const my_const = "fire" // constants

num = 69
my_const = "lol" // comptime error: cannot re-assign a constant
num = "a" // comptime error: cannot assign `string` to `uint`
```

## Pointers

```
let str = "hi mom"
let *strptr = &str

// types can also be used like this
let strptr_typed: *string = &str
let *strptr_typed_2: string = &str

// dereferencing
let deref_str = *strptr

// note: you cannot make pointers to pointers because it is stupid
```
