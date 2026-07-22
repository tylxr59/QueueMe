ALTER TABLE app_settings ADD COLUMN allow_nickname_changes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN show_guest_names INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN show_admin_link INTEGER NOT NULL DEFAULT 1;
