{
  description = "career-ops - AI job search pipeline";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flakelight.url = "github:nix-community/flakelight";
  };

  outputs =
    { flakelight, nixpkgs, ... }:
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
        pkgs: with pkgs; [

          nodejs
          bun

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
