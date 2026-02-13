use anyhow::{Context, Error};
use std::io;
use std::path::PathBuf;
use std::process::Command;
use sysinfo::System;

const LIMBUS_STEAM_ID: u32 = 1973530;

#[cfg(target_os = "windows")]
pub fn launch_game() -> Result<(), Error> {
    if let Err(_) = Command::new("cmd")
        .args(["/C", "start", &format!("steam://run/{}", LIMBUS_STEAM_ID)])
        .spawn()
    {
        return Err(anyhow::anyhow!("Failed to launch Steam. Is it installed?"));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub fn launch_game() -> Result<(), Error> {
    let result = Command::new("xdg-open")
        .arg(format!("steam://run/{}", LIMBUS_STEAM_ID))
        .spawn();

    if let Err(_) = result {
        if let Err(_) = Command::new("steam")
            .args([format!("steam://run/{}", LIMBUS_STEAM_ID)])
            .spawn()
        {
            return Err(anyhow::anyhow!("Failed to launch Steam. Is it installed?"));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_steam_path() -> io::Result<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu.open_subkey("Software\\Valve\\Steam")?;
    let install_path: String = steam_key.get_value("SteamPath")?;

    let path = PathBuf::from(install_path.replace("/", "\\"));
    if path.exists() {
        return Ok(path);
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Steam installation not found",
    ))
}

#[cfg(target_os = "macos")]
fn get_steam_path() -> io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let path = home.join("Library/Application Support/Steam");
    if path.exists() {
        return Ok(path);
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Steam installation not found",
    ))
}

#[cfg(target_os = "linux")]
fn get_steam_path() -> io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    let path = home.join(".steam/steam");
    if path.exists() {
        return Ok(path);
    }

    let path = home.join(".local/share/Steam");
    if path.exists() {
        return Ok(path);
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Steam installation not found",
    ))
}

pub fn validate_game_directory(directory: &str) -> Result<(), Error> {
    let game_path = PathBuf::from(directory).join("LimbusCompany.exe");

    if !game_path.exists() {
        return Err(anyhow::anyhow!("Invalid game directory"));
    }

    let data_path = game_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Invalid game path"))?
        .join("LimbusCompany_Data");
    if !data_path.exists() {
        return Err(anyhow::anyhow!("Invalid game directory"));
    }

    Ok(())
}

pub fn get_game_directory() -> Result<PathBuf, Error> {
    let steam_path = get_steam_path()?;
    let default_path = steam_path.join("steamapps").join("common");

    let vdf_path = steam_path.join("steamapps").join("libraryfolders.vdf");
    if !vdf_path.exists() {
        return Err(anyhow::anyhow!("Steam libraries file not found"));
    }

    let vdf_content = std::fs::read_to_string(vdf_path)
        .with_context(|| format!("Failed to read Steam libraries file"))?;

    let mut library_paths = vec![default_path];
    for line in vdf_content.lines() {
        if line.contains("\"path\"") {
            if let Some(path_str) = line.split('"').nth(3) {
                let lib_path = PathBuf::from(path_str).join("steamapps").join("common");
                library_paths.push(lib_path);
            }
        }
    }

    for library in library_paths {
        let parent = library
            .parent()
            .ok_or(anyhow::anyhow!("Invalid library path"))?;
        let manifest_path = parent.join(format!("appmanifest_{}.acf", LIMBUS_STEAM_ID));

        if manifest_path.exists() {
            let manifest = std::fs::read_to_string(manifest_path)
                .with_context(|| format!("Failed to read game manifest"))?;

            for line in manifest.lines() {
                if line.contains("\"installdir\"") {
                    if let Some(dir_name) = line.split('"').nth(3) {
                        return Ok(library.join(dir_name));
                    }
                }
            }
        }
    }

    Err(anyhow::anyhow!("Limbus not found in any Steam library"))
}

pub fn is_game_running() -> bool {
    let system = System::new_all();

    system.processes().iter().any(|(_, process)| {
        process
            .name()
            .to_str()
            .map_or(false, |name| name.starts_with("LimbusCompany.e"))
    })
}
