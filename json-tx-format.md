# JSON Transaction Format for Solana

## Description
This is a transaction format that describes all the necessary parameters and instructions ready for execution. This transaction format is an extended version of the standard raw transaction on Solana. This transaction format allows you to describe in JSON format a fully ready-made transaction with all the necessary parameters, including signers, data, and so on.

## JSON Structure

### Transaction Format
```json
[
    {
        "program_id": <Program ID>,
        "data": <Transaction Data>,
        "accounts": [
            {
                "pubkey": <Public Key>,
                "is_signer": false,
                "is_writable": false
            }
        ],
        "signers": [
            [<Secret Keypair>],
            [...]
        ]
    }
]
```

### Transaction Data
Transaction data can be represented in several formats, including hex, base64, byte array, or as an object with a specific type.

- Hex Data:
```json
{
    "data": "0x01020304"
}
```

- Base64 Data:
```json
{
    "data": "Qm2k1d2f3g4h5j6k7l8m9n0o1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d6e7f8g9h"
}
```

- Byte Array Data:
```json
{
    "data": [1, 2, 3, 4]
}
```

- Object Data:
```json
{
    "data": {
        "type": "u8 | u16 | u32 | u64 | pubkey | string (hex/base58) | bytes | object",
        "data": <value>
    }
}
```

Type `object` has the following structure:
```json
{
    "type": "object",
    "data": [
        {
            "type": "type1",
            "data": <value>
        },
        {
            "type": "type2",
            "data": <value>
        }
    ]
}
```

### Public Key
The public key has two formats basic `base58` and expanded `object` format.

- Base58 Public Key:
```json
{
    "pubkey": "7778W1aq6rufd25HNdokXp5xPga4Myd3mXP6TJrjcy3"
}
```

- Object Public Key:
```json
{
    "pubkey": {
        "type": "ata",
        "owner": "7778W1aq6rufd25HNdokXp5xPga4Myd3mXP6TJrjcy3",
        "mint": "So11111111111111111111111111111111111111112"
    }
}
```

### Signers
Signers represent the entities authorized to sign the transaction. Each signer can be specified as either:

- A secret keypair array consisting of 64 bytes.
- A file path pointing to the secret keypair file.

These signers are essential for authenticating and authorizing the transaction on the Solana blockchain.

### Dynamic Params In the Transaction
This transaction format supports dynamic parameters, which can be specified within this format and transmitted when a transaction is called.
Dynamic parameters can be entered in any part of the script, indicating the number of the parameter `$1`, `$2`, etc. These parameters will be replaced with the actual values when the transaction is executed.

- Example of using dynamic parameters, creating an associated token account USDC:
```json
{
    "program_id": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "data": 0,
    "accounts": [
        {
            "pubkey": "$1",
            "is_signer": true,
            "is_writable": true
        },
        {
            "pubkey": {
                "type": "ata",
                "owner": "$1",
                "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            "is_signer": false,
            "is_writable": true
        },
        {
            "pubkey": "$1",
            "is_signer": true,
            "is_writable": true
        },
        {
            "pubkey": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "is_signer": false,
            "is_writable": false
        },
        {
            "pubkey": "11111111111111111111111111111111",
            "is_signer": false,
            "is_writable": false
        },
        {
            "pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "is_signer": false,
            "is_writable": false
        }
    ],
    "signers": [
        "$2"
    ]
}
```

- Tx Execution:
```bash
soltnet exec-tx ./create-ata.json 7778W1aq6rufd25HNdokXp5xPga4Myd3mXP6TJrjcy3 ./7778W1aq6rufd25HNdokXp5xPga4Myd3mXP6TJrjcy3.json
```
