import base64
import functools
import logging
import time
from importlib.resources import files
from io import BytesIO
from typing import cast

import requests
from PIL import Image, UnidentifiedImageError

from llm_updater.http import get_github_headers, get_metadata_timeout, get_proxies
from llm_updater.models import ReleaseAsset, ReleaseInfo

logger = logging.getLogger(__name__)

MAX_ICON_BYTES = 10 * 1024 * 1024  # 10 MiB safeguard
DEFAULT_ICON_CACHE_TTL_SECONDS = 3600.0


class IconCache:
    """In-memory TTL cache for successfully downloaded & encoded icons."""

    def __init__(self, ttl_seconds: float = DEFAULT_ICON_CACHE_TTL_SECONDS) -> None:
        self._ttl_seconds: float = ttl_seconds
        self._entries: dict[str, tuple[float, str]] = {}

    def get(self, url: str) -> str | None:
        item = self._entries.get(url)
        if item is None:
            return None
        expires_at, data_uri = item
        if time.monotonic() >= expires_at:
            self._entries.pop(url, None)
            return None
        return data_uri

    def set(self, url: str, data_uri: str) -> None:
        self._entries[url] = (time.monotonic() + self._ttl_seconds, data_uri)


def _parse_release_info(payload: object, repo: str) -> ReleaseInfo:
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected release response for {repo!r}: expected JSON object")
    data = cast(dict[str, object], payload)

    tag_name = data.get("tag_name")
    if not isinstance(tag_name, str) or not tag_name.strip():
        raise ValueError(f"Release response for {repo!r} missing valid tag_name")

    raw_name = data.get("name")
    name = raw_name if isinstance(raw_name, str) else None

    raw_body = data.get("body")
    body = raw_body if isinstance(raw_body, str) else None

    raw_assets = data.get("assets", [])
    if not isinstance(raw_assets, list):
        raise ValueError(f"Release response for {repo!r} has non-list assets")

    assets: list[ReleaseAsset] = []
    for raw_asset in cast(list[object], raw_assets):
        if not isinstance(raw_asset, dict):
            continue
        asset_dict = cast(dict[str, object], raw_asset)
        asset_name = asset_dict.get("name")
        asset_url = asset_dict.get("browser_download_url")
        asset_size = asset_dict.get("size")
        if (
            isinstance(asset_name, str)
            and isinstance(asset_url, str)
            and isinstance(asset_size, int)
            and not isinstance(asset_size, bool)
        ):
            assets.append(
                {
                    "name": asset_name,
                    "size": asset_size,
                    "browser_download_url": asset_url,
                }
            )

    return {
        "tag_name": tag_name,
        "name": name,
        "body": body,
        "assets": assets,
    }


def get_release_info(
    session: requests.Session,
    repo: str,
    *,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> ReleaseInfo:
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    response = session.get(
        url,
        headers=get_github_headers(url, github_token, accept_json=True),
        proxies=get_proxies(url, github_proxy),
        timeout=get_metadata_timeout(),
    )
    response.raise_for_status()
    return _parse_release_info(response.json(), repo)


def get_description(
    session: requests.Session,
    release: ReleaseInfo,
    *,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> str:
    for asset in release.get("assets", []):
        if asset["name"].lower() != "readme.md":
            continue
        url = asset["browser_download_url"]
        response = session.get(
            url,
            headers=get_github_headers(url, github_token, accept_json=False),
            proxies=get_proxies(url, github_proxy),
            timeout=get_metadata_timeout(),
        )
        response.raise_for_status()
        text = response.content.decode("utf-8", errors="replace")
        return text.replace("\r\n", "\n\n")

    body = release.get("body") or ""
    return body.replace("\r\n", "\n\n")


def get_localization_asset_info(
    release: ReleaseInfo,
    localization_asset: str | None = None,
) -> tuple[str, int] | None:
    assets = release.get("assets", [])

    if localization_asset is None:
        for asset in assets:
            if asset["name"].lower().endswith(".zip"):
                return asset["browser_download_url"], asset["size"]
        return None

    target = localization_asset.lower()
    for asset in assets:
        if asset["name"].lower() == target:
            return asset["browser_download_url"], asset["size"]

    return None


def _encode_image_to_webp_data_uri(image: Image.Image) -> str:
    converted = image.convert("RGBA")
    # Pillow's size parameter union references optional numpy types when numpy is absent.
    resized = converted.resize((40, 40), Image.Resampling.LANCZOS)  # pyright: ignore[reportUnknownMemberType]

    buffer = BytesIO()
    resized.save(buffer, format="WebP", quality=95, lossless=False)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{base64_data}"


@functools.lru_cache(maxsize=1)
def get_fallback_icon_data_uri() -> str:
    icon_resource = files("llm_updater.assets").joinpath("icon_404.png")
    with icon_resource.open("rb") as f, Image.open(f) as image:
        return _encode_image_to_webp_data_uri(image)


def _download_bounded(
    session: requests.Session,
    url: str,
    *,
    max_bytes: int,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> bytes:
    with session.get(
        url,
        headers=get_github_headers(url, github_token, accept_json=False),
        proxies=get_proxies(url, github_proxy),
        timeout=get_metadata_timeout(),
        stream=True,
    ) as response:
        response.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(f"Icon exceeds maximum allowed size of {max_bytes} bytes")
            chunks.append(chunk)
        return b"".join(chunks)


def get_optimized_icon(
    session: requests.Session,
    icon_url: str,
    *,
    fallback_icon: str | None = None,
    icon_cache: IconCache | None = None,
    github_token: str | None = None,
    github_proxy: str | None = None,
) -> str:
    if icon_cache is not None:
        cached = icon_cache.get(icon_url)
        if cached is not None:
            return cached

    try:
        raw = _download_bounded(
            session,
            icon_url,
            max_bytes=MAX_ICON_BYTES,
            github_token=github_token,
            github_proxy=github_proxy,
        )
        with Image.open(BytesIO(raw)) as image:
            data_uri = _encode_image_to_webp_data_uri(image)
        if icon_cache is not None:
            icon_cache.set(icon_url, data_uri)
        return data_uri
    except (
        requests.RequestException,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        ValueError,
    ) as e:
        logger.warning("Failed to load icon from %s: %s", icon_url, e)
        if fallback_icon:
            logger.info("Keeping previously cached icon for %s", icon_url)
            return fallback_icon
        return get_fallback_icon_data_uri()
