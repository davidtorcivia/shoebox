import secrets

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"


def nanoid(size: int = 12) -> str:
    if size < 0:
        raise ValueError("size must be non-negative")
    return "".join(secrets.choice(ALPHABET) for _ in range(size))
