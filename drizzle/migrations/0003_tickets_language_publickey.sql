
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_key text;

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  claimed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own tickets" ON public.tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'helper'));

CREATE POLICY "Users create own tickets" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Helpers and admins update tickets" ON public.tickets FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'helper'));

CREATE UNIQUE INDEX tickets_one_open_per_user ON public.tickets (user_id) WHERE status = 'open';

CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE public.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read ticket messages" ON public.ticket_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'helper')))
  );

CREATE POLICY "Insert ticket messages" ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR t.claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'helper')))
  );

INSERT INTO public.app_settings (key, value, updated_at) VALUES ('winter_sale', '{"enabled": true, "multiplier": 1.2}'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = '{"enabled": true, "multiplier": 1.2}'::jsonb, updated_at = now();
