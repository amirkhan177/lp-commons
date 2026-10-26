-- Profile photo URL of the user's own LinkedIn connections, read by the agent from the
-- connections list it already visits. Private workspace data; never exported.
ALTER TABLE user_contacts ADD COLUMN photo_url TEXT;
