/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import solc from 'solc';
import { ethers } from 'ethers';
import chalk from 'chalk';
import figlet from 'figlet';

// ──────────────────────────────────────────
// Konstanta
// ──────────────────────────────────────────
const DELAY_MS = 5_000;
const KEYS_PATH = './private_keys.txt';
const CONTRACT_PATH = './Gmonad.sol';

// ──────────────────────────────────────────
// 1. Memuat private keys via stream
// ──────────────────────────────────────────
async function loadPrivateKeys(path) {
  const keys = [];
  const rl = createInterface({ input: createReadStream(path) });

  for await (const line of rl) {
    const k = line.trim();
    if (k) keys.push(k.startsWith('0x') ? k : `0x${k}`);
  }
  return keys;
}

// ──────────────────────────────────────────
// 2. Helper async delay
// ──────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ──────────────────────────────────────────
// 3. Compile Solidity sekali saja
// ──────────────────────────────────────────
function compileOnce() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [CONTRACT_PATH]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } }
  };

  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  const file = compiled.contracts[CONTRACT_PATH].Gmonad;
  return { abi: file.abi, bytecode: file.evm.bytecode.object };
}
const { abi, bytecode } = compileOnce();

// ──────────────────────────────────────────
// 4. Program utama
// ──────────────────────────────────────────
async function main() {
  // Tampilkan banner (non-prod bisa dimatikan via env)
  if (process.env.SHOW_BANNER !== 'false') {
    console.log(chalk.green(figlet.textSync('karpal')));
  }

  // a. Ambil private keys
  const PRIVATE_KEYS = await loadPrivateKeys(KEYS_PATH);
  if (PRIVATE_KEYS.length === 0) {
    console.error(chalk.red('private_keys.txt kosong!'));
    process.exit(1);
  }

  // b. Ambil input jumlah deploy per akun
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const deployPerAccount = await new Promise((res) =>
    rl.question(
      chalk.blueBright('Berapa kontrak per akun? '),
      (ans) => {
        rl.close();
        res(Number(ans));
      }
    )
  );
  if (!Number.isInteger(deployPerAccount) || deployPerAccount <= 0) {
    console.error(chalk.red('Harus angka > 0'));
    return;
  }

  // c. Siapkan provider
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  console.log(
    chalk.cyan(
      `\n⏩ Deploy ${deployPerAccount} kontrak pada ${PRIVATE_KEYS.length} akun…\n`
    )
  );

  // d. Loop akun
  for (const [accIdx, pk] of PRIVATE_KEYS.entries()) {
    const wallet = new ethers.Wallet(pk, provider);
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    console.log(chalk.yellow('\n========================'));
    console.log(chalk.yellow(`Akun ${accIdx + 1}: ${wallet.address}`));

    // e. Loop deploy
    for (let d = 0; d < deployPerAccount; d++) {
      console.log(chalk.yellow(`Deploy #${d + 1}`));
      try {
        // estimasi gas
        const gas = await provider.estimateGas({
          from: wallet.address,
          data: `0x${bytecode}`
        });
        const gasPrice = BigInt(await provider.send('eth_gasPrice', []));
        const costEth = ethers.formatEther(gasPrice * BigInt(gas));

        console.log(
          `Estimasi gas: ${chalk.magenta(gas)} @ ${chalk.magenta(
            ethers.formatUnits(gasPrice, 'gwei')
          )} gwei ≈ ${chalk.green(costEth)} ETH`
        );

        // deploy!
        let contract = await factory.deploy();
        await contract.waitForDeployment();
        console.log(
          chalk.green(`✅ Sukses: ${contract.target}\n`)
        );

        // catat
        fs.appendFileSync(
          'deployed_contracts.txt',
          `${wallet.address} => ${contract.target}\n`
        );

        // lepaskan referensi
        contract = null;
      } catch (err) {
        console.error(chalk.red(`❌ Gagal deploy: ${err.message}`));
      }

      if (d < deployPerAccount - 1) {
        console.log(chalk.gray(`Tunggu ${DELAY_MS / 1_000} dtk…`));
        await delay(DELAY_MS);
      }
    }

    if (accIdx < PRIVATE_KEYS.length - 1) {
      console.log(
        chalk.gray(`\n➡️  Lanjut akun berikutnya dalam ${DELAY_MS / 1_000} dtk…`)
      );
      await delay(DELAY_MS);
    }
  }

  console.log(chalk.black.bgGreen('\n🎉 Semua kontrak selesai dideploy!'));
}

main().catch((e) =>
  console.error(chalk.bgRed('FATAL'), chalk.red(e.message ?? e))
);
