#!/usr/bin/env bash
set -euo pipefail

# OpenTrackPlan installer (macOS / Linux).
#
# By default, binaries are downloaded from GitHub Releases. Override this by setting
# OPENTP_DOWNLOAD_BASE to a compatible base URL (it should contain /releases/download).
#
# Example:
#   OPENTP_DOWNLOAD_BASE="https://github.mycompany.com/org/opentrackplan/opentp-cli/releases/download" \
#     curl -fsSL https://opentp.dev/install | bash

# Settings (edit these)
OPENTP_VERSION="0.7.1"
OPENTP_DOWNLOAD_BASE="${OPENTP_DOWNLOAD_BASE:-https://github.com/opentrackplan/opentp-cli/releases/download}"

# Windows detection - redirect to PowerShell
if [[ ${OS:-} = Windows_NT ]]; then
  powershell -c "irm https://opentp.dev/install.ps1 | iex"
  exit $?
fi

INSTALL_DIR="${HOME}/.opentp/bin"
INSTALL_PATH="${INSTALL_DIR}/opentp"

error() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

need_cmd uname
need_cmd mktemp
need_cmd mkdir
need_cmd chmod
need_cmd mv
need_cmd curl
need_cmd grep

os="$(uname -s)"
arch="$(uname -m)"

asset=""
case "$os" in
  Darwin)
    case "$arch" in
      arm64) asset="opentp-mac" ;;
      x86_64) asset="opentp-mac-intel" ;;
      *) error "Unsupported macOS architecture: $arch" ;;
    esac
    ;;
  Linux)
    case "$arch" in
      x86_64) asset="opentp-linux" ;;
      *) error "Unsupported Linux architecture: $arch" ;;
    esac
    ;;
  *)
    error "Unsupported OS: $os"
    ;;
esac

url="${OPENTP_DOWNLOAD_BASE}/v${OPENTP_VERSION}/${asset}"

tmp="$(mktemp "${TMPDIR:-/tmp}/opentp.${OPENTP_VERSION}.XXXXXX")"
cleanup() { rm -f "$tmp" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"

echo "Downloading ${url}"
curl_args=(--fail --location --show-error --output "$tmp")
if [[ -t 1 ]]; then
  curl_args+=(--progress-bar)
else
  curl_args+=(--silent)
fi
curl "${curl_args[@]}" "$url"

chmod +x "$tmp"
mv -f "$tmp" "$INSTALL_PATH"

echo "Installed opentp ${OPENTP_VERSION} to ${INSTALL_PATH}"

existing_opentp="$(command -v opentp 2>/dev/null || true)"
if [[ -n "$existing_opentp" ]]; then
  if [[ "$existing_opentp" != "$INSTALL_PATH" ]]; then
    echo
    echo "Note: Another opentp is already in PATH at: ${existing_opentp}"
    echo "Typing 'opentp' will not use what was just installed."
    echo "To verify the installed version, run: ${INSTALL_PATH} version"
    exit 0
  fi

  echo "Run 'opentp version' to check the installation"
  exit 0
fi

path_entry='$HOME/.opentp/bin'
shell_name="${SHELL##*/}"
refresh_command=""

echo

case "$shell_name" in
  fish)
    fish_config="$HOME/.config/fish/config.fish"

    if [[ -f "$fish_config" ]] && grep -qsF "$path_entry" "$fish_config"; then
      echo "PATH already configured in: ${fish_config}"
      refresh_command="source ${fish_config}"
    elif mkdir -p "${fish_config%/*}" 2>/dev/null; then
      {
        echo -e '\n# opentp'
        echo "set --export PATH \"$path_entry\" \$PATH"
      } >>"$fish_config"

      echo "Added \"$path_entry\" to \$PATH in: ${fish_config}"
      refresh_command="source ${fish_config}"
    else
      echo "Manually add to ${fish_config} (or similar):"
      echo "  set --export PATH \"$path_entry\" \$PATH"
    fi
    ;;
  zsh)
    zsh_config="$HOME/.zshrc"
    if [[ -f "$zsh_config" ]] && grep -qsF "$path_entry" "$zsh_config"; then
      echo "PATH already configured in: ${zsh_config}"
      refresh_command="exec $SHELL"
    elif [[ ( -e "$zsh_config" && -w "$zsh_config" ) || ( ! -e "$zsh_config" && -w "${zsh_config%/*}" ) ]]; then
      {
        echo -e '\n# opentp'
        echo "export PATH=\"$path_entry:\$PATH\""
      } >>"$zsh_config"

      echo "Added \"$path_entry\" to \$PATH in: ${zsh_config}"
      refresh_command="exec $SHELL"
    else
      echo "Manually add to ${zsh_config} (or similar):"
      echo "  export PATH=\"$path_entry:\$PATH\""
    fi
    ;;
  bash)
    bash_configs=(
      "$HOME/.bash_profile"
      "$HOME/.bashrc"
    )

    if [[ -n ${XDG_CONFIG_HOME:-} ]]; then
      bash_configs+=(
        "$XDG_CONFIG_HOME/.bash_profile"
        "$XDG_CONFIG_HOME/.bashrc"
        "$XDG_CONFIG_HOME/bash_profile"
        "$XDG_CONFIG_HOME/bashrc"
      )
    fi

    already_set=false
    for bash_config in "${bash_configs[@]}"; do
      if [[ -f "$bash_config" ]] && grep -qsF "$path_entry" "$bash_config"; then
        echo "PATH already configured in: ${bash_config}"
        refresh_command="source ${bash_config}"
        already_set=true
        break
      fi
    done

    if [[ "$already_set" = true ]]; then
      :
    else
      set_manually=true
      for bash_config in "${bash_configs[@]}"; do
        if [[ ( -e "$bash_config" && -w "$bash_config" ) || ( ! -e "$bash_config" && -w "${bash_config%/*}" ) ]]; then
          {
            echo -e '\n# opentp'
            echo "export PATH=\"$path_entry:\$PATH\""
          } >>"$bash_config"

          echo "Added \"$path_entry\" to \$PATH in: ${bash_config}"
          refresh_command="source ${bash_config}"
          set_manually=false
          break
        fi
      done

      if [[ $set_manually = true ]]; then
        echo "Manually add to ~/.bashrc (or similar):"
        echo "  export PATH=\"$path_entry:\$PATH\""
      fi
    fi
    ;;
  *)
    echo "Manually add to your shell config (e.g. ~/.zshrc):"
    echo "  export PATH=\"$path_entry:\$PATH\""
    ;;
esac

echo
echo "To get started, run:"
echo
if [[ -n "$refresh_command" ]]; then
  echo "  $refresh_command"
fi
echo "  opentp version"
