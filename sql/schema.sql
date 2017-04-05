CREATE TABLE channels(
  contract_id bytea,
  channel_id bytea,
  demand bytea,
  supply bytea,
  root bytea,
  arbiter bytea,
  state integer,
  expiration integer,
  challenge integer,
  proposed_root bytea,
  PRIMARY KEY (channel_id)
);

INSERT INTO channels(
  contract_id,
  channel_id,
  demand,
  supply,
  root,
  arbiter,
  state,
  expiration,
  challenge,
  proposed_root
) VALUES (
  '\xdd',
  '\xab',
  '\xde',
  '\xee',
  '\xaa',
  '\xbb',
  0,
  100,
  100,
  '\x'
);

/* Additional fields:
 * - createdAt (both sql and blockchain)
 * - updatedAt
 */
