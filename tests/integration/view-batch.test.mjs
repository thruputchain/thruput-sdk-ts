import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGroundhogClient,
  GroundhogRpcErrorCode,
  HttpTransport,
  JsonRpcError,
} from "@groundhogchain/client";
import { ERC20 } from "@groundhogchain/client/contracts";
import { loadLocalDevAccount } from "@groundhogchain/client/local-dev";
import { HOG_ADDRESS, contractAddress } from "@groundhogchain/protocol";

test("typed shared-snapshot reads against a matching live node", async () => {
  const rpcUrl = process.env.GROUNDHOG_RPC_URL;
  assert.ok(rpcUrl, "Set GROUNDHOG_RPC_URL to a server with viewBatch support");
  const account = await loadLocalDevAccount();
  const client = await createGroundhogClient({
    transport: new HttpTransport(rpcUrl),
  });
  const tip = await client.getChainTip();
  const snapshot = await client.readViews({
    calls: [
      ERC20.getBalanceOf.viewRequest({
        contract: HOG_ADDRESS,
        args: { addr: account.address },
      }),
      ERC20.getBalance.viewRequest({
        contract: HOG_ADDRESS,
        caller: account.address,
      }),
      ERC20.totalSupply.viewRequest({
        contract: contractAddress(new Uint8Array(32)),
      }),
    ],
    minHeight: tip.height,
  });
  assert.ok(snapshot.height >= tip.height);
  const [explicit, caller, missing] = snapshot.results;
  assert.equal(explicit.kind, "return");
  assert.equal(caller.kind, "return");
  assert.equal(explicit.value, caller.value);
  assert.ok(explicit.value > 0n);
  assert.equal(missing.kind, "fault");
  assert.ok(
    snapshot.results.every((result) => result.height === snapshot.height),
  );
  await assert.rejects(
    client.readViews({
      calls: [
        ERC20.getBalance.viewRequest({
          contract: HOG_ADDRESS,
          caller: account.address,
        }),
      ],
      minHeight: snapshot.height + 100_000n,
    }),
    (error) => {
      assert.ok(error instanceof JsonRpcError);
      assert.equal(error.code, GroundhogRpcErrorCode.ViewHeightUnavailable);
      assert.equal(BigInt(error.data.requested), snapshot.height + 100_000n);
      assert.ok(BigInt(error.data.observed) < snapshot.height + 100_000n);
      return true;
    },
  );
});
