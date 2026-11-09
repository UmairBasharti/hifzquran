"""Shared pytest setup.

Several tests read backend/quran/quran_data.json directly. The server creates that file the first
time it starts, but on a fresh clone nothing has started yet, so create it here the same way (one
download from api.quran.com, about a minute) instead of failing with FileNotFoundError.
"""
import asyncio
import os
import warnings

import pytest
from dotenv import load_dotenv

load_dotenv()

from quran import loader


@pytest.fixture(scope="session", autouse=True)
def quran_data_file():
    if os.path.exists(loader.DATA_FILE_PATH):
        return
    try:
        asyncio.run(loader.load_quran_data())
    except Exception as download_error:
        # Do not fail the whole session: tests that need the data fail with a clear
        # FileNotFoundError, and the tests that do not need it still run.
        warnings.warn(f"Could not create {loader.DATA_FILE_PATH}: {download_error}")
