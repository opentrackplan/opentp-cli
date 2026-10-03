#!/usr/bin/env bash
set -euo pipefail

# OpenTrackPlan installer (macOS / Linux).
#
# Installs the latest GitHub release of the opentp binary into ~/.opentp/bin.
#
# Environment variables (all optional; set them on `bash`, not on `curl`):
#   OPENTP_VERSION        Pin a release, e.g. 0.7.4 (a leading "v" is accepted). Default: latest.
#   OPENTP_DOWNLOAD_BASE  Base URL that holds the release assets, i.e. the ".../releases/download"
#                         URL of a GitHub-compatible mirror.
#                         Default: https://github.com/opentrackplan/opentp-cli/releases/download
#                           pinned: ${OPENTP_DOWNLOAD_BASE}/v${OPENTP_VERSION}/<asset>
#                           latest: the tag is read once from the redirect of
#                                   ${OPENTP_DOWNLOAD_BASE%/download}/latest/download/<asset>,
#                                   then the install continues as if that version were pinned
#                         "latest" needs a base that ends with /releases/download (GitHub and
#                         GitHub Enterprise layout); with any other base, set OPENTP_VERSION.
#
# The binary is checked against the SHA256SUMS file of the same release. Only releases up to 0.7.4,
# which predate SHA256SUMS, are installed without it (with a warning); for any later release a
# missing SHA256SUMS, a missing entry or a checksum mismatch aborts the install.
#
# Examples:
#   curl -fsSL https://opentp.dev/install | bash
#   curl -fsSL https://opentp.dev/install | OPENTP_VERSION=0.7.4 bash
#   curl -fsSL https://opentp.dev/install | \
#     OPENTP_DOWNLOAD_BASE="https://github.mycompany.com/org/opentp-cli/releases/download" bash

DEFAULT_DOWNLOAD_BASE="https://github.com/opentrackplan/opentp-cli/releases/download"
OPENTP_VERSION="${OPENTP_VERSION:-}"
OPENTP_DOWNLOAD_BASE="${OPENTP_DOWNLOAD_BASE:-$DEFAULT_DOWNLOAD_BASE}"

# Windows detection - redirect to PowerShell (environment variables are inherited)
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

warn() {
  echo "warning: $*" >&2
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

# Releases up to v0.7.4 were published without SHA256SUMS
predates_sha256sums() {
  local major minor patch
  IFS=. read -r major minor patch <<<"${1%%[-+]*}"
  (( 10#$major == 0 && (10#$minor < 7 || (10#$minor == 7 && 10#$patch <= 4)) ))
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    return 1
  fi
}

need_cmd uname
need_cmd mktemp
need_cmd mkdir
need_cmd chmod
need_cmd mv
need_cmd curl
need_cmd grep
need_cmd awk
need_cmd tr

os="$(uname -s)"
arch="$(uname -m)"

asset=""
case "$os" in
  Darwin)
    # A shell running under Rosetta reports x86_64 on Apple Silicon: install the native binary
    if [[ "$arch" == x86_64 && "$(/usr/sbin/sysctl -n sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then
      echo "Running under Rosetta on Apple Silicon: installing the native arm64 binary"
      arch=arm64
    fi
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

download_base="${OPENTP_DOWNLOAD_BASE%/}"
version="${OPENTP_VERSION#v}"
version_pattern='^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$'
if [[ "$version" = latest ]]; then
  version=""
fi

if [[ -n "$version" ]]; then
  [[ "$version" =~ $version_pattern ]] ||
    error "Invalid OPENTP_VERSION: '${OPENTP_VERSION}' (expected e.g. 0.7.4)"
  release_label="${version}"
elif [[ "$download_base" == */releases/download ]]; then
  # Resolve the tag once and download the binary and SHA256SUMS from that release. Two separate
  # .../latest/download/ requests could reach two different releases if one is published in between.
  latest_url="${download_base%/download}/latest/download/${asset}"
  latest="$(curl --silent --show-error --output /dev/null --write-out '%{http_code} %{redirect_url}' "$latest_url")" ||
    error "Could not resolve the latest release from ${latest_url}"
  read -r latest_status latest_redirect <<<"$latest"
  latest_tag="${latest_redirect%/*}"
  latest_tag="${latest_tag##*/}"
  if [[ "$latest_redirect" != */"$asset" || ! "${latest_tag#v}" =~ $version_pattern || "$latest_tag" != v* ]]; then
    error "Could not resolve the latest release from ${latest_url} (HTTP ${latest_status}${latest_redirect:+, redirect to ${latest_redirect}}). Set OPENTP_VERSION to pin a release."
  fi
  version="${latest_tag#v}"
  release_label="${version} (latest release)"
else
  error "Cannot resolve the latest release from OPENTP_DOWNLOAD_BASE=${OPENTP_DOWNLOAD_BASE} (it does not end with /releases/download). Set OPENTP_VERSION to pin a release."
fi

release_url="${download_base}/v${version}"
url="${release_url}/${asset}"
sums_url="${release_url}/SHA256SUMS"

tmp="$(mktemp "${TMPDIR:-/tmp}/opentp.XXXXXX")"
sums_tmp="$(mktemp "${TMPDIR:-/tmp}/opentp-sums.XXXXXX")"
cleanup() { rm -f "$tmp" "$sums_tmp" 2>/dev/null || true; }
trap cleanup EXIT

echo "Downloading ${url}"
curl_args=(--fail --location --show-error --output "$tmp")
if [[ -t 1 ]]; then
  curl_args+=(--progress-bar)
else
  curl_args+=(--silent)
fi
curl "${curl_args[@]}" "$url" || error "Could not download ${url}"

# Without --fail, so a missing file (older releases) can be told apart from other errors.
sums_status="$(curl --location --silent --show-error --output "$sums_tmp" --write-out '%{http_code}' "$sums_url")" ||
  error "Could not download ${sums_url}. Nothing was installed."

case "$sums_status" in
  200)
    expected="$(awk -v name="$asset" '{ file = $2; sub(/^\*/, "", file); if (file == name) { print $1; exit } }' "$sums_tmp" | tr '[:upper:]' '[:lower:]')"
    [[ -n "$expected" ]] || error "SHA256SUMS has no entry for ${asset} (${sums_url}). Nothing was installed."
    actual="$(sha256_of "$tmp" | tr '[:upper:]' '[:lower:]')" || actual=""
    if [[ -z "$actual" ]]; then
      warn "Neither sha256sum nor shasum is available; skipping checksum verification."
    elif [[ "$actual" != "$expected" ]]; then
      error "Checksum mismatch for ${asset}: expected ${expected}, got ${actual}. Nothing was installed."
    else
      echo "Verified SHA-256 checksum of ${asset}"
    fi
    ;;
  403 | 404 | 410)
    if predates_sha256sums "$version"; then
      warn "Release ${version} predates SHA256SUMS; skipping checksum verification."
    else
      error "${sums_url} is missing (HTTP ${sums_status}), although every release after 0.7.4 publishes it. The release may still be uploading its assets, or the mirror is incomplete. Nothing was installed."
    fi
    ;;
  *)
    error "Could not download ${sums_url} (HTTP ${sums_status}). Nothing was installed."
    ;;
esac

# Only now that the binary is verified: an aborted install leaves no empty directory behind
mkdir -p "$INSTALL_DIR"
chmod +x "$tmp"
mv -f "$tmp" "$INSTALL_PATH"

echo "Installed opentp ${release_label} to ${INSTALL_PATH}"
installed_version="$("$INSTALL_PATH" --version 2>/dev/null | head -n 1)" || installed_version=""
if [[ -n "$installed_version" ]]; then
  echo "  ${installed_version}"
fi

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
