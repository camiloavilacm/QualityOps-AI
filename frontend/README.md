# Local release review

C1 presents the synthetic mixed campaign. From this directory, install the lockfile and run the local dashboard with Node 22.12 or newer.

```sh
npm ci
npm run dev -- --port 4173
```

Open `http://127.0.0.1:4173/` and follow the **Mixed campaign** link. The detail view also opens at `/?campaign=fixture-mixed`. The release decision is `BLOCKED` with `REQUIRED_FAILURE` for execution `x` and `INSUFFICIENT_EVIDENCE` for execution `y`. The evidence link opens the sanitized entry for `x`. The page reports the absence of investigation and evaluation records.

## Verified fixture

The only dashboard data source is `src/mixed-campaign.json`, a local export with version `1.0.0`. Its SHA-256 is `1bdda5cadd7c835f08123d29af8c56eb51c7356cdd9153bd34c865c0c84f0662`. It contains the closed v2 gate record, source kind, completeness, and allowlisted evidence identifiers and types. The bundle manifest, execution reports, paths, and held-out evaluation data remain in their source directories.

From the repository root, use Python 3.11 or later with the dependency pinned in `harness/requirements.txt`.

```sh
python -B frontend/scripts/export_mixed.py --check
python -B -m unittest -q backend.gate.test_gate
npm --prefix frontend run build
npm --prefix frontend run preview -- --port 4183
```

The fixture check replays the gate from A1 revision `9e298860ea326e41e3ed953c70d6f6953bcdf2c9` against the v2 synthetic evidence, trusted local policy, and independent source receipts. The export must match the frozen mixed-campaign expectation and bind to the exact source manifest bytes. Omit `--check` to regenerate the export. The production build uses relative asset paths and can be served by a static host.
