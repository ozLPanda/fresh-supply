"""Verify a disposable staged Windows payload before replacing an installation."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sys


def current_sid():
    from ctypes import wintypes
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    token = wintypes.HANDLE()
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise RuntimeError("Cannot verify installation owner")
    try:
        size = wintypes.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        data = ctypes.create_string_buffer(size.value)
        if not advapi.GetTokenInformation(token, 1, data, size, ctypes.byref(size)):
            raise RuntimeError("Cannot read installation owner")
        pointer = ctypes.cast(data, ctypes.POINTER(ctypes.c_void_p))[0]
        result = wintypes.LPWSTR()
        if not advapi.ConvertSidToStringSidW(pointer, ctypes.byref(result)):
            raise RuntimeError("Cannot read installation owner SID")
        try:
            return result.value
        finally:
            kernel.LocalFree(ctypes.cast(result, ctypes.c_void_p))
    finally:
        kernel.CloseHandle(token)


def verify(root, version, sid=""):
    root = Path(root).resolve(strict=True)
    if sid and (os.name != "nt" or current_sid() != sid):
        raise RuntimeError("The per-user installation belongs to a different Windows user")
    metadata = json.loads((root / "resources/package-integrity.json").read_text("utf-8"))
    if (metadata.get("schemaVersion"), metadata.get("platform"), metadata.get("arch"), metadata.get("version")) != (1, "win32", "x64", version):
        raise RuntimeError("Wrong installation version or architecture")
    seen = set()
    for item in metadata["files"]:
        relative = item["path"]
        if not relative or "\\" in relative or ":" in relative or relative.startswith("/") or any(p in ("", ".", "..") for p in relative.split("/")):
            raise RuntimeError("Invalid package file path")
        if relative.lower() in seen:
            raise RuntimeError("Duplicate package file path")
        seen.add(relative.lower())
        file = root / relative
        if file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(root):
            raise RuntimeError("Missing installed file: " + relative)
        if file.stat().st_size != item["size"]:
            raise RuntimeError("Incomplete installed file: " + relative)
        with file.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if digest != item["sha256"]:
            raise RuntimeError("Damaged installed file: " + relative)
    runtime = json.loads((root / "resources/runtime/manifest.json").read_text("utf-8"))
    critical = ["fresh-supply.exe", "resources/app.asar", "resources/runtime/manifest.json",
                *["resources/runtime/" + p for p in [runtime["python"], runtime["java"], runtime["backend"], runtime["importer"], *runtime["postgres"].values(), "postgres/bin/postgres.exe", "python/python311.dll", "frontend/index.html", "model/model.safetensors", "model/config.json", "model/modules.json", "import-reference.json"]]]
    if not all(p.lower() in seen for p in critical):
        raise RuntimeError("Missing critical package files")
    return len(seen)


if __name__ == "__main__":
    try:
        count = verify(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
        print("Verified complete Windows application:", count, "files")
    except Exception as error:
        print(str(error))
        sys.exit(1)
