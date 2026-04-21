#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-tsosunchia/iNetSpeed-CLI}"
DEFAULT_BINARY="speedtest"
RELEASE_BINARY="speedtest"
BINARY_ENV_SET=0
if [[ "${BINARY+x}" == x ]]; then
  BINARY_ENV_SET=1
fi
BINARY_ENV_VALUE="${BINARY-}"
BINARY=""
RELEASE_BASE="${RELEASE_BASE:-https://github.com/${REPO}/releases/latest/download}"
RELEASES_URL="${RELEASES_URL:-https://github.com/${REPO}/releases/latest}"

if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
  C_RESET=$'\033[0m'
  C_BLUE=$'\033[34m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=''
  C_BLUE=''
  C_YELLOW=''
  C_RED=''
fi

log() {
  printf '%b==>%b %s\n' "$C_BLUE" "$C_RESET" "$1"
}

warn() {
  printf '%bWarning:%b %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2
}

die() {
  printf '%bError:%b %s\n' "$C_RED" "$C_RESET" "$1" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

normalize_binary() {
  local value="$1"
  local normalized
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    speedtest|inetspeed)
      BINARY="$normalized"
      ;;
    *)
      die "BINARY must be speedtest or inetspeed."
      ;;
  esac
}

choose_binary() {
  local choice normalized

  if (( BINARY_ENV_SET )); then
    normalize_binary "${BINARY_ENV_VALUE}"
    return
  fi

  if [[ -t 1 ]] && exec 3<> /dev/tty 2>/dev/null; then
    while true; do
      printf 'Install command name [1] speedtest [2] inetspeed (Enter=1): ' >&3
      if ! IFS= read -r choice <&3; then
        printf '\n' >&3
        exec 3>&-
        exec 3<&-
        BINARY="${DEFAULT_BINARY}"
        return
      fi
      normalized="$(printf '%s' "$choice" | tr '[:upper:]' '[:lower:]')"
      case "$normalized" in
        ""|"1"|speedtest)
          exec 3>&-
          exec 3<&-
          BINARY="speedtest"
          return
          ;;
        "2"|inetspeed)
          exec 3>&-
          exec 3<&-
          BINARY="inetspeed"
          return
          ;;
        *)
          printf 'Please enter 1, 2, speedtest, or inetspeed.\n' >&3
          ;;
      esac
    done
  fi

  if [[ -t 0 && -t 1 ]]; then
    while true; do
      printf 'Install command name [1] speedtest [2] inetspeed (Enter=1): '
      if ! IFS= read -r choice; then
        BINARY="${DEFAULT_BINARY}"
        return
      fi
      normalized="$(printf '%s' "$choice" | tr '[:upper:]' '[:lower:]')"
      case "$normalized" in
        ""|"1"|speedtest)
          BINARY="speedtest"
          return
          ;;
        "2"|inetspeed)
          BINARY="inetspeed"
          return
          ;;
        *)
          printf 'Please enter 1, 2, speedtest, or inetspeed.\n'
          ;;
      esac
    done
  fi

  BINARY="${DEFAULT_BINARY}"
}

download() {
  local url="$1"
  local output="$2"
  if has_cmd curl; then
    curl -fsSL --retry 3 --connect-timeout 10 -o "$output" "$url"
    return
  fi
  if has_cmd wget; then
    wget -qO "$output" "$url"
    return
  fi
  die "curl or wget is required."
}

detect_platform() {
  local os arch ext
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux) os="linux"; ext="tar.gz" ;;
    Darwin) os="darwin"; ext="tar.gz" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT*)
      die "Use scripts/install.ps1 on Windows: ${RELEASES_URL}"
      ;;
    *)
      die "unsupported OS: ${os}"
      ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      die "unsupported architecture: ${arch}"
      ;;
  esac

  printf '%s/%s/%s\n' "$os" "$arch" "$ext"
}

choose_install_dir() {
  if [[ -n "${INSTALL_DIR:-}" ]]; then
    printf '%s\n' "${INSTALL_DIR}"
    return
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    printf '%s\n' "/usr/local/bin"
    return
  fi
  if path_has_dir "${HOME}/.local/bin"; then
    printf '%s\n' "${HOME}/.local/bin"
    return
  fi
  if path_has_dir "${HOME}/bin"; then
    printf '%s\n' "${HOME}/bin"
    return
  fi
  printf '%s\n' "${HOME}/.local/bin"
}

verify_checksum() {
  local file="$1"
  local checksum_file="$2"
  local asset="$3"
  local expected actual

  expected="$(awk -v asset="$asset" '$2 == asset { print $1; exit }' "$checksum_file")"
  [[ -n "$expected" ]] || die "checksum for ${asset} not found."

  if has_cmd sha256sum; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  elif has_cmd shasum; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    die "sha256sum or shasum is required."
  fi

  [[ "$actual" == "$expected" ]] || die "checksum mismatch for ${asset}"
}

path_has_dir() {
  local target="$1"
  local item
  IFS=':' read -r -a path_dirs <<< "${PATH:-}"
  for item in "${path_dirs[@]}"; do
    [[ "$item" == "$target" ]] && return 0
  done
  return 1
}

cleanup() {
  local dir="${1:-}"
  if [[ -n "$dir" ]]; then
    rm -rf -- "$dir"
  fi
}

choose_shell_rc() {
  case "${SHELL##*/}" in
    zsh)
      printf '%s\n' "${HOME}/.zshrc"
      ;;
    bash)
      if [[ -f "${HOME}/.bashrc" || ! -f "${HOME}/.bash_profile" ]]; then
        printf '%s\n' "${HOME}/.bashrc"
      else
        printf '%s\n' "${HOME}/.bash_profile"
      fi
      ;;
    *)
      printf '%s\n' "${HOME}/.profile"
      ;;
  esac
}

ensure_user_path() {
  local dir="$1"
  local rc_file export_line

  if path_has_dir "$dir"; then
    return 0
  fi
  if [[ -n "${INSTALL_DIR:-}" || "$(id -u)" -eq 0 ]]; then
    warn "install dir is not in PATH: ${dir}"
    return 1
  fi

  rc_file="$(choose_shell_rc)"
  export_line="export PATH=\"${dir}:\$PATH\""
  mkdir -p "$(dirname "${rc_file}")"
  touch "${rc_file}"
  if ! grep -Fqx "${export_line}" "${rc_file}"; then
    {
      printf '\n'
      printf '# Added by iNetSpeed-CLI installer\n'
      printf '%s\n' "${export_line}"
    } >> "${rc_file}"
    warn "added ${dir} to PATH in ${rc_file}; open a new shell to use it."
  fi
  export PATH="${dir}:${PATH:-}"
  return 0
}

main() {
  local platform os arch ext asset archive_path sum_path tmpdir install_dir target extracted run_hint
  choose_binary
  IFS='/' read -r os arch ext <<< "$(detect_platform)"
  asset="${RELEASE_BINARY}-${os}-${arch}.${ext}"

  tmpdir="$(mktemp -d)"
  trap "cleanup '${tmpdir}'" EXIT
  archive_path="${tmpdir}/${asset}"
  sum_path="${tmpdir}/checksums-sha256.txt"

  log "Command name: ${BINARY}"
  log "Downloading ${asset}"
  download "${RELEASE_BASE}/${asset}" "${archive_path}"

  log "Downloading checksums-sha256.txt"
  download "${RELEASE_BASE}/checksums-sha256.txt" "${sum_path}"

  log "Verifying checksum"
  verify_checksum "${archive_path}" "${sum_path}" "${asset}"

  log "Extracting archive"
  tar -xzf "${archive_path}" -C "${tmpdir}"
  extracted="${tmpdir}/${RELEASE_BINARY}"

  install_dir="$(choose_install_dir)"
  install_dir="${install_dir%/}"
  mkdir -p "${install_dir}"
  [[ -w "${install_dir}" ]] || die "install dir is not writable: ${install_dir}"

  target="${install_dir}/${BINARY}"
  install "${extracted}" "${target}"
  chmod +x "${target}"

  log "Installed to ${target}"
  ensure_user_path "${install_dir}" || true

  if [[ "${install_dir}" == "${PWD}" ]]; then
    run_hint="./${BINARY}"
  elif path_has_dir "${install_dir}"; then
    run_hint="${BINARY}"
  else
    run_hint="${target}"
  fi
  log "Run with: ${run_hint}"
  "${target}" --version || warn "version check failed"
}

main "$@"
