import time
import routers.auth as auth_mod


def setup_function():
    auth_mod._oauth_codes.clear()


def teardown_function():
    auth_mod._oauth_codes.clear()


def test_expired_entries_evicted_on_store():
    # Plant a stale entry (expired 1s ago)
    auth_mod._oauth_codes["stale-code"] = ({"access_token": "old"}, time.time() - 1)

    # Trigger a new store — sweep should evict the stale entry
    new_code = auth_mod._store_oauth_tokens({"access_token": "new"})

    assert "stale-code" not in auth_mod._oauth_codes
    assert new_code in auth_mod._oauth_codes


def test_unexpired_entries_survive_sweep():
    # Plant a live entry (expires in 60s)
    auth_mod._oauth_codes["live-code"] = ({"access_token": "live"}, time.time() + 60)

    new_code = auth_mod._store_oauth_tokens({"access_token": "new"})

    assert "live-code" in auth_mod._oauth_codes
    assert new_code in auth_mod._oauth_codes
