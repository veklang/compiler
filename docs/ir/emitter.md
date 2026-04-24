# IR C Emitter Contract

The C emitter consumes emittable IR.

It is responsible for:

- choosing C declarations for IR types
- emitting prototypes
- emitting function definitions
- emitting runtime includes
- emitting runtime calls
- emitting block labels and gotos
- emitting C-safe names
- preserving evaluation order represented by IR
- emitting explicit retain/release instructions as runtime calls

It is not responsible for:

- name resolution
- type checking
- overload resolution
- trait satisfaction
- match exhaustiveness
- nullable narrowing
- generic specialization selection
- deciding whether a mutation is legal
- inserting copy-on-write detach operations
- inserting missing retain/release operations for supported heap-backed features

## C Type Mapping

| IR type | C type |
| --- | --- |
| `void` | `void` |
| `bool` | `bool` from `stdbool.h` |
| `i8` | `int8_t` |
| `i16` | `int16_t` |
| `i32` | `int32_t` |
| `i64` | `int64_t` |
| `u8` | `uint8_t` |
| `u16` | `uint16_t` |
| `u32` | `uint32_t` |
| `u64` | `uint64_t` |
| `f32` | `float` |
| `f64` | `double` |
| `null` | `void *` |
| `string` | `__vek_string *` |
| `Array<T>` named type | erased runtime array pointer |
| `nullable<T>` | representation chosen per emitter (struct with tag, or pointer for pointer-like T) |
| tuple | generated `struct` |
| struct | generated `struct` |
| enum | generated tagged `struct` with discriminator + payload union |
| function | function pointer |
| `unknown` / `error` | invalid in emittable IR |

Function pointer declarations use C declarators rather than a plain type string
so function values can appear consistently in parameters, locals, globals, and
return positions.

Examples:

```c
int32_t (*f)(int32_t);
static int32_t (*choose(void))(int32_t);
```

## Control Flow Emission

Blocks lower to C labels. All blocks in a multi-block function get a label, even
if never jumped to (unreachable labels are harmless in C).

```c
bb_0:
  ...
  if (cond) goto bb_1; else goto bb_2;

bb_1:
  ...
  goto bb_3;

bb_2:
  ...
  goto bb_3;

bb_3:
  ...
  return;
```

Terminator mappings:

| IR terminator | C emission |
| --- | --- |
| `return` (void) | `return;` |
| `return value` | `return expr;` |
| `branch target` | `goto bb_N;` |
| `cond_branch cond, then, else` | `if (cond) goto bb_T; else goto bb_E;` |
| `switch val, cases, default` | C `switch` statement |
| `unreachable` | `__builtin_unreachable();` |

Single-block functions may omit labels as an optimization. Multi-block functions
must emit labels for all blocks.

## C Name Rules

All emitted names follow fixed patterns to avoid collisions with user code and
the C runtime.

| Category | Pattern |
| --- | --- |
| Vek function | `__vek_fn_<linkName>` |
| Block label | `bb_<N>` (underscores, not dots) |
| Local variable | `v<N>` (from `local.N`) |
| Temporary | `t<N>` (from `tmp.N`) |
| Runtime helper | `__vek_*` (owned by runtime repo) |

User-visible source names must be sanitized to be C-safe before use in link
names.

## Runtime Boundary

All runtime symbols emitted by the C emitter must use the reserved `__vek_*`
prefix.

The runtime repo owns:

- the canonical runtime source
- the generated single-header artifact `dist/vek_runtime.h`
- smoke tests for runtime helpers

The compiler repo owns:

- generated C
- calls to runtime symbols
- declarations of what runtime symbols are required
- packaging or writing the runtime header next to generated C

Generated C must include the runtime as a single-header library. Exactly one
generated translation unit must define `VEK_RUNTIME_IMPLEMENTATION` before
including `vek_runtime.h`.

```c
#define VEK_RUNTIME_IMPLEMENTATION
#include "vek_runtime.h"
```

No prebuilt runtime library is required. The runtime implementation is compiled
by the user's chosen C toolchain together with the generated program.

The default runtime header path for local development:

```text
../runtime/dist/vek_runtime.h
```

The compiler CLI accepts an explicit `--runtime-header` flag to override this.
