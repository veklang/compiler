# IR Control Flow

## Blocks

Functions contain basic blocks.

```ts
interface IrBlock {
  id: IrBlockId;
  instructions: IrInstruction[];
  terminator?: IrTerminator;
}
```

Rules:

- Every block has exactly one terminator.
- Blocks do not fall through.
- Instructions inside one block execute in order.
- Terminators transfer control or leave the function.
- A block may be unreachable, but unreachable blocks should be removed before C
  emission when practical.
- Block ids are assigned in lowering order and are used as jump targets.
  Recommended form: `bb.N` where N is the block's index in the function's block
  list.

## Terminators

```ts
type IrTerminator =
  | IrReturn
  | IrBranch
  | IrCondBranch
  | IrSwitch
  | IrUnreachable;
```

### Return

```ts
interface IrReturn {
  kind: "return";
  value?: IrOperand;
  span?: Span;
}
```

Rules:

- `value` is absent only for `void` functions.
- Return type compatibility has already been checked.
- Ownership lowering must release owned locals before `return` if required.

### Unconditional Branch

```ts
interface IrBranch {
  kind: "branch";
  target: IrBlockId;
  span?: Span;
}
```

An unconditional jump to another block in the same function. The target block
must exist in `IrFunction.blocks`.

### Conditional Branch

```ts
interface IrCondBranch {
  kind: "cond_branch";
  condition: IrOperand;
  thenTarget: IrBlockId;
  elseTarget: IrBlockId;
  span?: Span;
}
```

`condition` must have type `bool`. Both `thenTarget` and `elseTarget` must exist
in `IrFunction.blocks`.

### Switch

```ts
interface IrSwitch {
  kind: "switch";
  value: IrOperand;
  cases: IrSwitchCase[];
  defaultTarget: IrBlockId;
  span?: Span;
}

interface IrSwitchCase {
  value: IrConst;
  target: IrBlockId;
}
```

`switch` may be used for:

- enum discriminator tags (integer)
- integer literal match arms
- boolean literal match arms

All case targets and `defaultTarget` must exist in `IrFunction.blocks`.

The lowerer may use chains of `cond_branch` instead of `switch` when there are
two or fewer cases. Switch is preferred for three or more cases.

### Unreachable

```ts
interface IrUnreachable {
  kind: "unreachable";
  span?: Span;
}
```

Used after calls that cannot return, such as `panic`. The C emitter must emit
`__builtin_unreachable()` or equivalent.

## Control Flow Invariants

- Every block in a defined function must have a terminator.
- Terminator targets must be blocks in the same function.
- A block may be jumped to by any number of predecessors, including zero
  (unreachable blocks).
- The first block in `IrFunction.blocks` is the entry block. It has no
  predecessors in the IR representation (the caller is outside the function).
- The lowerer must ensure every execution path that does not exit via `return`
  or `unreachable` is terminated with a `branch` to a join or exit block.

## Block Ordering Convention

The lowerer creates blocks in the following canonical order for each construct:

### If

```
entry_block:
  %cond = ...
  cond_branch %cond, then_block, else_or_join_block

then_block:
  ...
  branch join_block

else_block:           (only if else branch present)
  ...
  branch join_block

join_block:
  ...
```

If the then or else branch terminates (via return or unreachable), it does not
emit a `branch` to `join_block`. If both branches terminate, `join_block` is
unreachable and may be omitted by an optimizer.

`else if` chains are represented by nesting: the outer `else_block` becomes the
entry of the inner if construct, and each inner join block branches to the outer
join block.

### While

```
entry_block:
  branch condition_block

condition_block:
  %cond = ...
  cond_branch %cond, body_block, exit_block

body_block:
  ...
  branch condition_block   (or: unreachable after panic, branch condition_block after continue)

exit_block:
  ...
```

`break` inside the body lowers to `branch exit_block`.
`continue` inside the body lowers to `branch condition_block`.

Nested loops each have their own `exit_block` and `condition_block`. The
lowerer tracks the innermost loop's exit and continue targets.

### For (array)

```
entry_block:
  %len = array_len array
  store %index_local, 0
  branch condition_block

condition_block:
  %i = load %index_local
  %more = binary lt %i, %len
  cond_branch %more, body_block, exit_block

body_block:
  %item = array_get array, %i
  assign %item_local, %item
  ...
  %next = binary add %i, 1
  assign %index_local, %next
  branch condition_block

exit_block:
  ...
```

`break` and `continue` follow the same rules as for while loops.

### For (custom Iterable)

```
entry_block:
  %iter_value = ...
  assign %iter_local, %iter_value
  branch condition_block

condition_block:
  %next = call @Owner_next, %iter_local
  %done = is_null %next
  cond_branch %done, exit_block, body_block

body_block:
  %item = unwrap_nullable %next
  assign %item_local, %item
  ...
  branch condition_block

exit_block:
  ...
```

The `next` method is the emitted concrete method for the iterable owner and
must have shape `next(mut self) -> T?`. Mutable parameters emit as C pointers,
so the hidden iterator local is advanced by each call.

`break` and `continue` follow the same rules as for while loops. `continue`
branches to `condition_block`, which calls `next` again.

### Match Statement

Enum match:

```
entry_block:
  %tag = get_tag %scrutinee
  switch %tag, cases: [0 -> arm_A, 1 -> arm_B, ...], default -> wildcard_block

arm_A:
  ... (extract payload if needed, bind names, lower body)
  branch join_block

arm_B:
  ...
  branch join_block

wildcard_block:        (wildcard or identifier arm, if present)
  ... (bind name if identifier, lower body)
  branch join_block

join_block:
  ...
```

Nullable match:

```
entry_block:
  %is_null = is_null %scrutinee
  cond_branch %is_null, null_block, non_null_block

null_block:
  ... (lower null arm body)
  branch join_block

non_null_block:
  %inner = unwrap_nullable %scrutinee
  ... (bind name, lower non-null arm body)
  branch join_block

join_block:
  ...
```

Literal match:

```
entry_block:
  %eq0 = binary eq %scrutinee, literal_0
  cond_branch %eq0, arm_0, check_1

check_1:
  %eq1 = binary eq %scrutinee, literal_1
  cond_branch %eq1, arm_1, wildcard_block

arm_0:
  ...
  branch join_block

arm_1:
  ...
  branch join_block

wildcard_block:
  ...
  branch join_block

join_block:
  ...
```

### Short-Circuit Operators

`&&` must preserve short-circuit evaluation:

```
entry_block:
  %a = ...
  cond_branch %a, eval_b_block, false_block

eval_b_block:
  %b = ...
  store %result_local, %b
  branch join_block

false_block:
  store %result_local, false
  branch join_block

join_block:
  %result = load %result_local
```

`||` is analogous with the early branch storing `true`.

### Match Expressions

Match expressions follow the same block structure as match statements, but each
arm stores its result into a compiler-generated local before branching to the
join block:

```
arm_block:
  %val = ...
  store %match_result_local, %val
  branch join_block

join_block:
  %result = load %match_result_local
```
