"""Protocol-only synthetic controls; kernel/mount fences need Linux qualification."""
import unittest
import time
from native_reader_lease import NativeReaderLeaseAuthority


class SyntheticAuthority(NativeReaderLeaseAuthority):
    def __init__(self):
        # Isolate admission semantics, not the root-only mount controller setup.
        self.proof = {
            "lease": {"id": "a" * 64, "factoryPid": 10,
                      "factoryStartTicks": "20", "expiresAtUtc": "synthetic"},
            "source": {"pid": 30, "startTicks": "40", "listenerSocketInode": "50"},
        }
        self.deadline = time.monotonic() + 1
        self.revoked = False
        self.native_alive = True
        self.native_checks = 0
        self.reader_fence = lambda peer: peer == (60, 70, 80)
        self.native_fence = self.check_native

    def check_native(self):
        self.native_checks += 1
        return self.native_alive

    def revoke(self, reason):
        self.revoked = True
        self.reason = reason


class LeaseControls(unittest.TestCase):
    def request(self, authority):
        return {"schemaVersion": "universe-stamps-lease-admission-v1",
                "leaseId": authority.proof["lease"]["id"],
                "nonce": "synthetic-only", "operation": "readonly"}

    def test_current_reader_and_source_are_bracketed(self):
        authority = SyntheticAuthority()
        reply = authority.admit(self.request(authority), (60, 70, 80))
        self.assertTrue(reply["admitted"])
        self.assertEqual(reply["nonce"], "synthetic-only")
        self.assertEqual(authority.native_checks, 2)

    def test_wrong_reader_never_gets_admission(self):
        authority = SyntheticAuthority()
        with self.assertRaisesRegex(RuntimeError, "reader_identity"):
            authority.admit(self.request(authority), (61, 70, 80))
        self.assertEqual(authority.native_checks, 0)

    def test_source_death_revokes_instead_of_success(self):
        authority = SyntheticAuthority()
        authority.native_alive = False
        with self.assertRaisesRegex(RuntimeError, "native_source"):
            authority.admit(self.request(authority), (60, 70, 80))
        self.assertTrue(authority.revoked)

    def test_expiry_never_produces_a_new_token(self):
        authority = SyntheticAuthority()
        authority.deadline = time.monotonic() - 1
        with self.assertRaisesRegex(RuntimeError, "expired"):
            authority.admit(self.request(authority), (60, 70, 80))

    def test_unknown_or_mutating_frames_refuse(self):
        for delta in ({"operation": "write"}, {"extra": True}, {"leaseId": "wrong"}):
            authority = SyntheticAuthority()
            with self.assertRaisesRegex(RuntimeError, "frame_refused"):
                authority.admit({**self.request(authority), **delta}, (60, 70, 80))


if __name__ == "__main__":
    unittest.main()
