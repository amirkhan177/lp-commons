-- First-run setup: set when the user finishes or skips the onboarding checklist.
ALTER TABLE workspaces ADD COLUMN onboarded_at TIMESTAMPTZ;
