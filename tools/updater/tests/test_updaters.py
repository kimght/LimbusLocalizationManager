import hashlib
import io
import json
import subprocess
import sys
import tomllib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import BinaryIO, cast
from unittest.mock import MagicMock

import pytest
import requests
import urllib3
import yaml
from minio.error import S3Error
from PIL import Image

from llm_updater import cli, gist, mirror
from llm_updater.config import (
    get_bool_env,
    get_optional_env,
    load_config,
    resolve_local_config_path,
    validate_config_entry,
)
from llm_updater.github import (
    MAX_ICON_BYTES,
    IconCache,
    get_description,
    get_fallback_icon_data_uri,
    get_localization_asset_info,
    get_optimized_icon,
)
from llm_updater.http import (
    DEFAULT_DOWNLOAD_TIMEOUT,
    MAX_RETRY_AFTER_SECONDS,
    _CappedRetry,  # pyright: ignore[reportPrivateUsage]
    get_download_timeout,
    get_github_headers,
    get_proxies,
    is_github_host,
)
from llm_updater.models import ReleaseInfo
from llm_updater.runner import positive_int

UPDATER_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = UPDATER_ROOT.parent.parent
DATA_LOCALIZATIONS = REPO_ROOT / "data" / "localizations.toml"


def _make_png_bytes(color: tuple[int, int, int] = (20, 120, 220)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, format="PNG")
    return buf.getvalue()


class _FakeResponse(requests.Response):
    def __init__(
        self,
        status_code: int = 200,
        *,
        json_data: object | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__()
        self.status_code = status_code
        self.headers.update(headers or {})
        if json_data is not None:
            payload = json.dumps(json_data).encode("utf-8")
            self.headers.setdefault("content-type", "application/json")
        elif content is not None:
            payload = content
        else:
            payload = b""
        self._content = payload
        self._content_consumed = False
        self.url = "https://example.invalid/"

    def iter_content(
        self,
        chunk_size: int | None = 1,
        decode_unicode: bool = False,
    ) -> Iterator[bytes]:
        del decode_unicode
        data = self._content or b""
        self._content_consumed = True
        step = max(chunk_size or 1, 1)
        for i in range(0, len(data), step):
            yield data[i : i + step]


class FakeS3Object:
    def __init__(
        self,
        data: bytes,
        content_type: str,
        metadata: dict[str, str | list[str] | tuple[str]] | None = None,
    ) -> None:
        self.data = data
        self.size: int | None = len(data)
        self.content_type = content_type
        self.etag: str | None = f'"{hashlib.md5(data).hexdigest()}"'
        self.metadata: dict[str, object] = {}
        for k, v in (metadata or {}).items():
            self.metadata[f"x-amz-meta-{k.lower()}"] = v


class FakeListedObject:
    def __init__(self, object_name: str) -> None:
        self.object_name: str | None = object_name


class FakeGetResponse:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self.closed = False
        self.released = False

    def read(self) -> bytes:
        return self._data

    def close(self) -> None:
        self.closed = True

    def release_conn(self) -> None:
        self.released = True


class FakeMinio:
    def __init__(self, bucket: str = "localizations", bucket_exists: bool = True) -> None:
        self.bucket = bucket
        self._bucket_exists = bucket_exists
        self.objects: dict[str, FakeS3Object] = {}
        self.ops: list[tuple[str, str]] = []
        self.last_get_responses: list[FakeGetResponse] = []

    def bucket_exists(self, bucket_name: str) -> bool:
        return self._bucket_exists and bucket_name == self.bucket

    def _no_such_key(self, key: str) -> S3Error:
        return S3Error(
            code="NoSuchKey",
            message=f"NoSuchKey: {key}",
            resource=key,
            request_id="req",
            host_id="host",
            response=urllib3.HTTPResponse(status=404),
        )

    def stat_object(self, bucket_name: str, object_name: str) -> FakeS3Object:
        del bucket_name
        if object_name not in self.objects:
            raise self._no_such_key(object_name)
        return self.objects[object_name]

    def get_object(self, bucket_name: str, object_name: str) -> FakeGetResponse:
        del bucket_name
        if object_name not in self.objects:
            raise self._no_such_key(object_name)
        resp = FakeGetResponse(self.objects[object_name].data)
        self.last_get_responses.append(resp)
        return resp

    def put_object(
        self,
        bucket_name: str,
        object_name: str,
        data: BinaryIO,
        length: int,
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str | list[str] | tuple[str]] | None = None,
        part_size: int = 0,
    ) -> object:
        del bucket_name
        if length == -1 and part_size <= 0:
            raise ValueError("valid part size must be provided when object size is unknown")
        raw = data.read()
        assert length == len(raw)
        self.objects[object_name] = FakeS3Object(raw, content_type, metadata)
        self.ops.append(("put", object_name))
        return None

    def list_objects(
        self,
        bucket_name: str,
        *,
        recursive: bool = False,
    ) -> list[FakeListedObject]:
        del bucket_name, recursive
        return [FakeListedObject(name) for name in list(self.objects.keys())]

    def remove_object(self, bucket_name: str, object_name: str) -> None:
        del bucket_name
        self.objects.pop(object_name, None)
        self.ops.append(("remove", object_name))


def _make_mock_session(
    get_side_effect: Callable[..., requests.Response] | Exception | None = None,
    get_return_value: requests.Response | None = None,
    patch_return_value: requests.Response | None = None,
) -> tuple[requests.Session, MagicMock, MagicMock]:
    mock_session = MagicMock(spec=requests.Session)
    mock_get: MagicMock = mock_session.get
    mock_patch: MagicMock = mock_session.patch
    if get_side_effect is not None:
        mock_get.side_effect = get_side_effect
    if get_return_value is not None:
        mock_get.return_value = get_return_value
    if patch_return_value is not None:
        mock_patch.return_value = patch_return_value
    return cast(requests.Session, mock_session), mock_get, mock_patch


# --- Real data/localizations.toml & deploy config checks ---


def test_real_localizations_toml_valid_and_has_new_authors() -> None:
    assert DATA_LOCALIZATIONS.is_file()
    with DATA_LOCALIZATIONS.open("rb") as f:
        data = tomllib.load(f)

    assert len(data) >= 13
    for loc_id, entry in data.items():
        validated = validate_config_entry(loc_id, entry)
        assert validated["repo"] == entry["repo"]

    th_authors = data["th-stlinx"]["authors"]
    assert "DelayPD" in th_authors
    assert "Onyx" in th_authors
    assert th_authors == ["stlinx", "JoshWaltz49", "Asonakun", "DelayPD", "Onyx"]


def test_deploy_compose_and_workflow_paths_are_valid() -> None:
    compose_files = [
        (UPDATER_ROOT / "deploy" / "gist" / "docker-compose.yaml", "update-gist", "gist"),
        (UPDATER_ROOT / "deploy" / "mirror" / "docker-compose.yaml", "update-mirror", "mirror"),
    ]
    for compose_path, service_name, expected_target in compose_files:
        raw: object = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
        assert isinstance(raw, dict)
        parsed = cast(dict[str, object], raw)
        services = cast(dict[str, dict[str, object]], parsed["services"])
        service = services[service_name]
        build = cast(dict[str, str], service["build"])
        assert build["target"] == expected_target
        context_dir = (compose_path.parent / build["context"]).resolve()
        assert context_dir == UPDATER_ROOT
        assert (context_dir / build["dockerfile"]).is_file()

        volumes = cast(list[str], service["volumes"])
        host_config = volumes[0].split(":", 1)[0]
        assert (compose_path.parent / host_config).resolve() == DATA_LOCALIZATIONS

    workflow_path = REPO_ROOT / ".github" / "workflows" / "update_gist.yml"
    workflow: object = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    assert isinstance(workflow, dict)


# --- HTTP / Security / Env tests ---


def test_github_host_and_header_scoping() -> None:
    assert is_github_host("https://github.com/org/repo")
    assert is_github_host("https://api.github.com/repos/org/repo/releases/latest")
    assert is_github_host("https://raw.githubusercontent.com/org/repo/main/f.ttf")
    assert is_github_host("https://avatars.githubusercontent.com/u/123")
    assert not is_github_host("https://evil.com/github.com/repo")
    assert not is_github_host("https://notgithub.com/repo")
    assert not is_github_host("https://www.zeroasso.top/img/logo.png")

    third_party = get_github_headers(
        "https://example.com/localizations.toml", "secret", accept_json=True
    )
    assert "Authorization" not in third_party
    assert "Accept" not in third_party

    api_headers = get_github_headers("https://api.github.com/gists/1", "secret", accept_json=True)
    assert api_headers["Authorization"] == "token secret"
    assert api_headers["Accept"] == "application/vnd.github+json"

    raw_headers = get_github_headers(
        "https://raw.githubusercontent.com/a/b/main/c", "secret", accept_json=True
    )
    assert raw_headers["Authorization"] == "token secret"
    assert "Accept" not in raw_headers

    assert get_proxies("https://github.com/a/b", "socks5://127.0.0.1:1080") == {
        "http": "socks5://127.0.0.1:1080",
        "https": "socks5://127.0.0.1:1080",
    }
    assert get_proxies("https://evil.com/github.com", "socks5://127.0.0.1:1080") is None


def test_env_helpers_and_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMPTY_VAR", "")
    monkeypatch.setenv("SPACE_VAR", "   ")
    monkeypatch.setenv("BOOL_TRUE", "true")
    monkeypatch.setenv("BOOL_FALSE", "0")

    assert get_optional_env("EMPTY_VAR") is None
    assert get_optional_env("SPACE_VAR", "fallback") == "fallback"
    assert get_bool_env("BOOL_TRUE") is True
    assert get_bool_env("BOOL_FALSE", True) is False
    assert get_download_timeout() == DEFAULT_DOWNLOAD_TIMEOUT
    assert DEFAULT_DOWNLOAD_TIMEOUT[1] >= 300.0

    monkeypatch.setenv("HTTP_DOWNLOAD_TIMEOUT", "900")
    assert get_download_timeout() == (30.0, 900.0)

    monkeypatch.setenv("HTTP_DOWNLOAD_TIMEOUT", "-5")
    with pytest.raises(ValueError):
        get_download_timeout()


def test_resolve_local_config_auto_discovery(tmp_path: Path) -> None:
    # Discovers data/localizations.toml from both repo root and tools/updater
    assert resolve_local_config_path(base_dir=REPO_ROOT) == DATA_LOCALIZATIONS
    assert resolve_local_config_path(base_dir=UPDATER_ROOT) == DATA_LOCALIZATIONS

    # Discovers /app/localizations.toml (Docker layout) in current dir first
    docker_app = tmp_path / "app"
    docker_app.mkdir()
    mounted = docker_app / "localizations.toml"
    mounted.write_text('[x]\nname = "X"\n', encoding="utf-8")
    assert resolve_local_config_path(base_dir=docker_app) == mounted


def test_validate_config_entry_rejects_bad_inputs() -> None:
    base: dict[str, object] = {
        "repo": "org/repo",
        "name": "Test",
        "authors": ["Author"],
        "flag": "RU",
        "icon": "https://example.com/icon.png",
        "format": "auto",
        "fonts": [],
    }
    validate_config_entry("ru-test", base)

    with pytest.raises(ValueError):
        validate_config_entry("../escape", base)
    with pytest.raises(ValueError):
        validate_config_entry("ru-test", {**base, "format": "invalid"})
    with pytest.raises(ValueError):
        validate_config_entry(
            "ru-test",
            {
                **base,
                "fonts": [{"name": "../evil.ttf", "url": "https://a/b.ttf", "hash": "a" * 32}],
            },
        )
    with pytest.raises(ValueError):
        validate_config_entry(
            "ru-test",
            {
                **base,
                "fonts": [{"name": "Context/a.ttf", "url": "https://a/b.ttf", "hash": "not-md5"}],
            },
        )


# --- GitHub helpers tests ---


def test_get_localization_asset_case_insensitive() -> None:
    release: ReleaseInfo = {
        "tag_name": "v1",
        "name": "v1",
        "body": "",
        "assets": [
            {"name": "Other.zip", "size": 10, "browser_download_url": "https://github.com/o.zip"},
            {
                "name": "Localize_Files.ZIP",
                "size": 42,
                "browser_download_url": "https://github.com/l.zip",
            },
        ],
    }
    assert get_localization_asset_info(release, "localize_files.zip") == (
        "https://github.com/l.zip",
        42,
    )
    assert get_localization_asset_info(release, "LOCALIZE_FILES.zip") == (
        "https://github.com/l.zip",
        42,
    )
    assert get_localization_asset_info(release, None) == ("https://github.com/o.zip", 10)


def test_get_description_handles_none_body_and_utf8_readme() -> None:
    session, mock_get, _ = _make_mock_session()
    assert (
        get_description(session, {"tag_name": "v1", "name": None, "body": None, "assets": []}) == ""
    )

    readme_bytes = "Привет мир\r\n日本語".encode()
    mock_get.return_value = _FakeResponse(
        200,
        content=readme_bytes,
        headers={"content-type": "text/markdown"},
    )
    release: ReleaseInfo = {
        "tag_name": "v1",
        "name": "v1",
        "body": "fallback",
        "assets": [
            {
                "name": "README.md",
                "size": len(readme_bytes),
                "browser_download_url": "https://github.com/readme.md",
            }
        ],
    }
    assert get_description(session, release) == "Привет мир\n\n日本語"

    mock_get.return_value = _FakeResponse(502, content=b"<html>502</html>")
    with pytest.raises(requests.HTTPError):
        get_description(session, release)


def test_get_optimized_icon_fallback_and_cache() -> None:
    cache = IconCache(ttl_seconds=3600)
    png = _make_png_bytes()
    session, mock_get, _ = _make_mock_session(get_return_value=_FakeResponse(200, content=png))

    uri1 = get_optimized_icon(session, "https://example.com/icon.png", icon_cache=cache)
    uri2 = get_optimized_icon(session, "https://example.com/icon.png", icon_cache=cache)
    assert uri1.startswith("data:image/webp;base64,")
    assert uri1 == uri2
    assert mock_get.call_count == 1

    mock_get.side_effect = requests.ConnectionError("boom")
    preserved = get_optimized_icon(
        session, "https://example.com/other.png", fallback_icon=uri1, icon_cache=cache
    )
    assert preserved == uri1

    mock_get.side_effect = None
    mock_get.return_value = _FakeResponse(200, content=b"<html>cloudflare</html>")
    fallback_404 = get_optimized_icon(session, "https://example.com/bad.png", icon_cache=cache)
    assert fallback_404 == get_fallback_icon_data_uri()
    assert fallback_404.startswith("data:image/webp;base64,")
    assert cache.get("https://example.com/bad.png") is None


# --- gist updater end-to-end mocked tests ---


def test_update_gist_detects_chapters_url_change_and_reads_via_api(tmp_path: Path) -> None:
    cfg = tmp_path / "localizations.toml"
    cfg.write_text(
        "[ru-test]\n"
        'repo = "org/repo"\n'
        'name = "Test"\n'
        'authors = ["A"]\n'
        'flag = "RU"\n'
        'icon = "https://example.com/icon.png"\n'
        'format = "auto"\n'
        "fonts = []\n",
        encoding="utf-8",
    )

    png = _make_png_bytes()
    helper_session, _, _ = _make_mock_session(get_return_value=_FakeResponse(200, content=png))
    icon_uri = get_optimized_icon(helper_session, "https://example.com/icon.png")

    existing_manifest = {
        "localizations": [
            {
                "id": "ru-test",
                "version": "v1.0",
                "name": "Test",
                "flag": "RU",
                "icon": icon_uri,
                "description": "hello",
                "authors": ["A"],
                "url": "https://github.com/org/repo/releases/download/v1.0/loc.zip",
                "size": 123,
                "fonts": [],
                "format": "auto",
            }
        ],
        "format_version": 1,
    }

    def fake_get(url: str, **kwargs: object) -> requests.Response:
        assert "timeout" in kwargs and kwargs["timeout"] is not None
        if url == "https://api.github.com/gists/gist123":
            return _FakeResponse(
                200,
                json_data={
                    "files": {
                        "localizations.json": {
                            "truncated": False,
                            "content": json.dumps(existing_manifest),
                        }
                    }
                },
            )
        if url == "https://api.github.com/repos/org/repo/releases/latest":
            return _FakeResponse(
                200,
                json_data={
                    "tag_name": "v1.0",
                    "name": "v1.0",
                    "body": "hello",
                    "assets": [
                        {
                            "name": "loc.zip",
                            "size": 123,
                            "browser_download_url": "https://github.com/org/repo/releases/download/v1.0/loc.zip",
                        }
                    ],
                },
            )
        if url == "https://example.com/icon.png":
            return _FakeResponse(200, content=png)
        raise AssertionError(f"Unexpected GET {url}")

    session, _, mock_patch = _make_mock_session(
        get_side_effect=fake_get,
        patch_return_value=_FakeResponse(200, json_data={}),
    )

    settings = gist.GistSettings(
        github_token="tok",
        gist_id="gist123",
        chapters_url="https://example.com/chapters.json",
    )
    rc = gist.do_update(cfg, settings=settings, session=session, icon_cache=IconCache())
    assert rc == 0
    assert mock_patch.call_count == 1
    patch_json = cast(dict[str, dict[str, dict[str, str]]], mock_patch.call_args.kwargs["json"])
    sent_payload = cast(
        dict[str, object], json.loads(patch_json["files"]["localizations.json"]["content"])
    )
    assert sent_payload["chapters_url"] == "https://example.com/chapters.json"


# --- mirror updater end-to-end mocked tests ---


def test_update_mirror_updates_metadata_on_same_tag_and_cleans_up_after_manifest(
    tmp_path: Path,
) -> None:
    zip_bytes = b"PK\x03\x04fake-zip-content"
    font_bytes = b"OTTO-fake-otf-font-data"
    font_md5 = hashlib.md5(font_bytes).hexdigest()
    chapters_bytes = b'{"chapters": [1, 2]}'
    png = _make_png_bytes()

    cfg = tmp_path / "localizations.toml"
    cfg.write_text(
        "[ptbr-test]\n"
        'repo = "org/repo"\n'
        'name = "Updated Name"\n'
        'authors = ["Author 1", "Author 2"]\n'
        'flag = "BR"\n'
        'icon = "https://example.com/icon.png"\n'
        'format = "auto"\n'
        "[[ptbr-test.fonts]]\n"
        'url = "https://raw.githubusercontent.com/org/repo/main/Font.otf"\n'
        f'hash = "{font_md5}"\n'
        'name = "Context/Font.otf"\n',
        encoding="utf-8",
    )

    fake_minio = FakeMinio(bucket="localizations")
    fake_minio.objects["ptbr-test/files/v1.0.zip"] = FakeS3Object(b"old", "application/zip")
    fake_minio.objects["ptbr-test/files/v2.0.zip"] = FakeS3Object(zip_bytes, "application/zip")
    fake_minio.objects["localizations.json"] = FakeS3Object(
        json.dumps(
            {
                "localizations": [
                    {
                        "id": "ptbr-test",
                        "version": "v2.0",
                        "name": "Old Name",
                        "flag": "BR",
                        "icon": "data:image/webp;base64,old",
                        "description": "old",
                        "authors": ["Author 1"],
                        "url": "https://mirror.test/localizations/ptbr-test/files/v2.0.zip",
                        "size": len(zip_bytes),
                        "fonts": [],
                        "format": "auto",
                    }
                ],
                "format_version": 1,
            }
        ).encode("utf-8"),
        "application/json",
    )

    download_calls: list[str] = []

    def fake_get(url: str, **kwargs: object) -> requests.Response:
        assert "timeout" in kwargs and kwargs["timeout"] is not None
        if url == "https://api.github.com/repos/org/repo/releases/latest":
            return _FakeResponse(
                200,
                json_data={
                    "tag_name": "v2.0",
                    "name": "v2.0",
                    "body": "new desc",
                    "assets": [
                        {
                            "name": "loc.zip",
                            "size": len(zip_bytes),
                            "browser_download_url": "https://github.com/org/repo/releases/download/v2.0/loc.zip",
                        }
                    ],
                },
            )
        if url == "https://github.com/org/repo/releases/download/v2.0/loc.zip":
            download_calls.append(url)
            return _FakeResponse(200, content=zip_bytes)
        if url == "https://raw.githubusercontent.com/org/repo/main/Font.otf":
            download_calls.append(url)
            headers = cast(dict[str, str], kwargs["headers"])
            assert headers["Accept-Encoding"] == "identity"
            assert kwargs["timeout"] == DEFAULT_DOWNLOAD_TIMEOUT
            return _FakeResponse(200, content=font_bytes)
        if url == "https://example.com/icon.png":
            return _FakeResponse(200, content=png)
        if url == "https://example.com/chapters.json":
            return _FakeResponse(200, content=chapters_bytes)
        raise AssertionError(f"Unexpected GET {url}")

    session, _, _ = _make_mock_session(get_side_effect=fake_get)
    settings = mirror.MirrorSettings(
        minio_endpoint="minio:9000",
        minio_access_key="a",
        minio_secret_key="s",
        minio_bucket="localizations",
        minio_public_url="https://mirror.test",
        chapters_url="https://example.com/chapters.json",
    )

    rc = mirror.do_update(
        cfg, settings=settings, client=fake_minio, session=session, icon_cache=IconCache()
    )
    assert rc == 0

    assert fake_minio.last_get_responses[-1].closed
    assert fake_minio.last_get_responses[-1].released

    assert "https://github.com/org/repo/releases/download/v2.0/loc.zip" not in download_calls
    font_key = f"ptbr-test/fonts/{font_md5}.otf"
    assert font_key in fake_minio.objects

    manifest_obj = fake_minio.objects["localizations.json"]
    assert manifest_obj.content_type == "application/json; charset=utf-8"
    manifest = cast(dict[str, object], json.loads(manifest_obj.data.decode("utf-8")))
    locs = cast(list[dict[str, object]], manifest["localizations"])
    assert locs[0]["name"] == "Updated Name"
    assert locs[0]["authors"] == ["Author 1", "Author 2"]
    fonts = cast(list[dict[str, str]], locs[0]["fonts"])
    assert fonts[0]["url"] == f"https://mirror.test/localizations/{font_key}"
    assert manifest["chapters_url"] == "https://mirror.test/localizations/chapters.json"

    put_manifest_idx = fake_minio.ops.index(("put", "localizations.json"))
    remove_old_idx = fake_minio.ops.index(("remove", "ptbr-test/files/v1.0.zip"))
    assert remove_old_idx > put_manifest_idx
    assert "ptbr-test/files/v1.0.zip" not in fake_minio.objects


def test_update_mirror_aborts_on_total_failure_and_empty_config(tmp_path: Path) -> None:
    cfg = tmp_path / "localizations.toml"
    cfg.write_text(
        "[loc-a]\n"
        'repo = "org/a"\n'
        'name = "A"\n'
        'authors = ["A"]\n'
        'flag = "RU"\n'
        'icon = "https://example.com/a.png"\n'
        'format = "auto"\n'
        "fonts = []\n",
        encoding="utf-8",
    )

    fake_minio = FakeMinio(bucket="localizations")
    fake_minio.objects["loc-a/files/v1.zip"] = FakeS3Object(b"keep-me", "application/zip")

    session, _, _ = _make_mock_session(get_side_effect=requests.ConnectionError("github down"))

    settings = mirror.MirrorSettings(
        minio_endpoint="minio:9000",
        minio_access_key="a",
        minio_secret_key="s",
        minio_bucket="localizations",
        minio_public_url="https://mirror.test",
    )

    rc = mirror.do_update(
        cfg, settings=settings, client=fake_minio, session=session, icon_cache=IconCache()
    )
    assert rc == 1
    assert "loc-a/files/v1.zip" in fake_minio.objects
    assert "localizations.json" not in fake_minio.objects

    empty_cfg = tmp_path / "empty.toml"
    empty_cfg.write_text("# comment only\n", encoding="utf-8")
    rc_empty = mirror.do_update(
        empty_cfg, settings=settings, client=fake_minio, session=session, icon_cache=IconCache()
    )
    assert rc_empty == 1
    assert "loc-a/files/v1.zip" in fake_minio.objects
    assert "localizations.json" not in fake_minio.objects


def test_update_mirror_partial_failure_preserves_previous_and_skips_cleanup(
    tmp_path: Path,
) -> None:
    zip_a = b"PK\x03\x04zip-a-v2"
    png = _make_png_bytes()

    cfg = tmp_path / "localizations.toml"
    cfg.write_text(
        "[loc-a]\n"
        'repo = "org/a"\n'
        'name = "A"\n'
        'authors = ["A"]\n'
        'flag = "RU"\n'
        'icon = "https://example.com/a.png"\n'
        'format = "auto"\n'
        "fonts = []\n\n"
        "[loc-b]\n"
        'repo = "org/b"\n'
        'name = "B"\n'
        'authors = ["B"]\n'
        'flag = "RU"\n'
        'icon = "https://example.com/b.png"\n'
        'format = "auto"\n'
        "fonts = []\n",
        encoding="utf-8",
    )

    fake_minio = FakeMinio(bucket="localizations")
    fake_minio.objects["loc-a/files/v1.zip"] = FakeS3Object(b"old-a", "application/zip")
    fake_minio.objects["loc-b/files/v1.zip"] = FakeS3Object(b"old-b", "application/zip")
    fake_minio.objects["localizations.json"] = FakeS3Object(
        json.dumps(
            {
                "localizations": [
                    {
                        "id": "loc-a",
                        "version": "v1",
                        "name": "A",
                        "flag": "RU",
                        "icon": "data:image/webp;base64,oldA",
                        "description": "",
                        "authors": ["A"],
                        "url": "https://mirror.test/localizations/loc-a/files/v1.zip",
                        "size": 5,
                        "fonts": [],
                        "format": "auto",
                    },
                    {
                        "id": "loc-b",
                        "version": "v1",
                        "name": "B",
                        "flag": "RU",
                        "icon": "data:image/webp;base64,oldB",
                        "description": "",
                        "authors": ["B"],
                        "url": "https://mirror.test/localizations/loc-b/files/v1.zip",
                        "size": 5,
                        "fonts": [],
                        "format": "auto",
                    },
                ],
                "format_version": 1,
            }
        ).encode(),
        "application/json",
    )

    def fake_get(url: str, **kwargs: object) -> requests.Response:
        del kwargs
        if url == "https://api.github.com/repos/org/a/releases/latest":
            return _FakeResponse(
                200,
                json_data={
                    "tag_name": "v2",
                    "name": "v2",
                    "body": "ok",
                    "assets": [
                        {
                            "name": "a.zip",
                            "size": len(zip_a),
                            "browser_download_url": "https://github.com/org/a/releases/download/v2/a.zip",
                        }
                    ],
                },
            )
        if url == "https://github.com/org/a/releases/download/v2/a.zip":
            return _FakeResponse(200, content=zip_a)
        if url == "https://example.com/a.png":
            return _FakeResponse(200, content=png)
        if url == "https://api.github.com/repos/org/b/releases/latest":
            raise requests.ConnectionError("transient failure for org/b")
        raise AssertionError(f"Unexpected GET {url}")

    session, _, _ = _make_mock_session(get_side_effect=fake_get)
    settings = mirror.MirrorSettings(
        minio_endpoint="minio:9000",
        minio_access_key="a",
        minio_secret_key="s",
        minio_bucket="localizations",
        minio_public_url="https://mirror.test",
    )

    rc = mirror.do_update(
        cfg, settings=settings, client=fake_minio, session=session, icon_cache=IconCache()
    )
    assert rc == 0
    manifest = cast(
        dict[str, object], json.loads(fake_minio.objects["localizations.json"].data.decode("utf-8"))
    )
    locs = cast(list[dict[str, object]], manifest["localizations"])
    by_id = {cast(str, loc["id"]): loc for loc in locs}
    assert by_id["loc-a"]["version"] == "v2"
    assert by_id["loc-b"]["version"] == "v1"
    assert "loc-a/files/v1.zip" in fake_minio.objects
    assert "loc-b/files/v1.zip" in fake_minio.objects


def test_update_gist_empty_config_and_truncated_gist(tmp_path: Path) -> None:
    empty_cfg = tmp_path / "empty.toml"
    empty_cfg.write_text("", encoding="utf-8")
    session, mock_get, mock_patch = _make_mock_session()
    settings = gist.GistSettings(github_token="tok", gist_id="gist123")
    assert gist.do_update(empty_cfg, settings=settings, session=session) == 1
    assert mock_patch.call_count == 0

    expected = {"localizations": [{"id": "x"}], "format_version": 1}

    def fake_get(url: str, **kwargs: object) -> requests.Response:
        del kwargs
        if url == "https://api.github.com/gists/gist123":
            return _FakeResponse(
                200,
                json_data={
                    "files": {
                        "localizations.json": {
                            "truncated": True,
                            "raw_url": "https://gist.githubusercontent.com/owner/gist123/raw/abc123/localizations.json",
                            "content": "{truncated",
                        }
                    }
                },
            )
        if url.endswith("/abc123/localizations.json"):
            return _FakeResponse(200, content=json.dumps(expected).encode())
        raise AssertionError(f"Unexpected GET {url}")

    mock_get.side_effect = fake_get
    assert gist.load_current_manifest(session, settings) == expected

    mock_get.side_effect = None
    mock_get.return_value = _FakeResponse(200, json_data={"files": {}})
    assert gist.load_current_manifest(session, settings) == {}


def test_sync_to_minio_integrity_checks_and_redownload() -> None:
    fake_minio = FakeMinio(bucket="localizations")
    session, mock_get, _ = _make_mock_session()

    mock_get.return_value = _FakeResponse(200, content=b"wrong-font-bytes")
    with pytest.raises(ValueError, match="MD5 mismatch"):
        mirror.sync_to_minio(
            fake_minio,
            session,
            "localizations",
            "https://raw.githubusercontent.com/org/repo/main/font.ttf",
            "loc/fonts/deadbeef.ttf",
            expected_md5="0" * 32,
        )
    assert "loc/fonts/deadbeef.ttf" not in fake_minio.objects

    mock_get.return_value = _FakeResponse(200, content=b"short")
    with pytest.raises(ValueError, match="size mismatch"):
        mirror.sync_to_minio(
            fake_minio,
            session,
            "localizations",
            "https://github.com/org/repo/releases/download/v1/loc.zip",
            "loc/files/v1.zip",
            expected_size=999,
        )
    assert "loc/files/v1.zip" not in fake_minio.objects

    good_bytes = b"valid-font-content"
    good_md5 = hashlib.md5(good_bytes).hexdigest()
    corrupt_obj = FakeS3Object(b"corrupt", "application/octet-stream")
    corrupt_obj.etag = f'"{good_md5}-2"'
    fake_minio.objects["loc/fonts/font.ttf"] = corrupt_obj

    mock_get.return_value = _FakeResponse(200, content=good_bytes)
    mirror.sync_to_minio(
        fake_minio,
        session,
        "localizations",
        "https://raw.githubusercontent.com/org/repo/main/font.ttf",
        "loc/fonts/font.ttf",
        expected_md5=good_md5,
    )
    assert fake_minio.objects["loc/fonts/font.ttf"].data == good_bytes
    assert fake_minio.objects["loc/fonts/font.ttf"].metadata["x-amz-meta-md5"] == good_md5


def test_sync_chapters_validation_and_fallback_on_outage(tmp_path: Path) -> None:
    fake_minio = FakeMinio(bucket="localizations")
    session, mock_get, _ = _make_mock_session(
        get_return_value=_FakeResponse(200, content=b"<html>not json</html>")
    )

    with pytest.raises(json.JSONDecodeError):
        mirror.sync_chapters(
            fake_minio, session, "localizations", "https://example.com/chapters.json"
        )
    assert "chapters.json" not in fake_minio.objects

    fake_minio.objects["chapters.json"] = FakeS3Object(b'{"ok":true}', "application/json")
    zip_bytes = b"PK\x03\x04ok"
    png = _make_png_bytes()
    cfg = tmp_path / "localizations.toml"
    cfg.write_text(
        "[loc-a]\n"
        'repo = "org/a"\n'
        'name = "A"\n'
        'authors = ["A"]\n'
        'flag = "RU"\n'
        'icon = "https://example.com/a.png"\n'
        'format = "auto"\n'
        "fonts = []\n",
        encoding="utf-8",
    )

    def fake_get(url: str, **kwargs: object) -> requests.Response:
        del kwargs
        if url == "https://api.github.com/repos/org/a/releases/latest":
            return _FakeResponse(
                200,
                json_data={
                    "tag_name": "v1",
                    "name": "v1",
                    "body": "ok",
                    "assets": [
                        {
                            "name": "a.zip",
                            "size": len(zip_bytes),
                            "browser_download_url": "https://github.com/org/a/releases/download/v1/a.zip",
                        }
                    ],
                },
            )
        if url == "https://github.com/org/a/releases/download/v1/a.zip":
            return _FakeResponse(200, content=zip_bytes)
        if url == "https://example.com/a.png":
            return _FakeResponse(200, content=png)
        if url == "https://example.com/chapters.json":
            raise requests.ConnectionError("chapters upstream down")
        raise AssertionError(f"Unexpected GET {url}")

    mock_get.side_effect = fake_get
    settings = mirror.MirrorSettings(
        minio_endpoint="minio:9000",
        minio_access_key="a",
        minio_secret_key="s",
        minio_bucket="localizations",
        minio_public_url="https://mirror.test",
        chapters_url="https://example.com/chapters.json",
    )
    rc = mirror.do_update(
        cfg, settings=settings, client=fake_minio, session=session, icon_cache=IconCache()
    )
    assert rc == 0
    manifest = cast(
        dict[str, object], json.loads(fake_minio.objects["localizations.json"].data.decode("utf-8"))
    )
    assert manifest["chapters_url"] == "https://mirror.test/localizations/chapters.json"


def test_load_config_precedence_and_remote_fallback(tmp_path: Path) -> None:
    local_cfg = tmp_path / "custom.toml"
    local_cfg.write_text('[local-loc]\nname = "Local"\n', encoding="utf-8")

    session, mock_get, _ = _make_mock_session(
        get_return_value=_FakeResponse(200, content=b'[remote-loc]\nname = "Remote"\n')
    )

    loaded = load_config(
        session,
        config_url="https://example.com/remote.toml",
        config_path=local_cfg,
        base_dir=tmp_path,
    )
    assert loaded == {"local-loc": {"name": "Local"}}
    assert mock_get.call_count == 0

    (tmp_path / "localizations.toml").write_text('[fallback]\nname = "FB"\n', encoding="utf-8")
    mock_get.return_value = _FakeResponse(200, content=b"   \n")
    loaded_fb = load_config(
        session,
        config_url="https://example.com/empty.toml",
        base_dir=tmp_path,
    )
    assert loaded_fb == {"fallback": {"name": "FB"}}


def test_timeout_rejects_nan_inf_and_retry_after_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    for bad in ("nan", "inf", "-inf", "0"):
        monkeypatch.setenv("HTTP_DOWNLOAD_TIMEOUT", bad)
        with pytest.raises(ValueError):
            get_download_timeout()

    retry = _CappedRetry(total=3, respect_retry_after_header=True)
    fake_resp = urllib3.HTTPResponse(status=429, headers={"Retry-After": "3600"})
    assert retry.get_retry_after(fake_resp) == MAX_RETRY_AFTER_SECONDS


def test_oversized_icon_falls_back_and_repo_dot_segments_rejected() -> None:
    session, _, _ = _make_mock_session(
        get_return_value=_FakeResponse(200, content=b"x" * (MAX_ICON_BYTES + 1))
    )
    uri = get_optimized_icon(session, "https://example.com/huge.png", fallback_icon="data:prev")
    assert uri == "data:prev"

    base: dict[str, object] = {
        "repo": "../evil",
        "name": "Test",
        "authors": ["Author"],
        "flag": "RU",
        "icon": "https://example.com/icon.png",
        "format": "auto",
        "fonts": [],
    }
    with pytest.raises(ValueError):
        validate_config_entry("ru-test", base)
    with pytest.raises(ValueError):
        validate_config_entry("ru-test", {**base, "repo": "org/.."})


def test_unified_cli_help_and_validate(tmp_path: Path) -> None:
    for sub_args in (
        ["--help"],
        ["gist", "--help"],
        ["mirror", "--help"],
        ["validate", "--help"],
    ):
        proc = subprocess.run(
            [sys.executable, "-m", "llm_updater", *sub_args],
            capture_output=True,
            text=True,
            env={"PATH": ""},
            check=False,
        )
        assert proc.returncode == 0, proc.stderr

    # Validating real data/localizations.toml passes
    assert cli.main(["validate", str(DATA_LOCALIZATIONS)]) == 0

    # Invalid config returns exit code 1
    bad_cfg = tmp_path / "bad.toml"
    bad_cfg.write_text('[bad]\nrepo = "invalid"\n', encoding="utf-8")
    assert cli.main(["validate", str(bad_cfg)]) == 1


def test_positive_int_and_version_sanitization() -> None:
    assert positive_int("3") == 3
    with pytest.raises(ValueError):
        positive_int("0")
    assert mirror.sanitize_version_for_key("v1.2.3-rc_1") == "v1.2.3-rc_1"
    assert mirror.sanitize_version_for_key("release/1.0 #2") == "release_1.0_2"
    with pytest.raises(ValueError):
        mirror.sanitize_version_for_key("..")
