import { execFileSync } from "node:child_process";

const requiredNodeMajor = 22;
const requiredZigVersion = "0.14.1";
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (!Number.isInteger(nodeMajor) || nodeMajor < requiredNodeMajor) {
  console.error(`Node.js >=${requiredNodeMajor} is required; found ${process.versions.node}.`);
  process.exitCode = 1;
} else {
  console.log(`Node.js ${process.versions.node} satisfies >=${requiredNodeMajor}.`);
}

try {
  const zigVersion = execFileSync("zig", ["version"], { encoding: "utf8" }).trim();
  if (zigVersion !== requiredZigVersion) {
    console.error(`Zig ${requiredZigVersion} is required; found ${zigVersion}.`);
    process.exitCode = 1;
  } else {
    console.log(`Zig ${zigVersion} matches the pinned version.`);
  }
} catch (error) {
  console.error(`Zig ${requiredZigVersion} is required but was not executable.`);
  process.exitCode = 1;
}
