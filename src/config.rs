use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{Context, Result, anyhow};
use regex::Regex;

const CONFIG_DEPLOY: &str = "deploy.sh";
const CONFIG_DOCKERFILE: &str = "Dockerfile.testnet";
const CONFIG_DOCKERCOMPOSE: &str = "docker-compose.yml";

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn template_path() -> PathBuf {
    repo_root().join("config")
}

fn container_path() -> PathBuf {
    repo_root().join("solana-testnet")
}

fn accounts_path() -> PathBuf {
    container_path().join("accounts")
}

fn test_ledger_path() -> PathBuf {
    container_path().join("test-ledger")
}

fn load_template(name: &str) -> Result<String> {
    let path = template_path().join(name);
    fs::read_to_string(&path).with_context(|| format!("failed to read template {path:?}"))
}

fn render_template(template: &str, values: &HashMap<String, String>) -> Result<String> {
    let re = Regex::new(r"\{\{(\w+)\}\}")?;
    let rendered = re.replace_all(template, |caps: &regex::Captures<'_>| {
        values.get(&caps[1]).map(String::as_str).unwrap_or("")
    });
    Ok(rendered.to_string())
}

fn write_testnet_config(name: &str, content: &str) -> Result<()> {
    println!("Update {name} config file");
    let path = container_path().join(name);
    fs::write(&path, content.trim()).with_context(|| format!("failed to write {path:?}"))
}

fn docker_command(args: &[&str]) -> Result<()> {
    let status = Command::new("docker")
        .args(args)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .stdin(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to run docker {args:?}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("docker command exited with status {status}"))
    }
}

pub fn stop_testnet_container() -> Result<()> {
    println!("Stopping testnet container...");
    let compose_path = container_path().join(CONFIG_DOCKERCOMPOSE);
    docker_command(&["compose", "-f", &compose_path.to_string_lossy(), "down"])?;
    let _ = fs::remove_dir_all(test_ledger_path());
    Ok(())
}

pub fn start_testnet_container() -> Result<()> {
    println!("Starting testnet container...");
    let compose_path = container_path().join(CONFIG_DOCKERCOMPOSE);
    docker_command(&[
        "compose",
        "-f",
        &compose_path.to_string_lossy(),
        "up",
        "-d",
        "--build",
    ])?;
    Ok(())
}

pub fn set_testnet_config(accounts_path_input: Option<&Path>) -> Result<()> {
    let accounts_dir = accounts_path();
    let container_dir = container_path();

    let _ = fs::remove_dir_all(&accounts_dir);

    if !container_dir.exists() {
        fs::create_dir_all(&container_dir)?;
    }
    if !accounts_dir.exists() {
        fs::create_dir_all(&accounts_dir)?;
    }

    let mut programs = Vec::new();
    let mut accounts = Vec::new();

    if let Some(input_path) = accounts_path_input {
        for entry in fs::read_dir(input_path)? {
            let entry = entry?;
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
                if ext == "so" || ext == "json" {
                    let stem = path
                        .file_stem()
                        .and_then(|v| v.to_str())
                        .unwrap_or_default();
                    if ext == "so" {
                        programs.push(stem.to_string());
                    } else {
                        accounts.push(stem.to_string());
                    }
                }
            }
        }

        for program in &programs {
            println!("Copying program {program}");
            fs::copy(
                input_path.join(format!("{program}.so")),
                accounts_dir.join(format!("{program}.so")),
            )?;
        }

        for account in &accounts {
            println!("Copying account {account}");
            fs::copy(
                input_path.join(format!("{account}.json")),
                accounts_dir.join(format!("{account}.json")),
            )?;
        }
    }

    let program_flags: Vec<String> = programs
        .iter()
        .map(|addr| format!("\\\n\t--bpf-program {addr} ./accounts/{addr}.so "))
        .collect();
    let account_flags: Vec<String> = accounts
        .iter()
        .map(|addr| format!("\\\n\t--account {addr} ./accounts/{addr}.json "))
        .collect();

    let mut all_flags = Vec::new();
    all_flags.extend(program_flags);
    all_flags.extend(account_flags);

    let deploy_template = load_template("deploy.sh.template")?;
    let flags_rendered = all_flags.join("");
    let mut values = HashMap::new();
    values.insert("FLAGS".to_string(), flags_rendered);
    write_testnet_config(CONFIG_DEPLOY, &render_template(&deploy_template, &values)?)?;

    let dockerfile_template = load_template("Dockerfile.testnet.template")?;
    write_testnet_config(CONFIG_DOCKERFILE, &dockerfile_template)?;

    let compose_template = load_template("docker-compose.yml.template")?;
    write_testnet_config(CONFIG_DOCKERCOMPOSE, &compose_template)?;

    Ok(())
}
