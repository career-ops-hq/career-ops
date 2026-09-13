{
  description = "career-ops - AI job search pipeline";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flakelight.url = "github:nix-community/flakelight";

    # Pi (see docs/SUPPORTED_CLIS.md) needs its own nixpkgs: the CLI gained the
    # `x-opencode-session` routing header OpenCode's API requires partway
    # through its 0.8x line, and the nixpkgs this flake pins for the toolchain
    # still carries 0.64, which the OpenCode Go endpoint rejects with
    # "Request is missing x-opencode-session". A second input keeps Pi working
    # without forcing a whole-nixpkgs bump (Node, Playwright browsers) on every
    # contributor. Drop it once the pin above passes 0.85.
    nixpkgs-pi.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { flakelight, nixpkgs, nixpkgs-pi, ... }:
    flakelight ./. {

      inputs.nixpkgs = nixpkgs;

      # flakelight only exposes its default Linux systems unless `systems` is
      # set, so on macOS `nix develop` / direnv fail with a confusing
      # "does not provide attribute 'devShells.aarch64-darwin.default'" error.
      # List the common dev systems so the devShell resolves on macOS too.
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      devShell.packages =
        pkgs:
        with pkgs; [

          nodejs
          bun

          # Pi coding agent host (docs/SUPPORTED_CLIS.md), in the shell so the
          # integration runs without a global npm install:
          #   pi            interactive
          #   pi -p "…"     headless worker
          # Taken from `nixpkgs-pi` (see the input comment): the toolchain pin
          # carries 0.64, which the OpenCode Go endpoint rejects.
          nixpkgs-pi.legacyPackages.${pkgs.stdenv.hostPlatform.system}.pi-coding-agent

          coreutils

          playwright-driver.browsers

        ];

      devShell.env = pkgs: {
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      };

      devShell.shellHook = pkgs: ''
        # Pin npm playwright to match nixpkgs browser binaries
        EXPECTED="${pkgs.playwright-driver.version}"
        CURRENT=$(node -e "try{console.log(require('playwright-core/package.json').version)}catch{}" 2>/dev/null)
        if [ "$CURRENT" != "$EXPECTED" ]; then
          echo "Pinning playwright to $EXPECTED to match Nix-provided browsers..."
          npm install --no-save "playwright@$EXPECTED" >/dev/null 2>&1
        fi
      '';

    };

}
