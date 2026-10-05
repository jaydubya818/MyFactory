-- A released reservation is proven not dispatched; it retains its operation slot.
ALTER TABLE factory.work_spend_operations DROP CONSTRAINT work_spend_operations_state_check;
ALTER TABLE factory.work_spend_operations ADD CONSTRAINT work_spend_operations_state_check
  CHECK (state IN ('reserved','dispatched','unknown','settled','released'));
