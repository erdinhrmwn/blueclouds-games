-- A table's own name, picked when it is opened (Erdin 2026-11-13, "Open a table" dialog). Optional: rooms opened
-- before this, tournament rooms and rooms opened without one keep NULL and show "<host>'s table".
-- Rollback: ALTER TABLE rooms DROP COLUMN name;
ALTER TABLE rooms
  ADD COLUMN name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 32);
