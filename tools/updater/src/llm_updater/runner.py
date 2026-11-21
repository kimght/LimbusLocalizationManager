import logging
import signal
import threading
from collections.abc import Callable

import schedule

logger = logging.getLogger(__name__)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise ValueError("interval must be >= 1")
    return parsed


def run_scheduled(
    update_fn: Callable[[], int],
    *,
    interval_minutes: int,
) -> int:
    stop_event = threading.Event()
    received_signals: list[int] = []

    def _handle_signal(signum: int, _frame: object) -> None:
        received_signals.append(signum)
        stop_event.set()

    prev_sigterm = signal.signal(signal.SIGTERM, _handle_signal)
    prev_sigint = signal.signal(signal.SIGINT, _handle_signal)

    try:

        def _job() -> None:
            if stop_event.is_set():
                return
            update_fn()

        logger.info("Scheduling updates every %d minute(s)", interval_minutes)
        _job()

        scheduler = schedule.Scheduler()
        # schedule's Job.do annotates job_func with bare Callable.
        scheduler.every(interval_minutes).minutes.do(_job)  # pyright: ignore[reportUnknownMemberType]

        while not stop_event.is_set():
            scheduler.run_pending()
            stop_event.wait(timeout=1.0)
    finally:
        signal.signal(signal.SIGTERM, prev_sigterm)
        signal.signal(signal.SIGINT, prev_sigint)

    if received_signals:
        sig_name = signal.Signals(received_signals[-1]).name
        logger.info("Received %s, shutdown complete", sig_name)
    else:
        logger.info("Shutdown complete")
    return 0
