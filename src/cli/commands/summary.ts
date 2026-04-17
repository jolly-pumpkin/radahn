import type { Command } from "commander";

export function registerSummary(program: Command): void {
	program
		.command("summary")
		.description("Display a compact module summary")
		.argument("<module>", "module to summarize")
		.option("--json", "output summary as JSON")
		.action((_module: string, options: { json?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "summary" }));
			} else {
				console.log("radahn summary: not yet implemented");
			}
		});
}
