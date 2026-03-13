import requests
import os
import toml
import json
import time
import schedule
import logging
import base64

from io import BytesIO
from PIL import Image
from pathlib import Path
from typing import TypedDict, Literal
from argparse import ArgumentParser

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_GIST_ID = os.environ["GITHUB_GIST_ID"]
GITHUB_GIST_OWNER = os.environ["GITHUB_GIST_OWNER"]
CONFIG_URL = os.environ.get("CONFIG_URL")


class UpToDateError(Exception):
    pass


class FontInfo(TypedDict):
    name: str
    url: str
    hash: str


class ConfigEntry(TypedDict):
    repo: str
    name: str
    authors: list[str]
    flag: str
    icon: str
    format: Literal["compatible", "new"]
    localization_asset: str | None
    fonts: list[FontInfo]


class Localization(TypedDict):
    id: str
    version: str
    name: str
    flag: str
    icon: str
    description: str
    authors: list[str]
    url: str
    fonts: list[FontInfo]
    size: int
    format: Literal["compatible", "new"]


class ReleaseAsset(TypedDict):
    name: str
    size: int
    browser_download_url: str


class ReleaseInfo(TypedDict):
    tag_name: str
    name: str
    body: str
    assets: list[ReleaseAsset]


def get_github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github.v3+json",
    }

    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

    return headers


def get_release_info(repo: str) -> ReleaseInfo:
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    response = requests.get(url, headers=get_github_headers())
    response.raise_for_status()
    content = response.json()
    return content


def get_description(release: ReleaseInfo) -> str:
    for asset in release["assets"]:
        if asset["name"].lower() != "readme.md":
            continue
        return requests.get(
            asset["browser_download_url"], headers=get_github_headers()
        ).text
    return release["body"]


def get_localization_asset_info(
    release: ReleaseInfo, localization_asset: str | None = None
) -> tuple[str, int] | None:
    if localization_asset is None:
        for asset in release["assets"]:
            if asset["name"].lower().endswith(".zip"):
                return asset["browser_download_url"], asset["size"]
        else:
            return None

    for asset in release["assets"]:
        if asset["name"].lower() == localization_asset:
            return asset["browser_download_url"], asset["size"]

    return None


def get_optimized_icon(icon_url: str) -> str:
    response = requests.get(icon_url)

    script_dir = Path(__file__).parent.absolute()

    if response.status_code != 200:
        image = Image.open(script_dir / "icon_404.png")
    else:
        image = Image.open(BytesIO(response.content))

    image = image.convert("RGBA")
    image = image.resize((40, 40), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    image.save(buffer, format="WebP", quality=95, lossless=False)
    buffer.seek(0)

    base64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/webp;base64,{base64_data}"


def create_release(
    localization_id: str,
    entry: ConfigEntry,
) -> Localization:
    latest_release = get_release_info(entry["repo"])
    version = latest_release["tag_name"]

    description = get_description(latest_release).replace("\r\n", "\n\n")
    asset = get_localization_asset_info(latest_release, entry.get("localization_asset"))

    if not asset:
        raise ValueError("Localization asset not found")

    asset_url, size = asset
    icon = get_optimized_icon(entry["icon"])

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
        "fonts": entry["fonts"],
        "format": entry["format"],
    }


def load_config() -> dict | None:
    if CONFIG_URL:
        try:
            logging.info(f"Fetching config from {CONFIG_URL}")
            response = requests.get(CONFIG_URL, headers=get_github_headers())
            response.raise_for_status()
            return toml.loads(response.text)
        except Exception as e:
            logging.warning(f"Failed to fetch remote config: {e}")

    script_dir = Path(__file__).parent.absolute()
    config_path = script_dir / "localizations.toml"

    if not config_path.exists() or not config_path.is_file():
        logging.error(f"Config file not found: {config_path}")
        return None

    logging.info(f"Using local config: {config_path}")
    with config_path.open("r") as f:
        return toml.load(f)


def do_update() -> int:
    logging.info("Checking for localizations updates")

    config = load_config()
    if config is None:
        return 1

    current = requests.get(
        f"https://gist.githubusercontent.com/{GITHUB_GIST_OWNER}/{GITHUB_GIST_ID}/raw/localizations.json",
        headers=get_github_headers()
    )

    current_localizations: dict[str, Localization] = {}
    if current.ok:
        current_contents = current.json()
        for localization in current_contents["localizations"]:
            current_localizations[localization["id"]] = localization

    processed: dict[str, Localization] = {}
    for localization_id, entry in config.items():
        try:
            processed[localization_id] = create_release(
                localization_id,
                entry,
            )
        except Exception as e:
            logging.error(f"Error getting latest release for {localization_id}: {e}")

            if localization_id in current_localizations:
                processed[localization_id] = current_localizations[localization_id]

    if processed == current_localizations:
        logging.info("No changes to the localizations")
        return 0

    content = json.dumps(
        {"localizations": list(processed.values()), "format_version": 1},
        indent=2,
        ensure_ascii=False,
    )

    response = requests.patch(
        f"https://api.github.com/gists/{GITHUB_GIST_ID}",
        headers=get_github_headers(),
        json={"files": {"localizations.json": {"content": content}}},
    )

    if response.status_code != 200:
        logging.error(f"Failed to update gist: {response.status_code} {response.text}")
        return 1

    logging.info("Gist updated successfully")
    return 0


def main() -> int:
    try:
        return do_update()
    except Exception as e:
        logging.error(f"Failed to update localizations: {e}")
        return 1


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--schedule", action="store_true", default=False)
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if not args.schedule:
        exit(main())

    else:
        logging.info(f"Scheduling updates every {args.interval} minutes")

        main()
        schedule.every(args.interval).minutes.do(main)

        while True:
            schedule.run_pending()
            time.sleep(1)
