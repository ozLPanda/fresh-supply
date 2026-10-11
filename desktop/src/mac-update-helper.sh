#!/bin/sh
# All paths are argv values from the application, never interpolated shell source.
set -u
parent_pid=$1
task=$2
target=$3
staged=$4
old=$5
log=$6
open_command=$7
wait_seconds=$8
startup_seconds=$9
archive=${10}
journal=${11}
clear_journal() {
  if [ -f "$task/install" ]; then /bin/rm -f "$journal"; fi
}
exec >> "$log" 2>&1
printf '%s\n' 'ready' > "$task/ready"
remaining=$wait_seconds
while [ ! -f "$task/install" ]; do
  if [ -f "$task/cancel" ] || [ "$remaining" -le 0 ]; then
    /bin/rm -rf "$task"
    exit 0
  fi
  /bin/sleep 1
  remaining=$((remaining - 1))
done
printf '%s\n' 'accepted' > "$task/accepted"
remaining=$wait_seconds
while kill -0 "$parent_pid" 2>/dev/null; do
  if [ -f "$task/cancel" ] || [ "$remaining" -le 0 ]; then
    printf '%s\n' 'Installation cancelled: application did not close.'
    clear_journal
    /bin/rm -rf "$task"
    exit 0
  fi
  /bin/sleep 1
  remaining=$((remaining - 1))
done
if [ -f "$task/cancel" ]; then
  clear_journal
  /bin/rm -rf "$task"
  exit 0
fi
if ! /bin/mv "$target" "$old"; then
  printf '%s\n' 'Could not move the previous application. It remains installed.'
  clear_journal
  "$open_command" -n "$target"
  /bin/rm -rf "$task"
  exit 1
fi
if ! /bin/mv "$staged" "$target"; then
  printf '%s\n' 'Could not activate update. Restoring the previous application.'
  if /bin/mv "$old" "$target"; then
    clear_journal
    "$open_command" -n "$target"
    /bin/rm -rf "$task"
  else
    printf 'Previous application preserved at: %s\n' "$old"
  fi
  exit 1
fi
if ! "$open_command" -n "$target"; then
  printf '%s\n' 'System refused to launch update. Restoring the previous application.'
  if /bin/mv "$target" "$staged" && /bin/mv "$old" "$target"; then
    clear_journal
    "$open_command" -n "$target"
    /bin/rm -rf "$task"
  else
    printf 'Previous application preserved at: %s\n' "$old"
  fi
  exit 1
fi
printf '%s\n' 'Update installed; relaunch requested.'
if [ -n "$archive" ]; then
  /bin/rm -f "$archive"
  /bin/rmdir "$(/usr/bin/dirname "$archive")" 2>/dev/null || true
fi
remaining=$startup_seconds
while [ ! -f "$task/new-app-ready" ]; do
  if [ ! -d "$task" ]; then exit 0; fi
  if [ "$remaining" -le 0 ]; then
    printf 'New application readiness not confirmed. Previous application preserved at: %s\n' "$old"
    exit 0
  fi
  /bin/sleep 1
  remaining=$((remaining - 1))
done
printf '%s\n' 'New application runtime confirmed healthy.'
/bin/rm -rf "$task"
