from __future__ import annotations

import argparse
import copy
import json
import math
import os
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


SCHEMA_VERSION = 1
HEADER_SEARCH_ROWS = 30
MAX_DATA_ROWS = 10_000
MAX_COLUMNS = 50
MAX_SHEETS = 100
MAX_CELL_CHARS = 500
MIN_WORKSHEET_XML_OPTIMIZE_BYTES = 2 * 1024 * 1024
WORKSHEET_CELL_REFERENCE_BYTES_PATTERN = re.compile(
    rb'<c\b[^>]*\br="\$?([A-Z]+)\$?(\d+)"[^>]*>'
)

FIELD_ALIASES = {
    "sku": ("код", "код товара", "артикул", "sku", "номенклатурный номер"),
    "name": ("наименование", "название", "товар", "name", "дымоходы т и с"),
    "price": ("цена", "розница", "розничная", "цена розница", "розничная цена", "цена продажи"),
    "wholesalePrice": (
        "опт",
        "цена опт",
        "оптовая",
        "оптовая цена",
        "для постоянных клиентов",
        "для посотянных клиентов",
    ),
    "bulkWholesalePrice": (
        "опт 2",
        "крупный опт",
        "крупнооптовая цена",
        "более 350 000",
        "более 350000",
    ),
    "skoPrice": ("ско", "цена ско", "ско цена"),
    "incomingPrice": (
        "приходная",
        "приходная цена",
        "приход",
        "закупочная",
        "закупочная цена",
        "себестоимость",
    ),
}

PRICE_FIELDS = ("price", "wholesalePrice", "bulkWholesalePrice", "skoPrice", "incomingPrice")
PRICE_ERRORS = {
    "price": "invalid_price",
    "wholesalePrice": "invalid_wholesale_price",
    "bulkWholesalePrice": "invalid_bulk_wholesale_price",
    "skoPrice": "invalid_sko_price",
    "incomingPrice": "invalid_incoming_price",
}
ONE_C_PRICE_FIELD = {
    "RETAIL": "price",
    "WHOLESALE": "wholesalePrice",
    "BULK_WHOLESALE": "bulkWholesalePrice",
    "SKO": "skoPrice",
    "INCOMING": "incomingPrice",
}
ONE_C_CODE_PATTERN = re.compile(
    r'\{16,2,\s*\{1,1,\s*\{"#","(?P<value>(?:""|[^"\\]|\\.)*)"\}\s*\},0\}',
    re.DOTALL,
)
ONE_C_TWO_COLUMN_NAME_PATTERN = re.compile(
    r'\{16,2,\s*\{1,1,\s*\{"#","(?P<value>(?:""|[^"\\]|\\.)*)"\}\s*\},0\}',
    re.DOTALL,
)
ONE_C_TWO_COLUMN_PRICE_PATTERN = re.compile(
    r'\{16,3,\s*\{1,1,\s*\{"#","(?P<value>(?:""|[^"\\]|\\.)*)"\}\s*\},0\}',
    re.DOTALL,
)
ONE_C_THREE_COLUMN_NAME_PATTERN = ONE_C_TWO_COLUMN_PRICE_PATTERN
ONE_C_THREE_COLUMN_PRICE_PATTERN = re.compile(
    r'\{16,4,\s*\{1,1,\s*\{"#","(?P<value>(?:""|[^"\\]|\\.)*)"\}\s*\},0\}',
    re.DOTALL,
)
ONE_C_ARTICLE_PATTERN = re.compile(r"арт(?:икул)?\.?\s*[-:]?\s*(\d+)", re.IGNORECASE)
ONE_C_CODE_HEADER_PATTERN = re.compile(
    r'\{"#","\s*(?:код|код товара|артикул)\s*"\}', re.IGNORECASE
)


class PriceImporterError(Exception):
    """Raised when the workbook cannot be processed at all."""


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).casefold().strip()
    normalized = "".join(character for character in text if character.isalnum())
    for currency_suffix in ("тенге", "kzt", "тг"):
        if normalized.endswith(currency_suffix) and len(normalized) > len(currency_suffix):
            return normalized[: -len(currency_suffix)]
    return normalized


ALIAS_TO_FIELD = {
    _normalize_header(alias): field
    for field, aliases in FIELD_ALIASES.items()
    for alias in aliases
}


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFKC", str(value)).replace("\u00a0", " ").split())


def _append_error(errors: list[str], error: str) -> None:
    if error not in errors:
        errors.append(error)


def _bounded_text(value: Any, field: str, errors: list[str]) -> str:
    text = _normalize_text(value)
    if len(text) > MAX_CELL_CHARS:
        _append_error(errors, f"cell_too_long:{field}")
        return text[:MAX_CELL_CHARS]
    return text


def _zero_pad_width(number_format: Any) -> int | None:
    """Return the width of a simple Excel integer mask such as 00000000."""

    if not isinstance(number_format, str):
        return None
    positive_section = number_format.split(";", 1)[0].strip()
    positive_section = re.sub(r"\[[^]]*]", "", positive_section)
    positive_section = positive_section.replace('"', "").replace("\\", "")
    return len(positive_section) if re.fullmatch(r"0+", positive_section) else None


def _format_sku(cell: Any, errors: list[str]) -> str:
    value = cell.value
    if value is None:
        return ""

    if isinstance(value, bool):
        text = str(value)
    elif isinstance(value, (int, float, Decimal)):
        try:
            numeric = Decimal(str(value))
        except InvalidOperation:
            text = str(value)
        else:
            if not numeric.is_finite():
                text = str(value)
            elif numeric == numeric.to_integral_value():
                text = str(int(numeric))
                width = _zero_pad_width(getattr(cell, "number_format", None))
                if width:
                    text = text.zfill(width)
            else:
                text = format(numeric.normalize(), "f")
    else:
        text = str(value)

    return _bounded_text(text, "sku", errors)


def _normalize_sku_key(value: str) -> str:
    return _normalize_text(value).casefold()


def _json_number(value: Decimal) -> str:
    """Serialize money losslessly for BigDecimal consumers."""

    return format(value, "f")


def _parse_price(value: Any, field: str, errors: list[str]) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None

    text = _normalize_text(value)
    if len(text) > MAX_CELL_CHARS:
        _append_error(errors, f"cell_too_long:{field}")
        _append_error(errors, PRICE_ERRORS[field])
        return None

    try:
        if isinstance(value, bool):
            raise InvalidOperation
        if isinstance(value, float) and not math.isfinite(value):
            raise InvalidOperation
        if isinstance(value, (int, float, Decimal)):
            parsed = Decimal(str(value))
        else:
            normalized = text.replace(" ", "").replace("\u00a0", "").replace(",", ".")
            parsed = Decimal(normalized)
    except (InvalidOperation, ValueError):
        _append_error(errors, PRICE_ERRORS[field])
        return None

    if not parsed.is_finite() or parsed < 0:
        _append_error(errors, PRICE_ERRORS[field])
        return None
    if parsed == 0:
        return None
    return _json_number(parsed)


def _header_candidate(row: tuple[Any, ...]) -> tuple[dict[str, int], list[str]]:
    columns: dict[str, int] = {}
    errors: list[str] = []
    for column_index, cell in enumerate(row, start=1):
        field = ALIAS_TO_FIELD.get(_normalize_header(cell.value))
        if field is None:
            continue
        if field in columns:
            _append_error(errors, f"duplicate_header:{field}")
            continue
        columns[field] = column_index
    return columns, errors


def _is_recognized_header(columns: dict[str, int]) -> bool:
    return "sku" in columns and any(field in columns for field in PRICE_FIELDS)


def _find_header(worksheet: Any) -> tuple[int, dict[str, int], list[str]] | None:
    max_row = min(int(worksheet.max_row or 0), HEADER_SEARCH_ROWS)
    max_col = min(int(worksheet.max_column or 0), MAX_COLUMNS)
    best: tuple[int, int, dict[str, int], list[str]] | None = None

    for row_number, row in enumerate(
        worksheet.iter_rows(min_row=1, max_row=max_row, max_col=max_col),
        start=1,
    ):
        columns, errors = _header_candidate(row)
        if not _is_recognized_header(columns):
            continue
        score = len(columns)
        if best is None or score > best[0]:
            best = (score, row_number, columns, errors)

    if best is None:
        return None
    return best[1], best[2], best[3]


def _cell_at(row: tuple[Any, ...], one_based_index: int | None) -> Any | None:
    if one_based_index is None or one_based_index < 1 or one_based_index > len(row):
        return None
    return row[one_based_index - 1]


def _row_is_product_candidate(row: tuple[Any, ...], columns: dict[str, int]) -> bool:
    sku_cell = _cell_at(row, columns.get("sku"))
    if sku_cell is None or not _normalize_text(sku_cell.value):
        return False
    return any(
        (cell := _cell_at(row, columns.get(field))) is not None
        and bool(_normalize_text(cell.value))
        for field in PRICE_FIELDS
    )


def _parse_row(
    sheet_name: str,
    row_number: int,
    row: tuple[Any, ...],
    columns: dict[str, int],
    inherited_errors: list[str] | None = None,
) -> dict[str, Any]:
    errors: list[str] = list(inherited_errors or [])
    sku_cell = _cell_at(row, columns.get("sku"))
    name_cell = _cell_at(row, columns.get("name"))
    sku = _format_sku(sku_cell, errors) if sku_cell is not None else ""
    name_text = _bounded_text(name_cell.value, "name", errors) if name_cell is not None else ""
    name = name_text or None

    if not sku:
        _append_error(errors, "missing_sku")

    prices: dict[str, str | None] = {}
    for field in PRICE_FIELDS:
        cell = _cell_at(row, columns.get(field))
        prices[field] = _parse_price(cell.value, field, errors) if cell is not None else None

    return {
        "sourceSheet": sheet_name,
        "sourceRow": row_number,
        "sku": sku,
        "name": name,
        "price": prices["price"],
        "wholesalePrice": prices["wholesalePrice"],
        "bulkWholesalePrice": prices["bulkWholesalePrice"],
        "skoPrice": prices["skoPrice"],
        "incomingPrice": prices["incomingPrice"],
        "errors": errors,
    }


def _empty_sheet_result(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "recognized": False,
        "headerRow": None,
        "columns": {},
        "dataRowCount": 0,
        "errors": [],
    }


def _excel_column_index(column_name: str) -> int:
    result = 0
    for character in column_name.upper():
        if not "A" <= character <= "Z":
            return 0
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def _excel_column_name(column_index: int) -> str:
    result = ""
    while column_index > 0:
        column_index, remainder = divmod(column_index - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result or "A"


def _filter_worksheet_xml_bytes(data: bytes, max_column: int) -> bytes:
    """Drop sorted far-right cells while preserving rows and drawing metadata."""

    sheet_data_start = data.find(b"<sheetData")
    if sheet_data_start < 0:
        return data
    sheet_data_start = data.find(b">", sheet_data_start)
    sheet_data_end = data.find(b"</sheetData>", sheet_data_start)
    if sheet_data_start < 0 or sheet_data_end < 0:
        return data

    kept_column_pattern = re.compile(
        rb'<c\b[^>]*\br="\$?(?:'
        + b"|".join(
            _excel_column_name(index).encode("ascii")
            for index in range(1, max_column + 1)
        )
        + rb')\$?\d+"'
    )
    output = bytearray(data[: sheet_data_start + 1])
    cursor = sheet_data_start + 1
    actual_max_column = 0
    actual_max_row = 0
    removed_cells = False

    def cell_end(cell_match: re.Match[bytes], limit: int) -> int | None:
        opening_end = cell_match.end()
        if data[opening_end - 2 : opening_end] == b"/>":
            return opening_end
        closing_start = data.find(b"</c>", opening_end, limit)
        return closing_start + len(b"</c>") if closing_start >= 0 else None

    while cursor < sheet_data_end:
        row_start = data.find(b"<row", cursor, sheet_data_end)
        if row_start < 0:
            output.extend(data[cursor:sheet_data_end])
            break
        output.extend(data[cursor:row_start])
        row_open_end = data.find(b">", row_start, sheet_data_end)
        if row_open_end < 0:
            return data
        if data[row_open_end - 1 : row_open_end] == b"/":
            output.extend(data[row_start : row_open_end + 1])
            cursor = row_open_end + 1
            continue
        row_close = data.find(b"</row>", row_open_end, sheet_data_end)
        if row_close < 0:
            return data

        cutoff_start: int | None = None
        cutoff_match: re.Match[bytes] | None = None
        search_position = row_open_end + 1
        while search_position < row_close:
            cell_match = WORKSHEET_CELL_REFERENCE_BYTES_PATTERN.search(
                data, search_position, row_close
            )
            if cell_match is None:
                break
            column = _excel_column_index(cell_match.group(1).decode("ascii"))
            if column > max_column:
                cutoff_start = cell_match.start()
                cutoff_match = cell_match
                break
            search_position = cell_match.end()

        last_cell_start = data.rfind(b"<c ", row_open_end + 1, row_close)
        last_cell_match = (
            WORKSHEET_CELL_REFERENCE_BYTES_PATTERN.match(
                data, last_cell_start, row_close
            )
            if last_cell_start >= 0
            else None
        )
        last_cell_end = (
            cell_end(last_cell_match, row_close)
            if last_cell_match is not None
            else None
        )
        if last_cell_match is not None:
            actual_max_column = max(
                actual_max_column,
                _excel_column_index(last_cell_match.group(1).decode("ascii")),
            )
            actual_max_row = max(actual_max_row, int(last_cell_match.group(2)))

        if (
            cutoff_start is not None
            and cutoff_match is not None
            and last_cell_end is not None
        ):
            if kept_column_pattern.search(data, cutoff_match.end(), last_cell_end):
                row_bytes = data[row_start : row_close + len(b"</row>")]
            else:
                row_bytes = (
                    data[row_start:cutoff_start]
                    + data[last_cell_end : row_close + len(b"</row>")]
                )
                removed_cells = True
        else:
            row_bytes = data[row_start : row_close + len(b"</row>")]
        output.extend(row_bytes)
        cursor = row_close + len(b"</row>")

    output.extend(data[sheet_data_end:])
    filtered = bytes(output)
    if not removed_cells or actual_max_column <= max_column or actual_max_row <= 0:
        return filtered

    sentinel_reference = (
        f"{_excel_column_name(actual_max_column)}{actual_max_row}".encode("ascii")
    )
    sentinel = b'<c r="' + sentinel_reference + b'"/>'
    filtered_sheet_end = filtered.find(b"</sheetData>")
    row_pattern = re.compile(
        rb'<row\b[^>]*\br="'
        + str(actual_max_row).encode("ascii")
        + rb'"[^>]*>'
    )
    row_match = row_pattern.search(filtered, sheet_data_start, filtered_sheet_end)
    if row_match is None:
        return (
            filtered[:filtered_sheet_end]
            + b'<row r="'
            + str(actual_max_row).encode("ascii")
            + b'">'
            + sentinel
            + b"</row>"
            + filtered[filtered_sheet_end:]
        )
    if filtered[row_match.end() - 2 : row_match.end()] == b"/>":
        replacement = (
            filtered[row_match.start() : row_match.end() - 2]
            + b">"
            + sentinel
            + b"</row>"
        )
        return (
            filtered[: row_match.start()]
            + replacement
            + filtered[row_match.end() :]
        )

    row_close = filtered.find(b"</row>", row_match.end(), filtered_sheet_end)
    if row_close < 0:
        return data
    last_cell_start = filtered.rfind(b"<c ", row_match.end(), row_close)
    if last_cell_start >= 0:
        last_cell_match = WORKSHEET_CELL_REFERENCE_BYTES_PATTERN.match(
            filtered, last_cell_start, row_close
        )
        if last_cell_match is None:
            return data
        opening_end = last_cell_match.end()
        if filtered[opening_end - 2 : opening_end] == b"/>":
            insert_at = opening_end
        else:
            closing_start = filtered.find(b"</c>", opening_end, row_close)
            if closing_start < 0:
                return data
            insert_at = closing_start + len(b"</c>")
    else:
        insert_at = row_match.end()
    return filtered[:insert_at] + sentinel + filtered[insert_at:]


def _filter_row_xml_bytes(
    row: bytes, max_column: int, kept_column_pattern: re.Pattern[bytes]
) -> bytes:
    row_open_end = row.find(b">")
    if row_open_end < 0 or row[row_open_end - 1 : row_open_end] == b"/":
        return row
    row_close = row.rfind(b"</row>")
    if row_close < 0:
        return row

    cutoff_match: re.Match[bytes] | None = None
    search_position = row_open_end + 1
    while search_position < row_close:
        cell_match = WORKSHEET_CELL_REFERENCE_BYTES_PATTERN.search(
            row, search_position, row_close
        )
        if cell_match is None:
            return row
        if _excel_column_index(cell_match.group(1).decode("ascii")) > max_column:
            cutoff_match = cell_match
            break
        search_position = cell_match.end()
    if cutoff_match is None:
        return row

    last_cell_start = row.rfind(b"<c ", row_open_end + 1, row_close)
    if last_cell_start < 0:
        return row
    last_cell_match = WORKSHEET_CELL_REFERENCE_BYTES_PATTERN.match(
        row, last_cell_start, row_close
    )
    if last_cell_match is None:
        return row
    if kept_column_pattern.search(row, cutoff_match.end(), row_close):
        return row

    opening_end = last_cell_match.end()
    if row[opening_end - 2 : opening_end] == b"/>":
        last_cell_end = opening_end
    else:
        closing_start = row.find(b"</c>", opening_end, row_close)
        if closing_start < 0:
            return row
        last_cell_end = closing_start + len(b"</c>")
    return row[: cutoff_match.start()] + row[last_cell_end:]


def _filter_worksheet_xml_stream(source: Any, target: Any, max_column: int) -> None:
    """Stream worksheet XML row-by-row and drop sorted cells right of the limit."""

    kept_column_pattern = re.compile(
        rb'<c\b[^>]*\br="\$?(?:'
        + b"|".join(
            _excel_column_name(index).encode("ascii")
            for index in range(1, max_column + 1)
        )
        + rb')\$?\d+"'
    )
    marker = b"<row "
    closing = b"</row>"
    buffer = b""
    cursor = 0
    eof = False

    while True:
        row_start = buffer.find(marker, cursor)
        if row_start < 0:
            if eof:
                target.write(buffer[cursor:])
                return
            keep = len(marker) - 1
            safe_end = max(cursor, len(buffer) - keep)
            if safe_end > cursor:
                target.write(buffer[cursor:safe_end])
            buffer = buffer[safe_end:]
            cursor = 0
            chunk = source.read(1024 * 1024)
            if chunk:
                buffer += chunk
            else:
                eof = True
            continue

        target.write(buffer[cursor:row_start])
        row_open_end = buffer.find(b">", row_start)
        while row_open_end < 0:
            chunk = source.read(1024 * 1024)
            if not chunk:
                target.write(buffer[row_start:])
                return
            buffer += chunk
            row_open_end = buffer.find(b">", row_start)

        if buffer[row_open_end - 1 : row_open_end] == b"/":
            row_end = row_open_end + 1
        else:
            row_close = buffer.find(closing, row_open_end + 1)
            while row_close < 0:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    target.write(buffer[row_start:])
                    return
                buffer += chunk
                row_close = buffer.find(closing, row_open_end + 1)
            row_end = row_close + len(closing)

        target.write(
            _filter_row_xml_bytes(
                buffer[row_start:row_end], max_column, kept_column_pattern
            )
        )
        cursor = row_end
        if cursor >= 1024 * 1024:
            buffer = buffer[cursor:]
            cursor = 0


def _create_optimized_workbook_source(
    path: Path,
) -> tuple[Path, tempfile.TemporaryDirectory[str]] | None:
    """Create a temporary OOXML copy without irrelevant far-right cells."""

    try:
        with zipfile.ZipFile(path) as source_archive:
            optimized_names = {
                info.filename
                for info in source_archive.infolist()
                if info.filename.startswith("xl/worksheets/")
                and info.filename.endswith(".xml")
                and info.file_size >= MIN_WORKSHEET_XML_OPTIMIZE_BYTES
            }
            if not optimized_names:
                return None

            directory = tempfile.TemporaryDirectory(prefix="price-import-optimized-")
            optimized_path = Path(directory.name) / path.name
            try:
                with zipfile.ZipFile(
                    optimized_path,
                    "w",
                    compression=zipfile.ZIP_STORED,
                    allowZip64=True,
                ) as target_archive:
                    for info in source_archive.infolist():
                        target_info = copy.copy(info)
                        target_info.compress_type = zipfile.ZIP_STORED
                        with source_archive.open(info) as source_entry, target_archive.open(
                            target_info, "w", force_zip64=True
                        ) as target_entry:
                            if info.filename in optimized_names:
                                _filter_worksheet_xml_stream(
                                    source_entry, target_entry, MAX_COLUMNS
                                )
                            else:
                                shutil.copyfileobj(
                                    source_entry, target_entry, length=1024 * 1024
                                )
            except Exception as exc:
                directory.cleanup()
                raise PriceImporterError(
                    f"Cannot optimize oversized worksheet XML: {exc}"
                ) from exc
    except (OSError, zipfile.BadZipFile):
        return None
    return optimized_path, directory


def _deduplicate_compatible_rows(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows_by_sku: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = _normalize_sku_key(row["sku"])
        if key:
            rows_by_sku.setdefault(key, []).append(row)

    result: list[dict[str, Any]] = []
    emitted_keys: set[str] = set()
    for row in rows:
        key = _normalize_sku_key(row["sku"])
        if not key:
            result.append(row)
            continue
        if key in emitted_keys:
            continue
        emitted_keys.add(key)
        duplicates = rows_by_sku[key]
        if len(duplicates) == 1:
            result.append(row)
            continue

        merged = dict(duplicates[0])
        merged["errors"] = []
        conflicts = False
        for field in PRICE_FIELDS:
            values = list(
                dict.fromkeys(
                    duplicate[field]
                    for duplicate in duplicates
                    if duplicate[field] is not None
                )
            )
            if len(values) > 1:
                conflicts = True
            elif values:
                merged[field] = values[0]
        for duplicate in duplicates:
            for error in duplicate["errors"]:
                _append_error(merged["errors"], error)

        if conflicts:
            for duplicate in duplicates:
                _append_error(duplicate["errors"], "duplicate_sku")
            result.extend(duplicates)
        else:
            result.append(merged)
    return result


def import_price_workbook(input_path: Path) -> dict[str, Any]:
    suffix = input_path.suffix.casefold()
    if suffix not in {".xlsx", ".xlsm"}:
        raise PriceImporterError("Only .xlsx and .xlsm workbooks are supported.")
    if not input_path.is_file():
        raise PriceImporterError(f"Input workbook does not exist: {input_path}")

    optimized_source = _create_optimized_workbook_source(input_path)
    workbook_path = optimized_source[0] if optimized_source is not None else input_path
    try:
        workbook = load_workbook(
            workbook_path,
            read_only=True,
            data_only=True,
            keep_vba=suffix == ".xlsm",
        )
    except Exception as exc:
        if optimized_source is not None:
            optimized_source[1].cleanup()
        raise PriceImporterError(f"Cannot open workbook: {exc}") from exc

    result: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sheets": [],
        "rows": [],
        "errors": [],
    }

    try:
        worksheets = list(workbook.worksheets)
        if len(worksheets) > MAX_SHEETS:
            result["errors"].append(f"sheet_limit_exceeded:{len(worksheets)}>{MAX_SHEETS}")
            for worksheet in worksheets:
                sheet_result = _empty_sheet_result(worksheet.title)
                sheet_result["errors"].append("not_processed:sheet_limit_exceeded")
                result["sheets"].append(sheet_result)
            return result

        total_data_rows = 0
        row_limit_reached = False
        for worksheet in worksheets:
            sheet_result = _empty_sheet_result(worksheet.title)
            result["sheets"].append(sheet_result)

            if row_limit_reached:
                sheet_result["errors"].append("not_processed:row_limit_exceeded")
                continue

            worksheet_max_column = int(worksheet.max_column or 0)
            if worksheet_max_column > MAX_COLUMNS:
                sheet_result["errors"].append(
                    f"column_limit_exceeded:{worksheet_max_column}>{MAX_COLUMNS}"
                )

            header = _find_header(worksheet)
            if header is None:
                sheet_result["errors"].append("unrecognized_sheet:no_supported_header")
                continue

            header_row, columns, header_errors = header
            sheet_result.update(
                {
                    "recognized": True,
                    "headerRow": header_row,
                    "columns": columns,
                    "errors": [*sheet_result["errors"], *header_errors],
                }
            )

            max_row = int(worksheet.max_row or 0)
            mapped_max_column = max(columns.values())
            for row_number, row in enumerate(
                worksheet.iter_rows(
                    min_row=header_row + 1,
                    max_row=max_row,
                    max_col=mapped_max_column,
                ),
                start=header_row + 1,
            ):
                if not _row_is_product_candidate(row, columns):
                    continue
                parsed_row = _parse_row(
                    worksheet.title,
                    row_number,
                    row,
                    columns,
                    header_errors,
                )
                if (
                    not parsed_row["errors"]
                    and all(parsed_row[field] is None for field in PRICE_FIELDS)
                ):
                    continue
                total_data_rows += 1
                if total_data_rows > MAX_DATA_ROWS:
                    error = f"row_limit_exceeded:{total_data_rows}>{MAX_DATA_ROWS}"
                    _append_error(result["errors"], error)
                    _append_error(sheet_result["errors"], error)
                    row_limit_reached = True
                    break
                result["rows"].append(parsed_row)
                sheet_result["dataRowCount"] += 1

        result["rows"] = _deduplicate_compatible_rows(result["rows"])
    finally:
        workbook.close()
        if optimized_source is not None:
            optimized_source[1].cleanup()

    return result


def _decode_one_c_text(value: str) -> str:
    # In MXL a literal quote inside a text cell is doubled (``""``), unlike
    # the JSON escaping used by the remainder of this parser.
    escaped_quotes = value.replace('""', r'\"')
    safe = re.sub(r"[\x00-\x1f]", lambda match: f"\\u{ord(match.group()):04x}", escaped_quotes)
    return json.loads(f'"{safe}"')


def _has_one_c_code_column(text: str) -> bool:
    first_data_cell = text.find("{16,2,")
    header = text if first_data_cell < 0 else text[:first_data_cell]
    return ONE_C_CODE_HEADER_PATTERN.search(header) is not None


def import_one_c_mxl(input_path: Path, price_tier: str | None) -> dict[str, Any]:
    if input_path.suffix.casefold() != ".mxl" or not input_path.is_file():
        raise PriceImporterError("Only .mxl 1C exports are supported.")
    price_field = ONE_C_PRICE_FIELD.get(price_tier or "")
    if price_field is None:
        raise PriceImporterError("Choose a 1C price type: RETAIL, WHOLESALE, BULK_WHOLESALE or SKO.")
    data = input_path.read_bytes()
    if not data.startswith(b"MOXCEL"):
        raise PriceImporterError("The file is not a valid 1C MXL export.")
    bom = data.find(b"\xef\xbb\xbf")
    if bom < 0:
        raise PriceImporterError("The 1C MXL export has no UTF-8 text section.")
    try:
        text = data[bom + 3 :].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PriceImporterError("Cannot decode the 1C MXL export.") from exc

    has_code_column = _has_one_c_code_column(text)
    names = list(ONE_C_TWO_COLUMN_NAME_PATTERN.finditer(text)) if not has_code_column else []
    row_starts = list(ONE_C_CODE_PATTERN.finditer(text)) if has_code_column else names
    name_pattern = ONE_C_THREE_COLUMN_NAME_PATTERN if has_code_column else ONE_C_TWO_COLUMN_NAME_PATTERN
    price_pattern = ONE_C_THREE_COLUMN_PRICE_PATTERN if has_code_column else ONE_C_TWO_COLUMN_PRICE_PATTERN
    rows: list[dict[str, Any]] = []
    for row_offset, row_start in enumerate(row_starts):
        source_row = row_offset + 2
        section_end = (
            row_starts[row_offset + 1].start() if row_offset + 1 < len(row_starts) else len(text)
        )
        name_match = (
            name_pattern.search(text, row_start.end(), section_end) if has_code_column else row_start
        )
        if name_match is None:
            continue
        price_match = price_pattern.search(text, name_match.end(), section_end)
        try:
            name = _decode_one_c_text(name_match.group("value"))
            raw_price = _decode_one_c_text(price_match.group("value")) if price_match else None
            raw_sku = _decode_one_c_text(row_start.group("value")) if has_code_column else None
        except (ValueError, json.JSONDecodeError):
            continue
        article = ONE_C_ARTICLE_PATTERN.search(name) if raw_sku is None else None
        sku = _normalize_text(raw_sku) if raw_sku is not None else (article.group(1) if article else None)
        if not sku:
            continue
        errors: list[str] = []
        missing_retail_price = price_field == "price" and raw_price is None
        price = None if raw_price is None else _parse_price(raw_price, price_field, errors)
        if errors or (price is None and not missing_retail_price):
            continue
        row = {
            "sourceSheet": "1С MXL",
            "sourceRow": source_row,
            "sku": _bounded_text(sku, "sku", errors),
            "name": _bounded_text(name, "name", errors),
            "price": None,
            "wholesalePrice": None,
            "bulkWholesalePrice": None,
            "skoPrice": None,
            "incomingPrice": None,
            "errors": errors,
        }
        row[price_field] = price
        if missing_retail_price:
            row["missingRetailPrice"] = True
        rows.append(row)
    rows = _deduplicate_compatible_rows(rows)
    if not rows:
        raise PriceImporterError("No products with an article and name were found in the 1C export.")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sheets": [{"name": "1С MXL", "recognized": True, "headerRow": 1, "columns": {"sku": 1, "name": 2, price_field: 3} if has_code_column else {"name": 1, price_field: 2}, "dataRowCount": len(rows), "errors": []}],
        "rows": rows,
        "errors": [],
    }


def write_result(output_path: Path, result: dict[str, Any]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            dir=output_path.parent,
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(result, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Analyze an Excel or 1C MXL price list and emit JSON.")
    parser.add_argument("input", type=Path, help="Input .xlsx or .xlsm workbook.")
    parser.add_argument("output", type=Path, help="Output JSON path.")
    parser.add_argument("--one-c-price-tier", choices=tuple(ONE_C_PRICE_FIELD))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = (
            import_one_c_mxl(args.input, args.one_c_price_tier)
            if args.input.suffix.casefold() == ".mxl"
            else import_price_workbook(args.input)
        )
        write_result(args.output, result)
    except (OSError, PriceImporterError) as exc:
        print(f"price-importer: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
