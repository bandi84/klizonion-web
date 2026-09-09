from __future__ import annotations

import argparse
import os
import platform
import time
from pathlib import Path

import torch

try:
    from .config import DEFAULT_CONFIG
    from .dataset import make_repeated_smoke_dataset, load_dataset
    from .model import count_parameters, create_model
    from .tokenizer import KlizonionTokenizer
except ImportError:
    from config import DEFAULT_CONFIG
    from dataset import make_repeated_smoke_dataset, load_dataset
    from model import count_parameters, create_model
    from tokenizer import KlizonionTokenizer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark KLIZONION CPU training throughput."
    )

    parser.add_argument(
        "--seconds",
        type=int,
        default=60,
        help="Benchmark duration in seconds.",
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
    )

    parser.add_argument(
        "--seq-len",
        type=int,
        default=32,
    )

    parser.add_argument(
        "--threads",
        type=int,
        default=0,
        help="PyTorch CPU threads. 0 keeps the default.",
    )

    parser.add_argument(
        "--data",
        type=Path,
        default=None,
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.seconds < 5:
        raise ValueError("--seconds must be at least 5")

    if args.batch_size < 1:
        raise ValueError("--batch-size must be >= 1")

    if args.seq_len < 2:
        raise ValueError("--seq-len must be >= 2")

    if args.threads > 0:
        torch.set_num_threads(args.threads)

    if not torch.cuda.is_available():
        device = torch.device("cpu")
    else:
        device = torch.device("cuda")

    root = Path(__file__).resolve().parents[2]
    data_dir = root / "data"

    dataset_path = args.data or (data_dir / "benchmark.txt")

    if not dataset_path.exists():
        make_repeated_smoke_dataset(
            dataset_path,
            repetitions=1000,
        )

    tokenizer = KlizonionTokenizer()

    train_dataset, _ = load_dataset(
        dataset_path,
        tokenizer,
        sequence_length=args.seq_len,
    )

    model = create_model(DEFAULT_CONFIG).to(device)
    model.train()

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=3e-4,
        betas=(0.9, 0.95),
        weight_decay=0.1,
    )

    parameters = count_parameters(model)

    print("KLIZONION training benchmark")
    print("=" * 42)
    print(f"OS:             {platform.platform()}")
    print(f"CPU cores:      {os.cpu_count()}")
    print(f"PyTorch:        {torch.__version__}")
    print(f"Device:         {device}")
    print(f"Threads:        {torch.get_num_threads()}")
    print(f"Parameters:     {parameters:,}")
    print(f"Parameters M:   {parameters / 1_000_000:.2f}M")
    print(f"Batch size:     {args.batch_size}")
    print(f"Sequence len:   {args.seq_len}")
    print(f"Duration:       {args.seconds}s")
    print()

    # Warm-up.
    for _ in range(2):
        x, y = train_dataset.sample(
            args.batch_size,
            device,
        )

        optimizer.zero_grad(set_to_none=True)

        _, loss = model(x, y)

        if loss is None:
            raise RuntimeError("Model returned no loss")

        loss.backward()
        optimizer.step()

    if device.type == "cuda":
        torch.cuda.synchronize()

    total_tokens = 0
    steps = 0
    last_loss = None

    start = time.perf_counter()

    while True:
        x, y = train_dataset.sample(
            args.batch_size,
            device,
        )

        optimizer.zero_grad(set_to_none=True)

        _, loss = model(x, y)

        if loss is None:
            raise RuntimeError("Model returned no loss")

        loss.backward()

        torch.nn.utils.clip_grad_norm_(
            model.parameters(),
            max_norm=1.0,
        )

        optimizer.step()

        if device.type == "cuda":
            torch.cuda.synchronize()

        steps += 1
        total_tokens += x.numel()
        last_loss = float(loss.detach().cpu())

        elapsed = time.perf_counter() - start

        if elapsed >= args.seconds:
            break

    elapsed = max(
        time.perf_counter() - start,
        1e-9,
    )

    tokens_per_second = total_tokens / elapsed
    tokens_per_hour = tokens_per_second * 3600
    tokens_per_12h = tokens_per_second * 3600 * 12
    tokens_per_day = tokens_per_second * 3600 * 12
    tokens_per_30_days = tokens_per_day * 30
    tokens_per_90_days = tokens_per_day * 90

    print()
    print("RESULT")
    print("=" * 42)
    print(f"Steps:          {steps:,}")
    print(f"Tokens:         {total_tokens:,}")
    print(f"Elapsed:        {elapsed:.2f}s")
    print(f"Final loss:     {last_loss:.4f}")
    print(f"Tokens/sec:     {tokens_per_second:,.2f}")
    print(f"Tokens/hour:    {tokens_per_hour:,.0f}")
    print(f"Tokens/12h:     {tokens_per_12h:,.0f}")
    print(f"Tokens/30 days: {tokens_per_30_days:,.0f}")
    print(f"Tokens/90 days: {tokens_per_90_days:,.0f}")
    print()
    print("Benchmark: PASS")


if __name__ == "__main__":
    main()