import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const sourceHtml = await readFile(join(root, "index.html"), "utf8");
const nativeScript = '<script src="./native-bridge.js"></script>\n';
if (!sourceHtml.includes("</head>")) throw new Error("index.html has no closing head tag");
await writeFile(join(output, "index.html"), sourceHtml.replace("</head>", nativeScript + "</head>"));

await copyFile(join(root, "data.json"), join(output, "data.json"));
await cp(join(root, "fonts"), join(output, "fonts"), { recursive: true });

await build({
  entryPoints: [join(root, "src", "native-bridge.js")],
  outfile: join(output, "native-bridge.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari15",
  minify: true,
  sourcemap: false,
  legalComments: "none"
});

console.log("built bundled iOS web assets in dist/");
