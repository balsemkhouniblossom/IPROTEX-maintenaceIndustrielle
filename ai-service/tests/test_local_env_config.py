from __future__ import annotations

import os
from pathlib import Path

from app.core import config


def test_local_env_loader_supplies_missing_values(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# local service configuration\n"
        "AI_SERVICE_TOKEN=local-test-token\n"
        "QUOTED_VALUE='quoted value'\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "ROOT_DIR", tmp_path)
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("QUOTED_VALUE", raising=False)

    config._load_local_env()

    assert os.environ["AI_SERVICE_TOKEN"] == "local-test-token"
    assert os.environ["QUOTED_VALUE"] == "quoted value"


def test_local_env_loader_never_overrides_deployment_value(
    tmp_path: Path, monkeypatch
) -> None:
    (tmp_path / ".env").write_text(
        "AI_SERVICE_TOKEN=local-token\n", encoding="utf-8"
    )
    monkeypatch.setattr(config, "ROOT_DIR", tmp_path)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "deployment-token")

    config._load_local_env()

    assert os.environ["AI_SERVICE_TOKEN"] == "deployment-token"
