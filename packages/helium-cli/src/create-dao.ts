import { ThresholdType } from "@helium/circuit-breaker-sdk";
import {
  daoKey,
  init as initDao,
  threadKey,
} from "@helium/helium-sub-daos-sdk";
import {
  dataCreditsKey,
  init as initDc,
  PROGRAM_ID,
} from "@helium/data-credits-sdk";
import { init as initLazy } from "@helium/lazy-distributor-sdk";
import {
  registrarKey,
  init as initVsr,
} from "@helium/voter-stake-registry-sdk";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getGovernanceProgramVersion,
  MintMaxVoteWeightSource,
  withCreateRealm,
  GoverningTokenType,
  VoteThreshold,
  VoteThresholdType,
  VoteTipping,
  GovernanceConfig,
  GoverningTokenConfigAccountArgs,
  withCreateGovernance,
  withSetRealmAuthority,
  SetRealmAuthorityAction,
  getTokenOwnerRecordAddress,
} from "@solana/spl-governance";
import os from "os";
import yargs from "yargs/yargs";
import {
  createAndMint,
  getTimestampFromDays,
  getUnixTimestamp,
  loadKeypair,
  isLocalhost,
} from "./utils";
import { sendInstructions, toBN } from "@helium/spl-utils";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BN } from "bn.js";
import Squads from "@sqds/sdk";

const { hideBin } = require("yargs/helpers");

const HNT_EPOCH_REWARDS = 10000000000;
const MOBILE_EPOCH_REWARDS = 5000000000;
const SECS_PER_DAY = 86400;
const SECS_PER_YEAR = 365 * SECS_PER_DAY;
const MAX_LOCKUP = 4 * SECS_PER_YEAR;
const BASELINE = 0;
const SCALE = 100;
const GENESIS_MULTIPLIER = 3;
async function exists(
  connection: Connection,
  account: PublicKey
): Promise<boolean> {
  return Boolean(await connection.getAccountInfo(account));
}

async function run() {
  const yarg = yargs(hideBin(process.argv)).options({
    wallet: {
      alias: "k",
      describe: "Anchor wallet keypair",
      default: `${os.homedir()}/.config/solana/id.json`,
    },
    url: {
      alias: "u",
      default: "http://127.0.0.1:8899",
      describe: "The solana url",
    },
    hntKeypair: {
      type: "string",
      describe: "Keypair of the HNT token",
      default: `${__dirname}/../keypairs/hnt.json`,
    },
    hstKeypair: {
      type: "string",
      describe: "Keypair of the HST token",
      default: `${__dirname}/../keypairs/hst.json`,
    },
    dcKeypair: {
      type: "string",
      describe: "Keypair of the Data Credit token",
      default: `${__dirname}/../keypairs/dc.json`,
    },
    numHnt: {
      type: "number",
      describe:
        "Number of HNT tokens to pre mint before assigning authority to lazy distributor",
      default: 0,
    },
    numHst: {
      type: "number",
      describe:
        "Number of HST tokens to pre mint before assigning authority to lazy distributor",
      default: 0,
    },
    numDc: {
      type: "number",
      describe:
        "Number of DC tokens to pre mint before assigning authority to lazy distributor",
      default: 1000,
    },
    bucket: {
      type: "string",
      describe: "Bucket URL prefix holding all of the metadata jsons",
      default:
        "https://shdw-drive.genesysgo.net/CsDkETHRRR1EcueeN346MJoqzymkkr7RFjMqGpZMzAib",
    },
    govProgramId: {
      type: "string",
      describe: "Pubkey of the GOV program",
      default: "hgovkRU6Ghe1Qoyb54HdSLdqN7VtxaifBzRmh9jtd3S",
    },
    realmName: {
      type: "string",
      describe: "Name of the realm to be generated",
      default: "Helium",
    },
    councilKeypair: {
      type: "string",
      describe: "Keypair of gov council token",
      default: `${__dirname}/../keypairs/council.json`,
    },
    councilWallet: {
      type: "string",
      describe: "Pubkey for holding/distributing council tokens",
      default: await loadKeypair(
        `${os.homedir()}/.config/solana/id.json`
      ).publicKey.toBase58(),
    },
    numCouncil: {
      type: "number",
      describe:
        "Number of Gov Council tokens to pre mint before assigning authority to dao",
      default: 10,
    },
    multisig: {
      type: "string",
      describe: "Address of the squads multisig to control the dao. If not provided, your wallet will be the authority"
    },
    authorityIndex: {
      type: "number",
      describe: "Authority index for squads. Defaults to 1",
      default: 1,
    }
  });

  const argv = await yarg.argv;
  process.env.ANCHOR_WALLET = argv.wallet;
  process.env.ANCHOR_PROVIDER_URL = argv.url;
  anchor.setProvider(anchor.AnchorProvider.local(argv.url));

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const dataCreditsProgram = await initDc(provider);
  const heliumSubDaosProgram = await initDao(provider);
  const heliumVsrProgram = await initVsr(provider);

  const govProgramId = new PublicKey(argv.govProgramId);
  const councilKeypair = await loadKeypair(argv.councilKeypair);
  const councilWallet = new PublicKey(argv.councilWallet);

  const hntKeypair = loadKeypair(argv.hntKeypair);
  const hstKeypair = loadKeypair(argv.hstKeypair);
  const dcKeypair = loadKeypair(argv.dcKeypair);
  const me = provider.wallet.publicKey;
  const dao = daoKey(hntKeypair.publicKey)[0];

  console.log("HNT", hntKeypair.publicKey.toBase58());
  console.log("HST", hstKeypair.publicKey.toBase58());
  console.log("DC", dcKeypair.publicKey.toBase58());
  console.log("GOV PID", govProgramId.toBase58());
  console.log("COUNCIL", councilKeypair.publicKey.toBase58());
  console.log("COUNCIL WALLET", councilWallet.toBase58());

  const thread = threadKey(dao, "issue_hst")[0];

  console.log("DAO", dao.toString());
  console.log("THREAD", thread.toString());

  const conn = provider.connection;

  const squads = Squads.endpoint(process.env.ANCHOR_PROVIDER_URL, provider.wallet);
  let authority = provider.wallet.publicKey;
  let multisig = argv.multisig ? new PublicKey(argv.multisig) : null;
  if (multisig) {
    authority = squads.getAuthorityPDA(multisig, argv.authorityIndex);
  }

  await createAndMint({
    provider,
    mintKeypair: hntKeypair,
    amount: argv.numHnt,
    metadataUrl: `${argv.bucket}/hnt.json`,
  });

  await createAndMint({
    provider,
    mintKeypair: hstKeypair,
    amount: argv.numHst,
    metadataUrl: `${argv.bucket}/hst.json`,
  });

  await createAndMint({
    provider,
    mintKeypair: dcKeypair,
    amount: argv.numDc,
    decimals: 0,
    metadataUrl: `${argv.bucket}/dc.json`,
  });

  await createAndMint({
    provider,
    mintKeypair: councilKeypair,
    amount: argv.numCouncil,
    decimals: 0,
    metadataUrl: `${argv.bucket}/council.json`,
    to: councilWallet,
  });

  let instructions: TransactionInstruction[] = [];
  const govProgramVersion = await getGovernanceProgramVersion(
    conn,
    govProgramId,
    isLocalhost(provider) ? "localnet" : undefined,
  );

  const realmName = argv.realmName;
  const realm = await PublicKey.findProgramAddressSync(
    [Buffer.from("governance", "utf-8"), Buffer.from(realmName, "utf-8")],
    govProgramId
  )[0];

  console.log("Realm, ", realm.toBase58());
  if (!(await exists(conn, realm))) {
    console.log("Initializing Realm");
    await withCreateRealm(
      instructions,
      govProgramId,
      govProgramVersion,
      realmName,
      provider.wallet.publicKey, // realmAuthorityPk
      hntKeypair.publicKey, // communityMintPk
      provider.wallet.publicKey, // payer
      councilKeypair.publicKey, // councilMintPk
      MintMaxVoteWeightSource.FULL_SUPPLY_FRACTION,
      new anchor.BN(100000000000000), // TODO: 1mm vehnt to create governance
      new GoverningTokenConfigAccountArgs({
        // community token config
        voterWeightAddin: heliumVsrProgram.programId,
        maxVoterWeightAddin: heliumVsrProgram.programId,
        tokenType: GoverningTokenType.Liquid,
      }),
      new GoverningTokenConfigAccountArgs({
        // council token config
        voterWeightAddin: undefined,
        maxVoterWeightAddin: undefined,
        tokenType: GoverningTokenType.Liquid,
      })
    );
  }

  const registrar = (await registrarKey(realm, hntKeypair.publicKey))[0];
  if (!(await exists(conn, registrar))) {
    console.log("Initializing VSR Registrar");
    instructions.push(
      await heliumVsrProgram.methods
        .initializeRegistrarV0({
          positionUpdateAuthority: (await daoKey(hntKeypair.publicKey))[0],
        })
        .accounts({
          realm,
          realmGoverningTokenMint: hntKeypair.publicKey,
        })
        .instruction()
    );
  }

  console.log("Configuring VSR voting mint at [0]");
  instructions.push(
    await heliumVsrProgram.methods
      .configureVotingMintV0({
        idx: 0, // idx
        digitShift: 0, // digit shift
        baselineVoteWeightScaledFactor: new anchor.BN(BASELINE * 1e9),
        maxExtraLockupVoteWeightScaledFactor: new anchor.BN(SCALE * 1e9),
        genesisVotePowerMultiplier: GENESIS_MULTIPLIER,
        genesisVotePowerMultiplierExpirationTs: new anchor.BN(
          Number(await getUnixTimestamp(provider)) + getTimestampFromDays(7)
        ),
        lockupSaturationSecs: new anchor.BN(MAX_LOCKUP),
      })
      .accounts({
        registrar,
        mint: hntKeypair.publicKey,
      })
      .remainingAccounts([
        {
          pubkey: hntKeypair.publicKey,
          isSigner: false,
          isWritable: false,
        },
      ])
      .instruction()
  );

  if (!authority.equals(me)) {
    withSetRealmAuthority(
      instructions,
      govProgramId,
      govProgramVersion,
      realm,
      provider.wallet.publicKey,
      authority,
      SetRealmAuthorityAction.SetChecked
    );
  }
  

  await sendInstructions(provider, instructions, []);
  instructions = [];

  const dcKey = (await dataCreditsKey(dcKeypair.publicKey))[0];
  console.log("dcpid", PROGRAM_ID.toBase58());
  if (!(await exists(conn, dcKey))) {
    await dataCreditsProgram.methods
      .initializeDataCreditsV0({
        authority,
        config: {
          windowSizeSeconds: new anchor.BN(60 * 60),
          thresholdType: ThresholdType.Absolute as never,
          threshold: new anchor.BN("1000000000000"),
        },
      })
      .accounts({
        hntMint: hntKeypair.publicKey,
        dcMint: dcKeypair.publicKey,
        hntPriceOracle: new PublicKey(
          isLocalhost(provider)
            ? "JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB"
            : "6Eg8YdfFJQF2HHonzPUBSCCmyUEhrStg9VBLK957sBe6"
        ), // TODO: Replace with HNT price feed,
      })
      .rpc({ skipPreflight: true });
  }

  if (!(await exists(conn, dao))) {
    console.log("Initializing DAO");
    await heliumSubDaosProgram.methods
      .initializeDaoV0({
        registrar: registrar,
        authority,
        netEmissionsCap: toBN(34.24, 8),
        // TODO: Emissions and net emissions schedule for hnt
        hstEmissionSchedule: [
          {
            startUnixTime: new anchor.BN(0),
            percent: 32,
          },
        ],
        emissionSchedule: [
          {
            startUnixTime: new anchor.BN(0),
            emissionsPerEpoch: new anchor.BN(HNT_EPOCH_REWARDS),
          },
        ],
      })
      .accounts({
        dcMint: dcKeypair.publicKey,
        hntMint: hntKeypair.publicKey,
        thread,
        // TODO: Create actual HST pool
        hstPool: await getAssociatedTokenAddress(
          hntKeypair.publicKey,
          authority,
          true
        ),
      })
      .rpc({ skipPreflight: true });
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit());
