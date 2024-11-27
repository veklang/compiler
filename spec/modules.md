## Modules

```
// modules are simply vek files
// you can export things to make them importable from other files

// file1.vek
export const pi = 3.14

// file2.vek
import { pi } from "./file1.vek"
import io from "std:io"

io.println(pi)

// you can also export default, just like in js, so you can do this

// pi.vek
export default 3.14

// main.vek
import pi from "./pi.vek"
```
