import os

from supabase import create_client

# Cached Supabase client (built once, reused across requests).
_supabase_client = None


# Returns a Supabase client built with the SERVICE-ROLE (secret) key, or None when
# the backend has no Supabase credentials configured (e.g. local dev without keys).
# The service-role key bypasses RLS, which is correct for trusted backend writes.
def get_supabase_client():
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        return None

    _supabase_client = create_client(supabase_url, service_role_key)
    return _supabase_client
