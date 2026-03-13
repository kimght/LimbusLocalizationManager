from minio.datatypes import HTTPHeaderDict
import requests
import os
import toml
import json
import time
import schedule
import logging
import base64
import minio

from io import BytesIO
from PIL import Image
from pathlib import Path
from typing import TypedDict, Literal, cast, BinaryIO
from argparse import ArgumentParser

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
CONFIG_URL = os.environ.get("CONFIG_URL")
MINIO_ENDPOINT = os.environ["MINIO_ENDPOINT"]
MINIO_ACCESS_KEY = os.environ["MINIO_ACCESS_KEY"]
MINIO_SECRET_KEY = os.environ["MINIO_SECRET_KEY"]
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "localizations")
MINIO_PUBLIC_URL = os.environ.get("MINIO_PUBLIC_URL", MINIO_ENDPOINT)


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
    headers = {}
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


def get_metadata(
    client: minio.Minio, object_name: str
) -> dict[str, str] | HTTPHeaderDict | None:
    try:
        file_object = client.stat_object(MINIO_BUCKET, object_name).metadata
        return file_object
    except minio.error.S3Error as e:
        if e.code == "NoSuchKey":
            return None
        else:
            raise e


def sync_to_minio(client: minio.Minio, source_url: str, object_name: str):
    current = get_metadata(client, object_name)

    if current is not None:
        return

    with requests.get(source_url, stream=True) as r:
        r.raise_for_status()

        file_size = int(r.headers.get("content-length", 0))
        if file_size == 0:
            file_size = -1

        client.put_object(
            MINIO_BUCKET,
            object_name,
            data=cast(BinaryIO, r.raw),
            length=file_size,
            content_type=r.headers.get("content-type", "application/octet-stream"),
        )


def create_release(
    client: minio.Minio,
    localization_id: str,
    entry: ConfigEntry,
    latest_version: str | None = None,
) -> Localization:
    latest_release = get_release_info(entry["repo"])
    version = latest_release["tag_name"]

    if latest_version is not None and version == latest_version:
        raise UpToDateError("Version is up to date")

    description = get_description(latest_release).replace("\r\n", "\n\n")
    asset = get_localization_asset_info(latest_release, entry.get("localization_asset"))

    if not asset:
        raise ValueError("Localization asset not found")

    asset_url, size = asset

    asset_path = f"{localization_id}/files/{version}.zip"
    sync_to_minio(client, asset_url, asset_path)

    fonts: list[FontInfo] = []
    for font in entry["fonts"]:
        font_path = f"{localization_id}/fonts/{font['hash']}"
        sync_to_minio(client, font["url"], font_path)

        current: FontInfo = {
            "name": font["name"],
            "url": f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/{font_path}",
            "hash": font["hash"],
        }

        fonts.append(current)

    icon = get_optimized_icon(entry["icon"])

    return {
        "id": localization_id,
        "version": version,
        "name": entry["name"],
        "flag": entry["flag"],
        "icon": icon,
        "description": description,
        "authors": entry["authors"],
        "url": f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/{asset_path}",
        "size": size,
        "fonts": fonts,
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


def cleanup_outdated(
    client: minio.Minio, processed: dict[str, Localization]
) -> None:
    expected_objects: set[str] = {"localizations.json"}
    for loc in processed.values():
        loc_id = loc["id"]
        expected_objects.add(f"{loc_id}/files/{loc['version']}.zip")
        for font in loc["fonts"]:
            expected_objects.add(f"{loc_id}/fonts/{font['hash']}")

    existing_objects = client.list_objects(MINIO_BUCKET, recursive=True)

    removed = 0
    for obj in existing_objects:
        if obj.object_name and obj.object_name not in expected_objects:
            logging.info(f"Removing outdated object: {obj.object_name}")
            client.remove_object(MINIO_BUCKET, obj.object_name)
            removed += 1

    if removed:
        logging.info(f"Cleaned up {removed} outdated object(s)")


def do_update() -> int:
    logging.info("Checking for localizations updates")

    client = minio.Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False,
    )

    config = load_config()
    if config is None:
        return 1

    current = requests.get(f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/localizations.json")

    current_localizations: dict[str, Localization] = {}
    if current.ok:
        current_contents = current.json()
        for localization in current_contents["localizations"]:
            current_localizations[localization["id"]] = localization

    processed: dict[str, Localization] = {}
    for localization_id, entry in config.items():
        current_version = current_localizations.get(localization_id, {}).get("version")

        try:
            processed[localization_id] = create_release(
                client,
                localization_id,
                entry,
                current_version,
            )
        except UpToDateError:
            logging.info(f"{localization_id} is up to date")
            processed[localization_id] = current_localizations[localization_id]
        except Exception as e:
            logging.error(f"Failed to process localization {localization_id}: {repr(e)}")

            if current_version is not None:
                processed[localization_id] = current_localizations[localization_id]

    cleanup_outdated(client, processed)

    if processed == current_localizations:
        logging.info("No changes to the localizations")
        return 0

    content = json.dumps(
        {"localizations": list(processed.values()), "format_version": 1},
        indent=2,
        ensure_ascii=False,
    ).encode("utf-8")

    client.put_object(
        MINIO_BUCKET,
        "localizations.json",
        BytesIO(content),
        len(content),
    )

    logging.info("Localizations updated successfully")
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
        schedule.every(args.interval).minutes.do(main)

        while True:
            schedule.run_pending()
            time.sleep(1)
