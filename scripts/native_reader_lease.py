"""Finite admission owner for the task-private, inode-bound SQL alias.

The mount controller supplies its held-pidfd/native-peer fence. This module
never mounts, authenticates to SQL, changes grants, or controls a native actor.
"""
import json
import os
import pathlib
import socket
import struct
import time
import select
import hashlib
import math
import stat
import datetime


class HeldNativeSourceFence:
    """Read-only process/source/listener and pre-auth peer evidence per admission."""
    def __init__(self, proof, alias_path, executable_sha256, listener_fd):
        self.source = proof["source"]
        self.socket = proof["socket"]
        self.alias_path = pathlib.Path(alias_path)
        self.listener_fd = listener_fd
        self.pidfd = None
        self.exe_fd = None
        try:
            self.pidfd = os.pidfd_open(self.source["pid"])
            self.proc = pathlib.Path("/proc") / str(self.source["pid"])
            self.exe_fd = os.open(self.proc / "exe", os.O_RDONLY)
            self.exe_identity = self.identity(os.fstat(self.exe_fd))
            digest = hashlib.sha256()
            count = 0
            while True:
                data = os.read(self.exe_fd, 131072)
                if not data:
                    break
                count += len(data)
                if count > 128 * 1024 * 1024:
                    raise RuntimeError("native_executable_bound")
                digest.update(data)
            if digest.hexdigest() != executable_sha256 or not self.check():
                raise RuntimeError("native_source_initial_fence_refused")
        except BaseException:
            self.close()
            raise

    @staticmethod
    def identity(st):
        return (st.st_dev, st.st_ino, st.st_size, st.st_uid, st.st_mode,
                st.st_mtime_ns, st.st_ctime_ns)

    def check(self):
        try:
            if select.select([self.pidfd], [], [], 0)[0]:
                return False
            ticks = (self.proc / "stat").read_text().rsplit(")", 1)[1].split()[19]
            if ticks != self.source["startTicks"]:
                return False
            if os.readlink(self.proc / "ns/mnt") != self.source["mountNamespace"]:
                return False
            if os.readlink(self.proc / "fd" / str(self.listener_fd)) != (
                "socket:[" + self.source["listenerSocketInode"] + "]"
            ):
                return False
            fresh_fd = os.open(self.proc / "exe", os.O_RDONLY)
            try:
                if self.identity(os.fstat(fresh_fd)) != self.exe_identity:
                    return False
            finally:
                os.close(fresh_fd)
            if self.identity(os.fstat(self.exe_fd)) != self.exe_identity:
                return False
            st = self.alias_path.lstat()
            if (str(st.st_dev), str(st.st_ino), st.st_uid) != (
                self.socket["deviceAtomic"], self.socket["inodeAtomic"], self.socket["uid"]
            ):
                return False
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(1)
                connection.connect(str(self.alias_path))
                pid, uid, _ = struct.unpack("3i", connection.getsockopt(
                    socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                if pid != self.source["pid"] or uid != self.socket["uid"]:
                    return False
            return not select.select([self.pidfd], [], [], 0)[0]
        except OSError:
            return False

    def close(self):
        if self.exe_fd is not None:
            os.close(self.exe_fd)
            self.exe_fd = None
        if self.pidfd is not None:
            os.close(self.pidfd)
            self.pidfd = None


class NativeReaderLeaseAuthority:
    def __init__(self, proof, deadline, native_fence, reader_fence, control_dir):
        if not math.isfinite(deadline) or not 0 < deadline - time.monotonic() <= 600:
            raise RuntimeError("lease_must_have_finite_ten_minute_ceiling")
        lease = proof["lease"]
        expiry = datetime.datetime.fromisoformat(lease["expiresAtUtc"])
        if expiry.tzinfo is None or abs(
            (expiry.timestamp() - time.time()) - (deadline - time.monotonic())
        ) > 1:
            raise RuntimeError("published_lease_and_actual_deadline_disagree")
        own_ticks = pathlib.Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()[19]
        if (
            lease["factoryPid"] != os.getpid()
            or lease["factoryStartTicks"] != own_ticks
            or lease["factoryMountNamespace"] != os.readlink("/proc/self/ns/mnt")
        ):
            raise RuntimeError("factory_current_identity_refused")
        self.proof = proof
        self.deadline = deadline
        self.native_fence = native_fence
        self.reader_fence = reader_fence
        self.control_dir = pathlib.Path(control_dir)
        for parent in [self.control_dir, *self.control_dir.parents]:
            metadata = parent.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0:
                raise RuntimeError("lease_control_parent_refused")
            sticky = parent in (pathlib.Path("/tmp"), pathlib.Path("/dev/shm"))
            if metadata.st_mode & 0o022 and not (
                sticky and metadata.st_mode & 0o7777 == 0o1777
            ):
                raise RuntimeError("lease_control_parent_writable")
        self.revoked = False

    def revoke(self, reason):
        self.revoked = True
        path = self.control_dir / "native-ended.json"
        if path.exists():
            return
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o444)
        try:
            body = json.dumps({"leaseId": self.proof["lease"]["id"], "reason": reason}).encode()
            os.write(fd, body)
            os.fsync(fd)
        finally:
            os.close(fd)
        fd = os.open(self.control_dir, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def admit(self, request, peer):
        if self.revoked or time.monotonic() >= self.deadline:
            self.revoke("expired")
            raise RuntimeError("lease_expired_or_revoked")
        if not self.reader_fence(peer):
            raise RuntimeError("reader_identity_refused")
        if not self.native_fence():
            self.revoke("native_source_ended_or_changed")
            raise RuntimeError("native_source_refused")
        lease = self.proof["lease"]
        if (
            set(request) != {"schemaVersion", "leaseId", "nonce", "operation"}
            or request["schemaVersion"] != "universe-stamps-lease-admission-v1"
            or request["leaseId"] != lease["id"]
            or request["operation"] != "readonly"
            or not isinstance(request["nonce"], str)
            or not 1 <= len(request["nonce"]) <= 128
        ):
            raise RuntimeError("admission_frame_refused")
        # Re-bracket native lifetime after parsing and before releasing admission.
        if (
            time.monotonic() >= self.deadline
            or not self.reader_fence(peer)
            or not self.native_fence()
        ):
            self.revoke("native_source_ended_or_changed")
            raise RuntimeError("native_source_refused")
        source = self.proof["source"]
        return {
            "admitted": True,
            "nonce": request["nonce"],
            "leaseId": lease["id"],
            "factoryPid": lease["factoryPid"],
            "factoryStartTicks": lease["factoryStartTicks"],
            "nativePid": source["pid"],
            "nativeStartTicks": source["startTicks"],
            "listenerSocketInode": source["listenerSocketInode"],
            "expiresAtUtc": lease["expiresAtUtc"],
        }

    def serve(self, listener):
        """Stops at its finite deadline; normal alias release remains separate."""
        listener.settimeout(0.25)
        try:
            while not self.revoked and time.monotonic() < self.deadline:
                if not self.native_fence():
                    self.revoke("native_source_ended_or_changed")
                    break
                try:
                    connection, _ = listener.accept()
                except TimeoutError:
                    continue
                with connection:
                    connection.settimeout(max(0.001, min(1, self.deadline - time.monotonic())))
                    peer = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    raw = bytearray()
                    try:
                        while not raw.endswith(b"\n"):
                            part = connection.recv(min(1024, 4097 - len(raw)))
                            if not part:
                                raise RuntimeError("truncated_admission_frame")
                            raw.extend(part)
                            if len(raw) > 4096:
                                raise RuntimeError("oversized_admission_frame")
                        reply = self.admit(json.loads(raw), peer)
                        connection.sendall(json.dumps(reply).encode() + b"\n")
                    except (ValueError, RuntimeError, OSError):
                        # Refusal never becomes an admitted reply or SQL success.
                        continue
            self.revoke("expired")
        finally:
            listener.close()
