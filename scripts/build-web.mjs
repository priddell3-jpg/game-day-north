import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "public");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Keep Vercel's published output deliberately small. The repository is public,
// but the website only needs the generated page, its refreshable data and the
// locally hosted fonts; native projects and source files do not belong there.
await copyFile(join(root, "index.html"), join(output, "index.html"));
await copyFile(join(root, "data.json"), join(output, "data.json"));
await cp(join(root, "fonts"), join(output, "fonts"), { recursive: true });

console.log("built web assets in public/");
