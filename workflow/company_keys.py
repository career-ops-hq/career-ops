"""Canonical employer keys shared by reply matching and historical insights."""

from __future__ import annotations

import re
import unicodedata


LEGAL_SUFFIXES = (
    "incorporated", "inc", "corporation", "corp", "company", "co",
    "limited", "ltd", "llc", "llp", "lp", "plc",
)
GENERIC_DESCRIPTORS = (
    "group", "holdings", "technologies", "technology", "solutions",
    "canada", "international",
)


def normalize_company(value: str) -> str:
    """Fold legal suffixes without merging distinct descriptor chains."""
    value = unicodedata.normalize("NFKC", value).lower()
    value = re.sub(r"\([^)]*\)", " ", value).replace("&", " and ")
    value = " ".join("".join(
        char if char.isalnum() or unicodedata.category(char).startswith("M") or char.isspace() else " "
        for char in value
    ).split())
    while any(value.endswith(" " + suffix) for suffix in LEGAL_SUFFIXES):
        value = next(value[:-(len(suffix) + 1)] for suffix in LEGAL_SUFFIXES if value.endswith(" " + suffix))
    for descriptor in GENERIC_DESCRIPTORS:
        if value.endswith(" " + descriptor):
            value = value[:-(len(descriptor) + 1)]
            break
    return value
