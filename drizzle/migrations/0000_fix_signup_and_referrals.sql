CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  ref_code text; ref_user uuid; is_admin boolean := false;
  uname text := lower(COALESCE(meta->>'username', split_part(new.email, '@', 1)));
  next_num bigint := nextval('public.profile_user_number_seq');
BEGIN
  ref_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  IF meta ? 'ref_code' AND length(meta->>'ref_code') > 0 THEN
    SELECT id INTO ref_user FROM public.profiles WHERE referral_code = upper(trim(meta->>'ref_code')) LIMIT 1;
  END IF;
  INSERT INTO public.profiles (id, email, full_name, avatar_url, discord_id, discord_username, profile_completed, referral_code, referred_by, username, user_number)
  VALUES (new.id, new.email, COALESCE(meta->>'full_name', meta->>'discord_username', meta->>'username', new.email),
    meta->>'avatar_url', meta->>'discord_id', meta->>'discord_username', false, ref_code, ref_user, NULLIF(uname, ''), next_num)
  ON CONFLICT (id) DO UPDATE SET
    avatar_url = COALESCE(excluded.avatar_url, public.profiles.avatar_url),
    referral_code = COALESCE(public.profiles.referral_code, excluded.referral_code),
    referred_by = COALESCE(public.profiles.referred_by, excluded.referred_by),
    username = COALESCE(public.profiles.username, excluded.username),
    user_number = COALESCE(public.profiles.user_number, excluded.user_number);
  IF ref_user IS NOT NULL AND ref_user <> new.id THEN
    INSERT INTO public.referrals(referrer_id, referee_id) VALUES (ref_user, new.id) ON CONFLICT (referee_id) DO NOTHING;
    INSERT INTO public.notifications(user_id, title, body, kind, payload)
    VALUES (ref_user, 'New referral', 'Someone signed up with your code. You get +30 days when they subscribe.', 'system', jsonb_build_object('referee_id', new.id));
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'operator') ON CONFLICT DO NOTHING;
  IF lower(new.email) IN ('jayjay@veltrix.xyz','jayjay@larping.cy') OR uname = 'jayjay' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'admin') ON CONFLICT DO NOTHING;
    is_admin := true;
  END IF;
  INSERT INTO public.subscriptions(user_id, plan, status, started_at, expires_at, provider, amount_usd, currency)
  VALUES (new.id, CASE WHEN is_admin THEN 'admin_grant' ELSE 'trial' END, 'active', now(),
    now() + CASE WHEN is_admin THEN interval '3650 days' ELSE interval '3 days' END,
    CASE WHEN is_admin THEN 'admin' ELSE 'trial' END, 0,
    CASE WHEN is_admin THEN 'ADMIN' ELSE 'TRIAL' END);
  RETURN new;
END; $fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_subscription_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE ref_row public.referrals%rowtype; total_count int; referrer uuid;
BEGIN
  IF new.status <> 'active' THEN RETURN new; END IF;
  IF new.plan IN ('trial', 'admin_grant', 'free') THEN RETURN new; END IF;
  IF tg_op = 'UPDATE' AND old.status = 'active' AND old.plan = new.plan THEN RETURN new; END IF;
  SELECT referred_by INTO referrer FROM public.profiles WHERE id = new.user_id;
  IF referrer IS NULL THEN RETURN new; END IF;
  SELECT * INTO ref_row FROM public.referrals WHERE referee_id = new.user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.referrals(referrer_id, referee_id, bonus_days_awarded, activated_at)
    VALUES (referrer, new.user_id, 30, now()) RETURNING * INTO ref_row;
  ELSIF ref_row.activated_at IS NULL THEN
    UPDATE public.referrals SET bonus_days_awarded = 30, activated_at = now() WHERE id = ref_row.id;
  ELSE
    RETURN new;
  END IF;
  PERFORM public.extend_subscription(referrer, 30);
  SELECT count(*) INTO total_count FROM public.referrals WHERE referrer_id = referrer AND activated_at IS NOT NULL;
  IF total_count > 0 AND total_count % 5 = 0 THEN
    PERFORM public.extend_subscription(referrer, 30);
    UPDATE public.referrals SET milestone_awarded = true WHERE id = ref_row.id;
    INSERT INTO public.notifications(user_id, title, body, kind, payload)
    VALUES (referrer, 'Milestone bonus!', 'You hit ' || total_count || ' referrals — +30 days added.', 'system', jsonb_build_object('milestone', total_count));
  END IF;
  INSERT INTO public.notifications(user_id, title, body, kind, payload)
  VALUES (referrer, 'Referral activated', 'A user you referred just subscribed — +30 days added.', 'system', jsonb_build_object('referee_id', new.user_id));
  RETURN new;
END; $fn$;

UPDATE public.profiles SET referral_code = upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)) WHERE referral_code IS NULL;