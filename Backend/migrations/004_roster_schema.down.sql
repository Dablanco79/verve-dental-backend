-- Module 04 rollback: drop roster tables (audit first due to FK constraint).
DROP TABLE IF EXISTS roster_entry_audit;
DROP TABLE IF EXISTS roster_entries;
