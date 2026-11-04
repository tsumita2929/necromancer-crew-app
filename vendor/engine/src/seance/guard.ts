/**
 * The guard files of a generic séance (QA-08).
 *
 * A séance asks the old package questions, and some of them come from the project's own calls. A
 * project's call can name a host, a file or a command (`request('http://localhost/delete-all')`), and
 * the old package would obey. The guard keeps every call the séance makes into either package inside
 * the test: no network (loopback included), no child process, no write, delete or rename outside the
 * temporary directory. Reads are allowed. A blocked call throws an error with the code `SEANCE_BLOCKED`,
 * which the séance compares like any other error class.
 *
 * The guard is installed when the test file starts (it is the first import, so a package that keeps a
 * reference to `fs.writeFileSync` at load time gets the guarded one) and it is switched on only while a
 * call runs, through `run`, so the test runner's own work is not touched.
 *
 * The curated recipes do not use it: they call pure functions, or create folders under a temporary
 * directory by construction.
 */

export const JS_GUARD_FILE = 'seance-guard.mjs';
export const PY_GUARD_FILE = 'seance_guard.py';

export const JS_GUARD = `// Necromancer séance guard. Imported first by seance.test.mjs.
// While a call runs through run(), it cannot: open a network connection (loopback included), start a
// process, or write, delete or rename a file outside the temporary directory. Reads are allowed.
// A blocked call throws an Error with code SEANCE_BLOCKED.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

let active = 0;
const TMP = fs.realpathSync(os.tmpdir());
export const blocked = [];

function stop(what) {
  const e = new Error('séance guard: ' + what + ' is blocked while the project calls are replayed');
  e.code = 'SEANCE_BLOCKED';
  blocked.push(what);
  return e;
}

/** Runs fn with the guard on. A promise it returns keeps the guard on until it settles. */
export function run(fn) {
  active++;
  let result;
  try {
    result = fn();
  } catch (e) {
    active--;
    throw e;
  }
  if (result && typeof result.then === 'function') {
    const done = () => { active--; };
    result.then(done, done);
    return result;
  }
  active--;
  return result;
}

function guardMethod(obj, name, check, asPromise) {
  const original = obj && obj[name];
  if (typeof original !== 'function') return;
  obj[name] = function (...args) {
    if (active > 0) {
      const why = check(args);
      if (why) {
        const e = stop(why);
        if (asPromise) return Promise.reject(e);
        throw e;
      }
    }
    return original.apply(this, args);
  };
}

// --- network ---------------------------------------------------------------------------------
guardMethod(net.Socket.prototype, 'connect', () => 'a network connection');
guardMethod(dgram.Socket.prototype, 'send', () => 'a network message');
guardMethod(dns, 'lookup', () => 'a DNS lookup');
guardMethod(dns, 'resolve', () => 'a DNS lookup');
if (dns.promises) {
  guardMethod(dns.promises, 'lookup', () => 'a DNS lookup', true);
  guardMethod(dns.promises, 'resolve', () => 'a DNS lookup', true);
}
if (typeof globalThis.fetch === 'function') {
  guardMethod(globalThis, 'fetch', () => 'a network request', true);
}

// --- processes -------------------------------------------------------------------------------
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  guardMethod(cp, name, () => 'starting a process');
}

// --- files -----------------------------------------------------------------------------------
function inside(p) {
  if (typeof p === 'number') return true; // a file descriptor opened earlier
  try {
    const text = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : String(p);
    const resolved = path.resolve(text);
    return resolved === TMP || resolved.startsWith(TMP + path.sep);
  } catch {
    return false;
  }
}
const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC;
function writesWithFlags(flags) {
  if (flags === undefined || flags === null) return false;
  return typeof flags === 'number' ? (flags & WRITE_FLAGS) !== 0 : /[wa+]/.test(String(flags));
}
const PATHS = {
  writeFile: [0], appendFile: [0], mkdir: [0], rm: [0], rmdir: [0], unlink: [0], truncate: [0],
  chmod: [0], chown: [0], lchown: [0], utimes: [0], lutimes: [0], mkdtemp: [0], createWriteStream: [0],
  rename: [0, 1], copyFile: [0, 1], cp: [0, 1], link: [0, 1], symlink: [1],
};
for (const [name, positions] of Object.entries(PATHS)) {
  const check = (args) => (positions.every((i) => args[i] === undefined || inside(args[i])) ? '' : 'a file change outside the temporary directory');
  guardMethod(fs, name, check);
  guardMethod(fs, name + 'Sync', check);
  guardMethod(fs.promises, name, check, true);
}
const openCheck = (args) => (writesWithFlags(args[1]) && !inside(args[0]) ? 'a file change outside the temporary directory' : '');
guardMethod(fs, 'open', openCheck);
guardMethod(fs, 'openSync', openCheck);
guardMethod(fs.promises, 'open', openCheck, true);

syncBuiltinESMExports();
`;

export const PY_GUARD = `"""Necromancer séance guard. Imported first by the test file.

While a call runs through run(), it cannot: open a network connection (loopback included), start a
process, or write, delete or rename a file outside the temporary directory. Reads are allowed. A
blocked call raises SeanceBlocked.
"""
import builtins
import io
import os
import shutil
import socket
import subprocess
import tempfile

_TMP = os.path.realpath(tempfile.gettempdir())
_active = 0
blocked = []


class SeanceBlocked(Exception):
    pass


def _stop(what):
    blocked.append(what)
    return SeanceBlocked("seance guard: %s is blocked while the project calls are replayed" % what)


def run(fn, *args):
    """Runs fn(*args) with the guard on."""
    global _active
    _active += 1
    try:
        return fn(*args)
    finally:
        _active -= 1


def _inside(path):
    if isinstance(path, int):
        return True  # a file descriptor opened earlier
    try:
        resolved = os.path.realpath(os.fsdecode(path))
    except Exception:
        return False
    return resolved == _TMP or resolved.startswith(_TMP + os.sep)


def _wrap(owner, name, check):
    original = getattr(owner, name, None)
    if original is None:
        return

    def guarded(*args, **kwargs):
        if _active > 0:
            why = check(args, kwargs)
            if why:
                raise _stop(why)
        return original(*args, **kwargs)

    try:
        setattr(owner, name, guarded)
    except (TypeError, AttributeError):
        pass


def _never(what):
    return lambda args, kwargs: what


# --- network ---
for _name in ("connect", "connect_ex", "sendto", "bind"):
    _wrap(socket.socket, _name, _never("a network connection"))
_wrap(socket, "create_connection", _never("a network connection"))
_wrap(socket, "getaddrinfo", _never("a DNS lookup"))

# --- processes ---
_wrap(subprocess.Popen, "__init__", _never("starting a process"))
for _name in ("system", "popen", "execv", "execve", "execvp", "execl", "execlp", "spawnv", "spawnl", "fork", "forkpty", "posix_spawn"):
    _wrap(os, _name, _never("starting a process"))

# --- files ---
def _outside(*positions):
    def check(args, kwargs):
        for i in positions:
            if i < len(args) and not _inside(args[i]):
                return "a file change outside the temporary directory"
        return ""
    return check


for _name in ("remove", "unlink", "rmdir", "removedirs", "mkdir", "makedirs", "truncate", "chmod", "chown", "utime"):
    _wrap(os, _name, _outside(0))
for _name in ("rename", "replace", "link"):
    _wrap(os, _name, _outside(0, 1))
_wrap(os, "symlink", _outside(1))
for _name in ("rmtree",):
    _wrap(shutil, _name, _outside(0))
for _name in ("copy", "copy2", "copyfile", "copytree", "move"):
    _wrap(shutil, _name, _outside(1))


def _open_check(args, kwargs):
    mode = args[1] if len(args) > 1 else kwargs.get("mode", "r")
    if isinstance(mode, str) and any(c in mode for c in "wax+") and args and not _inside(args[0]):
        return "a file change outside the temporary directory"
    return ""


_wrap(builtins, "open", _open_check)
_wrap(io, "open", _open_check)  # pathlib and others call io.open, which is a separate name


_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _os_open_check(args, kwargs):
    flags = args[1] if len(args) > 1 else kwargs.get("flags", 0)
    if isinstance(flags, int) and flags & _WRITE_FLAGS and args and not _inside(args[0]):
        return "a file change outside the temporary directory"
    return ""


_wrap(os, "open", _os_open_check)
`;
