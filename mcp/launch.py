"""Start the Necromancer MCP server (Node) from the installed app root.

Kiro Crew resolves a relative ``.py`` launcher against the app root but starts the
server under the chat session's working directory, so a relative ``node`` script
path would not be found. This launcher finds the bundle from its own location.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
BUNDLE = os.path.join(ROOT, "dist", "server.mjs")


def find_node():
    # kiro-cli may start MCP servers with a trimmed PATH, so try known places too.
    found = shutil.which("node")
    if found:
        return found
    for candidate in ("/usr/local/bin/node", "/usr/bin/node", os.path.expanduser("~/.local/bin/node")):
        if os.access(candidate, os.X_OK):
            return candidate
    return None


def main():
    node = find_node()
    if node is None:
        sys.stderr.write("necromancer: Node.js 22 or later is required but was not found.\n")
        return 1
    if not os.path.isfile(BUNDLE):
        sys.stderr.write("necromancer: %s is missing; run `npm run build` in the app source.\n" % BUNDLE)
        return 1
    os.environ.setdefault("NECROMANCER_DATA_DIR", os.path.join(ROOT, "data"))
    os.execv(node, [node, BUNDLE])


if __name__ == "__main__":
    sys.exit(main())
