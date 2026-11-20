"""Local campaign evidence ingestion."""

from .importer import ImportError, ImportResult, import_campaign

__all__ = ["ImportError", "ImportResult", "import_campaign"]
