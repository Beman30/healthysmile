CREATE TABLE studios (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created TEXT NOT NULL);
CREATE TABLE studio_members (studio_id TEXT NOT NULL REFERENCES studios(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','editor')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(studio_id,email));
CREATE INDEX idx_studio_members_email ON studio_members(email);
-- patients.owner is a stable studio UUID in this deployment, never an email/domain.
-- No existing database is automatically adopted or modified by this package.
