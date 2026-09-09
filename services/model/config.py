from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    vocab_size: int = 32_000
    max_seq_len: int = 512

    # ~59M parameter decoder-only model with tied input/output embeddings.
    d_model: int = 576
    n_layers: int = 10
    n_heads: int = 9
    d_ff: int = 2304

    dropout: float = 0.0
    bias: bool = True


DEFAULT_CONFIG = ModelConfig()