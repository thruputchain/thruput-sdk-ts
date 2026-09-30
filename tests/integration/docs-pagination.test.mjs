import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  PrivateKeySigner,
  localnet,
  gasAmount,
  toHex0x,
} from "@groundhogchain/client";
import { ERC20, groundhog_erc20_if } from "@groundhogchain/client/contracts";
import { loadLocalDevAccount } from "@groundhogchain/client/local-dev";
import { HOG_ADDRESS } from "@groundhogchain/protocol";
import { scanEventHistory } from "../../examples/event-history.ts";

test(
  "documentation checkpoint loop recovers and discovers later blocks",
  { timeout: 120_000 },
  async () => {
    const client = await createGroundhogClient({
      cluster: localnet({ rpcUrl: process.env.GROUNDHOG_RPC_URL }),
    });
    const setup = await createGroundhogClient({
      cluster: localnet({
        rpcUrl:
          process.env.GROUNDHOG_SETUP_RPC_URL ?? process.env.GROUNDHOG_RPC_URL,
      }),
    });
    const account = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    const wallet = createWalletClient({ client: setup, account });
    const funded = await wallet.requestAirdrop();
    assert.equal(funded.status.result, "ok");
    const recipient = await loadLocalDevAccount();
    const receipts = [];
    const send = async () => {
      const call = ERC20.v0_1.transfer.call({
        contract: HOG_ADDRESS,
        gasLimit: gasAmount(500_000n),
        args: { receiver: recipient.address, amount: 1_000n },
      });
      const result = await wallet.executeCallsAndWait({
        calls: [call, call],
        gasLimit: gasAmount(3_000_000n),
      });
      receipts.push(result.receipt);
    };
    await send();
    await send();
    const { TransferEvent } = groundhog_erc20_if.v0_1.events;
    const query = {
      filters: [
        TransferEvent.filter({
          contractAddresses: [HOG_ADDRESS],
          topics: { from: account.address },
        }),
      ],
      order: "ascending",
      anchor: "beginning",
      limit: 1,
    };
    const key = (row) => `${toHex0x(row.txHash)}:${row.sequenceNumber}`;
    let progress;
    let saves = 0;
    let stopAfter = 1;
    let rows = new Map();
    const store = {
      async load() {
        return structuredClone(progress);
      },
      async savePage(pageRows, nextProgress) {
        if (saves === stopAfter)
          throw new Error("simulated process interruption");
        const nextRows = new Map(rows);
        for (const row of pageRows)
          nextRows.set(key(row), structuredClone(row));
        rows = nextRows;
        progress = structuredClone(nextProgress);
        saves += 1;
      },
    };
    await assert.rejects(
      scanEventHistory(client, store, query),
      /process interruption/,
    );
    assert.equal(rows.size, 1);
    assert.ok(progress.query.cursor.length > 0);
    await send(); // Added after the saved historical walk began.
    stopAfter = Infinity;
    await scanEventHistory(client, store, query);
    assert.equal(rows.size, 4, "saved cursor must not absorb the later block");
    assert.equal(progress.complete, true);
    await scanEventHistory(client, store, query);
    assert.equal(
      rows.size,
      6,
      "fresh scan must find the later block without duplicate rows",
    );
    const expected = receipts.flatMap((receipt) =>
      receipt.events.flatMap((event, sequenceNumber) =>
        TransferEvent.decode(event)
          ? [`${toHex0x(receipt.txHash)}:${sequenceNumber}`]
          : [],
      ),
    );
    assert.deepEqual([...rows.keys()].sort(), expected.sort());
    let cursor = new Uint8Array();
    const refs = [];
    for (let pages = 0; pages < 10; pages += 1) {
      const page = await client.getTransactionsByAddress({
        address: account.address,
        order: "ascending",
        anchor: "beginning",
        cursor,
        limit: 1,
      });
      refs.push(...page.refs.map((ref) => toHex0x(ref.txHash)));
      cursor = page.cursor;
      if (cursor.length === 0) break;
    }
    assert.equal(cursor.length, 0);
    assert.deepEqual(
      refs.sort(),
      receipts.map((receipt) => toHex0x(receipt.txHash)).sort(),
    );
  },
);
