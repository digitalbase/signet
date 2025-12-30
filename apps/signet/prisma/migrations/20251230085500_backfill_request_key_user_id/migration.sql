-- Backfill keyUserId on existing Request records by matching (keyName, remotePubkey) to KeyUser.(keyName, userPubkey)
UPDATE Request
SET keyUserId = (
    SELECT KeyUser.id
    FROM KeyUser
    WHERE KeyUser.keyName = Request.keyName
    AND KeyUser.userPubkey = Request.remotePubkey
)
WHERE keyUserId IS NULL
AND keyName IS NOT NULL;
