import hashlib
import json
import logging
import re
import tempfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import BinaryIO, Protocol, cast
from urllib.parse import urlparse

import minio
import requests
from minio.error import S3Error

from llm_updater.config import (
    get_bool_env,
    get_optional_env,
    get_required_env,
    load_config,
    validate_config_entry,
)
from llm_updater.github import (
    IconCache,
    get_description,
    get_localization_asset_info,
    get_optimized_icon,
    get_release_info,
)
from llm_updater.http import (
    create_session,
    get_download_timeout,
    get_github_headers,
    get_metadata_timeout,
    get_proxies,
)
from llm_updater.models import ConfigEntry, FontInfo, Localization, extract_previous_localizations

logger = logging.getLogger(__name__)

MANIFEST_OBJECT_NAME = "localizations.json"
CHAPTERS_OBJECT_NAME = "chapters.json"
MINIO_PART_SIZE = 10 * 1024 * 1024  # 10 MiB
DOWNLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MiB

_SAFE_KEY_CHARS_RE = re.compile(r"[^A-Za-z0-9._-]+")
_ALLOWED_FONT_EXTS = frozenset({"ttf", "otf"})
_ICON_CACHE = IconCache()


class ObjectStat(Protocol):
    @property
    def size(self) -> int | None: ...
    @property
    def etag(self) -> str | None: ...
    @property
    def metadata(self) -> Mapping[str, object] | None: ...


class ListedObject(Protocol):
    @property
    def object_name(self) -> str | None: ...


class ObjectResponse(Protocol):
    def read(self) -> bytes: ...
    def close(self) -> None: ...
    def release_conn(self) -> None: ...


class ObjectStore(Protocol):
    def bucket_exists(self, bucket_name: str) -> bool: ...

    def stat_object(self, bucket_name: str, object_name: str) -> ObjectStat: ...

    def get_object(self, bucket_name: str, object_name: str) -> ObjectResponse: ...

    def put_object(
        self,
        bucket_name: str,
        object_name: str,
        data: BinaryIO,
        length: int,
        *,
        content_type: str = ...,
        metadata: dict[str, str | list[str] | tuple[str]] | None = ...,
        part_size: int = ...,
    ) -> object: ...

    def list_objects(
        self,
        bucket_name: str,
        *,
        recursive: bool = ...,
    ) -> Iterable[ListedObject]: ...

    def remove_object(self, bucket_name: str, object_name: str) -> None: ...


@dataclass(frozen=True)
class MirrorSettings:
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    minio_public_url: str
    minio_secure: bool = False
    github_token: str | None = None
    github_proxy: str | None = None
    config_url: str | None = None
    chapters_url: str | None = None


def load_settings() -> MirrorSettings:
    minio_endpoint = get_required_env("MINIO_ENDPOINT")
    minio_secure = get_bool_env("MINIO_SECURE", False)
    default_public_url = f"{'https' if minio_secure else 'http'}://{minio_endpoint}"
    explicit_public_url = get_optional_env("MINIO_PUBLIC_URL")
    if explicit_public_url is None:
        logger.warning(
            "MINIO_PUBLIC_URL is not set; falling back to %s (may be unreachable by external clients)",
            default_public_url,
        )
    minio_public_url = (explicit_public_url or default_public_url).rstrip("/")
    minio_bucket = get_optional_env("MINIO_BUCKET", "localizations") or "localizations"
    github_token = get_optional_env("GITHUB_TOKEN")
    if github_token is None:
        logger.warning("GITHUB_TOKEN is not set; GitHub API requests are limited to 60/hour per IP")

    return MirrorSettings(
        minio_endpoint=minio_endpoint,
        minio_access_key=get_required_env("MINIO_ACCESS_KEY"),
        minio_secret_key=get_required_env("MINIO_SECRET_KEY"),
        minio_bucket=minio_bucket,
        minio_public_url=minio_public_url,
        minio_secure=minio_secure,
        github_token=github_token,
        github_proxy=get_optional_env("GITHUB_PROXY"),
        config_url=get_optional_env("CONFIG_URL"),
        chapters_url=get_optional_env("CHAPTERS_URL"),
    )


def sanitize_version_for_key(version: str) -> str:
    sanitized = _SAFE_KEY_CHARS_RE.sub("_", version.strip())
    if not sanitized or sanitized in {".", ".."}:
        raise ValueError(f"Invalid release version for object key: {version!r}")
    return sanitized


def get_font_extension(font: FontInfo) -> str:
    for candidate in (urlparse(font["url"]).path, font["name"]):
        ext = Path(candidate).suffix.lstrip(".").lower()
        if ext in _ALLOWED_FONT_EXTS:
            return f".{ext}"
    return ""


def stat_object_safe(
    client: ObjectStore,
    bucket: str,
    object_name: str,
) -> ObjectStat | None:
    try:
        return client.stat_object(bucket, object_name)
    except S3Error as e:
        if e.code == "NoSuchKey":
            return None
        raise


def _extract_metadata_md5(stat: ObjectStat) -> str | None:
    metadata = stat.metadata
    if metadata:
        for key, value in metadata.items():
            if key.lower() == "x-amz-meta-md5" and value:
                return str(value).strip().lower()
    etag = stat.etag
    if isinstance(etag, str):
        cleaned = etag.strip('"').lower()
        if len(cleaned) == 32 and "-" not in cleaned:
            return cleaned
    return None


def _object_matches(
    stat: ObjectStat,
    *,
    expected_size: int | None = None,
    expected_md5: str | None = None,
) -> bool:
    if expected_size is not None and stat.size != expected_size:
        return False
    if expected_md5 is not None:
        existing_md5 = _extract_metadata_md5(stat)
        if existing_md5 != expected_md5.lower():
            return False
    return True


def sync_to_minio(
    client: ObjectStore,
    session: requests.Session,
    bucket: str,
    source_url: str,
    object_name: str,
    *,
    expected_size: int | None = None,
    expected_md5: str | None = None,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> None:
    existing = stat_object_safe(client, bucket, object_name)
    if existing is not None:
        if _object_matches(existing, expected_size=expected_size, expected_md5=expected_md5):
            return
        logger.warning(
            "Existing object %s failed integrity check (size=%s, etag=%s); re-downloading",
            object_name,
            existing.size,
            existing.etag,
        )

    headers = get_github_headers(source_url, github_token, accept_json=False)
    headers["Accept-Encoding"] = "identity"

    logger.info("Downloading %s -> %s", source_url, object_name)
    with session.get(
        source_url,
        headers=headers,
        proxies=get_proxies(source_url, github_proxy),
        stream=True,
        timeout=get_download_timeout(),
    ) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "application/octet-stream")

        hasher = hashlib.md5()
        actual_size = 0

        with tempfile.TemporaryFile() as tmp:
            for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                if not chunk:
                    continue
                tmp.write(chunk)
                hasher.update(chunk)
                actual_size += len(chunk)

            actual_md5 = hasher.hexdigest()

            if expected_size is not None and actual_size != expected_size:
                raise ValueError(
                    f"Downloaded size mismatch for {object_name}: "
                    f"expected {expected_size} bytes, got {actual_size}"
                )

            if expected_md5 is not None and actual_md5 != expected_md5.lower():
                raise ValueError(
                    f"Downloaded MD5 mismatch for {object_name}: "
                    f"expected {expected_md5.lower()}, got {actual_md5}"
                )

            tmp.seek(0)
            client.put_object(
                bucket,
                object_name,
                data=tmp,
                length=actual_size,
                part_size=MINIO_PART_SIZE,
                content_type=content_type,
                metadata={"md5": actual_md5},
            )


def sync_chapters(
    client: ObjectStore,
    session: requests.Session,
    bucket: str,
    source_url: str,
    *,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> str:
    response = session.get(
        source_url,
        headers=get_github_headers(source_url, github_token, accept_json=False),
        proxies=get_proxies(source_url, github_proxy),
        timeout=get_metadata_timeout(),
    )
    response.raise_for_status()

    data = response.content
    # Validate JSON so a broken upstream response never overwrites chapters.json
    json.loads(data.decode("utf-8"))

    actual_md5 = hashlib.md5(data).hexdigest()
    existing = stat_object_safe(client, bucket, CHAPTERS_OBJECT_NAME)
    if existing is not None and _object_matches(existing, expected_md5=actual_md5):
        logger.debug("Chapters file %s is unchanged", CHAPTERS_OBJECT_NAME)
        return CHAPTERS_OBJECT_NAME

    client.put_object(
        bucket,
        CHAPTERS_OBJECT_NAME,
        BytesIO(data),
        len(data),
        content_type="application/json; charset=utf-8",
        metadata={"md5": actual_md5},
    )
    logger.info("Updated %s (%d bytes)", CHAPTERS_OBJECT_NAME, len(data))
    return CHAPTERS_OBJECT_NAME


def load_current_manifest(client: ObjectStore, bucket: str) -> dict[str, object]:
    try:
        response = client.get_object(bucket, MANIFEST_OBJECT_NAME)
    except S3Error as e:
        if e.code == "NoSuchKey":
            return {}
        raise

    try:
        raw = response.read()
    finally:
        response.close()
        response.release_conn()

    if not raw.strip():
        return {}

    try:
        parsed: object = json.loads(raw.decode("utf-8"))
        return cast(dict[str, object], parsed) if isinstance(parsed, dict) else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        logger.warning("Existing %s is invalid JSON, ignoring: %s", MANIFEST_OBJECT_NAME, e)
        return {}


def create_release(
    client: ObjectStore,
    session: requests.Session,
    localization_id: str,
    entry: ConfigEntry,
    *,
    settings: MirrorSettings,
    previous_icon: str | None = None,
    icon_cache: IconCache | None = None,
) -> Localization:
    latest_release = get_release_info(
        session,
        entry["repo"],
        github_token=settings.github_token,
        github_proxy=settings.github_proxy,
    )
    version = latest_release["tag_name"]

    description = get_description(
        session,
        latest_release,
        github_token=settings.github_token,
        github_proxy=settings.github_proxy,
    )
    asset = get_localization_asset_info(latest_release, entry.get("localization_asset"))
    if asset is None:
        raise ValueError(f"Localization asset not found in release {version!r}")

    asset_url, size = asset
    safe_version = sanitize_version_for_key(version)
    asset_path = f"{localization_id}/files/{safe_version}.zip"
    sync_to_minio(
        client,
        session,
        settings.minio_bucket,
        asset_url,
        asset_path,
        expected_size=size,
        github_token=settings.github_token,
        github_proxy=settings.github_proxy,
    )

    fonts: list[FontInfo] = []
    for font in entry.get("fonts", []):
        font_ext = get_font_extension(font)
        font_path = f"{localization_id}/fonts/{font['hash']}{font_ext}"
        sync_to_minio(
            client,
            session,
            settings.minio_bucket,
            font["url"],
            font_path,
            expected_md5=font["hash"],
            github_token=settings.github_token,
            github_proxy=settings.github_proxy,
        )
        fonts.append(
            {
                "name": font["name"],
                "url": f"{settings.minio_public_url}/{settings.minio_bucket}/{font_path}",
                "hash": font["hash"],
            }
        )

    icon = get_optimized_icon(
        session,
        entry["icon"],
        fallback_icon=previous_icon,
        icon_cache=icon_cache,
        github_token=settings.github_token,
        github_proxy=settings.github_proxy,
    )

    return {
        "id": localization_id,
        "version": version,
        "name": entry["name"],
        "flag": entry["flag"],
        "icon": icon,
        "description": description,
        "authors": entry["authors"],
        "url": f"{settings.minio_public_url}/{settings.minio_bucket}/{asset_path}",
        "size": size,
        "fonts": fonts,
        "format": entry["format"],
    }


def _extract_object_key(url: str, url_prefix: str) -> str | None:
    if url.startswith(url_prefix):
        key = url[len(url_prefix) :].lstrip("/")
        return key or None
    return None


def cleanup_outdated(
    client: ObjectStore,
    bucket: str,
    public_url: str,
    manifest: Mapping[str, object],
) -> None:
    url_prefix = f"{public_url.rstrip('/')}/{bucket}/"
    expected_objects: set[str] = {MANIFEST_OBJECT_NAME}

    chapters_url = manifest.get("chapters_url")
    if isinstance(chapters_url, str):
        chapters_key = _extract_object_key(chapters_url, url_prefix)
        expected_objects.add(chapters_key or CHAPTERS_OBJECT_NAME)

    raw_locs = manifest.get("localizations")
    if isinstance(raw_locs, list):
        for raw_loc in cast(list[object], raw_locs):
            if not isinstance(raw_loc, dict):
                continue
            loc = cast(dict[str, object], raw_loc)
            loc_url = loc.get("url")
            if isinstance(loc_url, str):
                key = _extract_object_key(loc_url, url_prefix)
                if key:
                    expected_objects.add(key)
            raw_fonts = loc.get("fonts")
            if isinstance(raw_fonts, list):
                for raw_font in cast(list[object], raw_fonts):
                    if not isinstance(raw_font, dict):
                        continue
                    font_url = cast(dict[str, object], raw_font).get("url")
                    if isinstance(font_url, str):
                        key = _extract_object_key(font_url, url_prefix)
                        if key:
                            expected_objects.add(key)

    existing_objects = client.list_objects(bucket, recursive=True)

    removed = 0
    for obj in existing_objects:
        if obj.object_name and obj.object_name not in expected_objects:
            logger.info("Removing outdated object: %s", obj.object_name)
            client.remove_object(bucket, obj.object_name)
            removed += 1

    if removed:
        logger.info("Cleaned up %d outdated object(s)", removed)


def do_update(
    config_path: Path | None = None,
    *,
    settings: MirrorSettings | None = None,
    client: ObjectStore | None = None,
    session: requests.Session | None = None,
    icon_cache: IconCache | None = _ICON_CACHE,
) -> int:
    logger.info("Checking for localizations updates")

    resolved_settings = settings or load_settings()
    active_client: ObjectStore = client or minio.Minio(
        resolved_settings.minio_endpoint,
        access_key=resolved_settings.minio_access_key,
        secret_key=resolved_settings.minio_secret_key,
        secure=resolved_settings.minio_secure,
    )

    if not active_client.bucket_exists(resolved_settings.minio_bucket):
        logger.error("MinIO bucket %r does not exist", resolved_settings.minio_bucket)
        return 1

    owns_session = session is None
    active_session = session or create_session()

    try:
        config = load_config(
            active_session,
            config_url=resolved_settings.config_url,
            config_path=config_path,
            github_token=resolved_settings.github_token,
            github_proxy=resolved_settings.github_proxy,
        )
        if not config:
            logger.error("Loaded configuration is empty or missing; aborting mirror update")
            return 1

        current_content = load_current_manifest(active_client, resolved_settings.minio_bucket)
        current_localizations = extract_previous_localizations(current_content)

        processed: dict[str, Localization | dict[str, object]] = {}
        had_failures = False

        for localization_id, raw_entry in config.items():
            previous = current_localizations.get(localization_id)
            prev_icon = previous.get("icon") if previous is not None else None
            try:
                entry = validate_config_entry(localization_id, raw_entry)
                processed[localization_id] = create_release(
                    active_client,
                    active_session,
                    localization_id,
                    entry,
                    settings=resolved_settings,
                    previous_icon=prev_icon if isinstance(prev_icon, str) else None,
                    icon_cache=icon_cache,
                )
            except Exception:
                had_failures = True
                logger.exception("Failed to process localization %s", localization_id)
                if previous is not None:
                    processed[localization_id] = previous

        if not processed:
            logger.error(
                "All %d localization(s) failed and no cached entries exist; aborting mirror update",
                len(config),
            )
            return 1

        new_content: dict[str, object] = {
            "localizations": list(processed.values()),
            "format_version": 1,
        }

        if resolved_settings.chapters_url:
            try:
                chapters_path = sync_chapters(
                    active_client,
                    active_session,
                    resolved_settings.minio_bucket,
                    resolved_settings.chapters_url,
                    github_token=resolved_settings.github_token,
                    github_proxy=resolved_settings.github_proxy,
                )
                new_content["chapters_url"] = (
                    f"{resolved_settings.minio_public_url}/{resolved_settings.minio_bucket}/{chapters_path}"
                )
            except Exception:
                had_failures = True
                logger.exception("Failed to sync chapters from %s", resolved_settings.chapters_url)
                if (
                    stat_object_safe(
                        active_client, resolved_settings.minio_bucket, CHAPTERS_OBJECT_NAME
                    )
                    is not None
                ):
                    new_content["chapters_url"] = (
                        f"{resolved_settings.minio_public_url}/{resolved_settings.minio_bucket}/{CHAPTERS_OBJECT_NAME}"
                    )

        if new_content != current_content:
            content_bytes = json.dumps(new_content, indent=2, ensure_ascii=False).encode("utf-8")
            active_client.put_object(
                resolved_settings.minio_bucket,
                MANIFEST_OBJECT_NAME,
                BytesIO(content_bytes),
                len(content_bytes),
                content_type="application/json; charset=utf-8",
            )
            logger.info("Localizations updated successfully")
        else:
            logger.info("No changes to the localizations")

        if had_failures:
            logger.warning("Skipping outdated object cleanup due to partial failures in this run")
        else:
            cleanup_outdated(
                active_client,
                resolved_settings.minio_bucket,
                resolved_settings.minio_public_url,
                new_content,
            )

        return 0
    finally:
        if owns_session:
            active_session.close()


def run_once(config_path: Path | None = None) -> int:
    try:
        return do_update(config_path=config_path)
    except Exception:
        logger.exception("Failed to update localizations")
        return 1
