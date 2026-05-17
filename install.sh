#!/usr/bin/env bash
# install.sh — install or update agent-skills-agentteams.
#
# Clones (or fast-forwards) the repo into $AGENTTEAMS_KIT_HOME and symlinks each
# skill under .agents/skills/<name>/ into ~/.claude/skills/<name> so Claude Code
# (and any other agent runtime that reads ~/.claude/skills/*/SKILL.md) can
# discover them.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --ref=v0.1.0
#   curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --prefix="$HOME/code/agent-skills-agentteams"
#   curl -fsSL https://raw.githubusercontent.com/carlosmarte/agent-skills-agentteams/main/install.sh | bash -s -- --status
#
# Env-var equivalents: AGENTTEAMS_KIT_HOME, AGENTTEAMS_KIT_REF,
#                      AGENTTEAMS_KIT_LINK_DIR, AGENTTEAMS_KIT_RUN,
#                      AGENTTEAMS_KIT_REPO.

set -euo pipefail

REPO_URL_DEFAULT="https://github.com/carlosmarte/agent-skills-agentteams.git"
HOME_DEFAULT="${HOME}/.agent-skills-agentteams"
SKILLS_LINK_DIR_DEFAULT="${HOME}/.claude/skills"

REPO_URL="${AGENTTEAMS_KIT_REPO:-$REPO_URL_DEFAULT}"
KIT_HOME="${AGENTTEAMS_KIT_HOME:-$HOME_DEFAULT}"
KIT_REF="${AGENTTEAMS_KIT_REF:-main}"
SKILLS_LINK_DIR="${AGENTTEAMS_KIT_LINK_DIR:-$SKILLS_LINK_DIR_DEFAULT}"
DO_RUN="${AGENTTEAMS_KIT_RUN:-0}"
DO_STATUS=0
DO_ALL=0

# ── arg parsing ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --prefix=*)        KIT_HOME="${arg#*=}" ;;
    --ref=*)           KIT_REF="${arg#*=}" ;;
    --link-dir=*)      SKILLS_LINK_DIR="${arg#*=}" ;;
    --repo=*)          REPO_URL="${arg#*=}" ;;
    --run)             DO_RUN=1 ;;
    --status)          DO_STATUS=1 ;;
    --all)             DO_ALL=1 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      printf 'install.sh: unknown argument: %s\n' "$arg" >&2
      exit 2 ;;
  esac
done

log() { printf '[agent-skills-agentteams] %s\n' "$*"; }

# ── status mode ───────────────────────────────────────────────────────────────
if [ "$DO_STATUS" = 1 ]; then
  log "KIT_HOME         = $KIT_HOME"
  log "SKILLS_LINK_DIR  = $SKILLS_LINK_DIR"
  if [ -d "$KIT_HOME/.git" ]; then
    cur_ref="$(git -C "$KIT_HOME" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    cur_sha="$(git -C "$KIT_HOME" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    log "checkout         = $cur_ref @ $cur_sha"
  else
    log "checkout         = (not installed)"
  fi
  if [ -d "$SKILLS_LINK_DIR" ]; then
    linked_count=$(find "$SKILLS_LINK_DIR" -maxdepth 1 -type l -lname "*${KIT_HOME#$HOME/}*" 2>/dev/null | wc -l | tr -d ' ')
    log "skills linked    = $linked_count under $SKILLS_LINK_DIR"
  else
    log "skills linked    = 0 (link dir does not exist)"
  fi
  exit 0
fi

# ── dependency check ──────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  printf 'install.sh: git is required but not on PATH. Install Xcode CLI tools or Homebrew git first.\n' >&2
  exit 1
fi

# ── clone or update ───────────────────────────────────────────────────────────
if [ -d "$KIT_HOME/.git" ]; then
  log "updating existing checkout at $KIT_HOME"
  git -C "$KIT_HOME" fetch --tags --quiet origin
else
  if [ -e "$KIT_HOME" ]; then
    printf 'install.sh: %s exists and is not a git checkout — refusing to overwrite.\n' "$KIT_HOME" >&2
    exit 1
  fi
  log "cloning $REPO_URL → $KIT_HOME"
  git clone --quiet "$REPO_URL" "$KIT_HOME"
fi

log "checking out ref: $KIT_REF"
git -C "$KIT_HOME" checkout --quiet "$KIT_REF"
if git -C "$KIT_HOME" symbolic-ref -q HEAD >/dev/null; then
  git -C "$KIT_HOME" pull --quiet --ff-only origin "$KIT_REF" || true
fi

# ── symlink skills ────────────────────────────────────────────────────────────
mkdir -p "$SKILLS_LINK_DIR"
linked=0
skipped=0
for skill_dir in "$KIT_HOME"/.agents/skills/*/; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  name="$(basename "$skill_dir")"
  target="$SKILLS_LINK_DIR/$name"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    log "skip $name — $target exists and is not a symlink"
    skipped=$((skipped + 1))
    continue
  fi
  ln -s "${skill_dir%/}" "$target"
  linked=$((linked + 1))
done
log "linked $linked skill(s) into $SKILLS_LINK_DIR (skipped $skipped)"

# ── post-install: optional run hook ───────────────────────────────────────────
if [ "$DO_RUN" = 1 ] || [ "$DO_ALL" = 1 ]; then
  if command -v node >/dev/null 2>&1; then
    log "running: acceptance-gate.mjs"
    node "$KIT_HOME/.agents/skills/agentteams/scripts/acceptance-gate.mjs" || true
  else
    log "node not on PATH — skipping acceptance-gate run. Install Node 20+ and re-run with --run."
  fi
fi

log "done. Next steps:"
log "  • Restart Claude Code to pick up newly-linked skills."
log "  • cd $KIT_HOME && make install   # install mjs + py runtimes"
log "  • cd $KIT_HOME && make ci        # full install + test + parity + gate"
log "  • Re-run this installer any time to update (idempotent)."
