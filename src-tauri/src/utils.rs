use anyhow::Context;
use futures::stream::StreamExt;
use log::{debug, info, warn};
use md5::{Digest, Md5};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{
    fs,
    io::{self, BufReader, Read, Seek, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::Builder;
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

    pub fn with_localization(localization: &Localization, source: &String) -> Self {
        let mut installed_metadata = Self::new();

        installed_metadata.installed.insert(
            localization.id.clone(),
            InstalledLocalization {
                id: localization.id.clone(),
                version: localization.version.clone(),
                source: source.clone(),
            },
        );

        installed_metadata
    }
}

pub fn load_installed_metadata(game_path: &PathBuf) -> Result<InstalledMetadata, anyhow::Error> {
    let config_path = game_path.join(METADATA_FILE_NAME);

    if !config_path.exists() {
        let metadata = InstalledMetadata::new();
        let config_content = toml::to_string(&metadata)?;
        fs::write(&config_path, config_content)?;
        return Ok(metadata);
    }

    let config_content = fs::read_to_string(&config_path)?;
    let metadata: InstalledMetadata = toml::from_str(&config_content)?;
    Ok(metadata)
}

pub fn save_installed_metadata(
    game_path: &PathBuf,
    metadata: &InstalledMetadata,
) -> Result<(), anyhow::Error> {
    let config_path = game_path.join(METADATA_FILE_NAME);
    let config_content = toml::to_string(metadata)?;
    fs::write(&config_path, config_content)?;
    Ok(())
}

pub async fn fetch_available_localizations(url: &str) -> Result<Vec<Localization>, anyhow::Error> {
    let response = get_with_ip_fallback(url, |request| request.timeout(DEFAULT_TIMEOUT))
        .await
        .with_context(|| format!("Request error"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("HTTP error: {}", response.status()));
    }

    let localizations: AvailableLocalizations = response
        .json()
        .await
        .with_context(|| format!("Failed to parse JSON"))?;

    Ok(localizations.localizations)
}

pub async fn install_fonts_for_localization(
    game_path: &PathBuf,
    localization: &Localization,
) -> Result<(), anyhow::Error> {
    let font_cache_dir = game_path.join("FontCache");
    fs::create_dir_all(&font_cache_dir)
        .with_context(|| format!("Failed to create FontCache directory"))?;

    for font_info in &localization.fonts {
        let font_url = &font_info.url;
        let expected_hash = &font_info.hash;

        let extension = Path::new(font_url)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_lowercase())
            .filter(|ext| ext == "ttf" || ext == "otf")
            .unwrap_or_else(|| "ttf".to_string());

        let chache_font_filename = format!("{}.{}", expected_hash, extension);
        let font_cache_path = font_cache_dir.join(&chache_font_filename);

        let mut needs_download = true;
        if font_cache_path.exists() {
            debug!("Font found in cache: {:?}", font_cache_path);
            match calculate_md5(&font_cache_path) {
                Ok(calculated_hash) => {
                    if calculated_hash == *expected_hash {
                        debug!("Cached font hash matches. Skipping download.");
                        needs_download = false;
                    } else {
                        debug!(
                            "Cached font hash mismatch (expected: {}, found: {}). Re-downloading.",
                            expected_hash, calculated_hash
                        );
                        fs::remove_file(&font_cache_path).with_context(|| {
                            format!(
                                "Failed to remove mismatched cached font {:?}",
                                font_cache_path
                            )
                        })?;
                    }
                }
                Err(e) => {
                    debug!(
                        "Failed to calculate hash for cached font {:?}: {}. Re-downloading.",
                        font_cache_path, e
                    );
                    fs::remove_file(&font_cache_path).with_context(|| {
                        format!(
                            "Failed to remove potentially corrupted cached font {:?}",
                            font_cache_path
                        )
                    })?;
                }
            }
        }

        if needs_download {
            info!("Downloading font from: {}", font_url);
            download_and_validate_font(font_url, &font_cache_path, expected_hash).await?;
        } else {
            info!("Using cached font: {:?}", font_cache_path);
        }

        let target_font_path = game_path
            .join("LimbusCompany_Data")
            .join("Lang")
            .join(&localization.id)
            .join("Font")
            .join(&font_info.name);

        let target_fonts_dir = target_font_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid font target path"))?;

        fs::create_dir_all(&target_fonts_dir).with_context(|| {
            format!(
                "Failed to create target Font directory {:?}",
                target_fonts_dir
            )
        })?;

        let mut needs_copy = true;
        if target_font_path.exists() {
            match calculate_md5(&target_font_path) {
                Ok(target_hash) => {
                    if target_hash == *expected_hash {
                        debug!(
                            "Target font {:?} already exists and hash matches. Skipping copy.",
                            target_font_path
                        );
                        needs_copy = false;
                    } else {
                        debug!(
                            "Target font {:?} exists but hash mismatches. Overwriting.",
                            target_font_path
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        "Failed to calculate hash for target font {:?}: {}. Overwriting.",
                        target_font_path, e
                    );
                }
            }
        }

        if needs_copy {
            debug!(
                "Copying font from cache {:?} to {:?}",
                font_cache_path, target_font_path
            );
            fs::copy(&font_cache_path, &target_font_path).with_context(|| {
                format!(
                    "Failed to copy font from cache {:?} to target {:?}",
                    font_cache_path, target_font_path
                )
            })?;
        }

        info!(
            "Successfully installed font for localization '{}'",
            localization.id
        );
    }

    Ok(())
}

pub async fn install_localization(
    game_path: &PathBuf,
    localization: &Localization,
) -> Result<(), anyhow::Error> {
    let temp_dir = create_temp_directory(&localization.id)?;
    let extract_path = temp_dir.path();

    let download_path = download_localization_file(&localization, &temp_dir).await?;

    debug!("Extracting localization to: {:?}", extract_path);
    extract_zip_archive(&download_path, extract_path)?;

    let language_dir = find_language_directory(extract_path, &localization.format)?;
    install_to_game_directory(&game_path, &language_dir, &localization)?;

    info!(
        "Successfully installed localization '{}' version '{}'",
        localization.id, localization.version
    );
    Ok(())
}

pub async fn uninstall_localization(
    game_path: &PathBuf,
    localization: &Localization,
) -> Result<(), anyhow::Error> {
    let target_base_path = game_path.join("LimbusCompany_Data").join("Lang");
    let target_path = target_base_path.join(&localization.id);

    if !target_path.exists() {
        info!(
            "Localization '{}' not found, skipping uninstall",
            localization.id
        );
        return Ok(());
    }

    fs::remove_dir_all(&target_path)
        .with_context(|| format!("Failed to uninstall localization '{}'", localization.id))?;

    Ok(())
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

pub fn validate_game_config(game_path: &PathBuf) -> Result<(), anyhow::Error> {
    let config_path = game_path
        .join("LimbusCompany_Data")
        .join("Lang")
        .join("config.json");

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

            let active_localization = game_path
                .join("LimbusCompany_Data")
                .join("Lang")
                .join(&config.lang);

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

fn create_temp_directory(localization_id: &str) -> Result<tempfile::TempDir, anyhow::Error> {
    Builder::new()
        .prefix(&format!("limbus_loc_{}", localization_id))
        .tempdir()
        .with_context(|| format!("Failed to create temporary directory"))
}

async fn download_localization_file(
    localization: &Localization,
    temp_dir: &tempfile::TempDir,
) -> Result<PathBuf, anyhow::Error> {
    let download_path = temp_dir.path().join("localization.zip");

    download_to_file(&localization.url, &download_path)
        .await
        .with_context(|| format!("Failed to download {}", localization.url))?;

    let size = fs::metadata(&download_path)
        .with_context(|| format!("Failed to get file size"))?
        .len();

    if size != localization.size {
        return Err(anyhow::anyhow!("File size mismatch"));
    }

    info!(
        "Successfully downloaded localization from: {}",
        &localization.url
    );
    Ok(download_path)
}

enum AttemptError {
    Retry(anyhow::Error),
    Fatal(anyhow::Error),
}

async fn download_to_file(url: &str, path: &Path) -> Result<(), anyhow::Error> {
    let mut file =
        fs::File::create(path).with_context(|| format!("Failed to create {:?}", path))?;
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

    file.sync_all()
        .with_context(|| format!("Failed to flush {:?}", path))?;
    Ok(())
}

async fn download_attempt(
    url: &str,
    file: &mut fs::File,
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
            .and_then(|()| file.rewind())
            .context("Failed to truncate partial download")
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

fn install_to_game_directory(
    game_path: &PathBuf,
    language_dir: &Path,
    localization: &Localization,
) -> Result<(), anyhow::Error> {
    let target_base_path = game_path.join("LimbusCompany_Data").join("Lang");
    let target_path = target_base_path.join(&localization.id);

    debug!("Target installation path: {:?}", target_path);

    if target_path.exists() {
        info!("Removing existing localization at {:?}", target_path);
        fs::remove_dir_all(&target_path)
            .with_context(|| format!("Failed to remove existing localization directory"))?;
    }

    fs::create_dir_all(&target_base_path)
        .with_context(|| format!("Failed to create base Lang directory"))?;

    fs::create_dir(&target_path)
        .with_context(|| format!("Failed to create target localization directory"))?;

    debug!("Moving files from {:?} to {:?}", language_dir, target_path);
    copy_directory_contents(language_dir, &target_path)?;

    Ok(())
}

fn copy_directory_contents(src_dir: &Path, dest_dir: &Path) -> Result<(), anyhow::Error> {
    for entry in fs::read_dir(src_dir)
        .with_context(|| format!("Failed to read language directory {:?}", src_dir))?
    {
        let entry = entry.with_context(|| format!("Error reading entry in language dir"))?;
        let source_path = entry.path();
        let file_name = entry.file_name();

        if file_name == "localization.zip" {
            debug!("Skipping localization.zip file");
            continue;
        }

        let destination_path = dest_dir.join(&file_name);

        debug!("Copying {:?} -> {:?}", source_path, destination_path);

        if source_path.is_dir() {
            fs::create_dir_all(&destination_path)
                .with_context(|| format!("Failed to create directory {:?}", destination_path))?;
            copy_directory_contents(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).with_context(|| {
                format!(
                    "Failed to copy file {:?} to {:?}",
                    source_path, destination_path
                )
            })?;
        }
    }

    Ok(())
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
    save_path: &Path,
    expected_hash: &str,
) -> Result<(), anyhow::Error> {
    debug!("Starting download from {} to {:?}", url, save_path);

    if let Some(parent_dir) = save_path.parent() {
        fs::create_dir_all(parent_dir).with_context(|| {
            format!("Failed to create directory for font file {:?}", parent_dir)
        })?;
    }

    let temp_save_path = save_path.with_extension("tmp_download");

    download_to_file(url, &temp_save_path)
        .await
        .with_context(|| format!("Font download from {} failed", url))?;

    let calculated_hash = calculate_md5(&temp_save_path)?;

    if calculated_hash != expected_hash {
        fs::remove_file(&temp_save_path).ok();
        Err(anyhow::anyhow!(
            "Font hash mismatch for {}. Expected: {}, Calculated: {}. Download saved to {:?} was discarded.",
            url, expected_hash, calculated_hash, temp_save_path
        ))
    } else {
        fs::rename(&temp_save_path, save_path).with_context(|| {
            format!(
                "Failed to rename temporary font file {:?} to {:?}",
                temp_save_path, save_path
            )
        })?;

        info!(
            "Font downloaded successfully to {:?} and hash validated ({})",
            save_path, calculated_hash
        );
        Ok(())
    }
}
