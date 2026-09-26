import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadDevnode } from "./integration-devnode.mjs";

const bytes = Buffer.from("pinned archive bytes");
const artifact = {
  url: "https://example.invalid/devnode.tar.gz",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

async function destination(t) {
  const directory = await mkdtemp(join(tmpdir(), "integration-devnode-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "archive.tar.gz");
}

test("writes only bytes matching the reviewed size and checksum", async (t) => {
  const path = await destination(t);
  await downloadDevnode(
    artifact,
    path,
    new AbortController().signal,
    async (url, options) => {
      assert.equal(url, artifact.url);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(bytes);
    },
  );
  assert.deepEqual(await readFile(path), bytes);
});

for (const [name, body, status, error] of [
  ["truncated archive", bytes.subarray(1), 200, /size mismatch/],
  [
    "oversized archive",
    Buffer.concat([bytes, bytes]),
    200,
    /exceeds pinned size/,
  ],
  ["wrong checksum", Buffer.alloc(bytes.length), 200, /checksum mismatch/],
  ["HTTP failure", bytes, 404, /HTTP 404/],
]) {
  test(`rejects ${name} before writing an extractable archive`, async (t) => {
    const path = await destination(t);
    await assert.rejects(
      downloadDevnode(
        artifact,
        path,
        new AbortController().signal,
        async () => new Response(body, { status }),
      ),
      error,
    );
    await assert.rejects(stat(path), { code: "ENOENT" });
  });
}
