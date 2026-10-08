# Runtime Security Model

## Overview

The Runtime Layer executes code generated or provided by users.

The security goal is to reduce the impact of user workloads and prevent users from affecting each other during normal operation.

The primary security boundary is the Docker container environment.

---

## Isolation Model

Each workspace has:

* Its own container
* Its own workspace volume
* Resource limits
* A non-root execution user

Example:

```text
User A

Container A
Volume A


User B

Container B
Volume B
```

Workspace volumes are separated between users.

Access isolation depends on the Docker security boundary.

---

## Container Restrictions

### Non-root execution

Processes run as the `koda` user.

This reduces the impact of compromised processes.

---

### Memory limits

Default:

```text
4 GB
```

Limits excessive memory usage.

---

### CPU limits

Default:

```text
2 cores
```

Limits CPU consumption.

---

### Process limits

Default:

```text
500 processes
```

Limits uncontrolled process creation.

---

### No privilege escalation

Containers run with:

```text
no-new-privileges
```

Processes cannot gain additional permissions.

---

### No privileged containers

Containers do not have:

* Privileged mode
* Host device access
* Direct host control

---

## Threat Model

The runtime is designed to reduce risks from:

* Malicious code execution
* Resource abuse
* Accidental system misuse

The runtime does not provide protection against:

* Docker vulnerabilities
* Kernel vulnerabilities
* Host system compromise

The runtime should not be considered a replacement for stronger sandboxing technologies when handling highly sensitive workloads.

---

## Networking

Containers currently use host networking.

This is possible because ACP communication uses Docker attach rather than network ports.

Benefits:

* No port allocation
* No proxy layer
* Simple communication model

Tradeoff:

* Containers can access the host network environment

Future versions may introduce stronger network isolation.

---

## Security Summary

The runtime provides:

✅ Separate workspace storage
✅ Container-based execution
✅ Resource limits
✅ Non-root processes
✅ Reduced privileges

The runtime does not provide:

❌ Full virtual machine isolation
❌ Kernel-level attack protection
❌ Complete network isolation
