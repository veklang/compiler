import {
  logFailure,
  logHeader,
  logSuite,
  logSummary,
  logTestResult,
} from "./logger";

export type TestFn = () => void | Promise<void>;

interface TestCase {
  name: string;
  fn: TestFn;
}

const tests: TestCase[] = [];
const suiteStack: string[] = [];
const suiteNames = new Set<string>();

export const describe = (name: string, fn: () => void) => {
  suiteStack.push(name);
  suiteNames.add(suiteStack.join(" / "));
  fn();
  suiteStack.pop();
};

export const test = (name: string, fn: TestFn) => {
  const prefix = suiteStack.length ? `${suiteStack.join(" / ")} / ` : "";
  tests.push({ name: `${prefix}${name}`, fn });
};

export const run = async () => {
  logHeader("lexer + parser");

  const start = process.hrtime.bigint();
  let passed = 0;
  let failed = 0;
  const suites = Array.from(suiteNames.values()).sort();

  for (const suite of suites) {
    logSuite(suite);
    for (const t of tests.filter((item) =>
      item.name.startsWith(`${suite} / `),
    )) {
      const testStart = process.hrtime.bigint();
      try {
        await t.fn();
        const duration =
          Number(process.hrtime.bigint() - testStart) / 1_000_000;
        logTestResult(t.name.replace(`${suite} / `, ""), true, duration);
        passed++;
      } catch (error) {
        const duration =
          Number(process.hrtime.bigint() - testStart) / 1_000_000;
        logTestResult(t.name.replace(`${suite} / `, ""), false, duration);
        logFailure(t.name, error);
        failed++;
      }
    }
  }

  const total = passed + failed;
  const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
  logSummary(total, passed, failed, duration);

  if (failed > 0) process.exit(1);
};
