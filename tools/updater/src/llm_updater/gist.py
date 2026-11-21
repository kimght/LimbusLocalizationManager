import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import requests

from llm_updater.config import (
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
    get_github_headers,
    get_metadata_timeout,
    get_proxies,
)
from llm_updater.models import ConfigEntry, Localization, extract_previous_localizations

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "localizations.json"

_ICON_CACHE = IconCache()


@dataclass(frozen=True)
class GistSettings:
    github_token: str
    gist_id: str
    github_proxy: str | None = None
    config_url: str | None = None
    chapters_url: str | None = None


def load_settings() -> GistSettings:
    return GistSettings(
        github_token=get_required_env("GITHUB_TOKEN"),
        gist_id=get_required_env("GITHUB_GIST_ID"),
        github_proxy=get_optional_env("GITHUB_PROXY"),
        config_url=get_optional_env("CONFIG_URL"),
        chapters_url=get_optional_env("CHAPTERS_URL"),
    )


def load_current_manifest(
    session: requests.Session,
    settings: GistSettings,
) -> dict[str, object]:
    url = f"https://api.github.com/gists/{settings.gist_id}"
    response = session.get(
        url,
        headers=get_github_headers(url, settings.github_token, accept_json=True),
        proxies=get_proxies(url, settings.github_proxy),
        timeout=get_metadata_timeout(),
    )
    response.raise_for_status()
    raw_gist: object = response.json()
    if not isinstance(raw_gist, dict):
        return {}
    gist_data = cast(dict[str, object], raw_gist)

    raw_files = gist_data.get("files")
    if not isinstance(raw_files, dict):
        return {}
    files = cast(dict[str, object], raw_files)

    raw_file_info = files.get(MANIFEST_FILENAME)
    if not isinstance(raw_file_info, dict):
        return {}
    file_info = cast(dict[str, object], raw_file_info)

    raw_url = file_info.get("raw_url")
    if file_info.get("truncated") and isinstance(raw_url, str) and raw_url:
        raw_response = session.get(
            raw_url,
            headers=get_github_headers(raw_url, settings.github_token),
            proxies=get_proxies(raw_url, settings.github_proxy),
            timeout=get_metadata_timeout(),
        )
        raw_response.raise_for_status()
        raw_text = raw_response.content.decode("utf-8")
    else:
        content = file_info.get("content")
        raw_text = content if isinstance(content, str) else ""

    if not raw_text.strip():
        return {}

    try:
        parsed: object = json.loads(raw_text)
        return cast(dict[str, object], parsed) if isinstance(parsed, dict) else {}
    except json.JSONDecodeError as e:
        logger.warning("Existing gist %s is invalid JSON, ignoring: %s", MANIFEST_FILENAME, e)
        return {}


def create_release(
    session: requests.Session,
    localization_id: str,
    entry: ConfigEntry,
    *,
    settings: GistSettings,
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
        "url": asset_url,
        "size": size,
        "fonts": entry.get("fonts", []),
        "format": entry["format"],
    }


def do_update(
    config_path: Path | None = None,
    *,
    settings: GistSettings | None = None,
    session: requests.Session | None = None,
    icon_cache: IconCache | None = _ICON_CACHE,
) -> int:
    logger.info("Checking for localizations updates")

    resolved_settings = settings or load_settings()
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
            logger.error("Loaded configuration is empty or missing; aborting gist update")
            return 1

        current_content = load_current_manifest(active_session, resolved_settings)
        current_localizations = extract_previous_localizations(current_content)

        processed: dict[str, Localization | dict[str, object]] = {}
        failed_count = 0

        for localization_id, raw_entry in config.items():
            previous = current_localizations.get(localization_id)
            prev_icon = previous.get("icon") if previous is not None else None
            try:
                entry = validate_config_entry(localization_id, raw_entry)
                processed[localization_id] = create_release(
                    active_session,
                    localization_id,
                    entry,
                    settings=resolved_settings,
                    previous_icon=prev_icon if isinstance(prev_icon, str) else None,
                    icon_cache=icon_cache,
                )
            except Exception:
                failed_count += 1
                logger.exception("Failed to process localization %s", localization_id)
                if previous is not None:
                    processed[localization_id] = previous

        if not processed:
            logger.error(
                "All %d localization(s) failed and no cached entries exist; aborting gist update",
                len(config),
            )
            return 1

        if failed_count:
            logger.warning(
                "Completed with %d failed localization(s); preserved previous entries where available",
                failed_count,
            )

        new_content: dict[str, object] = {
            "localizations": list(processed.values()),
            "format_version": 1,
        }
        if resolved_settings.chapters_url:
            new_content["chapters_url"] = resolved_settings.chapters_url

        if new_content == current_content:
            logger.info("No changes to the localizations")
            return 0

        payload = json.dumps(new_content, indent=2, ensure_ascii=False)
        patch_url = f"https://api.github.com/gists/{resolved_settings.gist_id}"
        response = active_session.patch(
            patch_url,
            headers=get_github_headers(patch_url, resolved_settings.github_token, accept_json=True),
            proxies=get_proxies(patch_url, resolved_settings.github_proxy),
            json={"files": {MANIFEST_FILENAME: {"content": payload}}},
            timeout=get_metadata_timeout(),
        )

        if response.status_code != 200:
            logger.error("Failed to update gist: %s %s", response.status_code, response.text)
            return 1

        logger.info("Gist updated successfully")
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
