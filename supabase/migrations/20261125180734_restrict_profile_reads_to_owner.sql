alter policy "profile self or groupmate read" on public.profiles using (id = (select auth.uid()));
alter policy "profile self or groupmate read" on public.profiles rename to "profile self read";
