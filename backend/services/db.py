from __future__ import annotations

import os
import threading
from supabase import create_client, Client

_client: Client | None = None
_lock = threading.Lock()


def get_db() -> Client:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = create_client(
                    os.environ["SUPABASE_URL"],
                    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                )
    return _client
