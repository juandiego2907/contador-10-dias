// Syntax-checks every JS file in the project (no dependencies).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const files = ["backend/worker.js", "dev/server.mjs", ...fs.readdirSync("js").map((f) => "js/" + f)];
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`ok · ${files.length} files`);
