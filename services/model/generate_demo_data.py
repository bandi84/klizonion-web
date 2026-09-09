from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "klizonion_train.txt"

topics = [
    "KLIZONION is a language model project.",
    "A transformer predicts the next token using contextual information.",
    "Attention helps the model combine information from earlier tokens.",
    "Training reduces prediction loss by updating model parameters.",
    "Checkpoints allow experiments to resume safely.",
    "Evaluation measures whether a model improves on unseen examples.",
    "KLIZONION Builder turns ideas into software projects.",
    "An AI agent can inspect files, plan tasks, edit code, and run tests.",
    "A supervised runner controls access to the local workspace.",
    "A trainer can use CPU or GPU resources depending on hardware.",
    "A live preview shows the result of a generated project.",
    "Good software engineering uses tests and measurable feedback.",
]

examples = [
    "User: What is KLIZONION?\nAssistant: KLIZONION is an experimental language model and engineering platform.",
    "User: What does training do?\nAssistant: Training adjusts model parameters so the model becomes better at predicting the next token.",
    "User: What does the Builder do?\nAssistant: The Builder plans and creates software projects inside an authorized workspace.",
    "User: What is a checkpoint?\nAssistant: A checkpoint is a saved training state that allows training to resume later.",
    "User: Can KLIZONION use a GPU?\nAssistant: The training system can use supported GPU acceleration when available and CPU otherwise.",
]

blocks = []

for _ in range(2000):
    blocks.append("\n".join(topics))
    blocks.append("\n".join(examples))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n\n".join(blocks), encoding="utf-8")

print(f"Created: {OUT}")
print(f"Characters: {OUT.stat().st_size:,}")
print("PASS")