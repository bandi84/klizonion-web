from __future__ import annotations

import random
from pathlib import Path
from typing import Iterator, Sequence

import torch

try:
    from .tokenizer import KlizonionTokenizer, clean_text
except ImportError:
    from tokenizer import KlizonionTokenizer, clean_text


class TextDataset:
    """
    Loads a UTF-8 text corpus, tokenizes it, and provides contiguous
    next-token prediction samples for a decoder-only transformer.
    """

    def __init__(
        self,
        tokens: torch.Tensor,
        sequence_length: int,
    ) -> None:
        if tokens.dtype != torch.long:
            raise TypeError("tokens must use torch.long")

        if tokens.ndim != 1:
            raise ValueError("tokens must be a 1D tensor")

        if sequence_length < 2:
            raise ValueError("sequence_length must be >= 2")

        if tokens.numel() <= sequence_length:
            raise ValueError(
                f"Need more than {sequence_length} tokens, "
                f"got {tokens.numel()}"
            )

        self.tokens = tokens.contiguous()
        self.sequence_length = sequence_length

    def __len__(self) -> int:
        return self.tokens.numel() - self.sequence_length

    def sample(
        self,
        batch_size: int,
        device: torch.device | str,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        if batch_size < 1:
            raise ValueError("batch_size must be >= 1")

        max_start = self.tokens.numel() - self.sequence_length - 1

        starts = torch.randint(
            0,
            max_start + 1,
            (batch_size,),
        )

        x = torch.stack(
            [
                self.tokens[
                    start : start + self.sequence_length
                ]
                for start in starts.tolist()
            ]
        )

        y = torch.stack(
            [
                self.tokens[
                    start + 1 : start + self.sequence_length + 1
                ]
                for start in starts.tolist()
            ]
        )

        return x.to(device), y.to(device)


def read_text_file(path: str | Path) -> str:
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found: {path}")

    if not path.is_file():
        raise ValueError(f"Dataset path is not a file: {path}")

    text = path.read_text(
        encoding="utf-8",
        errors="replace",
    )

    text = clean_text(text)

    if not text:
        raise ValueError(f"Dataset is empty: {path}")

    return text


def load_dataset(
    dataset_path: str | Path,
    tokenizer: KlizonionTokenizer,
    sequence_length: int,
    *,
    split: float = 0.98,
) -> tuple[TextDataset, TextDataset]:
    if not 0.5 < split < 1.0:
        raise ValueError("split must be between 0.5 and 1.0")

    text = read_text_file(dataset_path)

    token_ids = tokenizer.encode(
        text,
        add_bos=True,
        add_eos=True,
    )

    tokens = torch.tensor(
        token_ids,
        dtype=torch.long,
    )

    minimum_tokens = (sequence_length + 1) * 2

    if tokens.numel() < minimum_tokens:
        raise ValueError(
            f"Dataset is too small. Need at least "
            f"{minimum_tokens} tokens, got {tokens.numel()}"
        )

    split_index = int(tokens.numel() * split)
    split_index = max(
        sequence_length + 1,
        min(split_index, tokens.numel() - sequence_length - 1),
    )

    train_tokens = tokens[:split_index]
    val_tokens = tokens[split_index:]

    train_dataset = TextDataset(
        train_tokens,
        sequence_length,
    )

    val_dataset = TextDataset(
        val_tokens,
        sequence_length,
    )

    return train_dataset, val_dataset


def discover_text_files(
    root: str | Path,
) -> list[Path]:
    root = Path(root)

    if not root.exists():
        raise FileNotFoundError(f"Dataset directory not found: {root}")

    files = sorted(
        path
        for path in root.rglob("*.txt")
        if path.is_file()
    )

    return files


def combine_text_files(
    files: Sequence[str | Path],
    output_path: str | Path,
) -> Path:
    if not files:
        raise ValueError("No text files supplied")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    parts: list[str] = []

    for file in files:
        path = Path(file)

        if not path.exists():
            raise FileNotFoundError(path)

        text = read_text_file(path)

        if text:
            parts.append(text)

    combined = "\n\n".join(parts).strip()

    if not combined:
        raise ValueError("Combined dataset is empty")

    output_path.write_text(
        combined + "\n",
        encoding="utf-8",
    )

    return output_path


def make_repeated_smoke_dataset(
    output_path: str | Path,
    repetitions: int = 100,
) -> Path:
    """
    Creates a deterministic larger corpus for pipeline benchmarking.
    This is only a smoke-test corpus, not a production training dataset.
    """

    if repetitions < 1:
        raise ValueError("repetitions must be >= 1")

    text = """
KLIZONION is an experimental language model project.
KLIZONION Builder is an engineering system for creating software.
A transformer predicts the next token from previous tokens.
Causal attention prevents the model from reading future tokens.
Training measures loss and updates the model parameters.
Checkpoints allow training to resume after interruption.
Evaluation measures whether the model is improving.
Good engineering uses tests, measurements, and reproducible experiments.
The self trainer can eventually compare different configurations.
A language model becomes useful by learning from large amounts of text.
""".strip()

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    combined = "\n\n".join(
        f"{text}\nExperiment copy {index + 1}."
        for index in range(repetitions)
    )

    output_path.write_text(
        combined + "\n",
        encoding="utf-8",
    )

    return output_path


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    data_dir = root / "data"
    smoke_path = data_dir / "benchmark.txt"
    tokenizer_path = data_dir / "tokenizer.json"

    tokenizer = KlizonionTokenizer()

    make_repeated_smoke_dataset(
        smoke_path,
        repetitions=100,
    )

    train_dataset, val_dataset = load_dataset(
        smoke_path,
        tokenizer,
        sequence_length=32,
    )

    print("KLIZONION dataset loader smoke test")
    print("=" * 40)
    print(f"Dataset:       {smoke_path}")
    print(f"Train tokens:  {train_dataset.tokens.numel():,}")
    print(f"Val tokens:    {val_dataset.tokens.numel():,}")
    print(f"Sequence:      {train_dataset.sequence_length}")

    x, y = train_dataset.sample(
        batch_size=2,
        device="cpu",
    )

    print(f"Input shape:   {tuple(x.shape)}")
    print(f"Target shape:  {tuple(y.shape)}")

    assert x.shape == y.shape
    assert x.shape == (2, 32)

    tokenizer.save(tokenizer_path)

    print("Dataset loader smoke test: PASS")