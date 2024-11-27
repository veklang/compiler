# Memory Management

## Dropping

```
// note: all variables, even heap-allocated ones, are automatically dropped by the end of the scope
// you almost NEVER need to manually drop stuff

let my_var = "test"
drop my_var
my_var = "hi" // comptime error: unknown identifer `my_var`

// drop can also be used for constants
const my_const = "hi"
drop my_const

// you can also drop pointers (as in, the area of memory that a pointer points to)
let value = 42
let value_ptr = &value
drop value_ptr

value // comptime error: unknown identifier `value`
value_ptr // comptime error: unknown identifier `value_ptr`
```

## Heap Allocation

```
// im trying to make the language have low-level features without making it super low-level
// you almost NEVER need to manually allocate blocks of memory

let block = alloc 69
// block is now a `void` (untyped) pointer to memory
// however, it is nullable, because if memory allocation fails, null will be returned
// so it is actually `void?`

if block == null {
  exit 69
}

block[42] = 69 // byte manipulation

// you can also cast it into a proper type
let u8_block = block as *u8[]

// and you can drop allocated blocks as theyre also pointers
drop block // this will also drop u8_block
```
