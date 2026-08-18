# receipt-evidence

Scan a receipt, get structured data that can show its work.

Every extracted value quotes the line of recognised text it came from, and a deterministic parser — not a second model — decides whether the model earned its answer.
A value that cannot show its evidence is reported as unverified rather than presented as fact.

The design, including the measured baseline that decides where the model belongs, is in
[`docs/specs/2026-08-19-receipt-evidence-design.md`](docs/specs/2026-08-19-receipt-evidence-design.md).

Nothing is implemented yet.
