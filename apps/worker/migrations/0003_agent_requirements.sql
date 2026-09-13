ALTER TABLE builder_missions ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'engineering';
ALTER TABLE builder_missions ADD COLUMN requirements_json TEXT NOT NULL DEFAULT '[]';
