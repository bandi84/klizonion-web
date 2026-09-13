from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import torch

try:
    from .config import DEFAULT_CONFIG, ModelConfig
    from .dataset import TextDataset, load_dataset, read_text_file
    from .model import count_parameters, create_model
    from .tokenizer import KlizonionTokenizer
except ImportError:
    from config import DEFAULT_CONFIG, ModelConfig
    from dataset import TextDataset, load_dataset, read_text_file
    from model import count_parameters, create_model
    from tokenizer import KlizonionTokenizer


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
CHECKPOINT_DIR = ROOT / "checkpoints"
DEFAULT_DATA = DATA_DIR / "benchmark.txt"
DEFAULT_SPLIT = 0.98
DEFAULT_TOKENIZER = DATA_DIR / "tokenizer.json"
DEFAULT_CHECKPOINT = CHECKPOINT_DIR / "latest.pt"
EVAL_SUMMARY_FILE = CHECKPOINT_DIR / "eval_summary.json"

# exp() overflows for large losses; a loss this high already means the
# model is far worse than useful, so perplexity is reported as "inf".
MAX_REPORTABLE_LOSS = 20.0


def choose_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def config_from_checkpoint(checkpoint: dict) -> ModelConfig:
    saved = checkpoint.get("config")

    if not saved:
        return DEFAULT_CONFIG

    return ModelConfig(**saved)


def verify_architecture() -> None:
    """
    Cheap structural check: a random-input forward pass confirms the
    model builds and produces correctly shaped logits. Requires no
    checkpoint or dataset, so it doubles as a fast install sanity check.
    """
    config = DEFAULT_CONFIG
    model = create_model(config)

    parameters = count_parameters(model)

    batch_size = 1
    seq_len = 32

    input_ids = torch.randint(
        0,
        config.vocab_size,
        (batch_size, seq_len),
        dtype=torch.long,
    )

    with torch.no_grad():
        logits, loss = model(input_ids)

    expected_shape = (batch_size, seq_len, config.vocab_size)

    assert logits.shape == expected_shape, (
        f"Unexpected logits shape: {logits.shape}, "
        f"expected {expected_shape}"
    )

    assert loss is None

    print("KLIZONION architecture check")
    print("=" * 32)
    print(f"Vocabulary:   {config.vocab_size:,}")
    print(f"Context:      {config.max_seq_len}")
    print(f"Dimensions:   {config.d_model}")
    print(f"Layers:       {config.n_layers}")
    print(f"Heads:        {config.n_heads}")
    print(f"Parameters:   {parameters:,}")
    print(f"Logits shape: {tuple(logits.shape)}")
    print("Architecture check: PASS")


@torch.no_grad()
def evaluate_checkpoint(
    *,
    checkpoint_path: Path,
    data_path: Path,
    tokenizer_path: Path,
    batch_size: int,
    sequence_length: int,
    max_batches: int | None,
    split: float,
    eval_whole_file: bool,
) -> dict:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    if not tokenizer_path.exists():
        raise FileNotFoundError(f"Tokenizer not found: {tokenizer_path}")

    device = choose_device()

    checkpoint = torch.load(checkpoint_path, map_location=device)
    config = config_from_checkpoint(checkpoint)

    sequence_length = min(sequence_length, config.max_seq_len)

    model = create_model(config).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    tokenizer = KlizonionTokenizer.load(tokenizer_path)

    if eval_whole_file:
        # --data is already a held-out file (e.g. data/processed/validation.txt);
        # evaluate every window in it rather than re-splitting.
        text = read_text_file(data_path)
        token_ids = tokenizer.encode(text, add_bos=True, add_eos=True)
        tokens = torch.tensor(token_ids, dtype=torch.long)
        dataset = TextDataset(tokens, sequence_length)
    else:
        # --data is the same corpus passed to train.py; reuse its exact
        # split so evaluation only ever sees text the model did not train on.
        _, dataset = load_dataset(
            data_path,
            tokenizer,
            sequence_length,
            split=split,
        )

    total_loss = 0.0
    total_windows = 0

    for batch_index, (x, y) in enumerate(
        dataset.iter_batches(batch_size, device)
    ):
        if max_batches is not None and batch_index >= max_batches:
            break

        _, loss = model(x, y)

        if loss is None:
            raise RuntimeError("Model returned no evaluation loss")

        total_loss += float(loss.detach().cpu()) * x.shape[0]
        total_windows += x.shape[0]

    if total_windows == 0:
        raise RuntimeError("No evaluation windows were produced")

    average_loss = total_loss / total_windows
    perplexity = (
        math.exp(average_loss)
        if average_loss <= MAX_REPORTABLE_LOSS
        else math.inf
    )

    return {
        "device": str(device),
        "checkpoint": str(checkpoint_path),
        "checkpoint_step": int(checkpoint.get("step", 0)),
        "parameters": count_parameters(model),
        "data": str(data_path),
        "sequence_length": sequence_length,
        "batch_size": batch_size,
        "windows_evaluated": total_windows,
        "tokens_evaluated": total_windows * sequence_length,
        "average_loss": average_loss,
        "perplexity": perplexity,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="KLIZONION model evaluation"
    )

    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=DEFAULT_CHECKPOINT,
    )

    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATA,
        help="The same corpus passed to train.py, unless --eval-whole-file is set.",
    )

    parser.add_argument(
        "--split",
        type=float,
        default=DEFAULT_SPLIT,
        help="Train/val split fraction applied to --data, matching train.py's default. Ignored with --eval-whole-file.",
    )

    parser.add_argument(
        "--eval-whole-file",
        action="store_true",
        help="Treat --data as an already held-out validation file (e.g. data/processed/validation.txt) instead of re-splitting it.",
    )

    parser.add_argument(
        "--tokenizer",
        type=Path,
        default=DEFAULT_TOKENIZER,
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
    )

    parser.add_argument(
        "--seq-len",
        type=int,
        default=32,
    )

    parser.add_argument(
        "--max-batches",
        type=int,
        default=None,
        help="Limit evaluation to this many batches. Default evaluates the full file.",
    )

    parser.add_argument(
        "--architecture-only",
        action="store_true",
        help="Skip the checkpoint/dataset and only verify model architecture shapes.",
    )

    args = parser.parse_args()

    if args.batch_size < 1:
        raise ValueError("--batch-size must be >= 1")

    if args.seq_len < 2:
        raise ValueError("--seq-len must be >= 2")

    if args.architecture_only:
        verify_architecture()
        return

    if not args.checkpoint.exists():
        raise SystemExit(
            f"No checkpoint found at {args.checkpoint}.\n"
            "Run training first (services/model/train.py), or pass "
            "--architecture-only to verify the model shape without one."
        )

    if not args.data.exists():
        raise SystemExit(
            f"No evaluation data found at {args.data}.\n"
            "Run services/model/prepare_data.py first, or pass --data "
            "to point at an existing text file."
        )

    result = evaluate_checkpoint(
        checkpoint_path=args.checkpoint,
        data_path=args.data,
        tokenizer_path=args.tokenizer,
        batch_size=args.batch_size,
        sequence_length=args.seq_len,
        max_batches=args.max_batches,
        split=args.split,
        eval_whole_file=args.eval_whole_file,
    )

    print("KLIZONION checkpoint evaluation")
    print("=" * 34)
    print(f"Device:            {result['device']}")
    print(f"Checkpoint:        {result['checkpoint']}")
    print(f"Checkpoint step:   {result['checkpoint_step']}")
    print(f"Parameters:        {result['parameters']:,}")
    print(f"Data:              {result['data']}")
    print(f"Sequence length:   {result['sequence_length']}")
    print(f"Batch size:        {result['batch_size']}")
    print(f"Windows evaluated: {result['windows_evaluated']:,}")
    print(f"Tokens evaluated:  {result['tokens_evaluated']:,}")
    print(f"Average loss:      {result['average_loss']:.4f}")
    print(f"Perplexity:        {result['perplexity']:.4f}")

    EVAL_SUMMARY_FILE.parent.mkdir(parents=True, exist_ok=True)
    EVAL_SUMMARY_FILE.write_text(
        json.dumps(result, indent=2),
        encoding="utf-8",
    )

    print()
    print(f"Summary written to {EVAL_SUMMARY_FILE}")


if __name__ == "__main__":
    main()
