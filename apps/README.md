# NearSpace applications

The root route is a minimal application launcher. NearDrop remains at `/drop`;
NearChat lives in its own folder `apps/near-chat` with separate account, session,
room and API contracts. Do not reuse NearDrop guest pairing as account login.

NearDrop's original modules remain in `src/transfer`, `src/lib`, `src/components`
and `server`. Moving a deployed transfer engine solely to reorganize folders is
not required to isolate the new application. Future apps should get their own
folder, route and API namespace, then one launcher entry.
