import { resolve } from "node:path";

export interface DatabaseCommandPaths {
  migrationsDirectory: string;
}

function optionValue(arguments_: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsArgument = arguments_.find((argument) => argument.startsWith(equalsPrefix));
  if (equalsArgument) return equalsArgument.slice(equalsPrefix.length);

  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a directory path.`);
  }
  return value;
}

export function databaseCommandPaths(arguments_: readonly string[]): DatabaseCommandPaths {
  const supported = new Set(["--migrations-dir"]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument?.startsWith("--")) continue;
    const name = argument.split("=", 1)[0];
    if (!name || !supported.has(name)) throw new Error(`Unknown option: ${argument}`);
    if (!argument.includes("=")) index += 1;
  }

  return {
    migrationsDirectory: resolve(optionValue(arguments_, "--migrations-dir") ?? "db/migrations"),
  };
}
