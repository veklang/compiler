import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildToolchainCommand,
  compileFile,
  defaultToolchainPrefix,
  parseCliArgs,
} from "@/index";
import { assert } from "./helpers";
import { describe, test } from "./tester";

const withTempFile = (source: string, run: (filePath: string) => void) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vek-cli-test-"));
  try {
    const filePath = path.join(root, "main.vek");
    fs.writeFileSync(filePath, source, "utf8");
    run(filePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe("cli", () => {
  test("parses source path and optional backend flags", () => {
    const options = parseCliArgs([
      "main.vek",
      "--runtime-header",
      "../runtime/dist/vek_runtime.h",
      "--toolchain-prefix",
      "cc -O2",
      "--preserve-temp",
    ]);

    assert.equal(options.sourcePath, path.resolve("main.vek"));
    assert.equal(
      options.runtimeHeaderPath,
      path.resolve("../runtime/dist/vek_runtime.h"),
    );
    assert.equal(options.toolchainPrefix, "cc -O2");
    assert.equal(options.preserveTemps, true);
    assert.equal(options.outputPath, path.resolve("main"));
  });

  test("uses the default musl-oriented toolchain prefix", () => {
    const options = parseCliArgs(["main.vek"]);

    assert.equal(options.toolchainPrefix, defaultToolchainPrefix);
    assert.ok(options.toolchainPrefix.startsWith("musl-gcc "));
    assert.ok(options.toolchainPrefix.includes("-static"));
  });

  test("appends emitted C path and output path to the toolchain prefix", () => {
    const command = buildToolchainCommand(
      "musl-gcc -O3",
      "/tmp/a file.c",
      "/tmp/a file",
    );

    assert.equal(command, "musl-gcc -O3 '/tmp/a file.c' -o '/tmp/a file'");
  });

  test("can preserve emitted C while using a fake successful toolchain", () => {
    withTempFile(
      `
fn main() -> void {
  return;
}
`,
      (filePath) => {
        const options = {
          ...parseCliArgs([
            filePath,
            "--toolchain-prefix",
            "true",
            "--preserve-temp",
          ]),
        };
        const result = compileFile(options);

        try {
          assert.equal(fs.existsSync(result.cPath), true);
          assert.equal(
            fs.readFileSync(result.cPath, "utf8").includes("int main(void)"),
            true,
          );
        } finally {
          fs.rmSync(result.tempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
