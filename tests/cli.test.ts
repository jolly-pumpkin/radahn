import { describe, expect, test } from "bun:test";

const CLI_ENTRY = "src/cli.ts";
const SUBCOMMANDS = ["check", "build", "fmt", "contract", "summary", "locate"];

async function run(...args: string[]) {
	const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
}

describe("radahn CLI", () => {
	test("--help exits zero and lists all subcommands", async () => {
		const { exitCode, stdout } = await run("--help");
		expect(exitCode).toBe(0);
		for (const cmd of SUBCOMMANDS) {
			expect(stdout).toContain(cmd);
		}
	});

	test("--version exits zero and prints version", async () => {
		const { exitCode, stdout } = await run("--version");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("0.1.0");
	});

	describe("subcommand stubs", () => {
		for (const cmd of SUBCOMMANDS) {
			const needsArg = ["contract", "summary", "locate"].includes(cmd);

			test(`${cmd} prints stub message`, async () => {
				const args = needsArg ? [cmd, "dummy"] : [cmd];
				const { exitCode, stdout } = await run(...args);
				expect(exitCode).toBe(0);
				expect(stdout).toContain("not yet implemented");
			});

			test(`${cmd} --json outputs valid JSON`, async () => {
				const args = needsArg ? [cmd, "dummy", "--json"] : [cmd, "--json"];
				const { exitCode, stdout } = await run(...args);
				expect(exitCode).toBe(0);
				const parsed = JSON.parse(stdout.trim());
				expect(parsed.status).toBe("not_implemented");
				expect(parsed.command).toBe(cmd);
			});
		}
	});
});
