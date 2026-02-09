const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

export const logHeader = (title: string) => {
  const line = `${colors.cyan}${"=".repeat(60)}${colors.reset}`;
  console.log(line);
  console.log(
    `${colors.bold}${colors.cyan}Veklang Test Runner${colors.reset} ${colors.dim}- ${title}${colors.reset}`,
  );
  console.log(line);
};

export const logTestResult = (name: string, ok: boolean, ms: number) => {
  const icon = ok ? "✓" : "✗";
  const color = ok ? colors.green : colors.red;
  const time = `${ms.toFixed(2)}ms`;
  console.log(
    `${color}${icon}${colors.reset} ${name} ${colors.dim}${time}${colors.reset}`,
  );
};

export const logSuite = (name: string) => {
  console.log(`\n${colors.bold}${name}${colors.reset}`);
};

export const logSummary = (
  total: number,
  passed: number,
  failed: number,
  ms: number,
) => {
  const color = failed === 0 ? colors.green : colors.red;
  console.log(`\n${"-".repeat(60)}`);
  console.log(
    `${color}${passed}/${total} passing${colors.reset} ${colors.dim}(${failed} failing, ${ms.toFixed(2)}ms)${colors.reset}`,
  );
};

export const logFailure = (name: string, error: unknown) => {
  console.log(`${colors.red}↳ ${name}${colors.reset}`);
  if (error instanceof Error) {
    console.log(`${colors.dim}${error.stack ?? error.message}${colors.reset}`);
  } else {
    console.log(`${colors.dim}${String(error)}${colors.reset}`);
  }
};
