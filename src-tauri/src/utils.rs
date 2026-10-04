use anyhow::Context;
use futures::stream::StreamExt;
use log::{debug, error, info, warn};
use md5::{Digest, Md5};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{
    ffi::OsStr,
    fs,
    io::{self, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tempfile::{Builder, NamedTempFile};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use zip::ZipArchive;

const METADATA_FILE_NAME: &str = "llc_config.toml";
const REPO_NAME: &str = "kimght/LimbusLocalizationManager";
const USER_AGENT: &str = "Limbus Launcher";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_ATTEMPTS: u32 = 5;

static PINNED_ADDRESSES: std::sync::LazyLock<
    std::sync::RwLock<HashMap<String, std::net::SocketAddr>>,
> = std::sync::LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

static PINNED_CLIENT: std::sync::LazyLock<std::sync::RwLock<Option<Client>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(None));

static HTTP_CLIENT: std::sync::LazyLock<Client> = std::sync::LazyLock::new(|| {
    client_builder(CONNECT_TIMEOUT)
        .build()
        .expect("Failed to create HTTP client")
});

fn client_builder(connect_timeout: Duration) -> reqwest::ClientBuilder {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(connect_timeout)
        .read_timeout(READ_TIMEOUT)
}

fn with_pinned_addresses(
    mut builder: reqwest::ClientBuilder,
    candidate: Option<(&str, std::net::SocketAddr)>,
) -> reqwest::ClientBuilder {
    match PINNED_ADDRESSES.read() {
        Ok(addresses) => {
            for (host, address) in addresses.iter() {
                builder = builder.resolve(host, *address);
            }
        }
        Err(error) => warn!("Pinned addresses are unreadable, ignoring them: {}", error),
    }

    if let Some((host, address)) = candidate {
        builder = builder.resolve(host, address);
    }

    builder
}

fn rebuild_pinned_client() {
    let has_addresses = match PINNED_ADDRESSES.read() {
        Ok(addresses) => !addresses.is_empty(),
        Err(error) => {
            warn!("Pinned addresses are unreadable, ignoring them: {}", error);
            false
        }
    };

    let client = if has_addresses {
        let builder = with_pinned_addresses(client_builder(CONNECT_TIMEOUT), None);
        match builder.build() {
            Ok(client) => Some(client),
            Err(error) => {
                warn!("Failed to build the pinned client: {}", error);
                None
            }
        }
    } else {
        None
    };

    match PINNED_CLIENT.write() {
        Ok(mut pinned) => *pinned = client,
        Err(error) => warn!("Failed to store the pinned client: {}", error),
    }
}

fn request_client() -> Client {
    match PINNED_CLIENT.read() {
        Ok(pinned) => {
            if let Some(client) = pinned.as_ref() {
                return client.clone();
            }
        }
        Err(error) => warn!(
            "Pinned client is unreadable, using the default one: {}",
            error
        ),
    }

    HTTP_CLIENT.clone()
}

fn remember_address(host: &str, address: std::net::SocketAddr) {
    {
        let mut addresses = match PINNED_ADDRESSES.write() {
            Ok(addresses) => addresses,
            Err(error) => {
                warn!("Failed to remember {} for {}: {}", address, host, error);
                return;
            }
        };
        if addresses.get(host) == Some(&address) {
            return;
        }

        info!("Remembering working address {} for {}", address, host);
        addresses.insert(host.to_string(), address);
    }
    rebuild_pinned_client();
}

fn forget_address(host: &str) {
    let removed = {
        let mut addresses = match PINNED_ADDRESSES.write() {
            Ok(addresses) => addresses,
            Err(error) => {
                warn!("Failed to forget the address of {}: {}", host, error);
                return;
            }
        };
        match addresses.remove(host) {
            Some(address) => {
                info!("Address {} for {} stopped working", address, host);
                true
            }
            None => false,
        }
    };
    if removed {
        rebuild_pinned_client();
    }
}

async fn get_with_ip_fallback(
    url: &str,
    configure: impl Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, anyhow::Error> {
    let error = match configure(request_client().get(url)).send().await {
        Ok(response) => return Ok(response),
        Err(error) if error.is_connect() => error,
        Err(error) => return Err(error.into()),
    };

    let failing_url = match error.url() {
        Some(url) => url.clone(),
        None => reqwest::Url::parse(url).with_context(|| format!("Invalid url: {}", url))?,
    };

    let host = failing_url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Url has no host: {}", failing_url))?
        .to_string();

    let port = failing_url.port_or_known_default().unwrap_or(443);

    warn!(
        "Request to {} failed to connect ({}), retrying each address of {}",
        url, error, host
    );

    forget_address(&host);

    let addresses = tokio::net::lookup_host((host.as_str(), port))
        .await
        .with_context(|| format!("Failed to resolve {}", host))?;

    for address in addresses {
        debug!("Retrying {} with {} pinned to {}", url, host, address);

        let client = with_pinned_addresses(
            client_builder(PROBE_CONNECT_TIMEOUT),
            Some((&host, address)),
        )
        .build()
        .with_context(|| format!("Failed to create an HTTP client for {}", address))?;

        match configure(client.get(url)).send().await {
            Ok(response) => {
                info!("Connected to {} via {}", host, address);
                remember_address(&host, address);
                return Ok(response);
            }
            Err(error) => {
                warn!("Address {} of {} failed: {}", address, host, error);
            }
        }
    }

    Err(anyhow::anyhow!("All addresses of {} are unreachable", host))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct GameConfig {
    lang: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AvailableLocalizations {
    format_version: u32,
    localizations: Vec<Localization>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum Format {
    #[serde(rename = "compatible")]
    Compatible, // zip with Localize/LANG/... as we used to do before update
    #[serde(rename = "new")]
    New, // just contents of LANG folder
    #[serde(rename = "auto")]
    Auto, // Find the first folder with StoryData
    #[serde(untagged)]
    Unknown(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Font {
    pub url: String,  // Url to font file
    pub hash: String, // Md5 hash of the font file
    pub name: String, // Filename in Font/ folder
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Localization {
    pub id: String,           // Unique identifier
    pub version: String,      // Version
    pub name: String,         // Human readable name
    pub flag: String,         // Country code for flag
    pub icon: String,         // Icon url of the localization
    pub description: String,  // Description in markdown
    pub authors: Vec<String>, // List of authors
    pub url: String,          // Url to zip archive
    pub size: u64,            // Size of the zip archive to check integrity
    pub fonts: Vec<Font>,     // List of fonts to install
    pub format: Format,
}

impl Localization {
    fn validate(&self) -> Result<(), anyhow::Error> {
        validate_path_component(&self.id, "localization id")?;
        for font in &self.fonts {
            validate_relative_path(&font.name, "font name")?;
            anyhow::ensure!(
                font.hash.len() == 32 && font.hash.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid font hash {:?}",
                font.hash
            );
        }
        Ok(())
    }
}

fn validate_path_component(value: &str, what: &str) -> Result<(), anyhow::Error> {
    let mut components = Path::new(value).components();
    let is_single_name = matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(name)), None) if name == OsStr::new(value)
    );

    anyhow::ensure!(
        is_single_name && !value.contains(['/', '\\', ':']),
        "Invalid {}: {:?}",
        what,
        value
    );
    Ok(())
}

fn validate_relative_path(value: &str, what: &str) -> Result<(), anyhow::Error> {
    let is_valid = !value.is_empty()
        && !value.contains(':')
        && value
            .split(['/', '\\'])
            .all(|segment| validate_path_component(segment, what).is_ok());

    anyhow::ensure!(is_valid, "Invalid {}: {:?}", what, value);
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledLocalization {
    pub id: String,
    pub version: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledMetadata {
    pub format_version: u32,
    pub installed: HashMap<String, InstalledLocalization>,
}

impl InstalledMetadata {
    pub fn new() -> Self {
        Self {
            format_version: 1,
            installed: HashMap::new(),
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, anyhow::Error> + Send + 'static,
) -> Result<T, anyhow::Error> {
    tokio::task::spawn_blocking(work)
        .await
        .context("Blocking task failed")?
}

pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), anyhow::Error> {
    let directory = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("{:?} has no parent directory", path))?;

    let mut file = NamedTempFile::new_in(directory)
        .with_context(|| format!("Failed to create a temporary file in {:?}", directory))?;
    file.write_all(contents)
        .with_context(|| format!("Failed to write a temporary file for {:?}", path))?;
    file.as_file()
        .sync_all()
        .with_context(|| format!("Failed to flush a temporary file for {:?}", path))?;
    file.persist(path)
        .with_context(|| format!("Failed to replace {:?}", path))?;
    Ok(())
}

pub fn back_up_corrupt_file(path: &Path) {
    let mut backup = path.as_os_str().to_owned();
    backup.push(".bak");
    let backup = PathBuf::from(backup);

    match fs::rename(path, &backup) {
        Ok(()) => warn!("Moved unreadable {:?} to {:?}", path, backup),
        Err(e) => error!("Failed to back up unreadable {:?}: {}", path, e),
    }
}

pub fn load_installed_metadata(game_path: &Path) -> Result<InstalledMetadata, anyhow::Error> {
    let config_path = game_path.join(METADATA_FILE_NAME);

    if !config_path.exists() {
        let metadata = InstalledMetadata::new();
        save_installed_metadata(game_path, &metadata)?;
        return Ok(metadata);
    }

    let config_content = fs::read_to_string(&config_path)?;
    match toml::from_str(&config_content) {
        Ok(metadata) => Ok(metadata),
        Err(e) => {
            error!("Failed to parse {:?}: {}", config_path, e);
            back_up_corrupt_file(&config_path);
            Ok(InstalledMetadata::new())
        }
    }
}

pub fn save_installed_metadata(
    game_path: &Path,
    metadata: &InstalledMetadata,
) -> Result<(), anyhow::Error> {
    let config_content = toml::to_string(metadata)?;
    write_atomic(
        &game_path.join(METADATA_FILE_NAME),
        config_content.as_bytes(),
    )
}

pub async fn fetch_available_localizations(url: &str) -> Result<Vec<Localization>, anyhow::Error> {
    let response = get_with_ip_fallback(url, |request| request.timeout(DEFAULT_TIMEOUT))
        .await
        .with_context(|| format!("Request error"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("HTTP error: {}", response.status()));
    }

    let available: AvailableLocalizations = response
        .json()
        .await
        .with_context(|| format!("Failed to parse JSON"))?;

    Ok(available
        .localizations
        .into_iter()
        .filter(|localization| match localization.validate() {
            Ok(()) => true,
            Err(e) => {
                warn!("Skipping localization {:?}: {:#}", localization.id, e);
                false
            }
        })
        .collect())
}

fn lang_dir(game_path: &Path) -> PathBuf {
    game_path.join("LimbusCompany_Data").join("Lang")
}

const STAGING_DIR: &str = ".llm-staging";
const STAGING_RANDOM_LEN: usize = 6;

fn create_staging_dir(
    game_path: &Path,
    localization_id: &str,
) -> Result<tempfile::TempDir, anyhow::Error> {
    let root = game_path.join(STAGING_DIR);
    fs::create_dir_all(&root).with_context(|| format!("Failed to create {:?}", root))?;

    let suffix = format!(".{}", localization_id);
    for entry in fs::read_dir(&root)
        .with_context(|| format!("Failed to read {:?}", root))?
        .flatten()
    {
        let is_stale = entry
            .file_name()
            .to_str()
            .and_then(|name| name.get(STAGING_RANDOM_LEN..))
            .is_some_and(|rest| rest == suffix);

        if is_stale {
            info!("Removing stale staging directory {:?}", entry.path());
            if let Err(e) = fs::remove_dir_all(entry.path()) {
                warn!("Failed to remove {:?}: {}", entry.path(), e);
            }
        }
    }

    Builder::new()
        .prefix("")
        .rand_bytes(STAGING_RANDOM_LEN)
        .suffix(&suffix)
        .tempdir_in(&root)
        .with_context(|| format!("Failed to create a staging directory in {:?}", root))
}

pub async fn install_localization(
    game_path: &Path,
    localization: &Localization,
) -> Result<(), anyhow::Error> {
    localization.validate()?;

    let target = lang_dir(game_path).join(&localization.id);

    let staging = {
        let lang_dir = lang_dir(game_path);
        let game_path = game_path.to_path_buf();
        let id = localization.id.clone();
        blocking(move || {
            fs::create_dir_all(&lang_dir)
                .with_context(|| format!("Failed to create {:?}", lang_dir))?;
            create_staging_dir(&game_path, &id)
        })
        .await?
    };

    let result = stage_and_swap(
        game_path,
        localization,
        staging.path().to_path_buf(),
        target,
    )
    .await;

    if let Err(e) = blocking(move || Ok(staging.close()?)).await {
        warn!("Failed to remove the staging directory: {:#}", e);
    }

    result?;
    info!(
        "Successfully installed localization '{}' version '{}'",
        localization.id, localization.version
    );
    Ok(())
}

async fn stage_and_swap(
    game_path: &Path,
    localization: &Localization,
    staging: PathBuf,
    target: PathBuf,
) -> Result<(), anyhow::Error> {
    let archive = staging.join("localization.zip");

    download_to_file(&localization.url, &archive)
        .await
        .with_context(|| format!("Failed to download {}", localization.url))?;

    let size = tokio::fs::metadata(&archive)
        .await
        .with_context(|| format!("Failed to get file size"))?
        .len();
    anyhow::ensure!(
        size == localization.size,
        "File size mismatch: expected {} bytes, got {}",
        localization.size,
        size
    );
    info!(
        "Successfully downloaded localization from: {}",
        &localization.url
    );

    let extract_path = staging.join("extract");
    let format = localization.format.clone();
    let language_dir = blocking(move || {
        debug!("Extracting localization to: {:?}", extract_path);
        extract_zip_archive(&archive, &extract_path)?;
        find_language_directory(&extract_path, &format)
    })
    .await?;

    install_fonts(game_path, &localization.fonts, &language_dir.join("Font")).await?;

    blocking(move || swap_into_place(&language_dir, &target, &staging)).await
}

fn swap_into_place(new_dir: &Path, target: &Path, staging: &Path) -> Result<(), anyhow::Error> {
    let previous = staging.join("previous");

    let had_previous = match fs::rename(target, &previous) {
        Ok(()) => true,
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => {
            return Err(e).with_context(|| format!("Failed to move aside {:?}", target));
        }
    };

    if let Err(e) = fs::rename(new_dir, target) {
        if had_previous {
            if let Err(restore) = fs::rename(&previous, target) {
                error!("Failed to restore {:?}: {}", target, restore);
            }
        }
        return Err(e).with_context(|| format!("Failed to move the new files into {:?}", target));
    }

    debug!("Installed {:?}", target);
    Ok(())
}

async fn install_fonts(
    game_path: &Path,
    fonts: &[Font],
    font_dir: &Path,
) -> Result<(), anyhow::Error> {
    let cache_dir = game_path.join("FontCache");

    for font in fonts {
        let cached = cache_font(&cache_dir, font).await?;
        let target = font_dir.join(&font.name);
        let target_dir = target
            .parent()
            .map_or_else(|| font_dir.to_path_buf(), Path::to_path_buf);

        blocking(move || {
            fs::create_dir_all(&target_dir)
                .with_context(|| format!("Failed to create {:?}", target_dir))?;
            debug!("Copying font from cache {:?} to {:?}", cached, target);
            fs::copy(&cached, &target).with_context(|| {
                format!("Failed to copy font from {:?} to {:?}", cached, target)
            })?;
            Ok(())
        })
        .await?;

        info!("Installed font {}", font.name);
    }

    Ok(())
}

async fn cache_font(cache_dir: &Path, font: &Font) -> Result<PathBuf, anyhow::Error> {
    let extension = Path::new(&font.url)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .filter(|ext| ext == "ttf" || ext == "otf")
        .unwrap_or_else(|| "ttf".to_string());

    let cache_path = cache_dir.join(format!("{}.{}", font.hash, extension));

    let is_cached = {
        let cache_dir = cache_dir.to_path_buf();
        let cache_path = cache_path.clone();
        let expected_hash = font.hash.clone();
        blocking(move || {
            fs::create_dir_all(&cache_dir)
                .with_context(|| format!("Failed to create {:?}", cache_dir))?;

            if !cache_path.exists() {
                return Ok(false);
            }

            match calculate_md5(&cache_path) {
                Ok(hash) if hash == expected_hash => return Ok(true),
                Ok(hash) => debug!(
                    "Cached font {:?} has hash {}, expected {}. Re-downloading.",
                    cache_path, hash, expected_hash
                ),
                Err(e) => debug!(
                    "Failed to hash cached font {:?}: {:#}. Re-downloading.",
                    cache_path, e
                ),
            }

            fs::remove_file(&cache_path)
                .with_context(|| format!("Failed to remove cached font {:?}", cache_path))?;
            Ok(false)
        })
        .await?
    };

    if is_cached {
        info!("Using cached font: {:?}", cache_path);
    } else {
        info!("Downloading font from: {}", font.url);
        download_and_validate_font(&font.url, cache_dir, &cache_path, &font.hash).await?;
    }

    Ok(cache_path)
}

pub async fn uninstall_localization(
    game_path: &Path,
    localization_id: &str,
) -> Result<(), anyhow::Error> {
    validate_path_component(localization_id, "localization id")?;

    let game_path = game_path.to_path_buf();
    let id = localization_id.to_owned();

    blocking(move || {
        let target = lang_dir(&game_path).join(&id);
        if !target.exists() {
            info!("Localization '{}' not found, skipping uninstall", id);
            return Ok(());
        }

        let staging = create_staging_dir(&game_path, &id)?;

        fs::rename(&target, staging.path().join("previous"))
            .with_context(|| format!("Failed to uninstall localization '{}'", id))?;

        if let Err(e) = staging.close() {
            warn!("Failed to delete files of uninstalled '{}': {}", id, e);
        }
        Ok(())
    })
    .await
}

pub async fn get_latest_version() -> Result<String, anyhow::Error> {
    let response = get_with_ip_fallback(
        &format!("https://api.github.com/repos/{}/releases/latest", REPO_NAME),
        |request| request.timeout(DEFAULT_TIMEOUT),
    )
    .await
    .with_context(|| format!("Failed to get latest version"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("HTTP error: {}", response.status()));
    }

    let body = response.text().await?;
    let json: serde_json::Value = serde_json::from_str(&body)?;

    let tag_name = json
        .get("tag_name")
        .ok_or_else(|| anyhow::anyhow!("No tag name found in response"))?
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Tag name is not a string"))?;

    info!("Latest version: {}", tag_name);
    Ok(tag_name.to_string())
}

pub fn validate_game_config(game_path: &Path) -> Result<(), anyhow::Error> {
    let config_path = lang_dir(game_path).join("config.json");

    if !config_path.exists() {
        debug!("Config file does not exist, the game will create it");
        return Ok(());
    }

    if !config_path.is_file() {
        return Err(anyhow::anyhow!("Config file is not a file"));
    }

    let config_content =
        fs::read_to_string(&config_path).with_context(|| format!("Failed to read config file"))?;

    match serde_json::from_str::<GameConfig>(&config_content) {
        Ok(config) => {
            if config.lang.is_empty() {
                return Err(anyhow::anyhow!("Config file is empty"));
            }

            let active_localization = lang_dir(game_path).join(&config.lang);

            if !active_localization.exists() {
                debug!("Active localization does not exist, deleting config file");
                fs::remove_file(&config_path)
                    .with_context(|| format!("Failed to delete config file"))?;
            }

            Ok(())
        }
        Err(e) => {
            debug!("Failed to parse config file, deleting it, error: {:?}", e);
            fs::remove_file(&config_path)
                .with_context(|| format!("Failed to delete config file"))?;

            return Ok(());
        }
    }
}

enum AttemptError {
    Retry(anyhow::Error),
    Fatal(anyhow::Error),
}

async fn download_to_file(url: &str, path: &Path) -> Result<(), anyhow::Error> {
    let mut file = tokio::fs::File::create(path)
        .await
        .with_context(|| format!("Failed to create {:?}", path))?;
    let mut downloaded = 0;
    let mut furthest = 0;
    let mut failures = 0;

    loop {
        match download_attempt(url, &mut file, &mut downloaded).await {
            Ok(()) => break,
            Err(AttemptError::Fatal(error)) => return Err(error),
            Err(AttemptError::Retry(error)) => {
                if downloaded > furthest {
                    furthest = downloaded;
                    failures = 0;
                }
                failures += 1;
                if failures >= DOWNLOAD_ATTEMPTS {
                    return Err(error.context(format!(
                        "Download failed {} times in a row at {} bytes",
                        failures, downloaded
                    )));
                }
                let delay = Duration::from_secs(1 << (failures - 1));
                warn!(
                    "Download of {} interrupted at {} bytes, retrying in {:?}: {:#}",
                    url, downloaded, delay, error
                );
                tokio::time::sleep(delay).await;
            }
        }
    }

    file.flush()
        .await
        .with_context(|| format!("Failed to flush {:?}", path))?;
    file.sync_all()
        .await
        .with_context(|| format!("Failed to sync {:?}", path))?;
    Ok(())
}

async fn download_attempt(
    url: &str,
    file: &mut tokio::fs::File,
    downloaded: &mut u64,
) -> Result<(), AttemptError> {
    let start = *downloaded;
    let response = get_with_ip_fallback(url, |request| {
        if start == 0 {
            request
        } else {
            request.header(reqwest::header::RANGE, format!("bytes={}-", start))
        }
    })
    .await
    .map_err(AttemptError::Retry)?;

    let status = response.status();
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT
        && content_range_start(&response) == Some(start);

    if start > 0
        && !resumed
        && (status.is_success() || status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE)
    {
        info!(
            "Server did not resume {} at {} bytes, restarting",
            url, start
        );
        file.set_len(0)
            .await
            .context("Failed to truncate partial download")
            .map_err(AttemptError::Fatal)?;
        file.seek(io::SeekFrom::Start(0))
            .await
            .context("Failed to rewind partial download")
            .map_err(AttemptError::Fatal)?;
        *downloaded = 0;
        if !status.is_success() {
            return Err(AttemptError::Retry(anyhow::anyhow!(
                "HTTP error {}",
                status
            )));
        }
    }

    if !status.is_success() {
        let error = anyhow::anyhow!("HTTP error {}", status);
        let transient = status.is_server_error()
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS
            || status == reqwest::StatusCode::REQUEST_TIMEOUT;
        return Err(if transient {
            AttemptError::Retry(error)
        } else {
            AttemptError::Fatal(error)
        });
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .context("Failed to read chunk")
            .map_err(AttemptError::Retry)?;
        file.write_all(&chunk)
            .await
            .context("Failed to write data chunk to file")
            .map_err(AttemptError::Fatal)?;
        *downloaded += chunk.len() as u64;
    }
    Ok(())
}

fn content_range_start(response: &reqwest::Response) -> Option<u64> {
    let value = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    value
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .parse()
        .ok()
}

fn extract_zip_archive(zip_path: &Path, extract_path: &Path) -> Result<(), anyhow::Error> {
    let file = fs::File::open(zip_path).with_context(|| format!("Failed to open zip file"))?;

    let mut archive =
        ZipArchive::new(file).with_context(|| format!("Failed to read ZIP archive"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .with_context(|| format!("Error reading file in zip"))?;

        let outpath = match file.enclosed_name() {
            Some(path) => extract_path.join(path),
            None => {
                warn!("Entry {} has unsafe path, skipping.", i);
                continue;
            }
        };

        extract_zip_entry(&mut file, &outpath)?;
    }

    Ok(())
}

fn extract_zip_entry(file: &mut zip::read::ZipFile, outpath: &Path) -> Result<(), anyhow::Error> {
    if file.name().ends_with('/') {
        debug!("Creating directory: {:?}", outpath);
        fs::create_dir_all(outpath)
            .with_context(|| format!("Failed to create directory during extraction"))?;
    } else {
        debug!("Extracting file: {:?}", outpath);
        if let Some(parent) = outpath.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).with_context(|| {
                    format!("Failed to create parent directory during extraction")
                })?;
            }
        }

        let mut outfile = fs::File::create(outpath)
            .with_context(|| format!("Failed to create file during extraction"))?;

        io::copy(file, &mut outfile)
            .with_context(|| format!("Failed to copy file during extraction"))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = file.unix_mode() {
            fs::set_permissions(outpath, fs::Permissions::from_mode(mode))
                .with_context(|| format!("Failed to set permissions"))?;
        }
    }

    Ok(())
}

fn find_language_directory(extract_path: &Path, format: &Format) -> Result<PathBuf, anyhow::Error> {
    match format {
        Format::Compatible => find_language_dir(extract_path),
        Format::Auto => find_language_dir(extract_path),
        Format::New => {
            debug!(
                "Using 'new' format, language directory is root: {:?}",
                extract_path
            );
            Ok(extract_path.to_path_buf())
        }
        Format::Unknown(unknown) => {
            Err(anyhow::anyhow!("Unknown localization format: {}", unknown))
        }
    }
}

fn find_language_dir(extract_path: &Path) -> Result<PathBuf, anyhow::Error> {
    fn find_story_data_dir(path: &Path) -> Option<PathBuf> {
        if path.join("StoryData").is_dir() {
            return Some(path.to_path_buf());
        }

        if path.is_dir() {
            for entry in fs::read_dir(path).ok()? {
                if let Ok(entry) = entry {
                    let entry_path = entry.path();
                    if let Some(found) = find_story_data_dir(&entry_path) {
                        return Some(found);
                    }
                }
            }
        }

        None
    }

    match find_story_data_dir(extract_path) {
        Some(path) => {
            debug!("Found compatible language directory: {:?}", path);
            Ok(path)
        }
        None => Err(anyhow::anyhow!(
            "Could not find language directory with StoryData in '{:?}'.",
            extract_path
        )),
    }
}

fn calculate_md5(file_path: &Path) -> Result<String, anyhow::Error> {
    let file = fs::File::open(file_path)
        .with_context(|| format!("Failed to open file for hashing {:?}", file_path))?;

    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Md5::new();
    let mut buffer = [0; 1024];

    loop {
        let n = reader
            .read(&mut buffer)
            .with_context(|| format!("Failed to read file chunk for hashing {:?}", file_path))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

async fn download_and_validate_font(
    url: &str,
    cache_dir: &Path,
    save_path: &Path,
    expected_hash: &str,
) -> Result<(), anyhow::Error> {
    debug!("Starting download from {} to {:?}", url, save_path);

    let temp_path = {
        let cache_dir = cache_dir.to_path_buf();
        blocking(move || {
            Ok(NamedTempFile::new_in(&cache_dir)
                .with_context(|| format!("Failed to create a temporary file in {:?}", cache_dir))?
                .into_temp_path())
        })
        .await?
    };

    download_to_file(url, &temp_path)
        .await
        .with_context(|| format!("Font download from {} failed", url))?;

    let hashed_path = temp_path.to_path_buf();
    let calculated_hash = blocking(move || calculate_md5(&hashed_path)).await?;

    anyhow::ensure!(
        calculated_hash == expected_hash,
        "Font hash mismatch for {}. Expected: {}, Calculated: {}.",
        url,
        expected_hash,
        calculated_hash
    );

    temp_path
        .persist(save_path)
        .with_context(|| format!("Failed to move downloaded font to {:?}", save_path))?;

    info!(
        "Font downloaded successfully to {:?} and hash validated ({})",
        save_path, calculated_hash
    );
    Ok(())
}
