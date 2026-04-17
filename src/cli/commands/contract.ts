import type { Command } from "commander";

export function registerContract(program: Command): void {
	program
		.command("contract")
		.description("Display the contract for a symbol")
		.argument("<symbol>", "symbol to look up")
		.option("--json", "output contract as JSON")
		.action((_symbol: string, options: { json?: boolean }) => {
			if (options.json) {
				console.log(JSON.stringify({ status: "not_implemented", command: "contract" }));
			} else {
				console.log("radahn contract: not yet implemented");
			}
		});
}
