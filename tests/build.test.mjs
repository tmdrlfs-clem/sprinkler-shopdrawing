import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHtml, buildScript } from "../build.mjs";

const html = buildHtml();

test("the built page is one self-contained file", () => {
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.trimEnd().endsWith("</html>"));
  const local = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^https:\/\//.test(u));
  assert.deepEqual(local, [], `the page should pull nothing from disk: ${local.join(", ")}`);
});

test("every outside dependency is pinned to a known host", () => {
  const urls = [...html.matchAll(/https:\/\/[^"')\s]+/g)].map(m => m[0]);
  const hosts = new Set(urls.map(u => new URL(u).host));
  for (const h of hosts) {
    assert.ok(["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(h),
      `unexpected host ${h}`);
  }
  assert.ok(urls.some(u => /pdf\.js|pdf\.min\.js/.test(u)), "pdf.js must be loaded");
  assert.ok(urls.some(u => /pdf-lib/.test(u)), "pdf-lib must be loaded, for writing the PDF");
});

test("the script parses as a whole", () => {
  assert.doesNotThrow(() => new Function(buildScript()));
});

test("the interface carries no leftover Korean", () => {
  const hangul = html.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /[가-힣]/.test(l));
  assert.deepEqual(hangul.map(([n]) => n), [], "the app ships in English");
});

test("the shipped copy matches a fresh build", () => {
  const dist = readFileSync(new URL("../dist/sprinkler-shop-drawing-drafter.html", import.meta.url), "utf8");
  assert.equal(dist, html, "run `node build.mjs` — dist is stale");
});
