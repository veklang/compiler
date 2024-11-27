# Functions

## Declaration

```
// fn, name, arguments, return type
// return type can be unspecified if you are returning nothing, or you can use `void`
fn add(x: int, y: int): int {
  return x + y
}

const value = add(69, 420)
```

## Inlining

```
// inline functions write the body of the function directly to where you're calling it
// this is good to save stack space and runtime if the function is small
inline fn add(x: int, y: int): int {
  return x + y
}

const value = add(69, 420)

// this is effectively the same as
const value = 69 + 420
```

## Functions as values

```
// function pointers are not allowed due to memory safety
// instead we pass in the function itself
fn nothing() {}

fn func_caller(func: callable<[], void>) {
  func()
}

func_caller(nothing)

// you can also make anonymous functions
func_caler(fn() {})
```
