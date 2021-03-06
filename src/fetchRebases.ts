import axios from "axios";
import * as fs from "fs/promises";

interface Rebase {
  terraTx: string;
  redeemed: boolean | null;
}

interface Txs {
  data: {
    txs: {
      txhash: string;
    }[];
  };
}

export const fetchRebases = async (): Promise<void> => {
  const txs: Txs = await axios.get(
    "https://api.extraterrestrial.money/v1/txs/by_account?account=terra12dt7sfw3wkuhh2ys6cj8a5glrzpxdhdgyt6j24"
  );

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
      redeemed: null,
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
