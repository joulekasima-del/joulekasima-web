-- Field Notes (the owner's blog): posts, categories and the links between them.
-- PR 1 of 2 only the private /admin/notes page uses these tables; nothing is public yet.
--
-- Run once in the Supabase SQL editor. Additive only; safe to re-run (every statement is "if not exists").
-- Until it has run, the admin Field Notes page shows a "run migration 0006" notice and the public site is unaffected.

create table if not exists fieldnotes_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                       -- the URL part, e.g. 'on-slow-mornings' (Thai characters allowed)
  title text not null,
  summary text,
  body_md text not null default '',                -- the owner's simple formatting (## headings, **bold**, - lists ...)
  lang text not null default 'en',
  thai_font text default 'noto-sans-thai',         -- which free Thai font the article uses (only matters when lang = 'th')
  cover_image_url text,                            -- NOT USED YET (cover images come later); kept so no later migration is needed
  status text not null default 'draft',
  published_at timestamptz,                        -- set the first time a post is published, then kept
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,                  -- +1 on every change; the admin page uses it to refuse stale edits
  constraint fieldnotes_posts_lang_check check (lang in ('en', 'th')),
  constraint fieldnotes_posts_status_check check (status in ('draft', 'published')),
  constraint fieldnotes_posts_slug_len check (char_length(slug) between 1 and 120),
  constraint fieldnotes_posts_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint fieldnotes_posts_summary_len check (summary is null or char_length(summary) <= 300),
  constraint fieldnotes_posts_body_len check (char_length(body_md) <= 100000),
  constraint fieldnotes_posts_published_has_date check (status <> 'published' or published_at is not null)
);

create index if not exists fieldnotes_posts_status_published_idx on fieldnotes_posts (status, published_at desc);
create index if not exists fieldnotes_posts_updated_idx on fieldnotes_posts (updated_at desc);

create table if not exists fieldnotes_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  constraint fieldnotes_categories_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint fieldnotes_categories_slug_len check (char_length(slug) between 1 and 120)
);
-- "Slow" and "slow" are the same category.
create unique index if not exists fieldnotes_categories_name_ci_key on fieldnotes_categories (lower(name));

create table if not exists fieldnotes_post_categories (
  post_id uuid not null references fieldnotes_posts (id) on delete cascade,
  category_id uuid not null references fieldnotes_categories (id) on delete cascade,
  primary key (post_id, category_id)
);
create index if not exists fieldnotes_post_categories_category_idx on fieldnotes_post_categories (category_id);

-- Service role only: RLS on, NO policies, and no direct grants to the public API roles (same as 0005).
alter table fieldnotes_posts enable row level security;
alter table fieldnotes_categories enable row level security;
alter table fieldnotes_post_categories enable row level security;
revoke all on table fieldnotes_posts from anon, authenticated;
revoke all on table fieldnotes_categories from anon, authenticated;
revoke all on table fieldnotes_post_categories from anon, authenticated;
