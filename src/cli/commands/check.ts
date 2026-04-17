import type { Command } from "commander";

export function registerCheck(program: Command): void {
	program
		.command("check")
		.description("Type-check and effect-check .rd source files")
		.argument("[files...]", "source files to check")
		.option("--json", "output diagnostics as JSON-Lines")
		.action((_files: string[], options: { json?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "check" }));
			} else {
				console.log("radahn check: not yet implemented");
			}
		});
}
