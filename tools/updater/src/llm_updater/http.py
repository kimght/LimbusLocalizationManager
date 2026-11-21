import math
import os
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.response import BaseHTTPResponse
from urllib3.util.retry import Retry

USER_AGENT = "LimbusLocalizationManager-Updater/1.0"

# (connect_timeout, read_timeout) in seconds
DEFAULT_METADATA_TIMEOUT: tuple[float, float] = (15.0, 60.0)
DEFAULT_DOWNLOAD_TIMEOUT: tuple[float, float] = (30.0, 600.0)
MAX_RETRY_AFTER_SECONDS: float = 60.0

_GITHUB_AUTH_HOSTS = frozenset(
    {
        "api.github.com",
        "github.com",
        "raw.githubusercontent.com",
        "gist.githubusercontent.com",
    }
)


class _CappedRetry(Retry):
    """urllib3 Retry that caps Retry-After waits so one 429 cannot stall shutdown."""

    def get_retry_after(self, response: BaseHTTPResponse) -> float | None:
        retry_after = super().get_retry_after(response)
        if retry_after is None:
            return None
        return min(retry_after, MAX_RETRY_AFTER_SECONDS)


def parse_timeout_env(
    env_name: str,
    default: tuple[float, float],
) -> tuple[float, float]:
    raw = os.environ.get(env_name)
    if raw is None or not raw.strip():
        return default
    try:
        read_timeout = float(raw.strip())
    except ValueError as e:
        raise ValueError(f"Invalid {env_name}={raw!r}: expected positive finite number") from e
    if not math.isfinite(read_timeout) or read_timeout <= 0:
        raise ValueError(f"Invalid {env_name}={raw!r}: must be a finite number > 0")
    return (min(default[0], read_timeout), read_timeout)


def get_metadata_timeout() -> tuple[float, float]:
    return parse_timeout_env("HTTP_METADATA_TIMEOUT", DEFAULT_METADATA_TIMEOUT)


def get_download_timeout() -> tuple[float, float]:
    return parse_timeout_env("HTTP_DOWNLOAD_TIMEOUT", DEFAULT_DOWNLOAD_TIMEOUT)


def is_github_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"github.com", "githubusercontent.com"} or host.endswith(
        (".github.com", ".githubusercontent.com")
    )


def get_github_headers(
    url: str,
    github_token: str | None = None,
    *,
    accept_json: bool = False,
) -> dict[str, str]:
    headers: dict[str, str] = {"User-Agent": USER_AGENT}
    host = (urlparse(url).hostname or "").lower()

    if accept_json and host == "api.github.com":
        headers["Accept"] = "application/vnd.github+json"

    if github_token and host in _GITHUB_AUTH_HOSTS:
        headers["Authorization"] = f"token {github_token}"

    return headers


def get_proxies(url: str, github_proxy: str | None = None) -> dict[str, str] | None:
    if github_proxy and is_github_host(url):
        return {"http": github_proxy, "https": github_proxy}
    return None


def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    retry = _CappedRetry(
        total=3,
        connect=3,
        read=2,
        status=3,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "HEAD"}),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session
