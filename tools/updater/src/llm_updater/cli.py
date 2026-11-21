import argparse
import logging
import tomllib
from collections.abc import Sequence
from pathlib import Path
from typing import cast

from llm_updater.config import resolve_local_config_path, validate_config
from llm_updater.runner import positive_int, run_scheduled

logger = logging.getLogger(__name__)

_LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def _add_common_updater_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--schedule",
        action="store_true",
        default=False,
        help="Run continuously on a fixed interval instead of exiting after one run.",
    )
    parser.add_argument(
        "--interval",
        type=positive_int,
        default=5,
        help="Polling interval in minutes when --schedule is set (default: 5).",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to localizations.toml (takes precedence over CONFIG_URL and CONFIG_PATH).",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=_LOG_LEVELS,
        help="Logging verbosity (default: INFO).",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="llm-updater",
        description="LimbusLocalizationManager localization manifest and mirror updater.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    gist_parser = subparsers.add_parser(
        "gist",
        help="Update the GitHub Gist localizations manifest.",
    )
    _add_common_updater_args(gist_parser)

    mirror_parser = subparsers.add_parser(
        "mirror",
        help="Sync localization archives, fonts, and manifest to a MinIO bucket.",
    )
    _add_common_updater_args(mirror_parser)

    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate localizations.toml against the client schema without network calls.",
    )
    validate_parser.add_argument(
        "config",
        nargs="?",
        type=Path,
        default=None,
        help="Path to localizations.toml (auto-discovered if omitted).",
    )
    validate_parser.add_argument(
        "--log-level",
        default="INFO",
        choices=_LOG_LEVELS,
        help="Logging verbosity (default: INFO).",
    )

    return parser


def _configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        force=True,
    )


def _run_validate(config_path: Path | None) -> int:
    resolved = resolve_local_config_path(config_path)
    if resolved is None:
        return 1

    try:
        with resolved.open("rb") as f:
            parsed = tomllib.load(f)
        validated = validate_config(parsed)
    except (OSError, tomllib.TOMLDecodeError, TypeError, ValueError) as e:
        logger.error("Validation failed for %s: %s", resolved, e)
        return 1

    logger.info("Valid configuration: %d localization(s) in %s", len(validated), resolved)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    log_level = cast(str, args.log_level)
    _configure_logging(log_level)

    command = cast(str, args.command)
    config_path = cast(Path | None, args.config)

    if command == "validate":
        return _run_validate(config_path)

    schedule_mode = cast(bool, args.schedule)
    interval = cast(int, args.interval)

    if command == "gist":
        from llm_updater.gist import run_once

        if schedule_mode:
            return run_scheduled(lambda: run_once(config_path), interval_minutes=interval)
        return run_once(config_path)

    if command == "mirror":
        try:
            from llm_updater.mirror import run_once as mirror_run_once
        except ModuleNotFoundError as e:
            if e.name == "minio" or (e.name is not None and e.name.startswith("minio.")):
                logger.error(
                    "The 'mirror' command requires the optional 'mirror' dependency group "
                    "(install with: uv sync --extra mirror)"
                )
                return 1
            raise

        if schedule_mode:
            return run_scheduled(lambda: mirror_run_once(config_path), interval_minutes=interval)
        return mirror_run_once(config_path)

    parser.error(f"Unknown command: {command}")
