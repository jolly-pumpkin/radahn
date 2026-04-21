import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const TMP = join(import.meta.dir, ".tmp-build-test");

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("radahn build", () => {
	test("emits .ts and .d.ts to --outdir", async () => {
		rmSync(TMP, { recursive: true, force: true });
		mkdirSync(TMP, { recursive: true });
		const outdir = join(TMP, "dist");
		const srcFile = join(TMP, "hello.rd");
		writeFileSync(srcFile, `module hello\nend-module\npub fn greet() -> () {\n}\n`);

		const result = await $`bun src/cli.ts build ${srcFile} --outdir ${outdir}`.quiet();
		expect(result.exitCode).toBe(0);

		expect(existsSync(join(outdir, "hello.ts"))).toBe(true);
		expect(existsSync(join(outdir, "hello.d.ts"))).toBe(true);

		const ts = readFileSync(join(outdir, "hello.ts"), "utf-8");
		expect(ts).toContain("export function greet");
	});

	test("exits 1 with no input files", async () => {
		const result = await $`bun src/cli.ts build`.quiet().nothrow();
		expect(result.exitCode).toBe(1);
	});

	test("default outdir is dist/", async () => {
		rmSync("dist", { recursive: true, force: true });
		const srcFile = join(TMP, "default.rd");
		mkdirSync(TMP, { recursive: true });
		writeFileSync(srcFile, `module default_test\nend-module\nfn f() -> () {\n}\n`);

		const result = await $`bun src/cli.ts build ${srcFile}`.quiet();
		expect(result.exitCode).toBe(0);
		expect(existsSync("dist/default.ts")).toBe(true);
		rmSync("dist", { recursive: true, force: true });
	});
});
