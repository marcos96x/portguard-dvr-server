#!/usr/bin/env bash
# Baixa o binário oficial do go2rtc (linux amd64 ou arm64) e instala.
# Uso:
#   ./scripts/install-go2rtc.sh              # tenta /usr/local/bin (pede sudo se necessário)
#   ./scripts/install-go2rtc.sh ./bin         # instala na pasta local, sem root
set -euo pipefail

INSTALL_DIR="${1:-/usr/local/bin}"
REPO_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) asset="go2rtc_linux_amd64" ;;
  aarch64|arm64) asset="go2rtc_linux_arm64" ;;
  armv7l|armv6l) asset="go2rtc_linux_arm" ;;
  *)
    echo "Arquitetura não suportada: $arch" >&2
    exit 1
    ;;
esac

tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

echo "Baixando ${asset} (latest)..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$tmp" "${REPO_URL}/${asset}"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$tmp" "${REPO_URL}/${asset}"
else
  echo "Instale curl ou wget." >&2
  exit 1
fi

chmod +x "$tmp"
mkdir -p "$INSTALL_DIR"

target="${INSTALL_DIR}/go2rtc"
if [ -w "$INSTALL_DIR" ]; then
  mv "$tmp" "$target"
  trap - EXIT
else
  echo "Sem permissão em ${INSTALL_DIR}, tentando sudo..."
  sudo mv "$tmp" "$target"
  sudo chmod 755 "$target"
  trap - EXIT
fi

echo "Instalado em ${target}"
"$target" --version || "$target" -version || true
