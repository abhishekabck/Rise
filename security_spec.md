# Rise Application Security Specification

## Data Invariants
1. A Task cannot be created or modified by a user other than its owner (where `userId` in the path matches `request.auth.uid`).
2. Timestamps like `createdAt` are immutable after creation, and `updatedAt` must match `request.time`.
3. Tasks must have valid categories, priorities, and statuses.
4. Users cannot modify security fields or arbitrary keys outside the schema.
5. All IDs must match `^[a-zA-Z0-9_\-]+$`.

## The "Dirty Dozen" Payloads (PERMISSION_DENIED Targets)
1. **Unauthenticated Read**: Attempting to read `/users/someUser123` without logging in.
2. **Identity Spoofing**: User `alice` attempts to write a task for `/users/bob/tasks/task123`.
3. **Ghost Field Update**: Injecting a custom `isAdmin: true` field into a user profile.
4. **Status Shortcutting**: Setting a task status directly to `completed` without estimated minutes, or setting custom variables.
5. **Path Poisoning**: Creating a task with a massive 2KB ID full of junk characters.
6. **Temporal Spoofing**: Creating a task with a hardcoded `createdAt` timestamp set to the future.
7. **Invalid Enumeration**: Creating a task with `priority: "ultra-high"` (only `low|medium|high` allowed).
8. **Negative Time Tracking**: Creating a task with `estimatedMinutes: -10`.
9. **Unauthenticated Profile Creation**: Creating a user profile document with random auth UID.
10. **Behavior Profile Tampering**: Editing another user's behaviour profile document.
11. **Immutability Breach**: Updating a task and attempting to change the `createdAt` value.
12. **Bypassing Verification**: Writing to a user profile while having `email_verified == false`.

## The Test Runner (Conceptual Rules Validation)
Standard tests checking that these malicious schemas and unauthorized reads/writes are blocked by the security rules engine.
