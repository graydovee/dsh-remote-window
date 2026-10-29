#!/usr/bin/env bash
# Install the remote-window server plugin into a per-client DSH profile on
# the QA target, following the offline install contract (no npm/pnpm/network):
#
#   1. create the profile from the shipped web template when missing
#   2. extract <tarball>/package/* into <profile>/node_modules/<plugin-name>
#   3. add the exact plugin version to the profile package.json dependencies and
#      list the package in dsh.profile.bundles (the plugin's own cordis.patch.yml
#      is composed by DSH as the bundle patch; never merged by hand)
#   4. verify the package imports and report the resulting profile layout
#
#   scripts/qa/install-server-plugin.sh [--name server] \
#       --profile graydovee-remote-window-qa1 \
#       --tarball /path/to/dsh-remote-window-server-0.1.0-alpha.3.tgz \
#       [--sha256 <expected>] [--create-profile] [--template web]
#
#   scripts/qa/install-server-plugin.sh --check [--name server] [--profile <p>]
#
# The script never writes outside the container's isolated DSH_HOME.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

NAME="server"
PROFILE=""
TARBALL=""
EXPECTED_SHA=""
MODE="install"
CREATE_PROFILE=0
TEMPLATE="web"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --tarball) TARBALL="$2"; shift 2 ;;
    --sha256) EXPECTED_SHA="$2"; shift 2 ;;
    --create-profile) CREATE_PROFILE=1; shift ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --check) MODE="check"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) qa_die "unknown argument: $1" ;;
  esac
done

QA_NAME="$NAME"
QA_DIR="$QA_ROOT/$NAME"
QA_STATE="$QA_DIR/state.env"
qa_load_state
QA_CONTAINER="${QA_CONTAINER:-dsh-qa-$NAME}"
qa_require_docker
qa_container_require_running

profile_summary() {
  local profile="$1"
  docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
    -e "PROFILE=$profile" "$QA_CONTAINER" bash -lc '
      set -u
      p="$DSH_HOME/profiles/$PROFILE"
      echo "profile: $p"
      if [ ! -d "$p" ]; then echo "  absent"; exit 0; fi
      node -e '"'"'
        const fs=require("fs");
        const j=JSON.parse(fs.readFileSync(process.env.DSH_HOME+"/profiles/"+process.env.PROFILE+"/package.json","utf8"));
        console.log("  bundles: "+(j.dsh?.profile?.bundles??[]).join(", "));
        for (const [name, spec] of Object.entries(j.dependencies ?? {})) console.log("  dep: "+name+"@"+spec);
      '"'"' 2>/dev/null || echo "  (package.json unreadable)"
      echo "  node_modules:"
      ls -1 "$p/node_modules" 2>/dev/null | sed "s/^/    /" || echo "    (none)"
      if [ -d "$p/node_modules/dsh-remote-window-server" ]; then
        echo "  installed plugin files:"
        find "$p/node_modules/dsh-remote-window-server" -maxdepth 2 -type f | sed "s/^/    /"
      fi
    '
}

if [ "$MODE" = "check" ]; then
  [ -n "$PROFILE" ] || qa_die "--check needs --profile"
  profile_summary "$PROFILE"
  echo "--- available profiles ---"
  docker exec -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
    -e "PROFILE=$PROFILE" "$QA_CONTAINER" bash -lc 'ls -1 "$DSH_HOME/profiles" 2>/dev/null | sed "s/^/  /"'
  exit 0
fi

[ -n "$PROFILE" ] || qa_die "--profile is required (e.g. graydovee-remote-window-qa1)"
[ -n "$TARBALL" ] || qa_die "--tarball is required"
[ -f "$TARBALL" ] || qa_die "tarball not found: $TARBALL"

actual_sha="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [ -n "$EXPECTED_SHA" ] && [ "$actual_sha" != "$EXPECTED_SHA" ]; then
  qa_die "sha256 mismatch: expected $EXPECTED_SHA, got $actual_sha"
fi
qa_log "tarball sha256: $actual_sha"

plugin_name="$(tar -xOzf "$TARBALL" package/package.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).name)})')"
plugin_version="$(tar -xOzf "$TARBALL" package/package.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).version)})')"
[ -n "$plugin_name" ] || qa_die "could not read package name from $TARBALL"
qa_log "installing $plugin_name@$plugin_version into profile $PROFILE (offline)"

profile_dir="/home/tester/.dsh/profiles/$PROFILE"
if ! docker exec "$QA_CONTAINER" test -d "$profile_dir"; then
  [ "$CREATE_PROFILE" -eq 1 ] || qa_die "profile $PROFILE is absent; pass --create-profile (template: $TEMPLATE)"
  qa_log "creating profile $PROFILE from template $TEMPLATE"
  docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
    -e "PROFILE=$PROFILE" -e "TEMPLATE=$TEMPLATE" "$QA_CONTAINER" bash -lc '
      set -eu
      src="$DSH_HOME/profiles/$TEMPLATE"
      dst="$DSH_HOME/profiles/$PROFILE"
      [ -d "$src" ] || { echo "template profile $TEMPLATE is absent; run dsh web once first" >&2; exit 1; }
      cp -a "$src" "$dst"
      PROFILE="$PROFILE" node -e '"'"'
        const fs=require("fs");
        const p=process.env.DSH_HOME+"/profiles/"+process.env.PROFILE+"/package.json";
        const j=JSON.parse(fs.readFileSync(p,"utf8"));
        j.name="dsh-profile-"+process.env.PROFILE;
        fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
      '"'"'
      echo "created $dst"
    '
fi

docker cp "$TARBALL" "$QA_CONTAINER:/home/tester/qa-run/server-plugin.tgz"
docker exec "$QA_CONTAINER" chown tester:tester /home/tester/qa-run/server-plugin.tgz

qa_log "extracting package/ (strip-components=1) into $profile_dir/node_modules/$plugin_name"
docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  -e "PROFILE=$PROFILE" -e "PLUGIN_NAME=$plugin_name" "$QA_CONTAINER" bash -lc '
  set -eu
  p="$DSH_HOME/profiles/$PROFILE/node_modules/$PLUGIN_NAME"
  rm -rf "$p"
  mkdir -p "$p"
  tar -xzf /home/tester/qa-run/server-plugin.tgz -C "$p" --strip-components=1
  test -f "$p/package.json" || { echo "package.json missing after extract" >&2; exit 1; }
  test -f "$p/lib/plugin.js" || { echo "lib/plugin.js missing after extract" >&2; exit 1; }
  echo "extracted files: $(find "$p" -type f | wc -l)"
  ls -la "$p" | sed "s/^/  /"
'

qa_log "registering dependency + bundle in $profile_dir/package.json"
docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
  -e "PROFILE=$PROFILE" -e "PLUGIN_NAME=$plugin_name" -e "PLUGIN_VERSION=$plugin_version" \
  "$QA_CONTAINER" bash -lc '
  node -e '"'"'
    const fs=require("fs");
    const home=process.env.DSH_HOME;
    const p=home+"/profiles/"+process.env.PROFILE+"/package.json";
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    j.dependencies ??= {};
    j.dependencies[process.env.PLUGIN_NAME]=process.env.PLUGIN_VERSION;
    j.dsh ??= {};
    j.dsh.profile ??= {};
    j.dsh.profile.bundles ??= [];
    if (!j.dsh.profile.bundles.includes(process.env.PLUGIN_NAME)) {
      j.dsh.profile.bundles.push(process.env.PLUGIN_NAME);
      console.log("bundle registered: "+process.env.PLUGIN_NAME);
    } else {
      console.log("bundle already registered: "+process.env.PLUGIN_NAME);
    }
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
  '"'"'
'

# The plugin imports @deepseek-ai/schemastery by name; the offline profile has
# no pnpm install, so expose the copy that ships with the global DSH install.
qa_log "checking plugin import resolution"
if ! docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
      -e "PROFILE=$PROFILE" "$QA_CONTAINER" bash -lc '
      cd "$DSH_HOME/profiles/$PROFILE" && node --input-type=module -e "await import(\"dsh-remote-window-server\"); console.log(\"import-ok\")"
    ' >/tmp/qa-plugin-import.log 2>&1; then
  qa_log "direct import failed; linking schemastery from the global DSH install"
  docker exec -i -u tester -e HOME=/home/tester -e DSH_HOME=/home/tester/.dsh \
    -e "PROFILE=$PROFILE" -e "PLUGIN_NAME=$plugin_name" "$QA_CONTAINER" bash -lc '
    set -eu
    g=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery
    [ -d "$g" ] || { echo "global schemastery not found at $g" >&2; exit 1; }
    nm="$DSH_HOME/profiles/$PROFILE/node_modules"
    mkdir -p "$nm/@deepseek-ai"
    ln -sfn "$g" "$nm/@deepseek-ai/schemastery"
    cd "$DSH_HOME/profiles/$PROFILE"
    node --input-type=module -e "await import(\"dsh-remote-window-server\"); console.log(\"import-ok-after-link\")"
  '
else
  cat /tmp/qa-plugin-import.log >&2
fi

profile_summary "$PROFILE"
cat <<EOF

Next step (inside the QA target container):
  dsh --profile $PROFILE --host 127.0.0.1 --port 0 --no-open
or use: scripts/qa/profile-start.sh --name $NAME --profile $PROFILE
EOF
