import logging
import os
import re
import string
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import TypeGuard, cast
from urllib.parse import urlparse

import requests

from llm_updater.http import get_github_headers, get_metadata_timeout, get_proxies
from llm_updater.models import VALID_FORMATS, ConfigEntry, FontInfo, LocalizationFormat

logger = logging.getLogger(__name__)

_REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_HEX_CHARS = frozenset(string.hexdigits)
_MAX_PARENT_SEARCH_DEPTH = 3


def _is_valid_format(value: object) -> TypeGuard[LocalizationFormat]:
    return isinstance(value, str) and value in VALID_FORMATS


def _is_str_dict(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(k, str) for k in cast(dict[object, object], value)
    )


def get_optional_env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped if stripped else default


def get_required_env(name: str) -> str:
    value = get_optional_env(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name!r} is not set or empty")
    return value


def get_bool_env(name: str, default: bool = False) -> bool:
    value = get_optional_env(name)
    if value is None:
        return default
    lowered = value.lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Invalid boolean value for {name}: {value!r}")


def validate_path_component(value: object, what: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value in {".", ".."}
        or any(ch in value for ch in ("/", "\\", ":"))
    ):
        raise ValueError(f"Invalid {what}: {value!r}")
    return value


def validate_relative_path(value: object, what: str) -> str:
    if not isinstance(value, str) or not value or ":" in value:
        raise ValueError(f"Invalid {what}: {value!r}")
    segments = re.split(r"[/\\]", value)
    for segment in segments:
        validate_path_component(segment, what)
    return value


def validate_http_url(value: object, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {what}: {value!r}")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Invalid {what}: {value!r}")
    return value


def validate_config_entry(localization_id: str, entry: object) -> ConfigEntry:
    validate_path_component(localization_id, "localization id")

    if not _is_str_dict(entry):
        raise TypeError(f"Config entry for {localization_id!r} must be a table/dict")

    repo = entry.get("repo")
    if not isinstance(repo, str) or not _REPO_PATTERN.match(repo):
        raise ValueError(f"Invalid repo for {localization_id!r}: {repo!r}")
    owner, repo_name = repo.split("/", 1)
    if owner in {".", ".."} or repo_name in {".", ".."}:
        raise ValueError(f"Invalid repo for {localization_id!r}: {repo!r}")

    name = entry.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"Invalid name for {localization_id!r}: {name!r}")

    flag = entry.get("flag")
    if not isinstance(flag, str) or not flag.strip():
        raise ValueError(f"Invalid flag for {localization_id!r}: {flag!r}")

    icon = validate_http_url(entry.get("icon"), f"icon URL for {localization_id!r}")

    raw_authors = entry.get("authors")
    if not isinstance(raw_authors, list) or not raw_authors:
        raise ValueError(f"Invalid authors for {localization_id!r}: {raw_authors!r}")
    authors: list[str] = []
    for author in cast(list[object], raw_authors):
        if not isinstance(author, str) or not author.strip():
            raise ValueError(f"Invalid authors for {localization_id!r}: {raw_authors!r}")
        authors.append(author)

    fmt = entry.get("format")
    if not _is_valid_format(fmt):
        raise ValueError(f"Invalid format for {localization_id!r}: {fmt!r}")

    localization_asset = entry.get("localization_asset")
    if localization_asset is not None and (
        not isinstance(localization_asset, str) or not localization_asset.strip()
    ):
        raise ValueError(
            f"Invalid localization_asset for {localization_id!r}: {localization_asset!r}"
        )

    raw_fonts = entry.get("fonts", [])
    if not isinstance(raw_fonts, list):
        raise TypeError(f"Invalid fonts for {localization_id!r}: expected list")

    validated_fonts: list[FontInfo] = []
    for idx, font in enumerate(cast(list[object], raw_fonts)):
        if not _is_str_dict(font):
            raise TypeError(f"Invalid font[{idx}] for {localization_id!r}: expected table")

        font_name = validate_relative_path(
            font.get("name"), f"font[{idx}].name for {localization_id!r}"
        )
        font_url = validate_http_url(font.get("url"), f"font[{idx}].url for {localization_id!r}")
        font_hash = font.get("hash")
        if (
            not isinstance(font_hash, str)
            or len(font_hash) != 32
            or not all(ch in _HEX_CHARS for ch in font_hash)
        ):
            raise ValueError(f"Invalid font[{idx}].hash for {localization_id!r}: {font_hash!r}")

        validated_fonts.append(
            {
                "name": font_name,
                "url": font_url,
                "hash": font_hash.lower(),
            }
        )

    validated: ConfigEntry = {
        "repo": repo,
        "name": name,
        "authors": authors,
        "flag": flag,
        "icon": icon,
        "format": fmt,
        "fonts": validated_fonts,
    }
    if localization_asset is not None:
        validated["localization_asset"] = localization_asset.strip()

    return validated


def validate_config(raw_config: Mapping[str, object]) -> dict[str, ConfigEntry]:
    if not raw_config:
        raise ValueError("Configuration contains no localizations")

    validated: dict[str, ConfigEntry] = {}
    errors: list[str] = []
    for localization_id, raw_entry in raw_config.items():
        try:
            validated[localization_id] = validate_config_entry(localization_id, raw_entry)
        except (TypeError, ValueError) as e:
            errors.append(f"{localization_id}: {e}")

    if errors:
        raise ValueError("Invalid configuration:\n  - " + "\n  - ".join(errors))
    return validated


def resolve_local_config_path(
    explicit_path: Path | None = None,
    *,
    base_dir: Path | None = None,
) -> Path | None:
    if explicit_path is not None:
        if explicit_path.is_file():
            return explicit_path
        logger.error("Explicit config file not found: %s", explicit_path)
        return None

    env_path = get_optional_env("CONFIG_PATH")
    if env_path is not None:
        candidate = Path(env_path)
        if candidate.is_file():
            return candidate
        logger.error("Config file from CONFIG_PATH not found: %s", candidate)
        return None

    start = (base_dir or Path.cwd()).resolve()
    candidates: list[Path] = [start / "localizations.toml"]
    search_dirs = (start, *start.parents[:_MAX_PARENT_SEARCH_DEPTH])
    for directory in search_dirs:
        candidate = directory / "data" / "localizations.toml"
        if candidate not in candidates:
            candidates.append(candidate)

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    logger.error(
        "Config file not found in any of: %s",
        ", ".join(str(p) for p in candidates),
    )
    return None


def load_config(
    session: requests.Session,
    *,
    config_url: str | None = None,
    config_path: Path | None = None,
    base_dir: Path | None = None,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> dict[str, object] | None:
    if config_path is None and config_url:
        try:
            logger.info("Fetching config from %s", config_url)
            response = session.get(
                config_url,
                headers=get_github_headers(config_url, github_token),
                proxies=get_proxies(config_url, github_proxy),
                timeout=get_metadata_timeout(),
            )
            response.raise_for_status()
            parsed = tomllib.loads(response.content.decode("utf-8"))
            if parsed:
                return dict(parsed)
            logger.warning(
                "Remote config from %s is empty; falling back to local config", config_url
            )
        except (requests.RequestException, UnicodeDecodeError, tomllib.TOMLDecodeError) as e:
            logger.warning("Failed to fetch remote config from %s: %s", config_url, e)

    resolved = resolve_local_config_path(config_path, base_dir=base_dir)
    if resolved is None:
        return None

    logger.info("Using local config: %s", resolved)
    with resolved.open("rb") as f:
        parsed = tomllib.load(f)
    if not parsed:
        logger.error("Local config %s is empty", resolved)
        return None
    return dict(parsed)
