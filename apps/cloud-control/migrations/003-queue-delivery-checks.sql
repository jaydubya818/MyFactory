-- Infrastructure qualification only; never an alternate Work or execution queue.
CREATE TABLE IF NOT EXISTS factory.queue_delivery_checks (
  id uuid PRIMARY KEY,
  deployment_id text NOT NULL,
  nonce_sha256 text NOT NULL CHECK (nonce_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('SENDING','ACCEPTED','UNKNOWN','DELIVERED')),
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
  delivered_at timestamptz,
  delivery_count integer CHECK (delivery_count > 0),
  CHECK ((state='DELIVERED') = (delivered_at IS NOT NULL))
);
