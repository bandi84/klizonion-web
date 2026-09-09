from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Iterable


class KlizonionTokenizer:
    """
    Lightweight byte-level BPE tokenizer.

    Special tokens:
      0 = PAD
      1 = BOS
      2 = EOS

    Base vocabulary:
      3-258 = raw byte values

    Remaining IDs are learned BPE merge tokens.

    The tokenizer targets the model's 32,000-token vocabulary.
    """

    PAD_ID = 0
    BOS_ID = 1
    EOS_ID = 2

    BYTE_OFFSET = 3
    BYTE_VOCAB_SIZE = 256

    VOCAB_SIZE = 32_000

    def __init__(self) -> None:
        self.vocab_size = self.VOCAB_SIZE

        self.merges: list[tuple[int, int]] = []
        self.merge_ranks: dict[tuple[int, int], int] = {}

        self.token_to_bytes: dict[int, bytes] = {
            self.BYTE_OFFSET + i: bytes([i])
            for i in range(self.BYTE_VOCAB_SIZE)
        }

        self.trained = False

    # ------------------------------------------------------------------
    # Basic byte encoding
    # ------------------------------------------------------------------

    def _text_to_base_tokens(self, text: str) -> list[int]:
        raw = text.encode("utf-8")
        return [self.BYTE_OFFSET + b for b in raw]

    # ------------------------------------------------------------------
    # BPE training
    # ------------------------------------------------------------------

    @staticmethod
    def _pair_counts(
        sequences: list[list[int]],
    ) -> Counter[tuple[int, int]]:
        counts: Counter[tuple[int, int]] = Counter()

        for sequence in sequences:
            for i in range(len(sequence) - 1):
                counts[(sequence[i], sequence[i + 1])] += 1

        return counts

    @staticmethod
    def _merge_pair(
        sequence: list[int],
        pair: tuple[int, int],
        new_token: int,
    ) -> list[int]:
        a, b = pair
        output: list[int] = []

        i = 0

        while i < len(sequence):
            if i + 1 < len(sequence) and sequence[i] == a and sequence[i + 1] == b:
                output.append(new_token)
                i += 2
            else:
                output.append(sequence[i])
                i += 1

        return output

    def train(
        self,
        texts: Iterable[str],
        *,
        vocab_size: int | None = None,
        min_frequency: int = 2,
        max_merges: int | None = None,
    ) -> None:
        """
        Train BPE merges from an iterable of text strings.

        For a 32k vocabulary:
          base tokens = 256
          special tokens = 3
          available merge tokens = 31,741
        """

        target_vocab = vocab_size or self.VOCAB_SIZE

        if target_vocab > self.VOCAB_SIZE:
            raise ValueError(
                f"vocab_size cannot exceed {self.VOCAB_SIZE}"
            )

        if target_vocab < self.BYTE_OFFSET + self.BYTE_VOCAB_SIZE:
            raise ValueError("vocab_size is too small")

        sequences = [
            self._text_to_base_tokens(text)
            for text in texts
            if isinstance(text, str) and text
        ]

        if not sequences:
            raise ValueError("No training text supplied")

        available_merges = (
            target_vocab
            - self.BYTE_OFFSET
            - self.BYTE_VOCAB_SIZE
        )

        merge_limit = (
            min(available_merges, max_merges)
            if max_merges is not None
            else available_merges
        )

        self.merges.clear()
        self.merge_ranks.clear()

        next_token = (
            self.BYTE_OFFSET
            + self.BYTE_VOCAB_SIZE
        )

        for _ in range(merge_limit):
            counts = self._pair_counts(sequences)

            if not counts:
                break

            best_pair, frequency = counts.most_common(1)[0]

            if frequency < min_frequency:
                break

            new_token = next_token
            next_token += 1

            self.merges.append(best_pair)
            self.merge_ranks[best_pair] = len(self.merges) - 1

            left = self.token_to_bytes[best_pair[0]]
            right = self.token_to_bytes[best_pair[1]]

            self.token_to_bytes[new_token] = left + right

            sequences = [
                self._merge_pair(sequence, best_pair, new_token)
                for sequence in sequences
            ]

        self.trained = True

    # ------------------------------------------------------------------
    # Encoding
    # ------------------------------------------------------------------

    def _apply_merges(self, tokens: list[int]) -> list[int]:
        if not tokens or not self.merges:
            return tokens

        result = tokens[:]

        while True:
            best_index = None
            best_rank = None

            for i in range(len(result) - 1):
                pair = (result[i], result[i + 1])

                rank = self.merge_ranks.get(pair)

                if rank is None:
                    continue

                if best_rank is None or rank < best_rank:
                    best_rank = rank
                    best_index = i

            if best_index is None:
                break

            pair = (
                result[best_index],
                result[best_index + 1],
            )

            new_token = (
                self.BYTE_OFFSET
                + self.BYTE_VOCAB_SIZE
                + self.merge_ranks[pair]
            )

            result = (
                result[:best_index]
                + [new_token]
                + result[best_index + 2 :]
            )

        return result

    def encode(
        self,
        text: str,
        *,
        add_bos: bool = False,
        add_eos: bool = True,
    ) -> list[int]:
        if not isinstance(text, str):
            raise TypeError("text must be a string")

        tokens = self._text_to_base_tokens(text)

        if self.trained:
            tokens = self._apply_merges(tokens)

        output: list[int] = []

        if add_bos:
            output.append(self.BOS_ID)

        output.extend(tokens)

        if add_eos:
            output.append(self.EOS_ID)

        return output

    # ------------------------------------------------------------------
    # Decoding
    # ------------------------------------------------------------------

    def decode(self, ids: Iterable[int]) -> str:
        output = bytearray()

        for token_id in ids:
            if token_id in {
                self.PAD_ID,
                self.BOS_ID,
                self.EOS_ID,
            }:
                continue

            token_bytes = self.token_to_bytes.get(token_id)

            if token_bytes is not None:
                output.extend(token_bytes)

        return output.decode(
            "utf-8",
            errors="replace",
        )

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "type": "byte_bpe",
            "vocab_size": self.vocab_size,
            "pad_id": self.PAD_ID,
            "bos_id": self.BOS_ID,
            "eos_id": self.EOS_ID,
            "byte_offset": self.BYTE_OFFSET,
            "merges": [list(pair) for pair in self.merges],
        }

        path.write_text(
            json.dumps(data, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "KlizonionTokenizer":
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(
                f"Tokenizer file not found: {path}"
            )

        data = json.loads(
            path.read_text(encoding="utf-8")
        )

        if data.get("type") != "byte_bpe":
            raise ValueError("Unsupported tokenizer type")

        tokenizer = cls()

        if data.get("vocab_size") != tokenizer.VOCAB_SIZE:
            raise ValueError(
                "Tokenizer vocabulary does not match model vocabulary"
            )

        for rank, pair_list in enumerate(
            data.get("merges", [])
        ):
            if len(pair_list) != 2:
                raise ValueError("Invalid merge entry")

            pair = (
                int(pair_list[0]),
                int(pair_list[1]),
            )

            tokenizer.merges.append(pair)
            tokenizer.merge_ranks[pair] = rank

            new_token = (
                tokenizer.BYTE_OFFSET
                + tokenizer.BYTE_VOCAB_SIZE
                + rank
            )

            left = tokenizer.token_to_bytes[pair[0]]
            right = tokenizer.token_to_bytes[pair[1]]

            tokenizer.token_to_bytes[new_token] = left + right

        tokenizer.trained = True

        return tokenizer


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def train_tokenizer_from_file(
    dataset_path: str | Path,
    tokenizer_path: str | Path,
) -> KlizonionTokenizer:
    dataset_path = Path(dataset_path)

    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {dataset_path}"
        )

    text = clean_text(
        dataset_path.read_text(
            encoding="utf-8",
            errors="replace",
        )
    )

    tokenizer = KlizonionTokenizer()

    tokenizer.train(
        [text],
        vocab_size=KlizonionTokenizer.VOCAB_SIZE,
        min_frequency=2,
    )

    tokenizer.save(tokenizer_path)

    return tokenizer


if __name__ == "__main__":
    tokenizer = KlizonionTokenizer()

    samples = [
        """
        KLIZONION is an experimental language model.
        KLIZONION Builder creates software projects.
        Transformers learn to predict the next token.
        """,
        """
        The model uses attention and feed-forward layers.
        Training measures loss and saves checkpoints.
        """,
    ]

    tokenizer.train(
        samples,
        vocab_size=KlizonionTokenizer.VOCAB_SIZE,
        min_frequency=2,
        max_merges=500,
    )

    sample = (
        "KLIZONION Builder can train a language model "
        "from scratch."
    )

    encoded = tokenizer.encode(
        sample,
        add_bos=True,
        add_eos=True,
    )

    decoded = tokenizer.decode(encoded)

    print("KLIZONION BPE tokenizer smoke test")
    print("=" * 38)
    print(f"Vocabulary:    {tokenizer.vocab_size:,}")
    print(f"Merges:        {len(tokenizer.merges):,}")
    print(f"Input chars:   {len(sample)}")
    print(f"Token count:   {len(encoded)}")
    print(f"Tokens:        {encoded[:30]}")
    print(f"Decoded:       {decoded}")
    print(
        "Compression:   "
        f"{len(sample) / max(len(encoded), 1):.2f} chars/token"
    )

    assert decoded == sample

    print("Tokenizer smoke test: PASS")