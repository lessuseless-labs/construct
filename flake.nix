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

          # Tools available inside the sandbox (deno is runtime, not a user tool)
          sandboxTools = with pkgs; [ jq ripgrep coreutils nushell tealdeer ];

          # Generate tool manifest from package metadata
          tool-manifest = pkgs.runCommand "tool-manifest" {
            nativeBuildInputs = [ pkgs.jq ];
          } ''
            echo '{"tools":[' > $out

            first=true
            ${lib.concatMapStringsSep "\n" (pkg:
              let
                description = pkg.meta.description or "";
                mainProgram = pkg.meta.mainProgram or null;
                homepage = pkg.meta.homepage or "";
                attr = pkg.pname or pkg.name or "unknown";
              in ''
                # List binaries
                bins="[]"
                if [ -d "${pkg}/bin" ]; then
                  bins=$(ls -1 "${pkg}/bin" | jq -R . | jq -s .)
                fi

                if [ "$first" = true ]; then
                  first=false
                else
                  echo ',' >> $out
                fi

                jq -n \
                  --arg attr "${attr}" \
                  --arg description ${lib.escapeShellArg description} \
                  ${if mainProgram != null then ''--arg mainProgram "${mainProgram}"'' else ''--argjson mainProgram null''} \
                  --arg homepage "${homepage}" \
                  --argjson binaries "$bins" \
                  '{attr: $attr, description: $description, mainProgram: $mainProgram, homepage: $homepage, binaries: $binaries}' >> $out
              ''
            ) sandboxTools}

            echo ']}' >> $out
          '';

          src = lib.cleanSourceWith {
            src = craneLib.path ./.;
            filter = path: type:
              (craneLib.filterCargoSources path type)
              || (builtins.match ".*runner/runner\\.ts$" path != null);
          };

          commonArgs = {
            inherit src;
            strictDeps = true;

            # Copy manifest into source tree before cargo build
            preBuild = ''
              cp ${tool-manifest} tool-manifest.json
            '';
          };

          cargoArtifacts = craneLib.buildDepsOnly commonArgs;

          gun-unwrapped = craneLib.buildPackage (commonArgs // {
            inherit cargoArtifacts;
          });

          # gun with tools + deno on PATH
          gun-with-tools = pkgs.symlinkJoin {
            name = "gun-with-tools";
            paths = [ gun-unwrapped pkgs.deno ] ++ sandboxTools;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/gun \
                --prefix PATH : ${lib.makeBinPath ([ pkgs.deno ] ++ sandboxTools)}
            '';
          };
          # MCP server — standalone node script with gun on PATH
          construct-mcp = pkgs.writeShellScriptBin "construct-mcp" ''
            export GUN_PATH="${gun-with-tools}/bin/gun"
            export PATH="${lib.makeBinPath ([ pkgs.deno ] ++ sandboxTools)}:$PATH"
            exec ${pkgs.nodejs_22}/bin/node ${./ts/dist/construct-mcp.js} "$@"
          '';
        in
        {
          packages = {
            inherit gun-unwrapped tool-manifest construct-mcp;
            default = gun-unwrapped;
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
