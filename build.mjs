#!/usr/bin/env node
/* Assemble the single-file app from src/.
   The tool ships as one HTML file you open in a browser, so the build is a
   concatenation and nothing more: no bundler, no transpile, no import graph.
   Source files are plain scripts that share one scope, exactly as they did
   when they lived in one file. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const order = JSON.parse(readFileSync(join(root, "src/order.json"), "utf8"));

export function buildScript() {
  return order.map(f => readFileSync(join(root, f), "utf8")).join("\n");
}

export function buildHtml() {
  const head = readFileSync(join(root, "src/shell.head.html"), "utf8");
  const tail = readFileSync(join(root, "src/shell.tail.html"), "utf8");
  return `${head}<script>\n${buildScript()}\n</script>${tail}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(root, "dist/sprinkler-shop-drawing-drafter.html");
  mkdirSync(dirname(out), { recursive: true });
  const html = buildHtml();
  writeFileSync(out, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`built ${out}  (${order.length} sources, ${kb} KB)`);
}
