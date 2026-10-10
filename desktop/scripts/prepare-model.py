"""Build-only download. Runtime always uses the included directory offline."""
import hashlib
import json
import pathlib
import sys
from huggingface_hub import snapshot_download

sources = json.loads(pathlib.Path(__file__).with_name("runtime-sources.json").read_text())
snapshot_download(
    repo_id=sources["model"]["repository"],
    revision=sources["model"]["revision"],
    local_dir=sys.argv[1],
    allow_patterns=["*.json", "model.safetensors", "sentencepiece.bpe.model", "1_Pooling/*", "README.md"],
)

model = pathlib.Path(sys.argv[1]) / "model.safetensors"
with model.open("rb") as stream:
    actual = hashlib.file_digest(stream, "sha256").hexdigest()
if actual != sources["model"]["sha256"]:
    raise RuntimeError("Pinned model SHA256 mismatch")
