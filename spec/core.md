# Core

```
// exiting the program
exit

// you can also exit with a status code (default is 0, code: uint8)
exit 69

// conditionals
if 1 == 1 { // any expression can be used
  // congrats, math still works as intended
} else {
  // wtf
}
// else if also works

match 50 {
  1 => {},
  50 => {},
  x => {},
}

// loops (continue and break also works)
while true {}
for i in 0..9 {}
for val in [6, 9, 4, 2, 0] {}
```
