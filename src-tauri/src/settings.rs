use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;

const CURRENT_CONFIG_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalizationSource {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    #[serde(default)]
    pub config_version: u32,
    pub sources: HashMap<String, LocalizationSource>,
    pub selected_source: Option<String>,
    pub game_directory: Option<String>,
    pub language: Option<String>,
}

impl AppSettings {
    pub fn default() -> Self {
        Self {
            config_version: CURRENT_CONFIG_VERSION,
            sources: HashMap::new(),
            selected_source: None,
            game_directory: None,
            language: None,
        }
    }
}

fn get_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, anyhow::Error> {
    let config_dir = app_handle.path().app_config_dir()?;
    Ok(config_dir.join("config.toml"))
}

fn load_bundled_defaults(app_handle: &tauri::AppHandle) -> Result<AppSettings, anyhow::Error> {
    let resource_path = app_handle
        .path()
        .resolve("resources/default_config.toml", BaseDirectory::Resource)?;

    debug!("Loading default config from: {:?}", resource_path);

    if !resource_path.exists() {
        warn!(
            "default_config.toml not found at {:?}. Using hardcoded default.",
            resource_path
        );
        return Ok(AppSettings::default());
    }

    let default_config_content = fs::read_to_string(&resource_path)?;
    let default_settings: AppSettings = toml::from_str(&default_config_content)?;
    Ok(default_settings)
}

fn migrate_settings(settings: &mut AppSettings, defaults: &AppSettings) -> bool {
    if settings.config_version >= CURRENT_CONFIG_VERSION {
        return false;
    }

    let old_version = settings.config_version;

    if settings.config_version < 1 {
        for (key, source) in &defaults.sources {
            if !settings.sources.contains_key(key) {
                info!("Migration v0→v1: adding source '{}'", key);
                settings.sources.insert(key.clone(), source.clone());
            }
        }
        settings.config_version = 1;
    }

    info!(
        "Config migrated from version {} to {}",
        old_version, settings.config_version
    );
    true
}

pub fn load_settings(app_handle: &tauri::AppHandle) -> Result<AppSettings, anyhow::Error> {
    let config_path = get_config_path(app_handle)?;

    if let Some(parent_dir) = config_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let defaults = load_bundled_defaults(app_handle)?;

    if !config_path.exists() {
        debug!(
            "Config file not found at {:?}. Using defaults.",
            config_path
        );
        save_settings(app_handle, &defaults)?;
        return Ok(defaults);
    }

    let config_content = fs::read_to_string(&config_path)?;
    let mut settings: AppSettings = toml::from_str(&config_content).unwrap_or_else(|e| {
        error!("Failed to parse config file: {}", e);
        defaults.clone()
    });

    if migrate_settings(&mut settings, &defaults) {
        save_settings(app_handle, &settings)?;
    }

    Ok(settings)
}

pub fn save_settings(
    app_handle: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<(), anyhow::Error> {
    let config_path = get_config_path(app_handle)?;
    let config_content = toml::to_string(settings)?;
    fs::write(&config_path, config_content)?;
    debug!("Settings saved to: {:?}", config_path);
    Ok(())
}
