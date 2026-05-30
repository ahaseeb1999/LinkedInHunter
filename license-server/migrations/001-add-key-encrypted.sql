-- Migration 001: add key_encrypted column to licenses table.
-- Run with: wrangler d1 execute linkedin-hunter-db --remote --file=migrations/001-add-key-encrypted.sql

ALTER TABLE licenses ADD COLUMN key_encrypted TEXT;
