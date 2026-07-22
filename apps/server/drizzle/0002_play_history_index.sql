CREATE INDEX IF NOT EXISTS queue_played_track_idx ON queue_items(status, track_id, finished_at);
