from __future__ import annotations

import torch

from config import DEFAULT_CONFIG
from model import create_model, count_parameters


def main() -> None:
    config = DEFAULT_CONFIG
    model = create_model(config)

    parameters = count_parameters(model)

    print("KLIZONION model verification")
    print("=" * 32)
    print(f"Vocabulary:   {config.vocab_size:,}")
    print(f"Context:      {config.max_seq_len}")
    print(f"Dimensions:   {config.d_model}")
    print(f"Layers:       {config.n_layers}")
    print(f"Heads:        {config.n_heads}")
    print(f"FFN:          {config.d_ff}")
    print(f"Parameters:   {parameters:,}")
    print(f"Parameters M: {parameters / 1_000_000:.2f}M")

    # Small CPU-only forward-pass test.
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

    print(f"Logits shape: {tuple(logits.shape)}")
    print("CPU forward pass: PASS")
    print("Model verification: PASS")


if __name__ == "__main__":
    main()