import type { Command } from "commander";

export function registerBuild(program: Command): void {
	program
		.command("build")
		.description("Compile .rd source files to TypeScript")
		.argument("[files...]", "source files to compile")
		.option("--json", "output results as JSON")
		.action((_files: string[], options: { json?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "build" }));
			} else {
				console.log("radahn build: not yet implemented");
			}
		});
}
