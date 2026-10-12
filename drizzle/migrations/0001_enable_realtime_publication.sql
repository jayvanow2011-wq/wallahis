DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'devices','commands','command_results','device_metrics','device_access','device_permissions',
    'sessions','notifications','direct_messages','community_posts','friendships','client_shares',
    'builds','subscriptions','active_sessions','build_server_config','turn_servers','server_endpoints'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;