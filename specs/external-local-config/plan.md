# Plan: External Local Project Configuration

1. Add one shared validated file reader for project configurations.
2. Add `--config PATH` and enforce that explicit local configs live outside the consumer root.
3. Route configuration-consuming CLI commands through the explicit loader while preserving defaults.
4. Move the example-consumer candidate to an ignored DevHarness local-projects directory.
5. Validate behavior without running consumer code.
