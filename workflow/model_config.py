"""Load the single workflow model from the user's Hermes configuration."""

from __future__ import annotations

from pathlib import Path
import site
import sys


def create_agent(*, system_prompt: str, tools: list[str], session_id: str, max_iterations: int | None = None):
    """Create a fresh agent while keeping Hermes as the configuration authority."""
    hermes = Path.home() / ".hermes" / "hermes-agent"
    hermes_packages = hermes / "venv" / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    if not hermes_packages.is_dir():
        raise RuntimeError(f"Hermes Python environment is missing: {hermes_packages}")
    site.addsitedir(str(hermes_packages))
    if str(hermes) not in sys.path:
        sys.path.insert(0, str(hermes))
    from hermes_cli.env_loader import load_hermes_dotenv
    from hermes_cli.config import load_config_readonly
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent

    load_hermes_dotenv()
    config = load_config_readonly()
    model = config["model"]["default"]
    runtime = resolve_runtime_provider(target_model=model)
    return AIAgent(
        model=model,
        **{key: runtime.get(key) for key in (
            "api_key", "base_url", "provider", "api_mode",
            "requested_provider", "request_overrides",
        )},
        enabled_toolsets=tools,
        max_iterations=max_iterations if max_iterations is not None else 12 if tools else 1,
        skip_context_files=True,
        skip_memory=True,
        load_soul_identity=False,
        skip_background_review=True,
        ephemeral_system_prompt=system_prompt,
        quiet_mode=True,
        session_id=session_id,
        reasoning_config={
            "enabled": True,
            "effort": config.get("agent", {}).get("reasoning_effort", "high"),
        },
    )
