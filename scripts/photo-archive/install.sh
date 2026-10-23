#!/bin/bash
# Installs the AYBKK photo archive on Boonchu's Mac (run once, in Terminal):
#   curl -fsSL https://raw.githubusercontent.com/Boonchutan/aybkk-workshop/main/scripts/photo-archive/install.sh | bash
# Remove it again:  ... | bash -s -- --uninstall
set -u
BASE="${AYBKK_BASE:-https://raw.githubusercontent.com/Boonchutan/aybkk-workshop/main/scripts/photo-archive}"
APP_DIR="$HOME/Library/Application Support/aybkk-photo-archive"
SCRIPT="$APP_DIR/aybkk-photo-archive.sh"
PLIST="$HOME/Library/LaunchAgents/net.aybkk.photo-archive.plist"
CONF="$HOME/.aybkk-photo-archive.conf"
LABEL=net.aybkk.photo-archive

[ "$(uname)" = Darwin ] || { echo "This is for the Mac only."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST" "$SCRIPT"
  echo "Removed. The photos already on the SSD stay there."
  exit 0
fi

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
here="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)"
if [ -f "$here/aybkk-photo-archive.sh" ]; then cp "$here/aybkk-photo-archive.sh" "$SCRIPT"
else curl -fsSL "$BASE/aybkk-photo-archive.sh" -o "$SCRIPT" || { echo "Download failed."; exit 1; }
fi
chmod +x "$SCRIPT"

# The class photos in Google Drive for desktop.
src=""
for g in "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive"/AYBKK/02_Shala_BKK/"Daily Class Photos"*/photos \
         /Volumes/GoogleDrive*/"My Drive"/AYBKK/02_Shala_BKK/"Daily Class Photos"*/photos; do
  [ -d "$g" ] && { src=$g; break; }
done
if [ -z "$src" ]; then
  echo "I cannot find My Drive > AYBKK > 02_Shala_BKK > Daily Class Photos/Videos > photos."
  echo "Open Google Drive for desktop, sign in as boonchutan, wait until My Drive shows in Finder, then run this again."
  exit 1
fi
echo "Class photos: $src"

# The SSD: a volume with "kingston" in its name, or ask.
ssd=""
n=0
for v in /Volumes/*; do
  case "$(echo "${v##*/}" | tr 'A-Z' 'a-z')" in *kingston*) ssd=${v##*/}; n=$((n+1));; esac
done
if [ "$n" != 1 ]; then
  echo "Plug in the Kingston SSD. These drives are connected now:"
  for v in /Volumes/*; do echo "  ${v##*/}"; done
  printf "Type the SSD's name exactly as shown: "
  read -r ssd </dev/tty
fi
[ -n "$ssd" ] && [ -d "/Volumes/$ssd" ] || { echo "No drive called '$ssd'. Plug it in and run this again."; exit 1; }
printf 'SSD_NAME=%q\n' "$ssd" > "$CONF"
echo "SSD: /Volumes/$ssd (photos go to the folder 'AYBKK Photos')"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>WatchPaths</key><array><string>/Volumes</string></array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/aybkk-photo-archive.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/aybkk-photo-archive.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
echo "Scheduled: Sundays 10:00, or when the SSD is plugged in later that week."

echo
echo "First run now (copy only, nothing leaves Drive). Big folders take a while..."
/bin/bash "$SCRIPT" --now
echo
echo "Done. Log: ~/Library/Logs/aybkk-photo-archive.log"
echo "If the log says 'Operation not permitted' when it runs by itself: System Settings >"
echo "Privacy & Security > Full Disk Access > + > press Cmd+Shift+G > type /bin/bash > Open."
