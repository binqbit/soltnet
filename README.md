# Solana Testnet Tool

## Description
This tool facilitates the development and testing process of various programs on Solana. Especially if it is necessary to dump the account of the program and quickly test transactions or something like that.

## Usage
- Build the soltnet binary
```bash
yarn build
```

- Load accounts from a path to testnet
```bash
soltnet load ./testnet-accounts
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
soltnet exec-tx ./transactions.json
```

- Get solana balance
```bash
soltnet balance <pubkey>
```

- Airdrop solana tokens
```bash
soltnet airdrop <pubkey> <amount>
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

## How it works?
The tool uses the `solana-test-validator` to start a local testnet. It reads the accounts from the specified path and uses them to initialize the testnet.

## Format of transactions ready for execution
- [Json Transaction Format](./json-tx-format.md)
