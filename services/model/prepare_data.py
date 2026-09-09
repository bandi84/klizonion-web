from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable

try:
    from .tokenizer import KlizonionTokenizer, clean_text
except ImportError:
    from tokenizer import KlizonionTokenizer, clean_text


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW = ROOT / "data" / "raw"
DEFAULT_PROCESSED = ROOT / "data" / "processed"
DEFAULT_TOKENIZER = ROOT / "data" / "tokenizer.json"


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")
    text = text.replace("\x00", " ")

    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(
        text.encode("utf-8")
    ).hexdigest()


def read_corpus_files(raw_dir: Path) -> list[tuple[Path, str]]:
    raw_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(
        path
        for path in raw_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".txt", ".md"}
    )

    documents: list[tuple[Path, str]] = []

    for path in files:
        try:
            text = path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            print(f"[skip] {path}: {exc}")
            continue

        text = normalize_text(text)

        if text:
            documents.append((path, text))

    return documents


def deduplicate_documents(
    documents: list[tuple[Path, str]],
) -> list[tuple[Path, str]]:
    seen: set[str] = set()
    unique: list[tuple[Path, str]] = []

    for path, text in documents:
        digest = sha256_text(text)

        if digest in seen:
            print(f"[dedupe] {path}")
            continue

        seen.add(digest)
        unique.append((path, text))

    return unique


def build_corpus(
    documents: Iterable[tuple[Path, str]],
) -> str:
    return "\n\n".join(
        text
        for _, text in documents
    ).strip()


def split_text(
    text: str,
    validation_fraction: float,
) -> tuple[str, str]:
    if not 0.0 < validation_fraction < 0.5:
        raise ValueError(
            "validation_fraction must be between 0 and 0.5"
        )

    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n{2,}", text)
        if paragraph.strip()
    ]

    if len(paragraphs) < 2:
        cut = int(len(text) * (1.0 - validation_fraction))
        cut = max(1, min(cut, len(text) - 1))
        return text[:cut], text[cut:]

    cut_index = max(
        1,
        int(len(paragraphs) * (1.0 - validation_fraction)),
    )

    train_text = "\n\n".join(paragraphs[:cut_index])
    validation_text = "\n\n".join(paragraphs[cut_index:])

    return train_text, validation_text


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    path.write_text(
        text.strip() + "\n",
        encoding="utf-8",
    )


def train_tokenizer_fast(
    full_text: str,
    tokenizer_path: Path,
    *,
    sample_chars: int,
    max_merges: int,
) -> KlizonionTokenizer:
    """
    Train BPE merges using only a bounded sample of the corpus.

    This avoids repeatedly scanning millions of characters during the
    first tokenizer build. The resulting tokenizer can still encode
    the complete training corpus.
    """

    if sample_chars < 1:
        raise ValueError("sample_chars must be >= 1")

    if max_merges < 0:
        raise ValueError("max_merges must be >= 0")

    sample = full_text[:sample_chars]

    tokenizer = KlizonionTokenizer()

    tokenizer.train(
        [sample],
        vocab_size=KlizonionTokenizer.VOCAB_SIZE,
        min_frequency=2,
        max_merges=max_merges,
    )

    tokenizer.save(tokenizer_path)

    return tokenizer


def write_manifest(
    path: Path,
    *,
    source_files: list[dict[str, object]],
    train_text: str,
    validation_text: str,
    tokenizer: KlizonionTokenizer,
    tokenizer_sample_chars: int,
    tokenizer_max_merges: int,
) -> None:
    manifest = {
        "format": "klizonion-text-dataset-v2",
        "tokenizer_type": "byte_bpe",
        "vocab_size": tokenizer.vocab_size,
        "merges": len(tokenizer.merges),
        "tokenizer_training": {
            "sample_chars": tokenizer_sample_chars,
            "max_merges": tokenizer_max_merges,
        },
        "sources": source_files,
        "characters": {
            "train": len(train_text),
            "validation": len(validation_text),
            "total": len(train_text) + len(validation_text),
        },
        "notes": [
            "Tokenizer merges were learned from a bounded sample for speed.",
            "The full corpus is still used for training/validation output.",
            "Verify dataset licensing before serious training.",
        ],
    }

    path.parent.mkdir(parents=True, exist_ok=True)

    path.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fast KLIZONION dataset preparation."
    )

    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=DEFAULT_RAW,
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_PROCESSED,
    )

    parser.add_argument(
        "--tokenizer",
        type=Path,
        default=DEFAULT_TOKENIZER,
    )

    parser.add_argument(
        "--validation-fraction",
        type=float,
        default=0.02,
    )

    parser.add_argument(
        "--tokenizer-sample-chars",
        type=int,
        default=100_000,
        help="Only this many characters are used to learn BPE merges.",
    )

    parser.add_argument(
        "--max-merges",
        type=int,
        default=500,
        help="Maximum number of BPE merges for the fast first tokenizer.",
    )

    args = parser.parse_args()

    documents = read_corpus_files(args.raw_dir)

    if not documents:
        raise SystemExit(
            f"No .txt or .md files found in {args.raw_dir}"
        )

    documents = deduplicate_documents(documents)

    if not documents:
        raise SystemExit("No unique documents remain")

    full_text = build_corpus(documents)
    full_text = clean_text(full_text)

    if not full_text:
        raise SystemExit("Combined corpus is empty")

    train_text, validation_text = split_text(
        full_text,
        args.validation_fraction,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)

    train_path = args.output_dir / "train.txt"
    validation_path = args.output_dir / "validation.txt"
    manifest_path = args.output_dir / "manifest.json"

    save_text(train_path, train_text)
    save_text(validation_path, validation_text)

    actual_sample_chars = min(
        args.tokenizer_sample_chars,
        len(full_text),
    )

    print("Training fast tokenizer...")
    print(
        f"Tokenizer sample: {actual_sample_chars:,} chars"
    )
    print(
        f"Maximum merges:   {args.max_merges:,}"
    )

    tokenizer = train_tokenizer_fast(
        full_text,
        args.tokenizer,
        sample_chars=actual_sample_chars,
        max_merges=args.max_merges,
    )

    source_metadata = [
        {
            "path": str(path),
            "characters": len(text),
            "sha256": sha256_text(text),
        }
        for path, text in documents
    ]

    write_manifest(
        manifest_path,
        source_files=source_metadata,
        train_text=train_text,
        validation_text=validation_text,
        tokenizer=tokenizer,
        tokenizer_sample_chars=actual_sample_chars,
        tokenizer_max_merges=args.max_merges,
    )

    print()
    print("KLIZONION fast dataset preparation")
    print("=" * 42)
    print(f"Documents:        {len(documents):,}")
    print(f"Total characters: {len(full_text):,}")
    print(f"Train characters: {len(train_text):,}")
    print(f"Val characters:   {len(validation_text):,}")
    print(f"Tokenizer merges: {len(tokenizer.merges):,}")
    print()
    print(f"Train file:       {train_path}")
    print(f"Validation file:  {validation_path}")
    print(f"Tokenizer:        {args.tokenizer}")
    print(f"Manifest:         {manifest_path}")
    print()
    print("Dataset preparation: PASS")


if __name__ == "__main__":
    main()