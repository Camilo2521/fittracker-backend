-- ============================================================
-- Demo seed data for development/testing
-- Run AFTER 001_initial.sql
-- ============================================================

INSERT OR IGNORE INTO users (external_id, name, current_weight, target_weight, goal, goal_type, start_weight, completed_onboarding)
VALUES ('demo_user_001', 'Demo User', 80.0, 70.0, 'lose', 'weight-loss', 85.0, 1);

INSERT OR IGNORE INTO goals (user_id, goal, target_weight, start_weight, current_weight)
VALUES ('demo_user_001', 'lose', 70.0, 85.0, 80.0);

INSERT OR IGNORE INTO weights (user_id, date, value, unit) VALUES
  ('demo_user_001', date('now', '-7 days'), 80.5, 'kg'),
  ('demo_user_001', date('now', '-5 days'), 80.1, 'kg'),
  ('demo_user_001', date('now', '-3 days'), 79.8, 'kg'),
  ('demo_user_001', date('now', '-1 days'), 79.5, 'kg'),
  ('demo_user_001', date('now'),            79.2, 'kg');

INSERT OR IGNORE INTO workouts (user_id, date, type, duration, intensity, calories) VALUES
  ('demo_user_001', date('now', '-6 days'), 'cardio',      30, 'medium', 360),
  ('demo_user_001', date('now', '-4 days'), 'strength',    45, 'high',   360),
  ('demo_user_001', date('now', '-2 days'), 'flexibility', 20, 'low',     40),
  ('demo_user_001', date('now'),            'cardio',      40, 'high',   600);

INSERT OR IGNORE INTO daily_checks (user_id, date, checks) VALUES
  ('demo_user_001', date('now', '-1 days'), '{"agua":true,"ejercicio":true,"sueno":true,"frutas":false}'),
  ('demo_user_001', date('now'),            '{"agua":true,"ejercicio":false,"sueno":true,"frutas":true}');

INSERT OR IGNORE INTO water_intake (user_id, date, glasses, ml) VALUES
  ('demo_user_001', date('now', '-1 days'), 8, 2000),
  ('demo_user_001', date('now'),            6, 1500);
