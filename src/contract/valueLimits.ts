import type { CodecLimits } from "@thruputchain/xdr";

// Contract values retain the SDK's absolute work cap. General protocol reads
// use the base decoder's byte-relative budget instead.
export function contractValueLimits(inputBytes: number): CodecLimits {
  return {
    maxDepth: 128,
    maxWork: Math.min(100_000, 1024 + 16 * inputBytes),
  };
}
