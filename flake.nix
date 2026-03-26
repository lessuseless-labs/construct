{
  description = "construct — Nix-based code executor for codemode";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    crane.url = "github:ipetkov/crane";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, crane, flake-utils, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        craneLib = crane.mkLib pkgs;

        # Filter source to only include Rust and runner files
        src = pkgs.lib.cleanSourceWith {
          src = craneLib.path ./.;
          filter = path: type:
            (craneLib.filterCargoSources path type)
            || (builtins.match ".*runner/runner\\.ts$" path != null);
        };

        commonArgs = {
          inherit src;
          strictDeps = true;
        };

        # Build deps separately for caching
        cargoArtifacts = craneLib.buildDepsOnly commonArgs;

        gun = craneLib.buildPackage (commonArgs // {
          inherit cargoArtifacts;
        });
      in
      {
        packages = {
          inherit gun;
          default = gun;
        };

        devShells.default = craneLib.devShell {
          packages = with pkgs; [
            deno
            rust-analyzer
            nodejs_22
            pnpm
            jq
          ];

          shellHook = ''
            export GUN_PATH="$PWD/target/release/gun"
            echo "construct devshell"
            echo "  cargo build --release  — build gun"
            echo "  pnpm install           — install TS deps"
            echo "  pnpm test              — run e2e tests"
            echo "  pnpm demo:basic        — run basic demo"
          '';
        };
      }
    ) // {
      overlays.default = final: _prev:
      let
        craneLib = inputs.crane.mkLib final;
        src = final.lib.cleanSourceWith {
          src = craneLib.path ./.;
          filter = path: type:
            (craneLib.filterCargoSources path type)
            || (builtins.match ".*runner/runner\\.ts$" path != null);
        };
        commonArgs = { inherit src; strictDeps = true; };
        cargoArtifacts = craneLib.buildDepsOnly commonArgs;
      in {
        construct-gun = craneLib.buildPackage (commonArgs // { inherit cargoArtifacts; });
      };
    };
}
