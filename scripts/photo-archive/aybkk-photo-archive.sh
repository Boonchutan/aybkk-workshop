#!/bin/bash
# AYBKK photo archive (Boonchu, 18 Oct 2026). Runs on Boonchu's Mac, once a week:
# copies the class-photo day folders older than 30 days from Google Drive to the
# Kingston SSD and checks that every file arrived (same count, same bytes).
# A Drive folder is moved to Drive's trash (kept there 30 days) only from the third
# run on, and only if the SSD copy was already checked in an earlier run and checks
# out again now. Installed by install.sh; runs Sundays 10:00, or when the SSD is
# plugged in later that week. Manual run: bash aybkk-photo-archive.sh --now
set -u

APP_DIR="$HOME/Library/Application Support/aybkk-photo-archive"
CONF="$HOME/.aybkk-photo-archive.conf"
LOG="${AYBKK_LOG:-$HOME/Library/Logs/aybkk-photo-archive.log}"
KEEP_DAYS=30
SSD_NAME=""
[ -f "$CONF" ] && . "$CONF"
STATE_DIR="${AYBKK_STATE_DIR:-$APP_DIR}"
mkdir -p "$STATE_DIR" "$(dirname "$LOG")"

log() { echo "$(date '+%Y-%m-%d %H:%M') $*" | tee -a "$LOG"; }
notify() {
  log "NOTICE: $1"
  command -v osascript >/dev/null && osascript -e "display notification \"$1\" with title \"AYBKK photo archive\"" >/dev/null 2>&1
}

# Google Drive for desktop shows "Daily Class Photos/Videos" with the slash as ':' in the shell.
find_src() {
  local g
  for g in "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive"/AYBKK/02_Shala_BKK/"Daily Class Photos"*/photos \
           /Volumes/GoogleDrive*/"My Drive"/AYBKK/02_Shala_BKK/"Daily Class Photos"*/photos; do
    [ -d "$g" ] && { echo "$g"; return 0; }
  done
  return 1
}

# "16Oct26", "3 Oct 2026", "12Oct26 Led Primary" -> 20261016 (same rule as the photo tagger).
folder_ymd() {
  local re='^([0-9]{1,2}) ?([A-Za-z]{3})[A-Za-z]* ?([0-9]{4}|[0-9]{2})([^0-9]|$)' d m y
  [[ $1 =~ $re ]] || return 1
  d=${BASH_REMATCH[1]}; y=${BASH_REMATCH[3]}
  m=$(echo "${BASH_REMATCH[2]}" | tr 'A-Z' 'a-z')
  case $m in
    jan) m=01;; feb) m=02;; mar) m=03;; apr) m=04;; may) m=05;; jun) m=06;;
    jul) m=07;; aug) m=08;; sep) m=09;; oct) m=10;; nov) m=11;; dec) m=12;; *) return 1;;
  esac
  [ ${#y} -eq 2 ] && y="20$y"
  printf '%s%s%02d\n' "$y" "$m" "$((10#$d))"
}

days_ago() { date -v-"$1"d +%Y%m%d 2>/dev/null || date -d "$1 days ago" +%Y%m%d; }
if stat -f %z / >/dev/null 2>&1; then STAT=(stat -f %z); else STAT=(stat -c %s); fi
# "<files> <bytes>" of a folder, ignoring Finder litter.
sig() { find "$1" -type f ! -name '.DS_Store' ! -name '._*' -exec "${STAT[@]}" {} + 2>/dev/null | awk '{n++; s+=$1} END {printf "%d %d\n", n, s}'; }

# Day folders older than the cutoff, as paths relative to the photos folder
# (directly inside it, or one level down, e.g. RAW/16Oct26).
list_old() {
  local e name sub ymd
  for e in "$SRC"/*/; do
    [ -d "$e" ] || continue
    e=${e%/}; name=${e##*/}
    if ymd=$(folder_ymd "$name"); then
      [ "$ymd" -lt "$CUTOFF" ] && echo "$name"
    else
      for sub in "$e"/*/; do
        [ -d "$sub" ] || continue
        sub=${sub%/}
        ymd=$(folder_ymd "${sub##*/}") && [ "$ymd" -lt "$CUTOFF" ] && echo "$name/${sub##*/}"
      done
    fi
  done
}

MODE=${1:-}
TODAY=$(date +%Y%m%d)
WEEK=$(date +%G-%V)
CUTOFF=$(days_ago "$KEEP_DAYS")

# Once a week: Sunday 10:00, or the first time the SSD shows up after that.
if [ "$MODE" != "--now" ] && [ "$(cat "$STATE_DIR/last_week" 2>/dev/null)" = "$WEEK" ]; then exit 0; fi

SSD=""
if [ -n "${AYBKK_SSD:-}" ]; then SSD=$AYBKK_SSD
elif [ -n "$SSD_NAME" ] && [ -d "/Volumes/$SSD_NAME" ]; then SSD="/Volumes/$SSD_NAME"
fi
if [ -z "$SSD" ]; then
  # Only nag on Sunday from 10:00, once a day; plugging in later still runs it.
  if [ "$(date +%u)" = 7 ] && [ "$(date +%H)" -ge 10 ] && [ "$(cat "$STATE_DIR/nagged" 2>/dev/null)" != "$TODAY" ]; then
    echo "$TODAY" > "$STATE_DIR/nagged"
    notify "Plug in the Kingston SSD. The photo archive runs as soon as it is in."
  fi
  exit 0
fi

SRC="${AYBKK_SRC:-$(find_src)}"
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  notify "Cannot find the class photos in Google Drive. Is Google Drive for desktop open and signed in?"
  exit 1
fi
if ! ls "$SRC" >/dev/null 2>&1 || ! touch "$SSD/.aybkk-write-test" 2>/dev/null; then
  notify "No permission. Give Full Disk Access to /bin/bash (System Settings, Privacy & Security)."
  exit 1
fi
rm -f "$SSD/.aybkk-write-test"
DEST="$SSD/AYBKK Photos"
mkdir -p "$DEST"

log "Run $WEEK: Drive $SRC -> $DEST, folders before $CUTOFF"
RUNS=$(cat "$STATE_DIR/runs" 2>/dev/null || echo 0)
VERIFIED="$STATE_DIR/verified.tsv"; touch "$VERIFIED"
copied=0; trashed=0; failed=0; bytes=0

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  src_sig=$(sig "$SRC/$rel")
  if [ "${src_sig%% *}" = 0 ]; then log "skip $rel: empty"; continue; fi
  need=${src_sig##* }
  free=$(( $(df -Pk "$SSD" | awk 'NR==2 {print $4}') * 1024 ))
  if [ "$(sig "$DEST/$rel" 2>/dev/null)" != "$src_sig" ] && [ "$need" -ge "$free" ]; then
    notify "The SSD is full. $rel was not copied."; failed=$((failed+1)); break
  fi
  mkdir -p "$DEST/$rel"
  if command -v rsync >/dev/null; then
    rsync -a --exclude ".DS_Store" --exclude "._*" "$SRC/$rel/" "$DEST/$rel/" </dev/null >>"$LOG" 2>&1
  else
    cp -Rp "$SRC/$rel/." "$DEST/$rel/" >>"$LOG" 2>&1
  fi
  if [ "$(sig "$DEST/$rel")" != "$src_sig" ]; then
    log "FAIL $rel: Drive $src_sig, SSD $(sig "$DEST/$rel")"; failed=$((failed+1)); continue
  fi
  copied=$((copied+1)); bytes=$((bytes+need))
  first=$(awk -F'\t' -v r="$rel" '$1==r {print $2; exit}' "$VERIFIED")
  if [ -z "$first" ]; then
    printf '%s\t%s\n' "$rel" "$TODAY" >> "$VERIFIED"
    log "ok $rel: ${src_sig%% *} files on the SSD (Drive copy stays until a later run)"
  elif [ "$RUNS" -ge 2 ] && [ "$first" -le "$(days_ago 6)" ]; then
    case $rel in ""|/*|*..*) continue;; esac
    rm -rf "${SRC:?}/$rel" && trashed=$((trashed+1)) && log "trash $rel: on the SSD since $first, checked again today"
  else
    log "ok $rel: still on the SSD (first checked $first)"
  fi
done < <(list_old)

[ "$failed" = 0 ] && { echo "$WEEK" > "$STATE_DIR/last_week"; echo $((RUNS+1)) > "$STATE_DIR/runs"; }
gb=$(awk -v b="$bytes" 'BEGIN {printf "%.1f", b/1073741824}')
msg="Checked $copied old folders on the SSD ($gb GB). Moved $trashed to Drive trash."
[ "$failed" -gt 0 ] && msg="$msg $failed had a problem, see the log."
[ "$RUNS" -lt 2 ] && msg="$msg Copy only for the first 2 weeks."
notify "$msg"
