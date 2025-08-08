// Ambient Plume auto swap (loop): PLUME -> pUSD saja
// Requirements: Node 18+, `npm i ethers dotenv`
// Files: .env (RPC + LOOPS), account.txt (1 PK hex per baris, tanpa 0x juga boleh)

import 'dotenv/config';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';

const RPC_URL = process.env.PLUME_RPC ?? 'https://rpc.plume.org'; // Plume mainnet RPC
const PUSD   = '0xdddD73F5Df1F0DC31373357beAC77545dC5A6f3F';        // pUSD
const DEX    = '0xAaAaAAAA81a99d2a05eE428eC7a1d8A3C2237D85';        // CrocSwapDex on Plume

// Loop config
const LOOPS  = parseInt(process.env.LOOPS ?? '10', 10); // berapa kali ulang per wallet

// Ambient constants
const ZERO         = '0x0000000000000000000000000000000000000000'; // native token (PLUME)
const POOL_IDX     = 420;    // per Ambient docs
const SWAP_PROXY   = 1;      // userCmd callpath = 1
const TIP_BPS      = 0;      // 0 = pakai pool fee standar
const SETTLE_FLAGS = 0;      // 0 = settle langsung ke wallet

// limitPrice “maksimum” per docs
const LIMIT_MAX_ISBUY_TRUE  = ethers.toBigInt('21267430153580247136652501917186561137');

const DEX_ABI = [
  {
    inputs: [
      { internalType: 'uint16', name: 'callpath', type: 'uint16' },
      { internalType: 'bytes',  name: 'cmd',      type: 'bytes' }
    ],
    name: 'userCmd',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'payable',
    type: 'function',
  },
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randDelayMs(minS = 3, maxS = 5) {
  return (minS * 1000) + Math.floor(Math.random() * ((maxS - minS) * 1000 + 1));
}
function randAmount(min, max) {
  return (min + Math.random() * (max - min)).toFixed(6); // 6 decimal precision
}

async function swapPlumeToPUSD(signer, amountPlumeHuman) {
  const base = ZERO;
  const quote = PUSD;
  const isBuy = true;
  const inBaseQty = true;

  const qty = ethers.parseUnits(String(amountPlumeHuman), 18); // PLUME 18 desimal
  const tip = TIP_BPS;
  const limitPrice = LIMIT_MAX_ISBUY_TRUE;
  const minOut = 0n; 
  const settleFlags = SETTLE_FLAGS;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const cmd = coder.encode(
    [ 'address','address','uint256','bool','bool','uint128','uint16','uint128','uint128','uint8' ],
    [ base,    quote,   POOL_IDX,  isBuy, inBaseQty, qty,   tip,     limitPrice,  minOut,  settleFlags ]
  );

  const dex = new ethers.Contract(DEX, DEX_ABI, signer);
  const tx = await dex.userCmd(SWAP_PROXY, cmd, { value: qty });
  return tx.wait();
}

async function runForWallet(pkRaw) {
  const pk = pkRaw.startsWith('0x') ? pkRaw.trim() : ('0x' + pkRaw.trim());
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`[i] Wallet: ${wallet.address}`);

  for (let i = 1; i <= LOOPS; i++) {
    const amountPlume = randAmount(1, 1.5);
    console.log(`\n[${wallet.address}] ➤ Loop ${i}/${LOOPS} — Swap PLUME -> pUSD: ${amountPlume}`);
    try {
      const r = await swapPlumeToPUSD(wallet, amountPlume);
      console.log(`[✅] Tx hash: ${r?.hash}`);
    } catch (e) {
      console.error(`[✗] Gagal swap di loop ${i}:`, e?.reason ?? e?.message ?? e);
    }

    if (i < LOOPS) {
      const dMs = randDelayMs(3, 5);
      console.log(`[⏳] Delay ${(dMs / 1000).toFixed(0)} detik sebelum loop berikutnya...`);
      await sleep(dMs);
    }
  }
}

async function main() {
  const content = readFileSync('./account.txt', 'utf8');
  const pks = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (pks.length === 0) throw new Error('account.txt kosong. Isi 1 PK per baris.');

  console.log('--- Ambient Plume Auto Swap (PLUME -> pUSD) ---');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Jumlah wallet: ${pks.length}`);
  console.log(`Loops per wallet: ${LOOPS}`);
  console.log(`Random amount range: 1.000000 – 1.500000 PLUME`);

  for (let i = 0; i < pks.length; i++) {
    console.log(`\n=== Wallet ${i + 1}/${pks.length} ===`);
    try {
      await runForWallet(pks[i]);
    } catch (e) {
      console.error(`[✗] Gagal di wallet ${i + 1}:`, e?.reason ?? e?.message ?? e);
    }
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
