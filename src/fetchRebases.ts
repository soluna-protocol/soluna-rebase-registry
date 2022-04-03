import type { ChainId } from "@certusone/wormhole-sdk";
import {
  getIsTransferCompletedSolana,
  getSignedVAA,
  parseSequenceFromLogTerra,
} from "@certusone/wormhole-sdk";
import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import { Connection, Keypair } from "@solana/web3.js";
import { LCDClient } from "@terra-money/terra.js";
import axios from "axios";
import * as fs from "fs/promises";
import invariant from "tiny-invariant";

interface Rebase {
  terraTx: string;
  redeemed: boolean;
}

export let CURRENT_WORMHOLE_RPC_HOST = -1;

export async function getSignedVAAWithRetry(
  emitterChain: ChainId,
  emitterAddress: string,
  sequence: string,
  retryAttempts?: number
) {
  const wormholeRPCHosts = [
    "https://wormhole-v2-mainnet-api.certus.one",
    "https://wormhole.inotel.ro",
    "https://wormhole-v2-mainnet-api.mcf.rocks",
    "https://wormhole-v2-mainnet-api.chainlayer.network",
    "https://wormhole-v2-mainnet-api.staking.fund",
    "https://wormhole-v2-mainnet.01node.com",
  ];
  const getNextRpcHost = () =>
    ++CURRENT_WORMHOLE_RPC_HOST % wormholeRPCHosts.length;

  let result;
  let attempts = 0;
  while (!result) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const wormholeRPCHost = wormholeRPCHosts[getNextRpcHost()];
    invariant(wormholeRPCHost);
    try {
      result = await getSignedVAA(
        wormholeRPCHost,
        emitterChain,
        emitterAddress,
        sequence
      );
    } catch (e) {
      if (retryAttempts !== undefined && attempts > retryAttempts) {
        throw e;
      }
    }
  }
  return result;
}

export async function checkIsRedeemed(
  connection: Connection,
  tx: string,
  lcd: LCDClient
) {
  const info = await lcd.tx.txInfo(tx);
  const sequence = parseSequenceFromLogTerra(info);
  // const emitterAddress = await getEmitterAddressTerra(
  //   "terra10nmmwe8r3g99a9newtqa7a75xfgs2e8z87r2sf"
  // );

  const { vaaBytes } = await getSignedVAAWithRetry(
    3,
    "0000000000000000000000007cf7b764e38a0a5e967972c1df77d432510564e2",
    "61915",
    3
  );
  console.log(vaaBytes);

  return await getIsTransferCompletedSolana(
    "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
    vaaBytes,
    connection
  );
}

// search most recent transactions and add them
// search unredeemed and check if redeemed

export const fetchRebases = async (): Promise<void> => {
  const provider = SolanaProvider.load({
    connection: new Connection("https://sencha.rpcpool.com"),
    wallet: new SignerWallet(Keypair.generate()),
  });

  const lcd = new LCDClient({
    URL: "https://lcd.terra.dev",
    chainID: "columbus-5",
  });

  const txs = await axios.get(
    "https://api.extraterrestrial.money/v1/txs/by_account?account=terra12dt7sfw3wkuhh2ys6cj8a5glrzpxdhdgyt6j24"
  );

  // read old list, check if unredeemed have been redeemed
  const rawFile = await fs.readFile("data/rebases.json");

  let rebases: Rebase[] = JSON.parse(rawFile.toString()) as Rebase[];
  rebases = await Promise.all(
    rebases.map(async (r) =>
      !r.redeemed &&
      (await checkIsRedeemed(provider.connection, r.terraTx, lcd))
        ? { ...r, redeemed: true }
        : r
    )
  );

  const rebaseSet = new Set<string>();
  rebases.forEach((r) => rebaseSet.add(r.terraTx));

  console.log(
    await checkIsRedeemed(
      provider.connection,
      "72AA1C3488129E0BEBC2BDF48181A85589FD2AD291018FB56205E154EA41984B",
      lcd
    )
  );

  // const newRebases = await Promise.all(
  //   (
  //     txs.data.txs.filter(
  //       (tx: { txhash: string }) => !rebaseSet.has(tx.txhash)
  //     ) as { txhash: string }[]
  //   ).map(async ({ txhash }) => ({
  //     terraTx: txhash,
  //     redeemed: await checkIsRedeemed(provider.connection, txhash, lcd),
  //   }))
  // );
  // console.log(newRebases);
  //todo reverse array
};

fetchRebases().catch((err) => {
  console.error(err);
});
