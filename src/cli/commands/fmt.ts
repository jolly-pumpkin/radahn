import type { Command } from "commander";

export function registerFmt(program: Command): void {
	program
		.command("fmt")
		.description("Format .rd source files")
		.argument("[files...]", "source files to format")
		.option("--json", "output results as JSON")
		.option("--check", "check formatting without modifying files")
		.action((_files: string[], options: { json?: boolean; check?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "fmt" }));
			} else {
				console.log("radahn fmt: not yet implemented");
			}
		});
}
