from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch

try:
    from .config import DEFAULT_CONFIG
    from .dataset import load_dataset, make_repeated_smoke_dataset
    from .model import count_parameters, create_model
    from .tokenizer import KlizonionTokenizer
except ImportError:
    from config import DEFAULT_CONFIG
    from dataset import load_dataset, make_repeated_smoke_dataset
    from model import count_parameters, create_model
    from tokenizer import KlizonionTokenizer


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
CHECKPOINT_DIR = ROOT / "checkpoints"
DEFAULT_DATA = DATA_DIR / "benchmark.txt"
DEFAULT_TOKENIZER = DATA_DIR / "tokenizer.json"
LATEST_CHECKPOINT = CHECKPOINT_DIR / "latest.pt"
SUMMARY_FILE = CHECKPOINT_DIR / "training_summary.json"


def choose_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def save_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    step: int,
    epoch: int,
    loss: float,
    total_tokens: int,
    elapsed_seconds: float,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "step": step,
        "epoch": epoch,
        "loss": loss,
        "total_tokens": total_tokens,
        "elapsed_seconds": elapsed_seconds,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "config": DEFAULT_CONFIG.__dict__,
    }

    temp_path = path.with_suffix(".tmp")
    torch.save(payload, temp_path)
    temp_path.replace(path)


def load_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> tuple[int, int, float, int, float]:
    checkpoint = torch.load(
        path,
        map_location=device,
    )

    model.load_state_dict(checkpoint["model_state"])
    optimizer.load_state_dict(checkpoint["optimizer_state"])

    return (
        int(checkpoint.get("step", 0)),
        int(checkpoint.get("epoch", 0)),
        float(checkpoint.get("loss", 0.0)),
        int(checkpoint.get("total_tokens", 0)),
        float(checkpoint.get("elapsed_seconds", 0.0)),
    )


def write_summary(
    *,
    device: torch.device,
    parameters: int,
    step: int,
    loss: float,
    total_tokens: int,
    elapsed_seconds: float,
) -> None:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    tokens_per_second = total_tokens / max(elapsed_seconds, 1e-9)

    summary = {
        "device": str(device),
        "parameters": parameters,
        "parameters_m": round(parameters / 1_000_000, 2),
        "step": step,
        "loss": loss,
        "total_tokens": total_tokens,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "tokens_per_second": round(tokens_per_second, 3),
    }

    SUMMARY_FILE.write_text(
        json.dumps(summary, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="KLIZONION checkpointable training runner"
    )

    parser.add_argument(
        "--data",
        type=Path,
        default=DEFAULT_DATA,
    )

    parser.add_argument(
        "--tokenizer",
        type=Path,
        default=DEFAULT_TOKENIZER,
    )

    parser.add_argument(
        "--steps",
        type=int,
        default=20,
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
        "--lr",
        type=float,
        default=3e-4,
    )

    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=5,
    )

    parser.add_argument(
        "--resume",
        action="store_true",
    )

    args = parser.parse_args()

    if args.steps < 1:
        raise ValueError("--steps must be >= 1")

    if args.batch_size < 1:
        raise ValueError("--batch-size must be >= 1")

    if args.seq_len < 2:
        raise ValueError("--seq-len must be >= 2")

    if args.checkpoint_every < 1:
        raise ValueError("--checkpoint-every must be >= 1")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not args.data.exists():
        make_repeated_smoke_dataset(
            args.data,
            repetitions=1000,
        )

    tokenizer = KlizonionTokenizer()

    # Create/save a tokenizer config if one does not already exist.
    if args.tokenizer.exists():
        tokenizer = KlizonionTokenizer.load(args.tokenizer)
    else:
        tokenizer.train(
            [
                args.data.read_text(
                    encoding="utf-8",
                    errors="replace",
                )
            ],
            vocab_size=KlizonionTokenizer.VOCAB_SIZE,
            min_frequency=2,
            max_merges=4000,
        )
        tokenizer.save(args.tokenizer)

    train_dataset, val_dataset = load_dataset(
        args.data,
        tokenizer,
        sequence_length=args.seq_len,
    )

    device = choose_device()

    model = create_model(DEFAULT_CONFIG).to(device)

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.lr,
        betas=(0.9, 0.95),
        weight_decay=0.1,
    )

    parameters = count_parameters(model)

    start_step = 0
    start_epoch = 0
    last_loss = 0.0
    total_tokens = 0
    previous_elapsed = 0.0

    if args.resume and LATEST_CHECKPOINT.exists():
        (
            start_step,
            start_epoch,
            last_loss,
            total_tokens,
            previous_elapsed,
        ) = load_checkpoint(
            LATEST_CHECKPOINT,
            model,
            optimizer,
            device,
        )

    print("KLIZONION training")
    print("=" * 32)
    print(f"Device:          {device}")
    print(f"Parameters:      {parameters:,}")
    print(f"Parameters (M):  {parameters / 1_000_000:.2f}")
    print(f"Train tokens:    {train_dataset.tokens.numel():,}")
    print(f"Val tokens:      {val_dataset.tokens.numel():,}")
    print(f"Batch size:      {args.batch_size}")
    print(f"Sequence length: {args.seq_len}")
    print(f"Learning rate:   {args.lr}")
    print(f"Start step:      {start_step}")
    print(f"Target steps:    {args.steps}")
    print(f"Resume:          {args.resume}")
    print()

    model.train()

    session_start = time.perf_counter()

    for local_step in range(1, args.steps + 1):
        global_step = start_step + local_step

        x, y = train_dataset.sample(
            batch_size=args.batch_size,
            device=device,
        )

        optimizer.zero_grad(set_to_none=True)

        _, loss = model(x, y)

        if loss is None:
            raise RuntimeError("Model returned no training loss")

        loss.backward()

        torch.nn.utils.clip_grad_norm_(
            model.parameters(),
            max_norm=1.0,
        )

        optimizer.step()

        total_tokens += x.numel()
        last_loss = float(loss.detach().cpu())

        elapsed = previous_elapsed + (
            time.perf_counter() - session_start
        )

        tokens_per_second = total_tokens / max(elapsed, 1e-9)

        print(
            f"step={global_step:06d} "
            f"loss={last_loss:.4f} "
            f"tokens/s={tokens_per_second:.2f}"
        )

        should_checkpoint = (
            global_step % args.checkpoint_every == 0
            or local_step == args.steps
        )

        if should_checkpoint:
            checkpoint_path = (
                CHECKPOINT_DIR
                / f"klizonion_step_{global_step:06d}.pt"
            )

            save_checkpoint(
                checkpoint_path,
                model,
                optimizer,
                step=global_step,
                epoch=start_epoch,
                loss=last_loss,
                total_tokens=total_tokens,
                elapsed_seconds=elapsed,
            )

            save_checkpoint(
                LATEST_CHECKPOINT,
                model,
                optimizer,
                step=global_step,
                epoch=start_epoch,
                loss=last_loss,
                total_tokens=total_tokens,
                elapsed_seconds=elapsed,
            )

    final_elapsed = previous_elapsed + (
        time.perf_counter() - session_start
    )

    write_summary(
        device=device,
        parameters=parameters,
        step=start_step + args.steps,
        loss=last_loss,
        total_tokens=total_tokens,
        elapsed_seconds=final_elapsed,
    )

    print()
    print("TRAINING RUN COMPLETE")
    print(f"Final loss:       {last_loss:.4f}")
    print(f"Total tokens:     {total_tokens:,}")
    print(
        f"Tokens/sec:       "
        f"{total_tokens / max(final_elapsed, 1e-9):.2f}"
    )
    print(f"Latest checkpoint: {LATEST_CHECKPOINT}")
    print(f"Summary:           {SUMMARY_FILE}")


if __name__ == "__main__":
    main()