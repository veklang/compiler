# Vek Compiler IR

Status: internal compiler contract.

This directory specifies the intermediate representation used by this compiler
between the checked Vek AST and C emission. It is not part of the public Vek
language specification. User code must not depend on it.

## Contents

- [program.md](./program.md) — `IrProgram`, source files, runtime requirements, identifiers, spans
- [types.md](./types.md) — `IrType` hierarchy
- [type-decls.md](./type-decls.md) — type declarations (struct, enum, tuple, array)
- [values.md](./values.md) — `IrValue`, `IrPlace`, `IrLocal`, `IrConst`
- [instructions.md](./instructions.md) — all instruction variants
- [control-flow.md](./control-flow.md) — `IrBlock`, `IrTerminator`, block structure
- [lowering.md](./lowering.md) — how AST constructs lower to IR
- [ownership.md](./ownership.md) — retain, release, detach lowering
- [emitter.md](./emitter.md) — C emitter contract and type mapping
- [validation.md](./validation.md) — validation rules, debug dump, invariants, expansion order

## Purpose

The IR exists to make Vek runtime semantics explicit before C emission.

The parser and checker work with source-shaped syntax. The C emitter must not
need to know high-level language rules such as nullable narrowing, match
coverage, method lookup, trait satisfaction, copy-on-write insertion, or generic
specialization. Those rules are resolved before or during IR lowering.

The C emitter consumes concrete IR and prints C.

## Pipeline

```text
Vek source
  -> lexer
  -> parser AST
  -> checker typed AST + symbols/types
  -> reachability
  -> monomorphization
  -> Vek IR lowering
  -> IR validation
  -> C emission
  -> C compiler + runtime
```

## Design Goals

The IR must be:

- typed
- concrete after monomorphization
- simple to validate
- simple to emit as C
- explicit about control flow
- explicit about runtime operations
- explicit about ownership operations once ownership lowering is enabled
- independent of source syntax trivia
- stable enough for tests and backend evolution

The IR must not be:

- a public ABI
- a bytecode format
- a VM instruction set
- a fully optimized SSA IR
- a second type checker
- a textual format required for compilation

The implementation may provide a textual dump for tests and debugging, but the
authoritative IR is TypeScript data structures.

## IR Levels

There is one IR model, but there are two validity levels.

### Lowered IR

Lowered IR is produced directly from the checked AST.

It may still contain:

- abstract aggregate operations such as `array_new`
- abstract runtime operations such as `panic`
- ownership-neutral value movement

It must not contain:

- parser AST nodes
- unresolved identifiers
- generic type parameters
- overloaded operators
- high-level `match`, `for`, `while`, or short-circuit expression syntax

### Emittable IR

Emittable IR is the input accepted by the C emitter.

It must satisfy every lowered IR invariant, plus:

- all functions have concrete names
- all types have concrete runtime representations or a specified C-lowering rule
- all calls have concrete targets or concrete function-value operands
- all required runtime helper calls are explicit
- all blocks are terminated
- all temporaries are defined before use
- no instruction relies on source-level control-flow semantics

Ownership operations may initially be absent for unsupported heap-backed
features. Once a feature is emitted, its required ownership operations must be
present in emittable IR rather than inferred by the C emitter.
