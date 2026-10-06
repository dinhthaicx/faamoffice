#!/bin/sh
# deb/rpm post-install: expose the faamoffice command line shipped inside the app.
# Only an absent name, a dead link or a link into our own install dir is taken
# over; anything else at /usr/bin/faamoffice belongs to another program (genoffice#893).
set -e
launcher="/opt/FaamOffice/resources/cli/faamoffice"
link="/usr/bin/faamoffice"
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    /opt/FaamOffice/*) ;;
    *) [ -e "$link" ] && { echo "faamoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "faamoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0
