import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import { Connection, Keypair } from "@solana/web3.js";
import { LCDClient } from "@terra-money/terra.js";
import axios from "axios";
import * as fs from "fs/promises";

interface Rebase {
  terraTx: string;
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

  const rebases: Rebase[] = JSON.parse(rawFile.toString()) as Rebase[];

  const rebaseSet = new Set<string>();
  rebases.forEach((r) => rebaseSet.add(r.terraTx));

  const newRebases = await Promise.all(
    (
      txs.data.txs.filter(
        (tx: { txhash: string }) => !rebaseSet.has(tx.txhash)
      ) as { txhash: string }[]
    ).map(async ({ txhash }) => ({
      terraTx: txhash,
    }))
  );
  await fs.writeFile(
    "data/rebases.json",
    JSON.stringify(rebases.concat(newRebases.reverse()), null, 2)
  );

  console.log(`Discovered and wrote ${newRebases.length} rebases`);
};

fetchRebases().catch((err) => {
  console.error(err);
});
