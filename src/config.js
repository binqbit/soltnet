const fs = require("fs");
const { spawn } = require('child_process');
const path = require("path");

const CONFIG_DEPLOY = "deploy.sh";
const CONFIG_DOCKERFILE = "Dockerfile.testnet";
const CONFIG_DOCKERCOMPOSE = "docker-compose.yml";

const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(REPO_ROOT, "config");
const CONTAINER_PATH = path.join(REPO_ROOT, "solana-testnet");
const ACCOUNTS_PATH = path.join(CONTAINER_PATH, "accounts");
const TEST_LEDGER_PATH = path.join(CONTAINER_PATH, "test-ledger");

function loadTemplate(name) {
    return fs.readFileSync(path.join(TEMPLATE_PATH, name), "utf8");
}

function renderTemplate(template, values = {}) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

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
    const child = spawn('docker', ['compose', '-f', composePath, 'up', '-d', '--build'], {
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

    const program_flags = programs.map(addr => `\\\n\t--bpf-program ${addr} ./accounts/${addr}.so `);
    const account_flags = accounts.map(addr => `\\\n\t--account ${addr} ./accounts/${addr}.json `);
    const all_flags = [...program_flags, ...account_flags];

    const deployTemplate = loadTemplate("deploy.sh.template");
    const flagsRendered = all_flags.join('');
    writeTestnetConfig(CONFIG_DEPLOY, renderTemplate(deployTemplate, { FLAGS: flagsRendered }));

    const dockerfileTemplate = loadTemplate("Dockerfile.testnet.template");
    writeTestnetConfig(CONFIG_DOCKERFILE, dockerfileTemplate);

    const composeTemplate = loadTemplate("docker-compose.yml.template");
    writeTestnetConfig(CONFIG_DOCKERCOMPOSE, composeTemplate);
}

module.exports = {
    stopTestnetContainer,
    startTestnetContainer,
    writeTestnetConfig,
    setTestnetConfig,
};
