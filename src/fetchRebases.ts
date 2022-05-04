import {
  CHAIN_ID_TERRA,
  getEmitterAddressTerra,
  getSignedVAA,
  importCoreWasm,
  setDefaultWasm,
} from "@certusone/wormhole-sdk";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import { Connection, PublicKey } from "@solana/web3.js";
import type { TxInfo } from "@terra-money/terra.js";
import { LCDClient } from "@terra-money/terra.js";
import axios from "axios";
import * as fs from "fs/promises";
import { chunk } from "lodash";
import invariant from "tiny-invariant";

interface Rebase {
  terraTx: string;
}

interface Txs {
  data: {
    txs: {
      txhash: string;
    }[];
  };
}
interface RL {
  events: {
    attributes: {
      key: string;
      value: string;
    }[];
  }[];
}

export function parseSequenceFromLogTerra(info: TxInfo) {
  // Scan for the Sequence attribute in all the outputs of the transaction.

  try {
    const log = (JSON.parse(info.raw_log) as RL[]).at(0);
    invariant(log);
    const pair = log.events
      .flatMap((e) => e.attributes)
      .find((d) => d.key === "message.sequence");
    return pair?.value;
  } catch (err) {
    return undefined;
  }
}

const max_chunk = 50;

export const fetchRebases = async (): Promise<void> => {
  const txs: Txs = await axios.get(
    "https://api.extraterrestrial.money/v1/txs/by_account?account=terra12dt7sfw3wkuhh2ys6cj8a5glrzpxdhdgyt6j24"
  );

  // read old list, check if unredeemed have been redeemed
  const rawFile = await fs.readFile("data/rebases.json");

  const rebases: Rebase[] = JSON.parse(rawFile.toString()) as Rebase[];

  const rebaseSet = new Set<string>();
  rebases.forEach((r) => rebaseSet.add(r.terraTx));

  const newRebases = await Promise.all(
    (
      txs.data.txs.filter(
        (tx: { txhash: string }) => !rebaseSet.has(tx.txhash)
      ) as { txhash: string }[]
    ).map(({ txhash }) => ({
      terraTx: txhash,
    }))
  );

  const lcd = new LCDClient({
    URL: "https://lcd.terra.dev",
    chainID: "columbus-5",
  });
  const emitterAddress = await getEmitterAddressTerra(
    "terra10nmmwe8r3g99a9newtqa7a75xfgs2e8z87r2sf"
  );

  const connection = new Connection("https://sencha.rpcpool.com");
  setDefaultWasm("node");
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { claim_address } = await importCoreWasm();

  const getIsTransferCompletedSolana = async (signedVAA: Uint8Array) => {
    const claimAddress = claim_address(
      "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
      signedVAA
    );
    const claimInfo = await connection.getAccountInfo(
      new PublicKey(claimAddress),
      "confirmed"
    );
    return !!claimInfo;
  };

  interface Output {
    terraTx: string;
    redeemed: boolean | null;
  }

  const output: Output[] = [];

  const rebaseChunks = chunk(rebases.concat(newRebases.reverse()), max_chunk);

  for (const rb of rebaseChunks) {
    const out: Output[] = await Promise.all(
      rb.map(async (r) => {
        const info = lcd.tx.txInfo(r.terraTx);

        const sequence = parseSequenceFromLogTerra(await info);

        if (!sequence) return { terraTx: r.terraTx, redeemed: null };

        const { vaaBytes } = await getSignedVAA(
          "https://wormhole-v2-mainnet-api.certus.one",
          CHAIN_ID_TERRA,
          emitterAddress,
          sequence ?? "0",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          { transport: NodeHttpTransport() }
        );
        const complete = await getIsTransferCompletedSolana(vaaBytes);
        return { terraTx: r.terraTx, redeemed: complete };
      })
    );
    output.push(...out);
  }
  await fs.writeFile("data/rebases.json", JSON.stringify(output, null, 2));

  console.log(`Discovered and wrote ${output.length} rebases`);
};

fetchRebases().catch((err) => {
  console.error(err);
});
