{
  description = "construct — Nix-based code executor for codemode";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    crane.url = "github:ipetkov/crane";
    sandnix.url = "github:srid/sandnix";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ inputs.sandnix.flakeModule ];

      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];

      perSystem = { pkgs, lib, ... }:
        let
          craneLib = inputs.crane.mkLib pkgs;

          src = lib.cleanSourceWith {
            src = craneLib.path ./.;
            filter = path: type:
              (craneLib.filterCargoSources path type)
              || (builtins.match ".*runner/runner\\.ts$" path != null);
          };

          commonArgs = {
            inherit src;
            strictDeps = true;
          };

          cargoArtifacts = craneLib.buildDepsOnly commonArgs;

          gun-unwrapped = craneLib.buildPackage (commonArgs // {
            inherit cargoArtifacts;
          });

          # Tools available inside the sandbox
          sandboxTools = with pkgs; [ deno jq ripgrep coreutils ];

          # gun with tools on PATH
          gun-with-tools = pkgs.symlinkJoin {
            name = "gun-with-tools";
            paths = [ gun-unwrapped ] ++ sandboxTools;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/gun \
                --prefix PATH : ${lib.makeBinPath sandboxTools}
            '';
          };
        in
        {
          packages = {
            inherit gun-unwrapped;
            default = gun-unwrapped; # sandnixApps.gun overrides when sandnix is available
          };

          sandnixApps.gun = {
            program = "${gun-with-tools}/bin/gun";
            features = {
              nix = true;
              tmp = true;
              network = false;
              tty = false;
            };
            cli.env = [ "PATH" ];
          };

          devShells.default = craneLib.devShell {
            packages = with pkgs; [
              deno
              rust-analyzer
              nodejs_22
              pnpm
              jq
              ripgrep
            ];

            shellHook = ''
              export GUN_PATH="$PWD/target/release/gun"
              echo "construct devshell (sandnix)"
              echo "  cargo build --release  — build gun"
              echo "  pnpm install           — install TS deps (in ts/)"
              echo "  pnpm test              — run e2e tests"
              echo "  nix build .#gun-unwrapped — build without sandbox"
            '';
          };
        };

      flake = {
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
    };
}
