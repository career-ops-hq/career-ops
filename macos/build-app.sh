#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
checkout="$(cd "$script_dir/.." && pwd -P)"
node_path="$(command -v node || true)"
data_root=""
destination="$HOME/Applications/Career Ops.app"
test_only=false
usage() { printf '%s\n' 'Uso: build-app.sh [--test-only] [--checkout PATH] [--node PATH] [--data-root PATH] [--destination PATH]'; }
while (($#)); do
    case "$1" in
        --test-only) test_only=true; shift ;;
        --checkout|--node|--data-root|--destination)
            option="$1"
            if (($# < 2)) || [[ -z "$2" || "$2" == --* ]]; then usage >&2; exit 2; fi
            case "$option" in
                --checkout) checkout="$2" ;;
                --node) node_path="$2" ;;
                --data-root) data_root="$2" ;;
                --destination) destination="$2" ;;
            esac
            shift 2 ;;
        --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
mkdir -p "$script_dir/../work/macos-build"
build_dir="$(mktemp -d "$script_dir/../work/macos-build/run.XXXXXX")"
swiftc -parse-as-library "$script_dir/CareerOpsCore.swift" "$script_dir/CareerOpsCoreTests.swift" -o "$build_dir/core-tests"
"$build_dir/core-tests"
if "$test_only"; then exit 0; fi

[[ -d "$checkout" ]] || { printf '%s\n' 'A pasta do projeto não existe.' >&2; exit 2; }
checkout="$(cd "$checkout" && pwd -P)"
[[ -x "$node_path" && ! -d "$node_path" ]] || { printf '%s\n' 'Escolha um executável Node válido com --node.' >&2; exit 2; }
node_path="$(cd "$(dirname "$node_path")" && pwd -P)/$(basename "$node_path")"
"$node_path" --version | /usr/bin/awk -F. '/^v?[0-9]+\.[0-9]+\.[0-9]+$/ {gsub(/^v/,"",$1); if ($1 > 22 || ($1 == 22 && $2 >= 6)) good=1} END {exit !good}' || {
    printf '%s\n' 'É necessário Node 22.6.0 ou posterior.' >&2; exit 2;
}
[[ -f "$checkout/web/server.mjs" && -f "$checkout/web/.next/BUILD_ID" ]] || {
    printf '%s\n' 'Falta o launcher ou a compilação web. Execute npm run build em web/.' >&2; exit 2;
}
if [[ -n "$data_root" ]]; then
    [[ -d "$data_root" ]] || { printf '%s\n' 'A pasta de dados não existe.' >&2; exit 2; }
    data_root="$(cd "$data_root" && pwd -P)"
fi
[[ "$destination" == /* && "$destination" == *.app && ! -L "$destination" ]] || {
    printf '%s\n' 'O destino deve ser um caminho absoluto terminado em .app, sem ligação simbólica.' >&2; exit 2;
}
if [[ -e "$destination" ]]; then
    [[ -d "$destination" ]] && [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$destination/Contents/Info.plist" 2>/dev/null)" == io.career-ops.local ]] || {
        printf '%s\n' 'O destino já existe e não é a aplicação Career Ops.' >&2; exit 2;
    }
fi
bundle="$build_dir/Career Ops.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
swiftc -parse-as-library -target "$(uname -m)-apple-macosx13.0" -O "$script_dir/CareerOpsCore.swift" "$script_dir/CareerOpsApp.swift" -framework AppKit -framework WebKit -o "$bundle/Contents/MacOS/CareerOps"
cp "$script_dir/Info.plist" "$bundle/Contents/Info.plist"
defaults="$bundle/Contents/Resources/Defaults.plist"
plutil -create xml1 "$defaults"
plutil -insert CareerOpsCheckoutPath -string "$checkout" "$defaults"
plutil -insert CareerOpsNodePath -string "$node_path" "$defaults"
if [[ -n "$data_root" ]]; then plutil -insert CareerOpsDataRootPath -string "$data_root" "$defaults"; fi

qlmanage -t -s 1024 -o "$build_dir" "$checkout/web/src/app/icon.svg" > "$build_dir/icon.log" 2>&1
iconset="$build_dir/CareerOps.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$build_dir/icon.svg.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    doubled=$((size * 2))
    sips -z "$doubled" "$doubled" "$build_dir/icon.svg.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$bundle/Contents/Resources/CareerOps.icns"
codesign --force --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
plutil -lint "$bundle/Contents/Info.plist"
mkdir -p "$(dirname "$destination")"
if [[ -e "$destination" ]]; then mv "$destination" "$build_dir/Previous Career Ops.app"; fi
cp -R "$bundle" "$destination"
printf 'Aplicação instalada: %s\n' "$destination"
