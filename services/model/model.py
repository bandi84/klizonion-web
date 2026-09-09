from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from config import ModelConfig


class CausalSelfAttention(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()

        if config.d_model % config.n_heads != 0:
            raise ValueError("d_model must be divisible by n_heads")

        self.n_heads = config.n_heads
        self.head_dim = config.d_model // config.n_heads

        self.qkv = nn.Linear(
            config.d_model,
            3 * config.d_model,
            bias=config.bias,
        )
        self.out_proj = nn.Linear(
            config.d_model,
            config.d_model,
            bias=config.bias,
        )

        self.attn_dropout = nn.Dropout(config.dropout)
        self.resid_dropout = nn.Dropout(config.dropout)

        mask = torch.tril(
            torch.ones(config.max_seq_len, config.max_seq_len, dtype=torch.bool)
        )
        self.register_buffer(
            "causal_mask",
            mask.view(1, 1, config.max_seq_len, config.max_seq_len),
            persistent=False,
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size, seq_len, d_model = x.shape

        qkv = self.qkv(x)
        q, k, v = qkv.split(d_model, dim=-1)

        q = q.view(batch_size, seq_len, self.n_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch_size, seq_len, self.n_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch_size, seq_len, self.n_heads, self.head_dim).transpose(1, 2)

        attention_scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)

        mask = self.causal_mask[:, :, :seq_len, :seq_len]
        attention_scores = attention_scores.masked_fill(~mask, torch.finfo(attention_scores.dtype).min)

        attention_weights = F.softmax(attention_scores, dim=-1)
        attention_weights = self.attn_dropout(attention_weights)

        y = attention_weights @ v
        y = y.transpose(1, 2).contiguous().view(batch_size, seq_len, d_model)

        return self.resid_dropout(self.out_proj(y))


class MLP(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()

        self.fc1 = nn.Linear(config.d_model, config.d_ff, bias=config.bias)
        self.fc2 = nn.Linear(config.d_ff, config.d_model, bias=config.bias)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.fc1(x)
        x = F.gelu(x)
        x = self.fc2(x)
        return self.dropout(x)


class TransformerBlock(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()

        self.ln1 = nn.LayerNorm(config.d_model)
        self.attn = CausalSelfAttention(config)

        self.ln2 = nn.LayerNorm(config.d_model)
        self.mlp = MLP(config)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x))
        x = x + self.mlp(self.ln2(x))
        return x


class KlizonionModel(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()

        self.config = config

        self.token_embedding = nn.Embedding(
            config.vocab_size,
            config.d_model,
        )
        self.position_embedding = nn.Embedding(
            config.max_seq_len,
            config.d_model,
        )

        self.dropout = nn.Dropout(config.dropout)

        self.blocks = nn.ModuleList(
            TransformerBlock(config)
            for _ in range(config.n_layers)
        )

        self.final_norm = nn.LayerNorm(config.d_model)

        self.lm_head = nn.Linear(
            config.d_model,
            config.vocab_size,
            bias=False,
        )

        # Tie input embeddings and output embeddings.
        self.lm_head.weight = self.token_embedding.weight

        self.apply(self._init_weights)

    @staticmethod
    def _init_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)

        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(
        self,
        input_ids: torch.Tensor,
        targets: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor | None]:

        if input_ids.ndim != 2:
            raise ValueError("input_ids must have shape [batch, sequence]")

        batch_size, seq_len = input_ids.shape

        if seq_len > self.config.max_seq_len:
            raise ValueError(
                f"Sequence length {seq_len} exceeds max_seq_len "
                f"{self.config.max_seq_len}"
            )

        positions = torch.arange(
            0,
            seq_len,
            device=input_ids.device,
            dtype=torch.long,
        )

        x = self.token_embedding(input_ids)
        x = x + self.position_embedding(positions)[None, :, :]
        x = self.dropout(x)

        for block in self.blocks:
            x = block(x)

        x = self.final_norm(x)
        logits = self.lm_head(x)

        loss = None

        if targets is not None:
            if targets.shape != input_ids.shape:
                raise ValueError("targets must have the same shape as input_ids")

            loss = F.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                targets.reshape(-1),
            )

        return logits, loss


def count_parameters(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def create_model(config: ModelConfig | None = None) -> KlizonionModel:
    return KlizonionModel(config or ModelConfig())