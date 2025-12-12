# Solana Testnet Tool

## Description
This tool facilitates the development and testing process of various programs on Solana. Especially if it is necessary to dump the account of the program and quickly test transactions or something like that.

## Usage
- Show available commands
```bash
soltnet --help
```

## Install globally for CLI use (Yarn)
From the repo:
```bash
yarn install
yarn link       # registers "soltnet" globally
```
From any project or shell:
```bash
yarn link soltnet
soltnet --help
```

- Get command-specific help
```bash
soltnet help <command>
```

- Build the soltnet binary
```bash
yarn build
```

- Load accounts from a path to testnet
```bash
soltnet load ./testnet-accounts
```

- Clear testnet accounts
```bash
soltnet clear
```

- Start testnet
```bash
soltnet start
```

- Stop testnet
```bash
soltnet stop
```

- Execute transactions
```bash
soltnet exec-tx ./transactions.json [<params>]
```

- Dump account from mainnet
```bash
soltnet dump <pubkey> [<output-path>]
```

- Dump accounts from transaction
```bash
soltnet dump-from-tx <tx-signature> [<output-path>]
```

- Dump accounts for transaction
```bash
soltnet dump-for-tx ./tx.json [<output-path>] [<params>]
```

- Parse transaction
```bash
soltnet parse-tx <tx-signature> [<output-path>]
```

- Dump raw transaction response (base64 JSON from RPC)
```bash
soltnet dump-raw-tx <tx-signature> [<output-path>]
```

- Dump raw block response (base64 JSON from RPC)
```bash
soltnet dump-raw-block <slot> [<output-path>]
```

- Set data format to tx instruction data
```bash
soltnet set-data-format <tx> <format> <program-id>
```

- Get solana balance
```bash
soltnet balance <pubkey>
```

- Airdrop solana tokens
```bash
soltnet airdrop <pubkey> <amount>
```

- Send solana to another account
```bash
soltnet send-sol <from> <to> <amount> ./signer.json
```

- Create ATA account
```bash
soltnet create-ata <owner> <mint> ./signer.json
```

- Close ATA account
```bash
soltnet close-ata <owner> <mint> ./signer.json
```

- Get token balance
```bash
soltnet token-balance <owner> <mint>
```

- Create lookup table
```bash
soltnet create-lookup-table <lookup-table-path> <signer>
```

## How it works?
The tool uses the `solana-test-validator` to start a local testnet. It reads the accounts from the specified path and uses them to initialize the testnet.

## Format of transactions ready for execution
- [Json Transaction Format](./json-tx-format.md)
