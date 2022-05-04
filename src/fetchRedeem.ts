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
import * as fs from "fs/promises";
import invariant from "tiny-invariant";

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

interface Rebase {
  terraTx: string;
}

export const fetchRedeem = async (): Promise<void> => {
  // read old list, check if unredeemed have been redeemed
  const rawFile = await fs.readFile("data/rebases.json");

  const rebases: Rebase[] = JSON.parse(rawFile.toString()) as Rebase[];

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

  for (const rebase of rebases) {
    const info = lcd.tx.txInfo(rebase.terraTx);

    const sequence = parseSequenceFromLogTerra(await info);

    if (!sequence) output.push({ terraTx: rebase.terraTx, redeemed: null });

    const { vaaBytes } = await getSignedVAA(
      "https://wormhole-v2-mainnet-api.certus.one",
      CHAIN_ID_TERRA,
      emitterAddress,
      sequence ?? "0",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      { transport: NodeHttpTransport() }
    );
    const complete = await getIsTransferCompletedSolana(vaaBytes);
    output.push({ terraTx: rebase.terraTx, redeemed: complete });
  }
  await fs.writeFile("data/redeemed.json", JSON.stringify(output, null, 2));

  console.log(`Discovered and wrote ${output.length} redemptions`);
};

fetchRedeem().catch((err) => {
  console.error(err);
});
