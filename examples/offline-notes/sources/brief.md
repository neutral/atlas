# Fictional product brief

This is an invented brief for learning Atlas. It records intended behavior for a
notes app, not a shipped product or a study with real participants.

## Offline work

A field researcher must be able to write and revise notes when a network is
unavailable. The interface should distinguish work still being saved from work
saved on the current device. Closing and reopening the app normally should leave
that saved work available without reconnecting.

## Save and delivery states

The selected wording is **Saved on this device** after local persistence. After
reconnection, synchronization retries pending changes. A server receipt for the
same revision permits **Sent for sync**. A receipt confirms server acceptance;
it does not establish that every other device has downloaded that revision.

This distinction prevents a writer from treating a local save as a backup on
another device. Unsaved work, pending delivery and failed delivery must remain
visible. Wording for delivery failures and conflicting revisions is still open.

## What remains to be established

Implementation, crash recovery, power-loss durability, conflict handling and
receipt validation need their own evidence. The selected wording has not been
tested with users. The separate fictional trial concerns only normal restart.
