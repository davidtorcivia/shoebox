import re

from ids import nanoid


def test_nanoid_default_length():
    assert len(nanoid()) == 12


def test_nanoid_custom_length():
    assert len(nanoid(21)) == 21


def test_nanoid_alphabet_is_url_safe():
    for _ in range(50):
        assert re.fullmatch(r"[A-Za-z0-9_-]+", nanoid())


def test_nanoid_unique():
    ids = {nanoid() for _ in range(1000)}
    assert len(ids) == 1000


def test_nanoid_rejects_negative_size():
    try:
        nanoid(-1)
        assert False
    except ValueError:
        assert True
