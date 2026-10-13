ALTER TABLE public.community_posts DROP CONSTRAINT community_posts_channel_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_channel_check
  CHECK (channel = ANY (ARRAY['news','reviews','chat','rules','announcements','leaderboard','general','support']));