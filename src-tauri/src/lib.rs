mod settings;
mod steam;
mod utils;

use dashmap::DashMap;
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
struct AppState {
    settings: settings::AppSettings,
    installed_metadata: Option<utils::InstalledMetadata>,
}

impl AppState {
    fn new(app_handle: &tauri::AppHandle) -> Self {
        let mut app_state = Self {
            settings: settings::load_settings(app_handle).unwrap_or_else(|e| {
                error!("Failed to load settings: {}", e);
                settings::AppSettings::default()
            }),
            installed_metadata: None,
        };

        app_state.load_installed_metadata().unwrap_or_else(|e| {
            error!("Failed to load installed metadata: {}", e);
        });

        app_state
    }

    fn game_path(&self) -> anyhow::Result<PathBuf> {
        match &self.settings.game_directory {
            Some(dir) => Ok(PathBuf::from(dir)),
            None => steam::get_game_directory(),
        }
    }

    fn active_source(&self) -> Result<(String, String), String> {
        let name = self
            .settings
            .selected_source
            .as_ref()
            .ok_or("No active source selected")?;
        let source = self
            .settings
            .sources
            .get(name)
            .ok_or("No active source selected")?;
        Ok((name.clone(), source.url.clone()))
    }

    fn apply_settings_patch(
        &mut self,
        app_handle: &tauri::AppHandle,
        patch: settings::SettingsPatch,
    ) -> anyhow::Result<()> {
        let mut settings = self.settings.clone();

        if let Some(source) = patch.selected_source {
            anyhow::ensure!(
                settings.sources.contains_key(&source),
                "Unknown source {:?}",
                source
            );
            settings.selected_source = Some(source);
        }

        if let Some(language) = patch.language {
            settings.language = Some(language);
        }

        settings::save_settings(app_handle, &settings)?;
        self.settings = settings;
        Ok(())
    }

    fn save_settings(&self, app_handle: &tauri::AppHandle) -> anyhow::Result<()> {
        settings::save_settings(app_handle, &self.settings)?;
        Ok(())
    }

    fn update_game_directory(&mut self, game_directory: &Option<String>) -> anyhow::Result<()> {
        let game_path = if let Some(game_directory) = game_directory {
            if !steam::validate_game_directory(&game_directory).is_ok() {
                return Err(anyhow::anyhow!("Invalid game directory"));
            }

            PathBuf::from(game_directory)
        } else {
            steam::get_game_directory()?
        };

        let installed_metadata = utils::load_installed_metadata(&game_path)?;

        self.installed_metadata = Some(installed_metadata);
        self.settings.game_directory = game_directory.clone();
        Ok(())
    }

    fn load_installed_metadata(&mut self) -> anyhow::Result<()> {
        let game_path = self.game_path()?;
        self.installed_metadata = Some(utils::load_installed_metadata(&game_path)?);
        Ok(())
    }

    fn save_installed_metadata(&self) -> anyhow::Result<()> {
        let game_path = self.game_path()?;

        if let Some(metadata) = &self.installed_metadata {
            utils::save_installed_metadata(&game_path, metadata)?;
        }

        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct RemoteLocalizations {
    source: String,
    localizations: Vec<utils::Localization>,
}

type AppStateMutex = Mutex<AppState>;
type RemoteLocalizationsMutex = Mutex<Option<RemoteLocalizations>>;
type LocalizationLocks = DashMap<(String, PathBuf), Arc<Mutex<()>>>;

fn localization_lock(locks: &LocalizationLocks, id: &str, game_path: &Path) -> Arc<Mutex<()>> {
    locks
        .entry((id.to_owned(), game_path.to_path_buf()))
        .or_default()
        .clone()
}

async fn ensure_game_not_running() -> Result<(), String> {
    match steam::is_game_running().await {
        Ok(false) => Ok(()),
        Ok(true) => Err("Game is running".to_string()),
        Err(e) => {
            error!("Failed to check whether the game is running: {:?}", e);
            Err(e.to_string())
        }
    }
}

async fn refresh_remote_localizations(
    app_handle: &tauri::AppHandle,
    state: &AppStateMutex,
    remote_localizations: &RemoteLocalizationsMutex,
) -> Result<RemoteLocalizations, String> {
    let (source, url) = state.lock().await.active_source()?;

    let localizations = utils::fetch_available_localizations(&url)
        .await
        .map_err(|e| {
            error!("Failed to fetch available localizations: {:?}", e);
            e.to_string()
        })?;

    let fetched = RemoteLocalizations {
        source,
        localizations,
    };

    *remote_localizations.lock().await = Some(fetched.clone());
    app_handle
        .emit("remote_localizations_updated", &fetched)
        .map_err(|e| e.to_string())?;
    Ok(fetched)
}

async fn resolve_localization(
    app_handle: &tauri::AppHandle,
    state: &AppStateMutex,
    remote_localizations: &RemoteLocalizationsMutex,
    id: &str,
) -> Result<(utils::Localization, String), String> {
    let (active_source, _) = state.lock().await.active_source()?;

    let cached = remote_localizations
        .lock()
        .await
        .as_ref()
        .filter(|remote| remote.source == active_source)
        .and_then(|remote| remote.localizations.iter().find(|l| l.id == id).cloned());

    if let Some(localization) = cached {
        return Ok((localization, active_source));
    }

    let fetched = refresh_remote_localizations(app_handle, state, remote_localizations).await?;
    let localization = fetched
        .localizations
        .into_iter()
        .find(|l| l.id == id)
        .ok_or_else(|| format!("Localization {} not found in source {}", id, fetched.source))?;
    Ok((localization, fetched.source))
}

async fn install_and_record(
    app_handle: &tauri::AppHandle,
    state: &AppStateMutex,
    localization_locks: &LocalizationLocks,
    game_path: &Path,
    localization: &utils::Localization,
    source: &str,
) -> Result<(), String> {
    let lock = localization_lock(localization_locks, &localization.id, game_path);
    let _acquired_lock = lock.lock().await;

    utils::install_localization(game_path, localization)
        .await
        .map_err(|e| {
            error!("Failed to install localization: {:?}", e);
            e.to_string()
        })?;

    let mut app_state_guard = state.lock().await;

    app_state_guard
        .installed_metadata
        .get_or_insert_with(utils::InstalledMetadata::new)
        .installed
        .insert(
            localization.id.clone(),
            utils::InstalledLocalization {
                id: localization.id.clone(),
                version: localization.version.clone(),
                source: source.to_owned(),
            },
        );

    app_state_guard.save_installed_metadata().map_err(|e| {
        error!("Failed to save installed metadata: {:?}", e);
        e.to_string()
    })?;

    app_handle
        .emit("app_state_updated", app_state_guard.clone())
        .map_err(|e| {
            error!("Failed to emit app state updated: {:?}", e);
            e.to_string()
        })?;

    Ok(())
}

#[tauri::command]
async fn get_latest_version() -> Result<String, String> {
    debug!("Fetching latest version");
    utils::get_latest_version().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_available_localizations(
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppStateMutex>,
    remote_localizations: State<'_, RemoteLocalizationsMutex>,
) -> Result<Vec<utils::Localization>, String> {
    debug!("Fetching available localizations");

    let fetched =
        refresh_remote_localizations(&app_handle, &app_state, &remote_localizations).await?;
    Ok(fetched.localizations)
}

#[tauri::command]
async fn get_app_state(state: State<'_, AppStateMutex>) -> Result<AppState, String> {
    let app_state_guard = state.lock().await;
    Ok(app_state_guard.clone())
}

#[tauri::command]
async fn update_settings(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    remote_localizations: State<'_, RemoteLocalizationsMutex>,
    patch: settings::SettingsPatch,
) -> Result<(), String> {
    debug!("Updating settings: {:?}", patch);

    let mut app_state_guard = state.lock().await;

    let source_changed = patch
        .selected_source
        .as_ref()
        .is_some_and(|source| app_state_guard.settings.selected_source.as_ref() != Some(source));

    app_state_guard
        .apply_settings_patch(&app_handle, patch)
        .map_err(|e| {
            error!("Failed to update settings: {:?}", e);
            e.to_string()
        })?;

    if source_changed {
        *remote_localizations.lock().await = None;
    }

    app_handle
        .emit("app_state_updated", app_state_guard.clone())
        .map_err(|e| {
            error!("Failed to emit app state updated: {:?}", e);
            e.to_string()
        })?;

    Ok(())
}

#[tauri::command]
async fn install_localization(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    localization_locks: State<'_, LocalizationLocks>,
    remote_localizations: State<'_, RemoteLocalizationsMutex>,
    localization_id: String,
) -> Result<(), String> {
    debug!("Installing localization: {:?}", localization_id);

    ensure_game_not_running().await?;

    let game_path = state.lock().await.game_path().map_err(|e| {
        error!("Failed to get game directory: {:?}", e);
        e.to_string()
    })?;

    let (localization, source) =
        resolve_localization(&app_handle, &state, &remote_localizations, &localization_id).await?;

    install_and_record(
        &app_handle,
        &state,
        &localization_locks,
        &game_path,
        &localization,
        &source,
    )
    .await
}

#[tauri::command]
async fn uninstall_localization(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    localization_locks: State<'_, LocalizationLocks>,
    localization_id: String,
) -> Result<(), String> {
    debug!("Uninstalling localization: {:?}", localization_id);

    ensure_game_not_running().await?;

    let game_path = {
        let app_state_guard = state.lock().await;

        let is_installed = app_state_guard
            .installed_metadata
            .as_ref()
            .is_some_and(|metadata| metadata.installed.contains_key(&localization_id));
        if !is_installed {
            return Err(format!("Localization {} is not installed", localization_id));
        }

        app_state_guard.game_path().map_err(|e| {
            error!("Failed to get game directory: {:?}", e);
            e.to_string()
        })?
    };

    let lock = localization_lock(&localization_locks, &localization_id, &game_path);
    let _acquired_lock = lock.lock().await;

    utils::uninstall_localization(&game_path, &localization_id)
        .await
        .map_err(|e| {
            error!("Failed to uninstall localization: {:?}", e);
            e.to_string()
        })?;

    let mut app_state_guard = state.lock().await;

    if let Some(installed_metadata) = &mut app_state_guard.installed_metadata {
        installed_metadata.installed.remove(&localization_id);
    }

    app_state_guard.save_installed_metadata().map_err(|e| {
        error!("Failed to save installed metadata: {:?}", e);
        e.to_string()
    })?;

    app_handle
        .emit("app_state_updated", app_state_guard.clone())
        .map_err(|e| {
            error!("Failed to emit app state updated: {:?}", e);
            e.to_string()
        })?;

    Ok(())
}

#[tauri::command]
async fn repair_localization(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    localization_locks: State<'_, LocalizationLocks>,
    remote_localizations: State<'_, RemoteLocalizationsMutex>,
    localization_id: String,
) -> Result<(), String> {
    debug!("Repairing localization: {:?}", localization_id);

    install_localization(
        app_handle,
        state,
        localization_locks,
        remote_localizations,
        localization_id,
    )
    .await
}

#[tauri::command]
async fn set_game_directory(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    directory: Option<String>,
) -> Result<(), String> {
    debug!("Setting game directory to: {:?}", directory);

    let mut app_state_guard = state.lock().await;

    app_state_guard
        .update_game_directory(&directory)
        .map_err(|e| {
            error!("Failed to update game directory: {:?}", e);
            e.to_string()
        })?;

    app_state_guard.save_settings(&app_handle).map_err(|e| {
        error!("Failed to save settings: {:?}", e);
        e.to_string()
    })?;

    app_handle
        .emit("app_state_updated", app_state_guard.clone())
        .map_err(|e| {
            error!("Failed to emit app state updated: {:?}", e);
            e.to_string()
        })?;

    Ok(())
}

#[tauri::command]
async fn update_and_play(
    app_handle: tauri::AppHandle,
    state: State<'_, AppStateMutex>,
    localization_locks: State<'_, LocalizationLocks>,
    remote_localizations: State<'_, RemoteLocalizationsMutex>,
) -> Result<(), String> {
    debug!("Running update and play");

    app_handle
        .emit("play:started", ())
        .map_err(|e| e.to_string())?;

    let game_running = steam::is_game_running().await.map_err(|e| {
        error!("Failed to check whether the game is running: {:?}", e);
        e.to_string()
    })?;
    if game_running {
        let _ = app_handle.emit("play:game_running", ());
        return Err("Game is already running".to_string());
    }

    let game_path = state.lock().await.game_path().map_err(|e| {
        error!("Failed to get game directory: {:?}", e);
        e.to_string()
    })?;

    let remote = refresh_remote_localizations(&app_handle, &state, &remote_localizations).await?;

    let localizations_to_update: Vec<utils::Localization> = state
        .lock()
        .await
        .installed_metadata
        .as_ref()
        .ok_or_else(|| "No installed metadata found".to_string())?
        .installed
        .values()
        .filter_map(|localization| {
            let Some(remote_localization) = remote
                .localizations
                .iter()
                .find(|l| l.id == localization.id)
            else {
                info!(
                    "Localization {} not found in remote source",
                    &localization.id
                );
                let _ = app_handle.emit("play:unknown_localization", &localization.id);
                return None;
            };

            let localization_path = game_path
                .join("LimbusCompany_Data")
                .join("Lang")
                .join(&localization.id);

            if localization_path.exists() && remote_localization.version == localization.version {
                info!("Localization {} is up to date", &localization.id);
                let _ = app_handle.emit("play:up_to_date", &localization.id);
                return None;
            }

            Some(remote_localization.clone())
        })
        .collect();

    for localization in &localizations_to_update {
        info!(
            "Updating localization {} to version {}",
            &localization.id, &localization.version
        );
        let _ = app_handle.emit("play:updating", &localization.id);

        install_and_record(
            &app_handle,
            &state,
            &localization_locks,
            &game_path,
            localization,
            &remote.source,
        )
        .await?;

        let _ = app_handle.emit("play:update_finished", &localization.id);
    }

    if let Err(e) = utils::validate_game_config(&game_path) {
        error!("Failed to validate game config: {:?}", e);
    }

    app_handle
        .emit("play:starting_game", ())
        .map_err(|e| e.to_string())?;
    steam::launch_game().map_err(|e| {
        error!("Failed to launch game: {:?}", e);
        e.to_string()
    })?;

    app_handle
        .emit("play:finished", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(128_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(10))
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle();

            let version = app_handle.package_info().version.to_string();
            info!("Initializing Limbus Localization Manager v{}", version);

            use tauri::{LogicalSize, WebviewUrl, WebviewWindowBuilder};
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Limbus Localization Manager")
                .resizable(false)
                .transparent(true)
                .decorations(false)
                .build()
                .unwrap();

            window.set_zoom(1.0).expect("Failed to set zoom");

            window
                .set_size(LogicalSize::new(640.0, 480.0))
                .expect("Failed to set size");

            let app_state = AppState::new(&app_handle);

            app.manage(Mutex::new(app_state));
            app.manage(Mutex::new(None::<RemoteLocalizations>));

            let localization_locks: LocalizationLocks = DashMap::new();
            app.manage(localization_locks);

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_available_localizations,
            get_app_state,
            get_latest_version,
            update_settings,
            install_localization,
            uninstall_localization,
            repair_localization,
            set_game_directory,
            update_and_play,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
