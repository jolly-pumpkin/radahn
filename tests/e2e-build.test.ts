import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const TMP = join(import.meta.dir, ".tmp-e2e");
const OUTDIR = join(TMP, "dist");

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("end-to-end", () => {
	test("console.log via extern prints to stdout", async () => {
		rmSync(TMP, { recursive: true, force: true });
		mkdirSync(TMP, { recursive: true });
		const srcFile = join(TMP, "hello.rd");
		writeFileSync(srcFile, `module hello
end-module

extern module console {
  fn log(msg: String) -> () ! { log }
}

fn main() -> () ! { log } {
  log("hello from radahn")
}

main()
`);

		const buildResult = await $`bun src/cli.ts build ${srcFile} --outdir ${OUTDIR}`.quiet().nothrow();
		expect(buildResult.exitCode).toBe(0);

		const runResult = await $`bun ${join(OUTDIR, "hello.ts")}`.quiet().nothrow();
		expect(runResult.stdout.toString().trim()).toBe("hello from radahn");
	});

	test("sum type construction + match returns correct value", async () => {
		rmSync(TMP, { recursive: true, force: true });
		mkdirSync(TMP, { recursive: true });
		const srcFile = join(TMP, "sumtype.rd");
		writeFileSync(srcFile, `module sumtype
end-module

extern module console {
  fn log(msg: String) -> () ! { log }
}

type Color = | Red | Green | Blue

fn color_code(c: Color) -> Int {
  match c {
    Red() => 1
    Green() => 2
    Blue() => 3
  }
}

log(color_code(Green()))
`);

		const buildResult = await $`bun src/cli.ts build ${srcFile} --outdir ${OUTDIR}`.quiet().nothrow();
		expect(buildResult.exitCode).toBe(0);

		const runResult = await $`bun ${join(OUTDIR, "sumtype.ts")}`.quiet().nothrow();
		expect(runResult.stdout.toString().trim()).toBe("2");
	});

	test("generic function with concrete types", async () => {
		rmSync(TMP, { recursive: true, force: true });
		mkdirSync(TMP, { recursive: true });
		const srcFile = join(TMP, "generic.rd");
		writeFileSync(srcFile, `module generic
end-module

extern module console {
  fn log(msg: String) -> () ! { log }
}

fn identity[T](x: T) -> T {
  x
}

log(identity(42))
`);

		const buildResult = await $`bun src/cli.ts build ${srcFile} --outdir ${OUTDIR}`.quiet().nothrow();
		expect(buildResult.exitCode).toBe(0);

		const runResult = await $`bun ${join(OUTDIR, "generic.ts")}`.quiet().nothrow();
		expect(runResult.stdout.toString().trim()).toBe("42");
	});

	test("declaration ordering with forward references", async () => {
		rmSync(TMP, { recursive: true, force: true });
		mkdirSync(TMP, { recursive: true });
		const srcFile = join(TMP, "ordering.rd");
		writeFileSync(srcFile, `module ordering
end-module

extern module console {
  fn log(msg: String) -> () ! { log }
}

fn first() -> Int {
  second()
}

fn second() -> Int {
  42
}

log(first())
`);

		const buildResult = await $`bun src/cli.ts build ${srcFile} --outdir ${OUTDIR}`.quiet().nothrow();
		expect(buildResult.exitCode).toBe(0);

		const runResult = await $`bun ${join(OUTDIR, "ordering.ts")}`.quiet().nothrow();
		expect(runResult.stdout.toString().trim()).toBe("42");
	});
});
