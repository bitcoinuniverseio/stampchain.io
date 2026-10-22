# Native readonly reader lifecycle

The `owned-unix-readonly` profile requires a finite root-managed alias lease.
Its existing SQL limits remain two connections, two queued requests, four
seconds for readiness and ten seconds for feed operations. Caller deadlines
never release a physical driver slot before the driver actually settles.

The application accepts only its fixed `/run/universe-stampchain-reader`
directory, immutable principal/source proof and single-inode MySQL socket.
The proof also binds a root-owned `admission.sock` inode, factory PID/start
ticks/mount namespace, lease ID and absolute expiry. Each operation obtains a
nonce-bound admission. Query results recheck admission before publication.
Expired leases and `native-ended.json` close new admission. The host factory
must retain native and reader pidfds, verify mapped source/listener identity
and obtain current native `SO_PEERCRED` evidence before issuing admission.
The control directory is separate from immutable application source.

The Python lease authority enforces a finite ten-minute ceiling and checks
that its published expiry agrees with its monotonic deadline and current
factory identity. It never mounts, logs in to SQL, changes grants or controls
a native actor. A separately qualified mount controller must create the
single-socket readonly alias and root-owned proof, register the exact reader,
and normally release the alias only after reader work and connections are
empty. An extinct technical alias qualification is not a usable lease.

On SIGINT, SIGTERM or lease revocation, the application closes HTTP and future
timer admission, awaits accepted handler and physical driver work, then
closes the pool. Uncertain producer or resource closure retains an explicit
HOLD reference; no timer forces process exit. A listener allocated by delayed
startup is closed, and a disconnected HTTP caller cannot release pending
work. The owned reader logs to stdout and does not warm external fee/price
providers; unqualified prices and fees remain unavailable.

For an immutable preinstalled package, the supported Deno 2.6.9 manual npm
mode skips automatic bin preparation. This is an explicit runtime profile
change. Retain `--frozen`, an explicit lock path, the original import map,
and an independently verified installed body and selected-target bridge.
Frozen mode alone does not authenticate the preinstalled npm tree. The
ordinary automatic profile still performs its supported npm preparation.

Run `deno task test:native-reader` for the original-config frozen tests and
`python3 -B -m unittest discover -s scripts -p test_native_reader_lease.py -v`
for synthetic admission protocol controls. These do not substitute for Linux
mount/peer qualification, actual purpose-principal SELECT readiness, full
application startup or wallet acceptance. No native deployment is implied.
