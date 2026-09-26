import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

// The reviewed pin authorizes the bytes before tar sees them. Do not fetch a
// checksum from the same response or rely on an older CLI's embedded catalog.
export async function downloadDevnode(
  artifact,
  destination,
  signal,
  fetcher = fetch,
) {
  const response = await fetcher(artifact.url, {
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
  });
  if (response.status !== 200 || !response.body) {
    throw new Error(`Devnode download returned HTTP ${response.status}`);
  }
  const chunks = [];
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > artifact.size)
      throw new Error("Devnode archive exceeds pinned size");
    hash.update(chunk);
    chunks.push(chunk);
  }
  if (size !== artifact.size) throw new Error("Devnode archive size mismatch");
  if (hash.digest("hex") !== artifact.sha256) {
    throw new Error("Devnode archive checksum mismatch");
  }
  await writeFile(destination, Buffer.concat(chunks), {
    flag: "wx",
    mode: 0o600,
  });
}
