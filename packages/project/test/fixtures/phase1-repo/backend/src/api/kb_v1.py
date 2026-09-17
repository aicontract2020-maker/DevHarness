def require_admin(payload):
    if payload.get("role") != "admin":
        raise Exception("Admin role required")
