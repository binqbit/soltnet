const fs = require("fs");
const { spawn } = require('child_process');
const path = require("path");

const CONFIG_DEPLOY = "deploy.sh";
const CONFIG_DOCKERFILE = "Dockerfile.testnet";
const CONFIG_DOCKERCOMPOSE = "docker-compose.yml";

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTAINER_PATH = path.join(REPO_ROOT, "solana-testnet");
const ACCOUNTS_PATH = path.join(CONTAINER_PATH, "accounts");
const TEST_LEDGER_PATH = path.join(CONTAINER_PATH, "test-ledger");

function stopTestnetContainer(onEnd) {
    console.log('Stopping testnet container...');
    const composePath = path.resolve(CONTAINER_PATH, CONFIG_DOCKERCOMPOSE);
    const child = spawn('docker', ['compose', '-f', composePath, 'down'], {
        stdio: 'inherit',
    });
    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`docker compose down exited with code ${code}`);
            return;
        }
        fs.rmSync(TEST_LEDGER_PATH, { recursive: true, force: true });
        onEnd && onEnd();
    });
}

function startTestnetContainer(onEnd) {
    console.log('Starting testnet container...');
    const composePath = path.resolve(CONTAINER_PATH, CONFIG_DOCKERCOMPOSE);
    const child = spawn('docker', ['compose', '-f', composePath, 'up', '--build'], {
        stdio: 'inherit',
    });
    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`docker compose exited with code ${code}`);
        }
        onEnd && onEnd();
    });
}

function writeTestnetConfig(name, content) {
    console.log(`Update ${name} config file`);
    fs.writeFileSync(path.resolve(CONTAINER_PATH, name), content.trim());
}

function setTestnetConfig(accounts_path) {
    fs.rmSync(ACCOUNTS_PATH, { recursive: true, force: true });
    if (!fs.existsSync(CONTAINER_PATH)) {
        fs.mkdirSync(CONTAINER_PATH, { recursive: true });
    }
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        fs.mkdirSync(ACCOUNTS_PATH, { recursive: true });
    }

    const all_accounts = accounts_path ? fs.readdirSync(accounts_path) : [];
    let programs = all_accounts
        .filter(file => file.endsWith('.so'))
        .map(file => file.slice(file.lastIndexOf('/') + 1, file.lastIndexOf('.')));
    let accounts = all_accounts
        .filter(file => file.endsWith('.json'))
        .map(file => file.slice(file.lastIndexOf('/') + 1, file.lastIndexOf('.')));
    
    for (const program of programs) {
        console.log(`Copying program ${program}`);
        fs.copyFileSync(path.join(accounts_path, `${program}.so`), path.join(ACCOUNTS_PATH, `${program}.so`));
    }

    for (const account of accounts) {
        console.log(`Copying account ${account}`);
        fs.copyFileSync(path.join(accounts_path, `${account}.json`), path.join(ACCOUNTS_PATH, `${account}.json`));
    }

    let program_flags = programs.map(addr => `--bpf-program ${addr} ./accounts/${addr}.so`).join(' \\\n\t');
    let account_flags = accounts.map(addr => `--account ${addr} ./accounts/${addr}.json`).join(' \\\n\t');

    writeTestnetConfig(CONFIG_DEPLOY, `
#!/bin/sh
solana-test-validator \\
    --ledger /testnet/test-ledger \\
    --reset \\
    --log \\
    ${program_flags} \\
    ${account_flags}
`);

    writeTestnetConfig(CONFIG_DOCKERFILE, `
FROM rustlang/rust:nightly-slim AS builder

WORKDIR /home/rust/solana/
RUN apt-get update && apt-get install -y libssl-dev pkg-config wget bzip2
RUN wget https://github.com/solana-labs/solana/releases/download/v1.18.15/solana-release-x86_64-unknown-linux-gnu.tar.bz2
RUN tar jxf solana-release-x86_64-unknown-linux-gnu.tar.bz2
ENV PATH=/home/rust/solana/solana-release/bin:$PATH

WORKDIR /testnet
COPY ./accounts ./accounts
COPY ./deploy.sh ./deploy.sh
RUN chmod +x ./deploy.sh

CMD [ "sh", "./deploy.sh" ]
`);

    writeTestnetConfig(CONFIG_DOCKERCOMPOSE, `
version: "3"

services:
  testnet:
    container_name: testnet
    build:
      context: ./
      dockerfile: Dockerfile.testnet
    ports:
      - "8900:8900"
      - "8899:8899"
    volumes:
      - ./test-ledger:/testnet/test-ledger

volumes:
  test-ledger:
`);
}

module.exports = {
    stopTestnetContainer,
    startTestnetContainer,
    writeTestnetConfig,
    setTestnetConfig,
};
