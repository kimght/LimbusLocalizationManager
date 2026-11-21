from collections.abc import Mapping
from typing import Literal, NotRequired, TypedDict, cast

LocalizationFormat = Literal["compatible", "new", "auto"]

VALID_FORMATS: frozenset[str] = frozenset({"compatible", "new", "auto"})


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
    format: LocalizationFormat
    localization_asset: NotRequired[str | None]
    fonts: NotRequired[list[FontInfo]]


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
    format: LocalizationFormat


class ReleaseAsset(TypedDict):
    name: str
    size: int
    browser_download_url: str


class ReleaseInfo(TypedDict):
    tag_name: str
    name: str | None
    body: str | None
    assets: list[ReleaseAsset]


def extract_previous_localizations(
    manifest: Mapping[str, object],
) -> dict[str, dict[str, object]]:
    raw_list = manifest.get("localizations")
    if not isinstance(raw_list, list):
        return {}
    result: dict[str, dict[str, object]] = {}
    for item in cast(list[object], raw_list):
        if not isinstance(item, dict):
            continue
        item_dict = cast(dict[str, object], item)
        loc_id = item_dict.get("id")
        if isinstance(loc_id, str):
            result[loc_id] = item_dict
    return result
