"""Publish one new file using a workspace directory inherited as descriptor 3."""
import errno
import json
import math
import os
import re
import stat
import sys
import time
import uuid
from datetime import datetime, timezone


def check_support():
    required = (os.open, os.mkdir, os.link, os.unlink, os.stat, os.rename, os.rmdir)
    if (os.name != "posix" or not getattr(os, "O_DIRECTORY", 0)
            or not getattr(os, "O_NOFOLLOW", 0)
            or any(operation not in os.supports_dir_fd for operation in required)
            or os.link not in os.supports_follow_symlinks):
        raise RuntimeError("Checked workspace output requires POSIX Python 3 directory-relative, no-follow filesystem operations.")


def open_parent(relative_path):
    parts = relative_path.split("/")
    if any(part in ("", ".", "..") or "\0" in part for part in parts):
        raise ValueError("Output must be a non-empty relative workspace path without traversal.")
    parent = os.dup(3)
    try:
        if not stat.S_ISDIR(os.fstat(parent).st_mode):
            raise ValueError("Workspace anchor is not a directory.")
        for part in parts[:-1]:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            try:
                child = os.open(part, flags, dir_fd=parent)
            except FileNotFoundError:
                try:
                    os.mkdir(part, dir_fd=parent)
                except FileExistsError:
                    pass
                # A concurrent creator may have installed a symlink. Open the
                # entry without following it rather than trusting mkdir's result.
                child = os.open(part, flags, dir_fd=parent)
            os.close(parent)
            parent = child
        return parent, parts[-1]
    except Exception:
        os.close(parent)
        raise


def write_output(parent, name, content, mode, replace=False):
    temporary = None
    descriptor = None
    try:
        temporary_name = f".{name}.{uuid.uuid4().hex}.tmp"
        descriptor = os.open(temporary_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             mode, dir_fd=parent)
        temporary = temporary_name
        content = memoryview(content)
        while content:
            written = os.write(descriptor, content)
            if not written:
                raise OSError(errno.EIO, "Workspace output write made no progress.")
            content = content[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        # linkat publishes completed bytes without replacing any existing name,
        # including dangling symlinks. Both names use the same pinned directory.
        if replace:
            os.rename(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            temporary = None
        else:
            os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent,
                    follow_symlinks=False)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary is not None:
            os.unlink(temporary, dir_fd=parent)


def publish(relative_path, mode):
    parent, name = open_parent(relative_path)
    try:
        write_output(parent, name, sys.stdin.buffer.read(), mode)
    finally:
        os.close(parent)


def manifest_lines(existing, row):
    # Same row contract as generate-pdf.mjs applyManifestRow; parity is tested.
    def report_key(value):
        value = (value or "").strip()
        return re.sub(r"^0+(?=[0-9])", "", value)
    incoming_kind = "cover" if row.get("kind") == "cover" else "cv"
    kept = []
    for line in existing.split("\n"):
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        fields += [""] * max(0, 6 - len(fields))
        if fields[1] == row["pdf"]:
            continue
        if row.get("reportNum") and report_key(fields[0]) == report_key(row["reportNum"]):
            existing_kind = fields[5].strip()
            if (incoming_kind == "cover" and existing_kind == "cover") or (incoming_kind == "cv" and existing_kind != "cover"):
                continue
        kept.append(line)
    kept.append("\t".join([row.get("reportNum") or "", row["pdf"], row["html"], row["format"], row["date"], incoming_kind]))
    return "# report\tpdf\thtml\tformat\tdate\tkind - written by generate-pdf.mjs, do not edit\n" + "\n".join(kept) + "\n"


def update_manifest(relative_path, row):
    parent, name = open_parent(relative_path)
    lock_name = name + ".lock"
    lock = None
    owns_stamp = False
    stamp_identity = None
    stamp_complete = False
    try:
        def wait_seconds(variable, default):
            try:
                value = float(os.environ.get(variable, "")) / 1000
                return value if math.isfinite(value) and value > 0 else default
            except ValueError:
                return default
        deadline = time.monotonic() + wait_seconds("CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS", 8)
        retry = wait_seconds("CAREER_OPS_PIPELINE_LOCK_RETRY_MS", 0.08)
        while True:
            try:
                os.mkdir(lock_name, 0o700, dir_fd=parent)
                break
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out waiting for PDF manifest lock; registration skipped.")
                time.sleep(min(retry, max(0, deadline - time.monotonic())))
        lock = os.open(lock_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        identity = os.fstat(lock)
        # Share the existing pipeline-lock directory protocol. A live helper's
        # PID prevents ordinary writers reclaiming its lock. This narrow writer
        # never reclaims stale locks itself; it fails rather than deleting one.
        owner = {"pid": os.getpid(), "token": uuid.uuid4().hex,
                 "started_at": datetime.now(timezone.utc).isoformat(), "pipeline": relative_path}
        fd = os.open("owner.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=lock)
        owns_stamp = True
        stamp_identity = os.fstat(fd)
        with os.fdopen(fd, "w", encoding="utf8") as stamp:
            json.dump(owner, stamp)
        stamp_complete = True
        current = os.stat(lock_name, dir_fd=parent, follow_symlinks=False)
        if (identity.st_dev, identity.st_ino) != (current.st_dev, current.st_ino):
            raise RuntimeError("PDF manifest lock changed while acquiring it.")
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        except FileNotFoundError:
            existing = ""
        else:
            with os.fdopen(fd, "r", encoding="utf8") as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ValueError("PDF manifest must be a regular file.")
                existing = source.read()
        write_output(parent, name, manifest_lines(existing, row).encode("utf8"), 0o666, replace=True)
    finally:
        try:
            if lock is not None:
                try:
                    if owns_stamp:
                        try:
                            current_stamp = os.stat("owner.json", dir_fd=lock, follow_symlinks=False)
                            owns_stamp = (stamp_identity.st_dev, stamp_identity.st_ino) == (current_stamp.st_dev, current_stamp.st_ino)
                            if not owns_stamp:
                                raise ValueError("PDF manifest lock owner was replaced.")
                            fd = os.open("owner.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=lock)
                            with os.fdopen(fd, "r", encoding="utf8") as stamp:
                                if stamp_complete and (not stat.S_ISREG(os.fstat(stamp.fileno()).st_mode) or json.load(stamp).get("token") != owner["token"]):
                                    owns_stamp = False
                        except (OSError, ValueError):
                            owns_stamp = False
                    if owns_stamp:
                        os.unlink("owner.json", dir_fd=lock)
                    if owns_stamp or not stamp_complete:
                        try:
                            current = os.stat(lock_name, dir_fd=parent, follow_symlinks=False)
                            if (identity.st_dev, identity.st_ino) == (current.st_dev, current.st_ino):
                                os.rmdir(lock_name, dir_fd=parent)
                        except OSError as error:
                            # A failed owner-stamp write must not wedge this
                            # protected writer. Only remove our empty directory;
                            # an entry added by another holder is left alone.
                            if error.errno not in (errno.ENOENT, errno.ENOTEMPTY, errno.EEXIST):
                                raise
                finally:
                    os.close(lock)
        finally:
            os.close(parent)


if __name__ == "__main__":
    try:
        check_support()
        if len(sys.argv) == 3 and sys.argv[1] == "--manifest":
            update_manifest(sys.argv[2], json.load(sys.stdin))
        elif sys.argv[1:] != ["--check"]:
            if len(sys.argv) != 3:
                raise ValueError("Expected a relative output path and creation mode.")
            publish(sys.argv[1], int(sys.argv[2]))
    except Exception as error:
        print(json.dumps({"error": str(error), "code": errno.errorcode.get(getattr(error, "errno", None), "ERR_WORKSPACE_OUTPUT")}), file=sys.stderr)
        sys.exit(1)
