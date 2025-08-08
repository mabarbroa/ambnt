// Ambient Plume auto swap: PLUME <-> pUSD
// Requirements: Node 18+, `npm i ethers dotenv`
// Files: .env (RPC + amounts), account.txt (1 PK hex per baris, tanpa 0x juga boleh)

import 'dotenv/config';
import { readFileSync } from 'fs';
import { ethers } from 'ethers';

const RPC_URL = process.env.PLUME_RPC ?? 'https://rpc.plume.org'; // Plume mainnet RPC
const PUSD = '0xdddD73F5Df1F0DC31373357beAC77545dC5A6f3F';           // pUSD
const DEX =  '0xAaAaAAAA81a99d2a05eE428eC7a1d8A3C2237D85';           // CrocSwapDex on Plume

// Amounts (human units). Contoh: 0.02 PLUME & 0.5 pUSD
const AMOUNT_PLUME = process.env.AMOUNT_PLUME ?? '0.02'; // swap PLUME -> pUSD
const AMOUNT_PUSD  = process.env.AMOUNT_PUSD  ?? '0.50'; // swap pUSD  -> PLUME

// Ambient constants
const ZERO = '0x0000000000000000000000000000000000000000'; // native token (PLUME)
const POOL_IDX = 420;                                     // per Ambient docs
const SWAP_PROXY = 1;                                     // userCmd callpath = 1
const TIP_BPS = 0;                                        // 0 = pakai pool fee standar
const SETTLE_FLAGS = 0;                                   // 0 = settle langsung ke wallet

// Max limitPrice per docs (pakai nilai "bebas partial fill" saat minOut dipakai)
// isBuy=true  (bayar base / PLUME, terima quote / pUSD)
const LIMIT_MAX_ISBUY_TRUE  = ethers.toBigInt('21267430153580247136652501917186561137');
// isBuy=false (terima base / PLUME, bayar quote / pUSD)
const LIMIT_MAX_ISBUY_FALSE = 65538n;

// Minimal ABI untuk CrocSwapDex.userCmd dan ERC20.approve
const DEX_ABI = [
  {
    "inputs":[{"internalType":"uint16","name":"callpath","type":"uint16"},
              {"internalType":"bytes","name":"cmd","type":"bytes"}],
    "name":"userCmd","outputs":[{"internalType":"bytes","name":"","type":"bytes"}],
    "stateMutability":"payable","type":"function"
  }
];

const ERC20_ABI = [
  { "inputs":[{"internalType":"address","name":"spender","type":"address"},
              {"internalType":"uint256","name":"amount","type":"uint256"}],
    "name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],
    "stateMutability":"nonpayable","type":"function" }
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function randDelayMs(minS = 5, maxS = 20) {
  const ms = (minS*1000) + Math.floor(Math.random()*((maxS-minS)*1000 + 1));
  return ms;
}

async function swapPlumeToPUSD(signer, amountPlume) {
  // isBuy=true (bayar base=PLUME(native), terima quote=pUSD), inBaseQty=true
  const base = ZERO;
  const quote = PUSD;
  const isBuy = true;
  const inBaseQty = true;
  const qty = ethers.parseUnits(amountPlume, 18);   // PLUME 18 desimal
  const tip = TIP_BPS;
  const limitPrice = LIMIT_MAX_ISBUY_TRUE;          // max per docs
  const minOut = 0n;                                // TODO: isi slippage guard
  const settleFlags = SETTLE_FLAGS;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const cmd = coder.encode(
    [ "address","address","uint256","bool","bool","uint128","uint16","uint128","uint128","uint8" ],
    [ base, quote, POOL_IDX, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags ]
  );

  const dex = new ethers.Contract(DEX, DEX_ABI, signer);
  // Karena bayar native (PLUME), kirim value = qty
  const tx = await dex.userCmd(SWAP_PROXY, cmd, { value: qty });
  return tx.wait();
}

async function swapPUSDToPlume(signer, amountPusd) {
  // isBuy=false (terima base=PLUME(native), bayar quote=pUSD), inBaseQty=false (qty di quote)
  const base = ZERO;
  const quote = PUSD;
  const isBuy = false;
  const inBaseQty = false;
  const qty = ethers.parseUnits(amountPusd, 18);    // pUSD 18 desimal
  const tip = TIP_BPS;
  const limitPrice = LIMIT_MAX_ISBUY_FALSE;         // max per docs
  const minOut = 0n;                                // TODO: isi slippage guard
  const settleFlags = SETTLE_FLAGS;

  // Pastikan approve pUSD ke DEX dulu
  const pusd = new ethers.Contract(PUSD, ERC20_ABI, signer);
  const appr = await pusd.approve(DEX, qty);
  await appr.wait();

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const cmd = coder.encode(
    [ "address","address","uint256","bool","bool","uint128","uint16","uint128","uint128","uint8" ],
    [ base, quote, POOL_IDX, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags ]
  );

  const dex = new ethers.Contract(DEX, DEX_ABI, signer);
  const tx = await dex.userCmd(SWAP_PROXY, cmd); // tidak kirim value, karena bayar ERC20
  return tx.wait();
}

async function runForWallet(pkRaw) {
  const pk = pkRaw.startsWith('0x') ? pkRaw.trim() : ('0x' + pkRaw.trim());
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`[i] Wallet: ${wallet.address}`);

  // 1) Swap PLUME -> pUSD
  console.log(`[➤] Swap PLUME -> pUSD: ${AMOUNT_PLUME}`);
  const r1 = await swapPlumeToPUSD(wallet, AMOUNT_PLUME);
  console.log(`[✅] Done. Tx: ${r1?.hash}`);

  // delay acak 5–20 detik
  const dMs = randDelayMs(5, 20);
  console.log(`[⏳] Delay ${(dMs/1000).toFixed(0)} detik...`);
  await sleep(dMs);

  // 2) Swap pUSD -> PLUME
  console.log(`[➤] Swap pUSD -> PLUME: ${AMOUNT_PUSD}`);
  const r2 = await swapPUSDToPlume(wallet, AMOUNT_PUSD);
  console.log(`[✅] Done. Tx: ${r2?.hash}`);
}

async function main() {
  const content = readFileSync('./account.txt', 'utf8');
  const pks = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (pks.length === 0) throw new Error('account.txt kosong. Isi 1 PK per baris.');

  console.log('--- Ambient Plume Auto Swap ---');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Jumlah wallet: ${pks.length}`);
  console.log(`Amount: ${AMOUNT_PLUME} PLUME -> pUSD, lalu ${AMOUNT_PUSD} pUSD -> PLUME`);
  for (let i = 0; i < pks.length; i++) {
    console.log(`\n=== Wallet ${i+1}/${pks.length} ===`);
    try {
      await runForWallet(pks[i]);
    } catch (e) {
      console.error(`[✗] Gagal di wallet ${i+1}:`, e?.reason ?? e?.message ?? e);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
